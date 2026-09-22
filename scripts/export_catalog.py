"""Export existing local embeddings to D1 SQL without making provider calls.

Run from the project root: python -m scripts.export_catalog DATABASE --output FILE
The resulting SQL contains vectors and labels only; original images stay local.
"""
import argparse
import json
import sqlite3
from pathlib import Path

import numpy as np

from lab.images import PREPROCESS_VERSION


def export_catalog(database, output, model='google/gemini-embedding-2', version='1'):
    signature = f'openrouter|{model}|{version}|{version}|{PREPROCESS_VERSION}'
    with sqlite3.connect(Path(database).resolve().as_uri() + '?mode=ro', uri=True) as db:
        db.row_factory = sqlite3.Row
        rows = db.execute('''
            SELECT r.artifact, r.digest, e.dimensions, e.vector
            FROM refs r LEFT JOIN embeddings e ON r.id=e.ref_id AND e.signature=? ORDER BY r.id
        ''', (signature,)).fetchall()
    if len({row['artifact'] for row in rows}) < 2:
        raise ValueError('The catalog needs at least two distinct artifacts.')

    def sql(value):
        return "'" + str(value).replace("'", "''") + "'"

    statements = [Path('migrations/0002_recognition_catalog.sql').read_text(encoding='utf-8')]
    for row in rows:
        if row['vector'] is None:
            raise ValueError('Some references are not indexed for the requested model/version.')
        vector = np.frombuffer(row['vector'], dtype='<f4')
        if len(vector) != row['dimensions'] or len(vector) < 2 or not np.isfinite(vector).all():
            raise ValueError('Invalid reference vector.')
        if abs(float(np.linalg.norm(vector.astype(np.float64))) - 1) > 0.001:
            raise ValueError('Reference vectors must be normalized.')
        values = ','.join([sql(signature), sql(row['digest']), sql(row['artifact']), str(len(vector)), sql(json.dumps(vector.tolist(), separators=(',', ':')))])
        statements.append('INSERT INTO recognition_references(signature,digest,artifact,dimensions,vector) '
                          f'VALUES({values}) ON CONFLICT(signature,digest) DO UPDATE SET '
                          'artifact=excluded.artifact,dimensions=excluded.dimensions,vector=excluded.vector;')
    output = Path(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text('\n'.join(statements) + '\n', encoding='utf-8')
    return {'references': len(rows), 'artifacts': len({r['artifact'] for r in rows}), 'signature': signature}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('database', type=Path)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--model', default='google/gemini-embedding-2')
    parser.add_argument('--version', default='1')
    args = parser.parse_args()
    print(json.dumps(export_catalog(args.database, args.output, args.model, args.version)))
