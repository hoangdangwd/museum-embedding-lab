"""Exercise the real camera capture UI with a browser-generated video stream."""
import json
import socket
import threading
import time
from pathlib import Path
from tempfile import TemporaryDirectory

import uvicorn
from playwright.sync_api import sync_playwright, expect

from lab.app import create_app
from lab.embeddings import ROOT
from lab.images import read_picture
from lab.store import Store
from tests.test_lab import TestEmbedder, png

CAMERA = """
window.__streams = [];
window.__cameraColor = 'red';
navigator.mediaDevices.getUserMedia = async () => {
  if (window.__denyCamera) throw new DOMException('Permission denied', 'NotAllowedError');
  const canvas = document.createElement('canvas');
  canvas.width = 640; canvas.height = 480;
  const draw = () => { const context = canvas.getContext('2d'); context.fillStyle = window.__cameraColor; context.fillRect(0, 0, 640, 480); };
  draw();
  const stream = canvas.captureStream(15);
  const timer = setInterval(draw, 60);
  window.__streams.push(stream);
  window.addEventListener('pagehide', () => clearInterval(timer));
  return stream;
};
"""

def main():
    report_dir = ROOT / "reports" / "ui-smoke"
    report_dir.mkdir(parents=True, exist_ok=True)
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    with TemporaryDirectory(prefix="camera-", dir=report_dir) as database_dir:
        app = create_app(Store(Path(database_dir) / "lab.sqlite3"), TestEmbedder())
        server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="error"))
        thread = threading.Thread(target=server.run, daemon=True)
        thread.start()
        errors = []
        try:
            for _ in range(100):
                if server.started: break
                time.sleep(.05)
            with sync_playwright() as p:
                browser = p.chromium.launch(channel="msedge", headless=True)
                page = browser.new_page(viewport={"width": 390, "height": 844})
                page.add_init_script(CAMERA)
                page.on("pageerror", lambda error: errors.append(str(error)))
                page.goto(f"http://127.0.0.1:{port}")
                page.locator("#username").fill("Nguyễn Minh")
                page.locator("#loginForm button").click()
                page.wait_for_url(f"http://127.0.0.1:{port}/")
                expect(page.locator("#openCamera")).to_be_visible()
                assert page.locator('input[type=file], #referenceList, #modelName, #threshold, #compareForm').count() == 0
                page.locator("#openCamera").click()
                expect(page.locator("#notice")).to_contain_text("chưa sẵn sàng")
                assert page.evaluate("window.__streams.length") == 0
                for artifact, color in [("bottle", "red"), ("mask", "blue")]:
                    app.state.lab.store.add(artifact, color + ".png", read_picture(png(color)))
                app.state.lab.build()
                page.evaluate("window.__denyCamera = true")
                page.locator("#openCamera").click()
                expect(page.locator("#notice")).to_contain_text("Cho phép camera")
                page.evaluate("window.__denyCamera = false")
                page.locator("#openCamera").click()
                expect(page.locator("#capturePhoto")).to_be_visible()
                page.wait_for_function("document.getElementById('cameraVideo').videoWidth > 0")
                page.screenshot(path=str(report_dir / "camera-mobile.png"), full_page=True)
                page.locator("#capturePhoto").click()
                expect(page.locator("#resultName")).to_have_text("Chai nước")
                assert page.evaluate("window.__streams.every(s => s.getTracks().every(t => t.readyState === 'ended'))")
                assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")
                page.screenshot(path=str(report_dir / "result-mobile.png"), full_page=True)
                page.set_viewport_size({"width": 1440, "height": 1050})
                page.screenshot(path=str(report_dir / "result-desktop.png"), full_page=True)
                page.evaluate("window.__cameraColor = 'gray'")
                page.locator("#retake").click()
                expect(page.locator("#capturePhoto")).to_be_visible()
                page.locator("#capturePhoto").click()
                expect(page.locator("#resultName")).to_have_text("Chưa nhận ra")
                assert len(app.state.lab.store.list(app.state.lab.embedder.signature)) == 2
                page.route("**/api/query", lambda route: route.fulfill(status=503, json={"detail": "Hãy thử lại."}))
                page.locator("#retake").click()
                expect(page.locator("#capturePhoto")).to_be_visible()
                page.locator("#capturePhoto").click()
                expect(page.locator("#notice")).to_have_text("Hãy thử lại.")
                expect(page.locator("#retake")).to_be_visible()
                page.locator("#logout").click()
                page.wait_for_url(f"http://127.0.0.1:{port}/login")
                assert not errors, errors
                browser.close()
            print(json.dumps({"status": "passed", "browser_errors": errors,
                              "checks": ["camera-only UI", "preloaded catalog", "camera permission retry",
                                         "capture and automatic recognition", "unknown result", "retake",
                                         "camera tracks released", "server error retry", "mobile layout", "logout"]}))
        finally:
            server.should_exit = True
            thread.join(timeout=5)

if __name__ == "__main__":
    main()