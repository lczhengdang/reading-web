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

        # 从请求头获取原始端点和 API Key
        original_endpoint = self.headers.get('X-Original-Endpoint', '')
        api_key = self.headers.get('Authorization', '')

        if not original_endpoint or not api_key:
            self.send_error(400, 'Missing X-Original-Endpoint or Authorization header')
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


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_PORT
    directory = sys.argv[2] if len(sys.argv) > 2 else DEFAULT_DIR

    os.chdir(directory)

    server = HTTPServer(('0.0.0.0', port), TTSProxyHandler)
    print(f'考研阅读 Web 版 - 本地服务器（带 TTS 代理）')
    print(f'目录：{directory}')
    print(f'端口：{port}')
    print(f'访问：http://localhost:{port}')
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
