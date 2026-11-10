"""Prepare an owner-approved, offline negative calibration slice.

This does not change the official partition, active dataset, originals, or catalog. It
normalizes only selected review-only `_unknown`/`_ambiguous` rows so they can be used for
threshold calibration without consuming the cross-device final holdout.
"""
import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
from pathlib import Path

UNKNOWN_IDS = [
    'R0623', 'R0625', 'R0708', 'R0736', 'R0738', 'R0739', 'R0741',
    'R0743', 'R0745', 'R0747', 'R0749', 'R0751', 'R0769', 'R0775',
    'R0870', 'R1005', 'R1013', 'R1277',
]


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
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=Path('data/staging/drive-negative-calibration-v1'))
    args = parser.parse_args()
    repo = Path(__file__).resolve().parents[1]
    output = (repo / args.output).resolve() if not args.output.is_absolute() else args.output.resolve()
    staging_root = (repo / 'data/staging').resolve()
    if staging_root not in output.parents or output == staging_root:
        raise ValueError('Output must be a new directory under data/staging/')
    if output.exists():
        raise ValueError('Refusing to overwrite an existing negative calibration staging directory')

    official_path = repo / 'reports/drive-official-split-v1/manifest.json'
    official = load(official_path)
    by_id = {row['review_id']: row for row in official['entries']}
    ambiguous = sorted(
        row['review_id'] for row in official['entries']
        if row.get('review_approved_scenario') == '_ambiguous' and row.get('partition') is None
    )
    selected_ids = UNKNOWN_IDS + ambiguous
    if len(selected_ids) != 25 or len(set(selected_ids)) != 25:
        raise ValueError('Negative selection must contain 18 unknown and 7 ambiguous IDs')
    if any(review_id not in by_id for review_id in selected_ids):
        raise ValueError('Negative selection contains an unknown review ID')

    originals = repo / 'data/incoming/drive-1jYzY5U3Yc6R_3CdUz7h0T8rYOBFGb7VH/originals'
    entries = []
    for review_id in selected_ids:
        source = by_id[review_id]
        label = source.get('review_approved_scenario')
        if label not in ('_unknown', '_ambiguous') or source.get('partition') is not None:
            raise ValueError(f'{review_id} is not an eligible review-only negative')
        entries.append({
            **source,
            'action': 'calibration_candidate',
            'proposed_role': 'calibration_negative',
            'partition': None,
            'scenario': 'out_of_catalog' if label == '_unknown' else 'ambiguous',
            'source_sha256': source['source_sha256'],
        })

    decode = load_stage_decode()
    import pillow_heif
    pillow_heif.register_heif_opener()
    output.mkdir(parents=True)
    (output / 'intermediate').mkdir()
    run = {
        'version': 'negative-calibration-decode-v1',
        'created_at': datetime.now(timezone.utc).isoformat(),
        'owner_offline_approved': True,
        'originals_root': str(originals),
        'official_manifest_sha256': sha(official_path),
        'official_partitions_changed': False,
        'provider_calls': 0,
        'selected_ids': selected_ids,
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
        raise RuntimeError(f'Decode failed for {len(errors)} negative calibration rows')
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
