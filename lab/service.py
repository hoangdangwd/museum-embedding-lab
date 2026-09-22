import threading
import time

import numpy as np

from .embeddings import normalize
from .images import LabError, Picture


def rank(metadata, vectors, query, threshold, min_margin, target=None):
    if not metadata:
        raise LabError("Chưa có ảnh tham chiếu được tạo embedding.", 409)
    matrix = np.stack(vectors)
    if matrix.shape[1] != len(query):
        raise LabError("Chiều vector truy vấn khác bộ tham chiếu. Hãy tạo lại chỉ mục.", 409)
    scores = np.clip(matrix @ query, -1, 1)
    grouped = {}
    for row, score in zip(metadata, scores):
        item = {**row, "score": float(score), "image_url": f"/api/references/{row['id']}/image"}
        grouped.setdefault(row["artifact"], []).append(item)
    candidates = []
    for artifact, matches in grouped.items():
        matches.sort(key=lambda m: (-m["score"], m["id"]))
        candidates.append({"artifact": artifact, "score": matches[0]["score"], "reference_count": len(matches), "matches": matches[:3]})
    candidates.sort(key=lambda c: (-c["score"], c["artifact"]))
    best = candidates[0]
    margin = best["score"] - candidates[1]["score"] if len(candidates) > 1 else None
    if best["score"] < threshold:
        decision = "low_similarity"
    elif margin is None:
        decision = "insufficient_catalog"
    elif margin < min_margin:
        decision = "ambiguous"
    elif target and target != best["artifact"]:
        decision = "wrong_target"
    else:
        decision = "match"
    return {"decision": decision, "best_artifact": best["artifact"], "best_score": best["score"],
            "margin": margin, "target": target, "threshold": threshold, "min_margin": min_margin,
            "candidates": candidates[:5], "artifact_count": len(candidates)}


class Lab:
    def __init__(self, store, embedder):
        self.store = store
        self.embedder = embedder
        self.build_lock = threading.Lock()

    def build(self):
        if not self.build_lock.acquire(blocking=False):
            raise LabError("Đang tạo embedding. Hãy chờ lượt hiện tại hoàn tất.", 409)
        try:
            if not self.store.list(self.embedder.signature):
                raise LabError("Bộ ảnh tham chiếu chưa được thiết lập.")
            start = time.perf_counter()
            self.embedder.prepare()
            signature = self.embedder.signature
            rows = self.store.list(signature)
            completed, skipped, failures, usage = 0, 0, [], []
            for row in rows:
                if row["indexed"]:
                    skipped += 1
                    continue
                try:
                    vector, used = self.embedder.embed(self.store.photo(row["id"]))
                    self.store.put_vector(row["id"], signature, normalize(vector))
                    completed += 1
                    usage.append(used)
                except LabError as exc:
                    failures.append({"id": row["id"], "filename": row["filename"], "error": str(exc)})
                    break  # Fail fast on provider errors; a second build resumes saved work.
            return {"completed": completed, "cached": skipped, "errors": failures, "usage": usage,
                    "remaining": len(rows) - completed - skipped, "seconds": time.perf_counter() - start,
                    "signature": signature}
        finally:
            self.build_lock.release()

    def query(self, picture: Picture, threshold=.8, min_margin=.05, target=None):
        if not np.isfinite([threshold, min_margin]).all() or not -1 <= threshold <= 1 or not 0 <= min_margin <= 2:
            raise LabError("Ngưỡng cosine phải trong [-1,1], chênh lệch trong [0,2].")
        if not self.store.list(self.embedder.signature):
            raise LabError("Bộ ảnh tham chiếu chưa được thiết lập. Bạn có thể dùng tab So sánh 2 ảnh.", 409)
        self.embedder.prepare()
        signature = self.embedder.signature
        rows = self.store.list(signature)
        if any(not r["indexed"] for r in rows):
            raise LabError("Bộ tham chiếu chưa được tạo embedding đầy đủ cho model này. Bấm Tạo embedding trước.", 409)
        if target and target not in {r["artifact"] for r in rows}:
            raise LabError("Hiện vật mục tiêu không có trong bộ tham chiếu.")
        start = time.perf_counter()
        vector, usage = self.embedder.embed(picture.jpeg)
        vector = normalize(vector)
        embedded = time.perf_counter()
        metadata, vectors = self.store.vectors(signature)
        result = rank(metadata, vectors, vector, threshold, min_margin, target)
        result.update({"signature": signature, "dimensions": len(vector), "embedding": vector.tolist(),
                       "usage": usage, "same_as_reference": any(r["digest"] == picture.digest for r in rows),
                       "timing_ms": {"embedding": round((embedded-start)*1000, 2),
                                     "search": round((time.perf_counter()-embedded)*1000, 2)},
                       "note": "Ngưỡng thử nghiệm do người dùng đặt; cosine không phải xác suất đúng."})
        return result
