#!/usr/bin/env python3
"""
考研阅读 Web 版 - 本地开发服务器（带 TTS 反向代理）
解决火山方舟 TTS 接口的 CORS 问题

用法：python tools/serve.py [端口] [目录]
示例：python tools/serve.py 8080
"""

import json
import sys
import os
import socket
import ssl
import struct
import uuid
import base64
import time
from http.server import SimpleHTTPRequestHandler, HTTPServer
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

DEFAULT_PORT = 8080
DEFAULT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

DOUBAO_WS_HOST = 'openspeech.bytedance.com'
DOUBAO_WS_PATH = '/api/v3/tts/bidirection'
DOUBAO_HTTP_URL = 'https://openspeech.bytedance.com/api/v3/tts/unidirectional'
DOUBAO_RESOURCE = 'seed-tts-2.0'

# ---- 事件码（V3 双向流式二进制协议） ----
EV_START_CONNECTION = 1
EV_FINISH_CONNECTION = 2
EV_CONNECTION_STARTED = 50
EV_CONNECTION_FAILED = 51
EV_START_SESSION = 100
EV_FINISH_SESSION = 102
EV_SESSION_STARTED = 150
EV_SESSION_FINISHED = 152
EV_SESSION_FAILED = 153
EV_TASK_REQUEST = 200
EV_TTS_SENTENCE_START = 350
EV_TTS_SENTENCE_END = 351
EV_TTS_RESPONSE = 352


class TTSProtocolError(Exception):
    pass


def _build_event_frame(event, obj):
    """构建上行二进制协议帧：4字节帧头 + int32事件 + uint32长度 + JSON负载"""
    payload = json.dumps(obj, ensure_ascii=False).encode('utf-8')
    head = bytes([0x11, 0x14, 0x10, 0x00]) + struct.pack('>iI', event, len(payload))
    return head + payload


def _parse_protocol_frame(data):
    """解析下行协议帧，返回 (event, body_bytes)；错误帧抛异常"""
    if len(data) < 8:
        raise TTSProtocolError('帧长度不足: %d' % len(data))
    msg_type = (data[1] >> 4) & 0x0F
    if msg_type == 0x0F:  # 错误帧
        code = struct.unpack('>i', data[4:8])[0]
        msg = data[8:].decode('utf-8', errors='replace')
        raise TTSProtocolError('服务端错误 %d: %s' % (code, msg[:200]))
    event = struct.unpack('>i', data[4:8])[0]
    if len(data) >= 12:
        size = struct.unpack('>I', data[8:12])[0]
        body = data[12:12 + size]
    else:
        body = b''
    return event, body


def _ws_connect(headers):
    """纯标准库 WebSocket 握手（可携带自定义请求头）"""
    sock = socket.create_connection((DOUBAO_WS_HOST, 443), timeout=15)
    ssock = ssl.create_default_context().wrap_socket(sock, server_hostname=DOUBAO_WS_HOST)
    key = base64.b64encode(os.urandom(16)).decode()
    req = ('GET %s HTTP/1.1\r\nHost: %s\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n'
           'Sec-WebSocket-Key: %s\r\nSec-WebSocket-Version: 13\r\n') % (DOUBAO_WS_PATH, DOUBAO_WS_HOST, key)
    for k, v in headers.items():
        req += '%s: %s\r\n' % (k, v)
    req += '\r\n'
    ssock.sendall(req.encode())
    buf = b''
    while b'\r\n\r\n' not in buf:
        chunk = ssock.recv(4096)
        if not chunk:
            raise TTSProtocolError('WebSocket 握手无响应')
        buf += chunk
    head, _, rest = buf.partition(b'\r\n\r\n')
    status_line = head.split(b'\r\n')[0].decode(errors='replace')
    if ' 101 ' not in status_line and not status_line.endswith(' 101'):
        raise TTSProtocolError('WebSocket 升级被拒绝: ' + status_line + ' ' + head[:300].decode(errors='replace'))
    return ssock, rest


def _ws_send(ssock, payload, opcode=1):
    """发送客户端帧（RFC6455 要求掩码）"""
    header = bytearray([0x80 | opcode])
    ln = len(payload)
    if ln < 126:
        header.append(0x80 | ln)
    elif ln < 65536:
        header.append(0x80 | 126)
        header += struct.pack('>H', ln)
    else:
        header.append(0x80 | 127)
        header += struct.pack('>Q', ln)
    mask = os.urandom(4)
    header += mask
    masked = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
    ssock.sendall(bytes(header) + masked)


class _WsReader:
    def __init__(self, ssock, buf):
        self.s = ssock
        self.buf = buf

    def read_frame(self):
        def exact(n):
            while len(self.buf) < n:
                chunk = self.s.recv(65536)
                if not chunk:
                    raise TTSProtocolError('连接已关闭')
                self.buf += chunk
            d, self.buf = self.buf[:n], self.buf[n:]
            return d
        h = exact(2)
        opcode = h[0] & 0x0F
        ln = h[1] & 0x7F
        if ln == 126:
            ln = struct.unpack('>H', exact(2))[0]
        elif ln == 127:
            ln = struct.unpack('>Q', exact(8))[0]
        mask = exact(4) if (h[1] & 0x80) else None
        payload = exact(ln)
        if mask:
            payload = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
        return opcode, payload


