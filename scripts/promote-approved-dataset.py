"""Promote the owner-approved normalized JPEG split into local active dataset folders.

This is an explicit local-only operation. It reads the official scenario manifest and the
verified staging JPEGs, copies derivatives (never originals), and writes a promotion audit.
It does not call providers, evaluate, upload, seed the catalog, or deploy.
"""
import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import shutil


EXPECTED = {'references': 35, 'calibration': 436, 'final': 183}
NEGATIVE_SCENARIOS = {'_unknown', '_ambiguous', '_low_quality'}


def load(path):
    return json.loads(path.read_text(encoding='utf-8'))


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def confined(root, relative):
    path = (root / relative).resolve()
    if root.resolve() not in path.parents:
        raise ValueError(f'Path escapes root: {relative}')
    return path


def build_plan(repo):
    official_path = repo / 'reports/drive-official-split-v1/manifest.json'
    staging_path = repo / 'data/staging/drive-normalized-v1/staging-manifest.json'
    official = load(official_path)
    staging = load(staging_path)
    if official['official_fields'] != {
        'partition_applied': True,
        'approved_artifact_id_applied': True,
        'scenario_applied': True,
    }:
        raise ValueError('Official scenario manifest is not fully applied')
    if len(official['entries']) != 1632 or len(staging['entries']) != 782:
        raise ValueError('Manifest population drift')
    counts = Counter(row['partition'] for row in official['entries'] if row.get('partition') is not None)
    if dict(counts) != EXPECTED:
        raise ValueError(f'Unexpected official partition counts: {dict(counts)}')
    stage = {row['review_id']: row for row in staging['entries']}
    plan = []
    for row in official['entries']:
        partition = row.get('partition')
        if partition not in ('references', 'calibration', 'final'):
            continue
        if row.get('candidate_hold'):
            raise ValueError(f'Hold entered promotion plan: {row["review_id"]}')
        staged = stage.get(row['review_id'])
        if not staged or staged.get('jpeg_status') != 'ok':
            raise ValueError(f'Missing verified staging JPEG: {row["review_id"]}')
        if staged['normalized_sha256'] != row.get('scenario_source_normalized_sha256', staged['normalized_sha256']) and partition != 'references':
            # Positive/negative test rows carry the scenario source hash; references do not.
            raise ValueError(f'Scenario/staging hash drift: {row["review_id"]}')
        relative = staged['jpeg_file']
        if partition == 'references':
            target = Path('references') / row['approved_artifact_id'] / f'drive-{row["review_id"]}.jpg'
            label = row['approved_artifact_id']
        elif row.get('scenario') in ('known_clean', 'known_clutter'):
            target = Path('test') / row['approved_artifact_id'] / partition / row['scenario'] / f'drive-{row["review_id"]}.jpg'
            label = row['scenario']
        else:
            label = row.get('review_approved_scenario')
            if label not in NEGATIVE_SCENARIOS:
                raise ValueError(f'Unassigned test row has no approved negative label: {row["review_id"]}')
            target = Path('test') / label / partition / f'drive-{row["review_id"]}.jpg'
        plan.append({
            'review_id': row['review_id'], 'partition': partition,
            'approved_artifact_id': row['approved_artifact_id'], 'scenario': row.get('scenario'),
            'review_approved_scenario': row.get('review_approved_scenario'), 'label': label,
            'source': relative, 'source_sha256': staged['normalized_sha256'],
            'target': str(target).replace('\\', '/'),
        })
    if len(plan) != 654:
        raise ValueError(f'Expected 654 promoted rows, got {len(plan)}')
    if Counter(row['partition'] for row in plan) != Counter(EXPECTED):
        raise ValueError('Promotion plan partition counts drifted')
    if Counter(row['scenario'] for row in plan if row['partition'] != 'references') != Counter({'known_clean': 153, 'known_clutter': 451, None: 15}):
        raise ValueError('Promotion plan scenario counts drifted')
    return plan, official_path, staging_path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true', help='Copy normalized JPEGs into active data/ folders')
    parser.add_argument('--audit-output', type=Path, default=Path('reports/drive-promotion-v1'))
    args = parser.parse_args()
    if not args.apply:
        raise ValueError('Explicit --apply is required for local promotion')
    repo = Path(__file__).resolve().parents[1]
    audit = (repo / args.audit_output).resolve() if not args.audit_output.is_absolute() else args.audit_output.resolve()
    if audit.exists() or (repo / 'reports').resolve() not in audit.parents:
        raise ValueError('Choose a new audit directory under reports/')
    plan, official_path, staging_path = build_plan(repo)
    staging_root = repo / 'data/staging/drive-normalized-v1'
    data_root = repo / 'data'
    copied = []
    for item in plan:
        source = confined(staging_root, item['source'])
        target = confined(data_root, item['target'])
        if sha(source) != item['source_sha256']:
            raise ValueError(f'Staging file changed: {item["review_id"]}')
        if target.exists():
            if sha(target) != item['source_sha256']:
                raise ValueError(f'Refusing to overwrite different file: {target}')
            copied.append({**item, 'status': 'already_present', 'target_sha256': sha(target)})
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)
        if sha(target) != item['source_sha256']:
            raise ValueError(f'Copied hash mismatch: {item["review_id"]}')
        copied.append({**item, 'status': 'copied', 'target_sha256': sha(target)})
    audit.mkdir(parents=True)
    source_hashes = {
        'official_manifest': {'path': str(official_path.relative_to(repo)).replace('\\', '/'), 'sha256': sha(official_path)},
        'staging_manifest': {'path': str(staging_path.relative_to(repo)).replace('\\', '/'), 'sha256': sha(staging_path)},
    }
    summary = {
        'version': 'drive-promotion-v1', 'created_at': datetime.now(timezone.utc).isoformat(),
        'status': 'LOCAL NORMALIZED JPEG PROMOTION APPLIED', 'counts': dict(Counter(item['partition'] for item in copied)),
        'scenario_counts': dict(Counter(item['scenario'] for item in copied if item['partition'] != 'references')),
        'labels': dict(Counter(item['label'] for item in copied)),
        'copied': sum(item['status'] == 'copied' for item in copied),
        'already_present': sum(item['status'] == 'already_present' for item in copied),
        'originals_changed': False, 'provider_calls': 0, 'uploads': 0, 'catalog_mutations': 0, 'production_mutations': 0,
        'source_hashes': source_hashes,
        'note': 'Only verified staging JPEG derivatives were copied. Originals and production remain unchanged. Evaluation was not run.',
    }
    (audit / 'plan.json').write_text(json.dumps(copied, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    (audit / 'summary.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
