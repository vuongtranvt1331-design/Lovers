@echo off
setlocal
title Pocket Space - Local
set "POCKET_LAUNCHER=%~f0"
set "POCKET_BOOT=import os; from pathlib import Path; p = Path(os.environ['POCKET_LAUNCHER']); exec(compile(p.read_text(encoding='utf-8').split('\n# Python launcher\n', 1)[1], str(p), 'exec'))"

py -3 -c "import sys; assert sys.version_info >= (3, 7)" >nul 2>&1
if not errorlevel 1 (
    py -3 -c "%POCKET_BOOT%"
    goto finished
)

python -c "import sys; assert sys.version_info >= (3, 7)" >nul 2>&1
if not errorlevel 1 (
    python -c "%POCKET_BOOT%"
    goto finished
)

echo Can Python 3.7 tro len de mo Pocket Space.
pause
exit /b 1

:finished
set "POCKET_EXIT=%errorlevel%"
if not "%POCKET_EXIT%"=="0" pause
exit /b %POCKET_EXIT%

# Python launcher
import os
import threading
import webbrowser
from functools import partial
from http.client import HTTPConnection, HTTPException
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


HOST = "127.0.0.1"
PORT = 8765
URL = f"http://{HOST}:{PORT}/"
ROOT = Path(os.environ["POCKET_LAUNCHER"]).resolve().parent


def open_browser():
    if not webbrowser.open(URL):
        print(f"Mở trình duyệt và truy cập {URL}", flush=True)


def existing_pocket_space(index):
    connection = HTTPConnection(HOST, PORT, timeout=1)
    try:
        expected = index.read_bytes()
        connection.request("GET", "/index.html")
        response = connection.getresponse()
        return response.status == 200 and response.read(len(expected) + 1) == expected
    except (OSError, HTTPException):
        return False
    finally:
        connection.close()


def main():
    index = ROOT / "index.html"
    if not index.is_file():
        print("Hãy đặt file này cùng thư mục với index.html của Pocket Space.")
        return 1

    handler = partial(SimpleHTTPRequestHandler, directory=str(ROOT))
    try:
        server = ThreadingHTTPServer((HOST, PORT), handler)
    except OSError as error:
        if existing_pocket_space(index):
            open_browser()
            return 0
        print(f"Không thể mở Pocket Space tại {URL}")
        print(error)
        return 1

    print(f"Pocket Space đang chạy tại {URL}", flush=True)
    print("Giữ cửa sổ này mở khi dùng app. Nhấn Ctrl+C để dừng.", flush=True)
    with server:
        threading.Thread(target=open_browser, daemon=True).start()
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
    return 0


raise SystemExit(main())
