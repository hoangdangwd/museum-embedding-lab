import sqlite3
from contextlib import contextmanager
from pathlib import Path

import numpy as np

from .images import LabError, Picture


class Store:
    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.path = path
        with self.connect() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS refs (
                    id INTEGER PRIMARY KEY, artifact TEXT NOT NULL, filename TEXT NOT NULL,
                    digest TEXT NOT NULL UNIQUE, jpeg BLOB NOT NULL,
                    width INTEGER NOT NULL, height INTEGER NOT NULL,
                    created TEXT DEFAULT CURRENT_TIMESTAMP
                );
                CREATE TABLE IF NOT EXISTS embeddings (
                    ref_id INTEGER REFERENCES refs(id) ON DELETE CASCADE,
                    signature TEXT NOT NULL, dimensions INTEGER NOT NULL, vector BLOB NOT NULL,
                    PRIMARY KEY(ref_id, signature)
                );
            """)

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=30)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys = ON")
        try:
            with db:
                yield db
        finally:
            db.close()

    def add(self, artifact: str, filename: str, picture: Picture):
        artifact = artifact.strip()
        if not artifact or len(artifact) > 100 or artifact == "_unknown":
            raise LabError("Tên hiện vật phải có 1–100 ký tự và không được là _unknown.")
        with self.connect() as db:
            existing = db.execute("SELECT id, artifact FROM refs WHERE digest=?", (picture.digest,)).fetchone()
            if existing:
                if existing["artifact"] != artifact:
                    raise LabError(f"Ảnh này đã thuộc hiện vật '{existing['artifact']}'. Không thể gắn hai nhãn khác nhau.", 409)
                return {"id": existing["id"], "duplicate": True}
            cursor = db.execute("INSERT INTO refs(artifact,filename,digest,jpeg,width,height) VALUES(?,?,?,?,?,?)",
                                (artifact, filename[:200], picture.digest, picture.jpeg, picture.width, picture.height))
            return {"id": cursor.lastrowid, "duplicate": False}

    def list(self, signature: str):
        with self.connect() as db:
            return [dict(r) for r in db.execute("""
                SELECT r.id, r.artifact, r.filename, r.digest, r.width, r.height,
                       e.dimensions, (e.ref_id IS NOT NULL) AS indexed
                FROM refs r LEFT JOIN embeddings e ON r.id=e.ref_id AND e.signature=?
                ORDER BY r.artifact, r.id
            """, (signature,))]

    def photo(self, ref_id: int):
        with self.connect() as db:
            row = db.execute("SELECT jpeg FROM refs WHERE id=?", (ref_id,)).fetchone()
            if not row:
                raise LabError("Không tìm thấy ảnh tham chiếu.", 404)
            return row["jpeg"]

    def delete(self, ref_id: int):
        with self.connect() as db:
            if not db.execute("DELETE FROM refs WHERE id=?", (ref_id,)).rowcount:
                raise LabError("Không tìm thấy ảnh tham chiếu.", 404)

    def put_vector(self, ref_id: int, signature: str, vector: np.ndarray):
        with self.connect() as db:
            dims = db.execute("SELECT dimensions FROM embeddings WHERE signature=? LIMIT 1", (signature,)).fetchone()
            if dims and dims[0] != len(vector):
                raise LabError("Chiều vector của model thay đổi. Tăng EMBEDDING_VERSION và lập chỉ mục lại.", 409)
            db.execute("INSERT OR REPLACE INTO embeddings VALUES(?,?,?,?)",
                       (ref_id, signature, len(vector), vector.astype('<f4').tobytes()))

    def vectors(self, signature: str):
        with self.connect() as db:
            rows = db.execute("""SELECT r.id, r.artifact, r.filename, r.digest, e.vector
                FROM refs r JOIN embeddings e ON r.id=e.ref_id WHERE e.signature=? ORDER BY r.id""", (signature,)).fetchall()
        metadata = [{k: r[k] for k in ("id", "artifact", "filename", "digest")} for r in rows]
        return metadata, [np.frombuffer(r["vector"], dtype="<f4") for r in rows]
