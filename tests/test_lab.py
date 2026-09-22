import io
import json

import httpx
import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image

from lab.app import create_app
from lab.cli import evaluate
from lab.embeddings import Embedder, normalize
from lab.images import LabError, read_picture
from lab.service import Lab, rank
from lab.store import Store


def png(color):
    output = io.BytesIO()
    Image.new("RGB", (80, 64), color).save(output, "PNG")
    return output.getvalue()


class TestEmbedder:
    """Deterministic fixture only; never available in the application."""
    __test__ = False
    signature = "test-only:v1"
    calls = 0

    def prepare(self):
        pass

    def info(self):
        return {"provider": "test", "model": "fixture", "signature": self.signature}

    def embed(self, jpeg):
        self.calls += 1
        image = np.asarray(Image.open(io.BytesIO(jpeg)))
        return normalize(image.mean(axis=(0, 1)) + 1), {}


@pytest.fixture
def lab(tmp_path):
    return Lab(Store(tmp_path / "lab.sqlite3"), TestEmbedder())


def add_two(lab):
    for artifact, color in [("red", "red"), ("blue", "blue")]:
        lab.store.add(artifact, artifact + ".png", read_picture(png(color)))


def test_decode_exif_and_reject_bad_images():
    with pytest.raises(LabError):
        read_picture(b"this is not a picture")
    source = Image.new("RGB", (90, 60), "white")
    exif = source.getexif()
    exif[274] = 6
    buffer = io.BytesIO()
    source.save(buffer, "JPEG", exif=exif)
    picture = read_picture(buffer.getvalue())
    assert (picture.width, picture.height) == (60, 90)


def test_deduplication_persistence_and_conflicting_labels(lab):
    photo = read_picture(png("red"))
    first = lab.store.add("red", "a.png", photo)
    assert lab.store.add("red", "renamed.png", photo)["duplicate"]
    with pytest.raises(LabError):
        lab.store.add("blue", "a.png", photo)
    assert Store(lab.store.path).list(lab.embedder.signature)[0]["id"] == first["id"]


def test_index_cache_and_model_isolation(lab):
    add_two(lab)
    assert lab.build()["completed"] == 2
    assert lab.build()["cached"] == 2
    assert lab.embedder.calls == 2
    lab.embedder.signature = "test-only:v2"
    with pytest.raises(LabError, match="chưa được tạo embedding"):
        lab.query(read_picture(png("red")))
    assert lab.build()["completed"] == 2
    assert lab.embedder.calls == 4


def test_group_by_artifact_not_reference_image():
    rows = [{"id": i, "artifact": artifact, "filename": "a", "digest": "a"} for i, artifact in enumerate(["A", "A", "B"])]
    vectors = [normalize([1, 0]), normalize([.999, .01]), normalize([0, 1])]
    result = rank(rows, vectors, normalize([1, 0]), .8, .05)
    assert result["decision"] == "match"
    assert result["margin"] == pytest.approx(1)
    assert result["candidates"][0]["reference_count"] == 2
    assert rank(rows, vectors, normalize([1, 0]), .8, .05, "B")["decision"] == "wrong_target"
    assert rank(rows[:2], vectors[:2], normalize([1, 0]), .8, .05)["decision"] == "insufficient_catalog"
    assert rank(rows, vectors, normalize([1, 1]), .8, .05)["decision"] == "low_similarity"
    assert rank(rows, vectors, normalize([1, 1]), .6, .05)["decision"] == "ambiguous"


@pytest.mark.parametrize("vector", [[0, 0], [float("nan"), 1], [[1, 2]], [float("inf"), 0]])
def test_bad_vectors_rejected(vector):
    with pytest.raises(LabError):
        normalize(vector)


def test_full_api_flow(lab):
    client = TestClient(create_app(lab.store, lab.embedder))
    assert client.post("/api/session", data={"username": "Test User"}).status_code == 200
    assert client.get("/").status_code == 200
    assert client.get("/api/status").json() == {"username": "Test User", "ready": False}
    assert client.post("/api/query", files={"file": ("x.png", png("red"))}).status_code == 503
    for method, path in [("POST", "/api/references"), ("POST", "/api/index"),
                         ("POST", "/api/model/load"), ("POST", "/api/compare"),
                         ("DELETE", "/api/references/1"), ("GET", "/api/references/1/image")]:
        assert client.request(method, path).status_code == 404
    assert lab.store.list(lab.embedder.signature) == []
    add_two(lab)
    assert client.get("/api/status").json()["ready"] is False
    lab.build()  # Developer preload, outside the user's HTTP API.
    assert client.get("/api/status").json() == {"username": "Test User", "ready": True}
    result = client.post("/api/query", files={"file": ("q.png", png("red"))}).json()
    assert result == {"recognized": True, "artifact": "red"}
    result = client.post("/api/query", data={"threshold": "-1", "min_margin": "0", "target": "red"},
                         files={"file": ("q.png", png("gray"))}).json()
    assert result == {"recognized": False, "artifact": None}
    assert client.post("/api/query", files={"file": ("bad.jpg", b"bad")}).status_code == 400
    assert client.post("/api/query", headers={"Origin": "https://other.example"}).status_code == 403
    assert len(lab.store.list(lab.embedder.signature)) == 2
    assert client.get("/openapi.json").status_code == 404



