"""Prepare all eligible review-only negatives for offline calibration.

This never changes the official split, active dataset, originals, catalog, or production.
It selects only review-approved negatives outside the final holdout and creates verified
offline decode derivatives.
"""
from collections import Counter
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
from pathlib import Path


def load(path):
    return json.loads(path.read_text(encoding='utf-8'))


def sha(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def load_stage_decode():
    path = Path(__file__).with_name('stage-decode.py')
    spec = importlib.util.spec_from_file_location('stage_decode', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main():
    repo = Path(__file__).resolve().parents[1]
    output = (repo / 'data/staging/drive-full-negative-calibration-v1').resolve()
    staging_root = (repo / 'data/staging').resolve()
    if staging_root not in output.parents or output == staging_root:
        raise ValueError('Output must be under data/staging/')
    if output.exists():
        raise ValueError('Refusing to overwrite an existing staging directory')
    official_path = repo / 'reports/drive-official-split-v1/manifest.json'
    official = load(official_path)
    selected = [
        row for row in official['entries']
        if row.get('review_approved_scenario') in ('_unknown', '_ambiguous', '_low_quality')
        and row.get('partition') is None
    ]
    selected.sort(key=lambda row: row['review_id'])
    if len(selected) != 72:
        raise ValueError(f'Expected 72 eligible negatives, got {len(selected)}')
    expected = Counter({'_unknown': 33, '_ambiguous': 7, '_low_quality': 32})
    if Counter(row['review_approved_scenario'] for row in selected) != expected:
        raise ValueError('Negative label counts drifted')
    originals = repo / 'data/incoming/drive-1jYzY5U3Yc6R_3CdUz7h0T8rYOBFGb7VH/originals'
    entries = []
    for source in selected:
        label = source['review_approved_scenario']
        entries.append({
            **source,
            'action': 'calibration_candidate',
            'proposed_role': 'calibration',
            'partition': None,
            'scenario': {'_unknown': 'out_of_catalog', '_ambiguous': 'ambiguous', '_low_quality': 'low_quality'}[label],
        })
    decode = load_stage_decode()
    import pillow_heif
    pillow_heif.register_heif_opener()
    output.mkdir(parents=True)
    (output / 'intermediate').mkdir()
    run = {
        'version': 'full-negative-calibration-decode-v1',
        'created_at': datetime.now(timezone.utc).isoformat(),
        'owner_offline_approved': True,
        'originals_root': str(originals),
        'official_manifest_sha256': sha(official_path),
        'official_partitions_changed': False,
        'provider_calls': 0,
        'selected_counts': dict(Counter(row['scenario'] for row in entries)),
    }
    (output / 'run.json').write_text(json.dumps(run, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    rows = []
    with (output / 'decode-log.jsonl').open('w', encoding='utf-8') as journal:
        for entry in entries:
            row = decode.decode_entry((originals, output, entry, None))
            rows.append(row)
            journal.write(json.dumps(row, ensure_ascii=False) + '\n')
    errors = [row for row in rows if row.get('decode_status') != 'ok']
    if errors:
        raise RuntimeError(f'Decode failed for {len(errors)} rows')
    manifest = {**run, 'entries': rows, 'summary': {
        'entries': len(rows),
        'labels': dict(Counter(row['scenario'] for row in rows)),
        'errors': 0,
        'originals_changed': False,
    }}
    (output / 'decode-manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(manifest['summary'], ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