def _wait_event(reader, expected, timeout_at):
    """循环读帧直到收到期望事件；忽略无关事件；返回 body"""
    while True:
        if time.time() > timeout_at:
            raise TTSProtocolError('等待事件 %d 超时' % expected)
        opcode, payload = reader.read_frame()
        if opcode == 8:
            raise TTSProtocolError('服务端关闭了连接')
        if opcode not in (1, 2) or len(payload) < 8:
            continue
        event, body = _parse_protocol_frame(payload)
        if event == expected:
            return body
        if event in (EV_CONNECTION_FAILED, EV_SESSION_FAILED):
            raise TTSProtocolError('服务端返回失败事件 %d: %s' % (event, body[:200].decode('utf-8', errors='replace')))


def _extract_audio(body):
    """从 TTSResponse 负载提取音频：兼容带 8 字节前缀与纯音频两种布局"""
    if len(body) > 8:
        seq = struct.unpack('>I', body[0:4])[0]
        size = struct.unpack('>I', body[4:8])[0]
        if seq < 100000 and size == len(body) - 8:
            return body[8:]
    return body


def doubao_tts_bidirection(text, api_key, speaker):
    """双向流式 WebSocket 合成（豆包语音合成大模型 2.0），返回完整 mp3 字节"""
    connect_id = str(uuid.uuid4())
    session_id = str(uuid.uuid4())
    ssock, rest = _ws_connect({
        'X-Api-Key': api_key,
        'X-Api-Resource-Id': DOUBAO_RESOURCE,
        'X-Api-Connect-Id': connect_id,
    })
    audio = bytearray()
    try:
        reader = _WsReader(ssock, rest)
        deadline = time.time() + 30
        _ws_send(ssock, _build_event_frame(EV_START_CONNECTION, {}))
        _wait_event(reader, EV_CONNECTION_STARTED, deadline)
        _ws_send(ssock, _build_event_frame(EV_START_SESSION, {
            'session_id': session_id,
            'req_params': {
                'speaker': speaker,
                'audio_params': {'format': 'mp3', 'sample_rate': 24000},
            },
        }))
        _wait_event(reader, EV_SESSION_STARTED, deadline)
        _ws_send(ssock, _build_event_frame(EV_TASK_REQUEST, {'text': text}))
        _ws_send(ssock, _build_event_frame(EV_FINISH_SESSION, {'session_id': session_id}))
        while True:
            if time.time() > deadline + 30:
                raise TTSProtocolError('音频接收超时')
            opcode, payload = reader.read_frame()
            if opcode == 8:
                break
            if opcode not in (1, 2) or len(payload) < 8:
                continue
            event, body = _parse_protocol_frame(payload)
            if event == EV_TTS_RESPONSE:
                audio += _extract_audio(body)
            elif event == EV_SESSION_FINISHED:
                break
            elif event == EV_SESSION_FAILED:
                raise TTSProtocolError('会话失败: %s' % body[:200].decode('utf-8', errors='replace'))
        try:
            _ws_send(ssock, _build_event_frame(EV_FINISH_CONNECTION, {}))
        except Exception:
            pass
    finally:
        try:
            ssock.close()
        except Exception:
            pass
    if not audio:
        raise TTSProtocolError('未收到任何音频数据')
    return bytes(audio)


def doubao_tts_http_fallback(text, api_key, speaker):
    """降级：HTTP 单向流式（同一模型 seed-tts-2.0、同一鉴权）"""
    req = Request(DOUBAO_HTTP_URL, data=json.dumps({
        'req_params': {
            'text': text,
            'speaker': speaker,
            'audio_params': {'format': 'mp3', 'sample_rate': 24000},
        },
    }, ensure_ascii=False).encode('utf-8'), headers={
        'X-Api-Key': api_key,
        'X-Api-Resource-Id': DOUBAO_RESOURCE,
        'X-Api-Request-Id': str(uuid.uuid4()),
        'Content-Type': 'application/json',
    }, method='POST')
    with urlopen(req, timeout=60) as resp:
        return resp.read()



