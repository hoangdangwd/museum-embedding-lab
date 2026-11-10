"""Build the approved offline evaluation pilot manifest without provider calls.

The pilot contains all 45 references, 72 stratified positive calibration rows, 25
review-approved negative calibration rows, and one final sentinel. It copies only
verified normalized derivatives into ignored data/evaluation/ and never changes the
official partition or production catalog.
"""
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import shutil


def sha(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def load(path):
    return json.loads(path.read_text(encoding='utf-8'))


def sample(rows, n):
    rows = sorted(rows, key=lambda row: row['file'])
    if len(rows) <= n:
        return rows
    indexes = [round(i * (len(rows) - 1) / (n - 1)) for i in range(n)] if n > 1 else [len(rows) // 2]
    return [rows[index] for index in indexes]


def main():
    repo = Path(__file__).resolve().parents[1]
    base_path = repo / 'data/evaluation/manifest.json'
    source = load(base_path)
    all_rows = source['entries']
    calibration = [row for row in all_rows if row['partition'] == 'calibration']
    groups = {}
    for row in calibration:
        groups.setdefault((row['expected'], row['scenario']), []).append(row)
    selected = []
    for artifact in sorted({row['expected'] for row in calibration}):
        for scenario in ('known_clean', 'known_clutter'):
            selected.extend(sample(groups.get((artifact, scenario), []), 4))
    by_artifact = {}
    for row in selected:
        by_artifact.setdefault(row['expected'], []).append(row)
    for artifact in sorted({row['expected'] for row in calibration}):
        if len(by_artifact.get(artifact, [])) < 8:
            used = {row['file'] for row in by_artifact.get(artifact, [])}
            remaining = [row for row in groups[(artifact, 'known_clutter')] if row['file'] not in used]
            selected.extend(sample(remaining, 8 - len(by_artifact.get(artifact, []))))
    seen = set()
    selected = [row for row in selected if not (row['file'] in seen or seen.add(row['file']))]
    if len(selected) != 72:
        raise ValueError(f'Expected 72 positive calibration rows, got {len(selected)}')

    negative_stage = repo / 'data/staging/drive-negative-calibration-v1'
    negative_manifest = load(negative_stage / 'staging-manifest.json')
    negative_rows = []
    negative_dir = repo / 'data/evaluation/calibration/negative'
    negative_dir.mkdir(parents=True, exist_ok=True)
    for row in negative_manifest['entries']:
        source_file = negative_stage / row['jpeg_file']
        target = negative_dir / f'{row["review_id"]}.jpg'
        if not source_file.is_file() or sha(source_file) != row['normalized_sha256']:
            raise ValueError(f'Negative source hash mismatch: {row["review_id"]}')
        if target.exists() and sha(target) != row['normalized_sha256']:
            raise ValueError(f'Refusing to overwrite negative derivative: {target}')
        if not target.exists():
            shutil.copy2(source_file, target)
        if sha(target) != row['normalized_sha256']:
            raise ValueError(f'Negative copy hash mismatch: {row["review_id"]}')
        negative_rows.append({
            'file': f'calibration/negative/{row["review_id"]}.jpg',
            'partition': 'calibration',
            'expected': '_unknown' if row['scenario'] == 'out_of_catalog' else '_ambiguous',
            'scenario': row['scenario'],
            'sha256': row['normalized_sha256'],
            'review_id': row['review_id'],
        })
    if Counter(row['scenario'] for row in negative_rows) != Counter({'out_of_catalog': 18, 'ambiguous': 7}):
        raise ValueError('Negative calibration label counts drifted')

    references = [row for row in all_rows if row['partition'] == 'references']
    final_sentinel = next(row for row in all_rows if row['partition'] == 'final' and row['scenario'] in ('known_clean', 'known_clutter'))
    entries = references + selected + negative_rows + [final_sentinel]
    if len(entries) != 143 or len({row['file'] for row in entries}) != 143 or len({row['sha256'] for row in entries}) != 143:
        raise ValueError('Pilot entry uniqueness/count check failed')
    pilot = {
        **{key: source[key] for key in ('version', 'model', 'dimensions', 'pipeline', 'signature')},
        'pilot_version': 'evaluation-pilot-v1',
        'created_at': datetime.now(timezone.utc).isoformat(),
        'provider_calls': 0,
        'entries': entries,
        'selection': {
            'references': 45,
            'calibration_positive': 72,
            'calibration_negative_unknown': 18,
            'calibration_negative_ambiguous': 7,
            'final_sentinel': final_sentinel['file'],
            'final_sentinel_is_not_for_threshold_selection': True,
        },
        'notes': [
            'Pilot is for threshold selection only; the final sentinel is not evaluated as final evidence.',
            'The 72 positive calibration rows are stratified by artifact and scenario, but remain same-session correlated.',
            'Negative calibration rows are review-approved and kept separate from the 183 final holdout rows.',
        ],
    }
    output = repo / 'data/evaluation/pilot-manifest.json'
    output.write_text(json.dumps(pilot, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    audit = repo / 'reports/eval-cost-plan-v1/pilot-build.json'
    audit.parent.mkdir(parents=True, exist_ok=True)
    audit.write_text(json.dumps({
        'manifest': str(output.relative_to(repo)).replace('\\', '/'),
        'entries': len(entries),
        'partition_counts': dict(Counter(row['partition'] for row in entries)),
        'scenario_counts': dict(Counter(row['scenario'] for row in entries if row['partition'] != 'references')),
        'provider_calls': 0,
        'originals_changed': False,
        'catalog_mutations': 0,
    }, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'manifest': str(output), 'entries': len(entries), 'provider_calls': 0}, ensure_ascii=False))


if __name__ == '__main__':
    main()
