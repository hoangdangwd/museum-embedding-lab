"""Build the full current-data calibration manifest without provider calls."""
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import shutil


def load(path):
    return json.loads(path.read_text(encoding='utf-8'))


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    repo = Path(__file__).resolve().parents[1]
    full = load(repo / 'data/evaluation/manifest.json')
    negative_stage = repo / 'data/staging/drive-full-negative-calibration-v1'
    negative = load(negative_stage / 'staging-manifest.json')
    refs = [row for row in full['entries'] if row['partition'] == 'references']
    positives = [row for row in full['entries'] if row['partition'] == 'calibration']
    if len(refs) != 45 or len(positives) != 436 or len(negative['entries']) != 72:
        raise ValueError('Calibration source counts drifted')
    root = repo / 'data/evaluation'
    negative_dir = root / 'calibration/negative'
    negative_dir.mkdir(parents=True, exist_ok=True)
    negatives = []
    for row in negative['entries']:
        source = negative_stage / row['jpeg_file']
        target = negative_dir / f'{row["review_id"]}.jpg'
        if sha(source) != row['normalized_sha256']:
            raise ValueError(f'Negative staging hash mismatch: {row["review_id"]}')
        shutil.copy2(source, target)
        if sha(target) != row['normalized_sha256']:
            raise ValueError(f'Negative evaluation copy hash mismatch: {row["review_id"]}')
        expected = {'out_of_catalog': '_unknown', 'ambiguous': '_ambiguous', 'low_quality': '_low_quality'}[row['scenario']]
        negatives.append({
            'file': f'calibration/negative/{row["review_id"]}.jpg',
            'partition': 'calibration', 'expected': expected, 'scenario': row['scenario'],
            'sha256': row['normalized_sha256'], 'review_id': row['review_id'],
        })
    final_sentinel = next(row for row in full['entries'] if row['partition'] == 'final' and row['scenario'] in ('known_clean', 'known_clutter'))
    entries = refs + positives + negatives + [final_sentinel]
    if len(entries) != 554 or len({row['file'] for row in entries}) != 554 or len({row['sha256'] for row in entries}) != 554:
        raise ValueError('Full calibration uniqueness/count check failed')
    if Counter(row['scenario'] for row in negatives) != Counter({'out_of_catalog': 33, 'ambiguous': 7, 'low_quality': 32}):
        raise ValueError('Full calibration negative counts drifted')
    manifest = {
        **{key: full[key] for key in ('version', 'model', 'dimensions', 'pipeline', 'signature')},
        'evaluation_version': 'full-current-data-calibration-v1',
        'created_at': datetime.now(timezone.utc).isoformat(),
        'provider_calls': 0,
        'entries': entries,
        'selection': {
            'references': 45, 'positive_calibration': 436,
            'negative_unknown': 33, 'negative_ambiguous': 7, 'negative_low_quality': 32,
            'final_holdout_excluded': True,
        },
        'notes': [
            'All positive calibration rows are retained; known_clean and known_clutter have equal positive meaning.',
            'All review-approved negative rows outside final are calibration negatives.',
            'The 183 final cross-device rows are excluded from threshold selection.',
        ],
    }
    path = repo / 'data/evaluation/full-calibration-manifest.json'
    path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    report = repo / 'reports/evaluation-full-calibration-v1'
    report.mkdir(parents=True, exist_ok=True)
    (report / 'build.json').write_text(json.dumps({
        'manifest': str(path.relative_to(repo)).replace('\\', '/'), 'entries': len(entries),
        'calibration_rows_used_for_threshold': len(positives) + len(negatives),
        'final_sentinel_excluded_from_threshold': final_sentinel['file'],
        'partition_counts': dict(Counter(row['partition'] for row in entries)),
        'scenario_counts': dict(Counter(row['scenario'] for row in entries if row['partition'] != 'references')),
        'provider_calls': 0, 'originals_changed': False, 'final_used_for_threshold': False,
    }, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'manifest': str(path), 'entries': len(entries), 'provider_calls': 0}, ensure_ascii=False))


if __name__ == '__main__':
    main()
