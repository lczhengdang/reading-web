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
from http.server import SimpleHTTPRequestHandler, HTTPServer
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

DEFAULT_PORT = 8080
DEFAULT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class TTSProxyHandler(SimpleHTTPRequestHandler):
    """扩展 SimpleHTTPRequestHandler，增加 /api/tts 反向代理"""

    def do_POST(self):
        if self.path == '/api/tts':
            self._proxy_tts()
        else:
            self.send_error(404, 'Unknown POST endpoint')

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
