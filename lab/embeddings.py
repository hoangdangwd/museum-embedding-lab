import base64
import io
import os
import threading
from pathlib import Path

import httpx
import numpy as np
from PIL import Image

from .images import LabError, PREPROCESS_VERSION

ROOT = Path(__file__).resolve().parent.parent
API = "https://openrouter.ai/api/v1"


def normalize(vector) -> np.ndarray:
    try:
        array = np.asarray(vector, dtype=np.float32)
    except (TypeError, ValueError) as exc:
        raise LabError("Model trả vector không hợp lệ.", 502) from exc
    if array.ndim != 1 or len(array) < 2 or not np.isfinite(array).all():
        raise LabError("Model trả vector sai chiều hoặc có giá trị không hữu hạn.", 502)
    norm = float(np.linalg.norm(array.astype(np.float64)))
    if norm <= 1e-12:
        raise LabError("Model trả vector rỗng/zero.", 502)
    return (array / norm).astype(np.float32)


class Embedder:
    def __init__(self):
        self.provider = os.getenv("EMBEDDING_PROVIDER", "openrouter")
        if self.provider not in {"local", "openrouter"}:
            raise RuntimeError("EMBEDDING_PROVIDER phải là local hoặc openrouter.")
        self.model = os.getenv("LOCAL_MODEL", "google/siglip2-base-patch16-224") if self.provider == "local" else os.getenv("OPENROUTER_MODEL", "google/gemini-embedding-2")
        self.revision = os.getenv("LOCAL_REVISION", "main")
        self.version = os.getenv("EMBEDDING_VERSION", "1")
        self.key = os.getenv("OPENROUTER_API_KEY", "")
        self.device = os.getenv("LOCAL_DEVICE", "cpu")
        self._model = self._processor = None
        self._lock = threading.Lock()
        self._validated = False
        self._resolved_revision = None
        self._model_aliases = {self.model}
        self._response_model = None

    @property
    def signature(self):
        revision = (self._resolved_revision or self.revision) if self.provider == "local" else self.version
        return f"{self.provider}|{self.model}|{revision}|{self.version}|{PREPROCESS_VERSION}"

    def info(self):
        return {"provider": self.provider, "model": self.model, "signature": self.signature,
                "configured": self.provider == "local" or bool(self.key),
                "loaded": self._model is not None or self._validated,
                "response_model": self._response_model,
                "device": self.device if self.provider == "local" else "API"}

    def _request(self, method, path, **kwargs):
        headers = {"Authorization": f"Bearer {self.key}", "X-Title": "Museum Embedding Lab"} if self.key else {}
        try:
            response = httpx.request(method, API + path, headers=headers, timeout=90, **kwargs)
        except httpx.TimeoutException as exc:
            raise LabError("Model phản hồi quá chậm (90 giây). Hãy thử lại.", 504) from exc
        except httpx.HTTPError as exc:
            raise LabError("Không kết nối được OpenRouter. Kiểm tra mạng/proxy.", 502) from exc
        if response.status_code != 200:
            descriptions = {400: "Model từ chối định dạng ảnh hoặc tham số.", 401: "API key thiếu hoặc không hợp lệ.",
                            402: "Tài khoản OpenRouter không đủ số dư.", 403: "Tài khoản không có quyền dùng model.",
                            404: "Không tìm thấy model hoặc provider.", 429: "Vượt giới hạn lượt gọi; hãy thử lại sau."}
            message = descriptions.get(response.status_code, "Provider gặp lỗi xử lý.")
            # Never reflect raw provider responses: they can contain input images or credentials.
            raise LabError(f"OpenRouter HTTP {response.status_code}: {message}", 502)
        try:
            return response.json()
        except ValueError as exc:
            raise LabError("OpenRouter trả nội dung không phải JSON.", 502) from exc

    def prepare(self):
        with self._lock:
            if self.provider == "openrouter":
                if not self.key:
                    raise LabError("Điền OPENROUTER_API_KEY trong .env rồi khởi động lại server.")
                if not self._validated:
                    catalog = self._request("GET", "/embeddings/models")
                    model = next((m for m in catalog.get("data", []) if m.get("id") == self.model), None)
                    if not model or "image" not in model.get("architecture", {}).get("input_modalities", []):
                        raise LabError("Model đã chọn không có image embedding trong danh mục OpenRouter.")
                    # OpenRouter may echo the upstream model ID without its catalog namespace.
                    # Accept only the requested catalog ID/canonical slug and their exact native IDs.
                    for identifier in (self.model, model.get("canonical_slug")):
                        if identifier:
                            self._model_aliases.add(identifier)
                            self._model_aliases.add(identifier.split("/", 1)[-1])
                    self._validated = True
                return
            if self._model is not None:
                return
            try:
                import torch
                from transformers import AutoImageProcessor, AutoModel
            except ImportError as exc:
                raise LabError("Chưa cài model local. Chạy pip install -r requirements-local.txt trong .venv.") from exc
            try:
                torch.set_num_threads(max(1, min(4, os.cpu_count() or 1)))
                options = {"revision": self.revision, "cache_dir": str(ROOT / "models"), "trust_remote_code": False}
                processor = AutoImageProcessor.from_pretrained(self.model, **options)
                model = AutoModel.from_pretrained(self.model, **options).to(self.device).eval()
                if not hasattr(model, "get_image_features"):
                    raise LabError("Model local phải hỗ trợ get_image_features.")
                self._processor, self._model = processor, model
                self._resolved_revision = getattr(model.config, "_commit_hash", None) or self.revision
            except LabError:
                raise
            except Exception as exc:
                raise LabError(f"Không tải được model local ({type(exc).__name__}). Kiểm tra kết nối, bộ nhớ và LOCAL_DEVICE.", 503) from exc

    def embed(self, jpeg: bytes):
        self.prepare()
        if self.provider == "openrouter":
            data_url = "data:image/jpeg;base64," + base64.b64encode(jpeg).decode("ascii")
            result = self._request("POST", "/embeddings", json={
                "model": self.model, "encoding_format": "float",
                "input": [{"content": [{"type": "image_url", "image_url": {"url": data_url}}]}],
            })
            rows = result.get("data", [])
            if len(rows) != 1 or not isinstance(rows[0].get("embedding"), list):
                raise LabError("Model không trả đúng một vector cho ảnh.", 502)
            if result.get("model") not in self._model_aliases:
                raise LabError("Provider trả tên model khác cấu hình; không lưu vector để tránh trộn model.", 502)
            self._response_model = result["model"]
            return normalize(rows[0]["embedding"]), result.get("usage", {})
        import torch
        with self._lock, torch.inference_mode():
            inputs = self._processor(images=Image.open(io.BytesIO(jpeg)), return_tensors="pt").to(self.device)
            vector = self._model.get_image_features(**inputs)
            return normalize(vector[0].float().cpu().numpy()), {}
