"""Browser smoke test with a deterministic fixture model, isolated from user data."""
import json
import socket
import threading
import time
from pathlib import Path
from tempfile import TemporaryDirectory

import uvicorn
from playwright.sync_api import sync_playwright

from lab.app import create_app
from lab.embeddings import ROOT
from lab.store import Store
from tests.test_lab import TestEmbedder, png


def main():
    report_dir = ROOT / "reports" / "ui-smoke"
    report_dir.mkdir(parents=True, exist_ok=True)
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    database_dir = TemporaryDirectory(prefix="run-", dir=report_dir)
    app = create_app(Store(Path(database_dir.name) / "lab.sqlite3"), TestEmbedder())
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="error"))
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    errors = []
    try:
        for _ in range(100):
            if server.started:
                break
            time.sleep(.05)
        with sync_playwright() as p:
            browser = p.chromium.launch(channel="msedge", headless=True)
            page = browser.new_page(viewport={"width": 1440, "height": 1050})
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.goto(f"http://127.0.0.1:{port}")
            page.locator('#username').fill('Nguyễn Minh')
            page.locator('#loginForm button').click()
            page.wait_for_url(f"http://127.0.0.1:{port}/")
            page.wait_for_function("document.getElementById('modelName').textContent === 'fixture'")
            assert page.locator('#currentUser').inner_text() == 'Xin chào, Nguyễn Minh'
            assert page.locator('#logout').is_visible()
            for artifact in ("red", "blue"):
                page.locator("#artifact").fill(artifact)
                page.locator("#referenceFiles").set_input_files({"name": artifact + ".png", "mimeType": "image/png", "buffer": png(artifact)})
                page.locator("#referenceForm button").click()
                page.wait_for_function("document.getElementById('notice').textContent.includes('Bấm')")
                page.wait_for_function("!document.querySelector('#referenceForm button').disabled")
            page.locator("#build").click()
            page.wait_for_function("document.getElementById('counts').textContent.includes('2/2')")
            page.locator("#queryFile").set_input_files({"name": "query.png", "mimeType": "image/png", "buffer": png((215, 15, 15))})
            page.locator('#queryForm button[type="submit"]').click()
            page.locator("#resultPanel").wait_for(state="visible")
            assert "Phù hợp" in page.locator("#result .decision").first.inner_text()
            assert page.locator(".candidate").count() == 2
            with page.expect_download() as download:
                page.locator("#downloadQuery").click()
            download.value.save_as(report_dir / "query-result.json")
            assert len(json.loads((report_dir / "query-result.json").read_text(encoding="utf-8"))["embedding"]) == 3
            page.screenshot(path=str(report_dir / "desktop.png"), full_page=True)
            page.set_viewport_size({"width": 390, "height": 844})
            assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")
            page.screenshot(path=str(report_dir / "mobile.png"), full_page=True)
            page.locator('[data-pane="compare"]').click()
            for target in ("leftFile", "rightFile"):
                page.locator('#' + target).set_input_files({"name": "red.png", "mimeType": "image/png", "buffer": png("red")})
            page.locator("#compareForm button").click()
            page.locator("#compareResult").wait_for(state="visible")
            assert "1.0000" in page.locator("#compareResult").inner_text()
            page.locator('#logout').click()
            page.wait_for_url(f"http://127.0.0.1:{port}/login")
            page.locator('#username').fill('Lan')
            page.locator('#loginForm button').click()
            page.wait_for_url(f"http://127.0.0.1:{port}/")
            page.wait_for_function("document.getElementById('currentUser')?.textContent === 'Xin chào, Lan'")
            assert not errors, errors
            browser.close()
        print(json.dumps({"status": "passed", "model": "fixture, not real API", "browser_errors": errors,
                          "checks": ["username entry", "reference uploads", "index", "query", "JSON download", "mobile layout", "pair comparison", "change username"]}))
    finally:
        server.should_exit = True
        thread.join(timeout=5)
        database_dir.cleanup()


if __name__ == "__main__":
    main()