class TTSProxyHandler(SimpleHTTPRequestHandler):
    """扩展 SimpleHTTPRequestHandler，增加 /api/tts 反向代理"""

    def do_POST(self):
        if self.path == '/api/tts':
            self._proxy_tts()
        elif self.path == '/api/tts2':
            self._proxy_tts2()
        else:
            self.send_error(404, 'Unknown POST endpoint')

    def _proxy_tts2(self):
        """豆包语音合成大模型 2.0：优先双向流式 WebSocket，失败自动降级 HTTP 单向流式"""
        content_length = int(self.headers.get('Content-Length', 0))
        try:
            req = json.loads(self.rfile.read(content_length).decode('utf-8'))
        except ValueError:
            self.send_error(400, 'Invalid JSON body')
            return
        text = (req.get('text') or '').strip()
        api_key = req.get('apiKey') or ''
        speaker = req.get('speaker') or ''
        if not text or not api_key or not speaker:
            self.send_error(400, 'Missing text / apiKey / speaker')
            return
        errors = []
        audio = None
        try:
            audio = doubao_tts_bidirection(text, api_key, speaker)
        except HTTPError as e:
            errors.append('WebSocket(HTTP %d): %s' % (e.code, e.read()[:200].decode(errors='replace')))
        except Exception as e:
            errors.append('WebSocket: %s' % e)
        if audio is None:
            try:
                audio = doubao_tts_http_fallback(text, api_key, speaker)
            except HTTPError as e:
                detail = e.read()[:300].decode(errors='replace')
                self._send_json_error(e.code, 'Upstream HTTP error: %s | %s' % (detail, ' ; '.join(errors)))
                return
            except URLError as e:
                self._send_json_error(502, 'Upstream unreachable: %s | %s' % (e.reason, ' ; '.join(errors)))
                return
            except Exception as e:
                self._send_json_error(500, 'TTS failed: %s | %s' % (e, ' ; '.join(errors)))
                return
        self.send_response(200)
        self.send_header('Content-Type', 'audio/mpeg')
        self.send_header('Content-Length', str(len(audio)))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(audio)

    def _send_json_error(self, code, message):
        """用 UTF-8 JSON 返回错误（send_error 不支持非 latin-1 字符）"""
        body = json.dumps({'error': message}, ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(body)

    def _proxy_tts(self):
        # 读取请求体
        content_length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(content_length) if content_length > 0 else b''

        # 从请求体中提取原始端点和 API Key（同源请求不会发送自定义头，故改用 body 传递）
        original_endpoint = ''
        api_key = ''
        try:
            payload = json.loads(body.decode('utf-8'))
            original_endpoint = payload.pop('_endpoint', '')
            api_key = payload.pop('_apiKey', '')
            body = json.dumps(payload).encode('utf-8')
        except (ValueError, KeyError):
            pass
        # 兼容请求头方式
        if not original_endpoint:
            original_endpoint = self.headers.get('X-Original-Endpoint', '')
        if not api_key:
            api_key = self.headers.get('Authorization', '')

        if not original_endpoint or not api_key:
            self.send_error(400, 'Missing _endpoint or _apiKey in request body')
            return

        # 转发到火山方舟
        try:
            req = Request(
                original_endpoint,
                data=body,
                headers={
                    'Authorization': api_key,
                    'Content-Type': 'application/json',
                },
                method='POST',
            )
            with urlopen(req, timeout=30) as resp:
                audio_data = resp.read()
                content_type = resp.headers.get('Content-Type', 'audio/mpeg')

            # 返回音频给浏览器
            self.send_response(200)
            self.send_header('Content-Type', content_type)
            self.send_header('Content-Length', str(len(audio_data)))
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(audio_data)

        except HTTPError as e:
            self.send_error(e.code, f'Upstream error: {e.reason}')
        except URLError as e:
            self.send_error(502, f'Upstream unreachable: {e.reason}')
        except Exception as e:
            self.send_error(500, f'Proxy error: {str(e)}')

    # 允许跨域（开发环境）
    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Original-Endpoint')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()


def _port_has_responder(p):
    """探测端口上是否已有其他服务器在响应
    （Windows 上 allow_reuse_address 可能让 bind 成功但请求仍被旧进程处理）"""
    import socket
    try:
        with socket.create_connection(('127.0.0.1', p), timeout=0.5):
            return True
    except OSError:
        return False


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_PORT
    directory = sys.argv[2] if len(sys.argv) > 2 else DEFAULT_DIR

    os.chdir(directory)

    # 端口被占用或已有旧服务器响应时自动顺延（常见于旧的 python -m http.server 未关闭）
    server = None
    for p in range(port, port + 10):
        if _port_has_responder(p):
            print(f'端口 {p} 已有服务器在运行（可能是未关闭的旧服务器），改用下一个端口…')
            continue
        try:
            server = HTTPServer(('0.0.0.0', p), TTSProxyHandler)
            port = p
            break
        except OSError:
            print(f'端口 {p} 被占用，尝试下一个…')
    if server is None:
        print(f'错误：端口 {port}~{port + 9} 均被占用，请关闭旧服务器后重试')
        sys.exit(1)

    print(f'考研阅读 Web 版 - 本地服务器（带 TTS 代理）')
    print(f'目录：{directory}')
    print(f'端口：{port}')
    print(f'访问：http://localhost:{port}   ← 请以本端口为准，勿用旧端口')
    print(f'TTS 代理：POST /api/tts -> 火山方舟')
    print(f'按 Ctrl+C 停止')
    print()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\n停止服务器')
        server.server_close()


if __name__ == '__main__':
    main()
