import sqlite3

import pytest

from lab.images import PREPROCESS_VERSION, read_picture
from lab.service import Lab
from lab.store import Store
from scripts.export_catalog import export_catalog
from tests.test_lab import TestEmbedder, png


def test_export_precomputed_catalog_is_complete_and_idempotent(tmp_path):
    store = Store(tmp_path / 'source.sqlite3')
    embedder = TestEmbedder()
    embedder.signature = f'openrouter|google/gemini-embedding-2|1|1|{PREPROCESS_VERSION}'
    lab = Lab(store, embedder)
    for name, color in [("Dev's red", 'red'), ('Blue', 'blue')]:
        store.add(name, color + '.png', read_picture(png(color)))
    output = tmp_path / 'catalog.sql'
    with pytest.raises(ValueError, match='not indexed'):
        export_catalog(store.path, output)
    assert not output.exists()
    lab.build()
    result = export_catalog(store.path, output)
    assert result['references'] == 2
    with sqlite3.connect(':memory:') as db:
        for _ in range(2):
            db.executescript(output.read_text(encoding='utf-8'))
        rows = db.execute('SELECT artifact,dimensions FROM recognition_references ORDER BY artifact').fetchall()
        assert rows == [('Blue', 3), ("Dev's red", 3)]
