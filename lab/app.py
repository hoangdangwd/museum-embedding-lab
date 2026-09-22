import logging
import os
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

from .embeddings import Embedder, ROOT
from .access import Access
from .images import LabError, MAX_BYTES, read_picture
from .service import Lab
from .store import Store


def create_app(store=None, embedder=None):
    load_dotenv(ROOT / ".env")
    database = Path(os.getenv("LAB_DATABASE", str(ROOT / "data" / "lab.sqlite3")))
    lab = Lab(store or Store(database), embedder or Embedder())
    access = Access(os.getenv("LAB_SESSION_SECRET") or os.getenv("LAB_ACCESS_PASSWORD", ""))
    app = FastAPI(title="Museum Embedding Lab", version="0.1.0", docs_url=None, redoc_url=None, openapi_url=None)
    app.state.lab = lab

    @app.middleware("http")
    async def guard(request, call_next):
        # Uvicorn trusts proxy headers only from the local tunnel process.
        origin = request.headers.get("origin")
        if request.method not in {"GET", "HEAD", "OPTIONS"} and origin and origin != str(request.base_url).rstrip("/"):
            return JSONResponse({"detail": "Origin không được phép."}, status_code=403)
        length = request.headers.get("content-length")
        try:
            if length and int(length) > 32 * 1024 * 1024:
                return JSONResponse({"detail": "Tổng upload vượt 32 MB."}, status_code=413)
        except ValueError:
            return JSONResponse({"detail": "Content-Length không hợp lệ."}, status_code=400)
        path = request.url.path
        public = path in {"/login", "/api/session", "/healthz"} or path.startswith("/static/")
        request.state.username = access.username(request.cookies.get(access.cookie))
        if not public and not request.state.username:
            if path.startswith("/api/"):
                return JSONResponse({"detail": "Hãy nhập tên người dùng để tiếp tục."}, status_code=401)
            return RedirectResponse("/login", status_code=303)
        if path in {"/api/query", "/api/compare", "/api/index"} and request.method == "POST":
            if not access.allow(access.paid_calls, 30, 60):
                return JSONResponse({"detail": "Tối đa 30 lượt xử lý/phút cho bản thử. Hãy chờ một chút."}, status_code=429)
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Permissions-Policy"] = "camera=(self), microphone=(), geolocation=()"
        if not path.startswith("/static/"):
            response.headers["Cache-Control"] = "no-store"
        return response

    @app.exception_handler(LabError)
    async def lab_error(request, exc):
        return JSONResponse({"detail": str(exc)}, status_code=exc.status)

    @app.exception_handler(Exception)
    async def unexpected(request, exc):
        logging.exception("Unhandled lab error")
        return JSONResponse({"detail": "Có lỗi xử lý. Xem log server để biết chi tiết."}, status_code=500)

    def picture(file):
        try:
            return read_picture(file.file.read(MAX_BYTES + 1))
        finally:
            file.file.close()

    @app.get("/")
    def index():
        return FileResponse(ROOT / "static" / "index.html")

    @app.get("/healthz")
    def health():
        return {"status": "ok"}

    @app.get("/login")
    def login_page():
        return FileResponse(ROOT / "static" / "login.html")

    @app.post("/api/session")
    def login(request: Request, username: str = Form("")):
        username = username.strip()
        if not access.valid_username(username):
            raise LabError("Tên người dùng phải có 1–100 ký tự và không chứa ký tự điều khiển.", 400)
        if not access.allow(access.attempts, 20, 60):
            raise LabError("Đã thử quá nhiều lần. Chờ một phút rồi thử lại.", 429)
        response = JSONResponse({"ok": True, "username": username})
        response.set_cookie(access.cookie, access.token(username), max_age=access.lifetime,
                            httponly=True, secure=request.url.scheme == "https", samesite="strict")
        return response

    @app.post("/api/logout")
    def logout():
        response = JSONResponse({"ok": True})
        response.delete_cookie(access.cookie)
        return response

    @app.get("/api/status")
    def status(request: Request):
        refs = lab.store.list(lab.embedder.signature)
        return {"username": request.state.username, "ready": bool(refs) and all(r["indexed"] for r in refs)}

    @app.post("/api/query")
    def query(file: UploadFile = File(...)):
        photo = picture(file)
        refs = lab.store.list(lab.embedder.signature)
        if not refs or not all(row["indexed"] for row in refs):
            raise LabError("Nhận diện chưa sẵn sàng. Hãy thử lại sau.", 503)
        try:
            result = lab.query(photo, float(os.getenv("RECOGNITION_THRESHOLD", "0.8")),
                               float(os.getenv("RECOGNITION_MARGIN", "0.05")))
        except LabError as exc:
            logging.warning("Recognition failed: %s", exc)
            raise LabError("Không nhận diện được lúc này. Hãy thử lại.", 502) from exc
        recognized = result["decision"] == "match"
        return {"recognized": recognized, "artifact": result["best_artifact"] if recognized else None}

    app.mount("/static", StaticFiles(directory=ROOT / "static"), name="static")
    return app


app = create_app()
