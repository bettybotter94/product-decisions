#!/usr/bin/env python3
"""Локальный сервер для прототипа.

Отличается от `python3 -m http.server` одним: запрещает кэширование.
Без этого браузер держит старую версию сценария после правки — и ты
видишь не то, что написала. Отладка такого стоит часа злости.

Запуск:  python3 serve.py  (потом http://localhost:8765/index.html)
"""
import http.server
import socketserver
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8765


class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def log_message(self, fmt, *args):
        if '200' not in (args[1] if len(args) > 1 else ''):
            super().log_message(fmt, *args)


socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(('127.0.0.1', PORT), NoCache) as httpd:
    print(f'Прототип: http://localhost:{PORT}/index.html')
    print('Остановить — Ctrl+C')
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print('\nОстановлено.')