def test_username_session(lab):
    client = TestClient(create_app(lab.store, lab.embedder))
    assert client.get("/", follow_redirects=False).headers["location"] == "/login"
    page = client.get("/login")
    assert page.status_code == 200 and 'name="username"' in page.text
    assert 'type="password"' not in page.text
    assert client.get("/api/status").status_code == 401
    for name in ("", "   ", "a" * 101, "a\x00b"):
        assert client.post("/api/session", data={"username": name}).status_code == 400
    result = client.post("/api/session", data={"username": "  Nguyễn Minh  "})
    assert result.json() == {"ok": True, "username": "Nguyễn Minh"}
    assert client.get("/api/status").json()["username"] == "Nguyễn Minh"
    assert client.get("/", follow_redirects=False).status_code == 200
    assert client.post("/api/logout").status_code == 200
    assert client.get("/api/status").status_code == 401
    assert client.post("/api/session", data={"username": "Lan"}).status_code == 200
    assert client.get("/api/status").json()["username"] == "Lan"


def test_username_session_rejects_invalid_cookies(monkeypatch):
    from lab.access import Access
    access = Access("test-only-secret")
    token = access.token("Nguyễn Minh")
    assert access.username(token) == "Nguyễn Minh"
    for invalid in (None, "bad", "old:password:cookie", token + "x"):
        assert access.username(invalid) is None
    issued = int(token.split(":")[0])
    monkeypatch.setattr("lab.access.time.time", lambda: issued + access.lifetime)
    assert access.username(token) is None


def test_partial_index_blocks_query_and_resumes(lab):
    add_two(lab)
    real = lab.embedder.embed
    def fail_second(jpeg):
        if lab.embedder.calls == 1:
            raise LabError("Temporary error", 502)
        return real(jpeg)
    lab.embedder.embed = fail_second
    result = lab.build()
    assert result["completed"] == 1 and result["errors"]
    with pytest.raises(LabError):
        lab.query(read_picture(png("red")))
    lab.embedder.embed = real
    assert lab.build()["completed"] == 1


def test_openrouter_request_is_image_embedding(monkeypatch):
    monkeypatch.setenv("EMBEDDING_PROVIDER", "openrouter")
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key-not-real")
    monkeypatch.setenv("OPENROUTER_MODEL", "example/image")
    calls = []
    def fake_request(method, url, **kwargs):
        calls.append((method, url, kwargs))
        if method == "GET":
            return httpx.Response(200, json={"data": [{"id": "example/image", "architecture": {"input_modalities": ["image"]}}]})
        return httpx.Response(200, json={"model": "example/image", "data": [{"embedding": [3., 4.]}], "usage": {"prompt_tokens": 1}})
    monkeypatch.setattr(httpx, "request", fake_request)
    vector, _ = Embedder().embed(read_picture(png("red")).jpeg)
    assert vector.tolist() == pytest.approx([.6, .8])
    payload = calls[-1][2]["json"]
    assert calls[-1][1].endswith("/embeddings")
    assert payload["input"][0]["content"][0]["image_url"]["url"].startswith("data:image/jpeg;base64,")
    assert "messages" not in payload


def test_benchmark_reports_leakage_and_unknowns(lab, tmp_path):
    add_two(lab)
    lab.build()
    folder = tmp_path / "test"
    for label in ("red", "_unknown"):
        (folder / label).mkdir(parents=True)
    (folder / "red" / "leak.png").write_bytes(png("red"))
    (folder / "red" / "new.png").write_bytes(png((210, 20, 20)))
    (folder / "_unknown" / "green.png").write_bytes(png("green"))
    report = evaluate(lab, folder, .8, .05)
    summary = report["summary"]
    assert summary["excluded_reference_duplicates"] == 1
    assert summary["valid_samples"] == 2
    assert summary["top1_accuracy_known"]["rate"] == 1
    assert summary["false_acceptance_unknown"]["count"] == 0
    json.dumps(report, allow_nan=False)


def test_missing_key_and_provider_errors_do_not_leak_secrets(monkeypatch):
    monkeypatch.setenv("EMBEDDING_PROVIDER", "openrouter")
    monkeypatch.setenv("OPENROUTER_API_KEY", "")
    with pytest.raises(LabError, match="OPENROUTER_API_KEY"):
        Embedder().prepare()
    monkeypatch.setenv("OPENROUTER_API_KEY", "secret-example")
    provider = Embedder()
    provider._validated = True
    monkeypatch.setattr(httpx, "request", lambda *a, **k: httpx.Response(401, json={"error": "secret-example"}))
    with pytest.raises(LabError) as failure:
        provider.embed(read_picture(png("red")).jpeg)
    assert "secret-example" not in str(failure.value)
    assert "HTTP 401" in str(failure.value)


@pytest.mark.parametrize("returned,allowed", [("gemini-embedding-2", True), ("google/gemini-embedding-2", True), ("different-model", False)])
def test_openrouter_native_model_alias(monkeypatch, returned, allowed):
    monkeypatch.setenv("EMBEDDING_PROVIDER", "openrouter")
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-only")
    monkeypatch.setenv("OPENROUTER_MODEL", "google/gemini-embedding-2")
    def response(method, url, **kwargs):
        if method == "GET":
            return httpx.Response(200, json={"data": [{"id": "google/gemini-embedding-2", "canonical_slug": "google/gemini-embedding-2", "architecture": {"input_modalities": ["image"]}}]})
        return httpx.Response(200, json={"model": returned, "data": [{"embedding": [1, 2]}]})
    monkeypatch.setattr(httpx, "request", response)
    embedder = Embedder()
    if allowed:
        vector, _ = embedder.embed(read_picture(png("red")).jpeg)
        assert len(vector) == 2
        assert embedder.info()["response_model"] == returned
    else:
        with pytest.raises(LabError, match="tên model"):
            embedder.embed(read_picture(png("red")).jpeg)
