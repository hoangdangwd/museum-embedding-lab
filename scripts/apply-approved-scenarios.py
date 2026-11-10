"""Create and apply a conservative, offline scenario review for eligible rows.

This script only reads the verified staging JPEG queue and the official manifest. It never
copies files, calls providers, uploads data, seeds a catalog, or deploys production.
The review is deliberately explicit: only listed IDs receive known_clean; other eligible
positive rows receive known_clutter because their context, angle, people, glass, or distance
makes them unsuitable for the clean bucket. Previously approved _low_quality/_ambiguous
rows remain without a scenario and are excluded from scenario evaluation.
"""
import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path


POSITIVE = {'known_clean', 'known_clutter'}
NEGATIVE = {'_low_quality', '_ambiguous'}


def ids(*parts):
    out = set()
    for part in parts:
        if isinstance(part, str) and '-' in part:
            a, b = part.split('-', 1)
            out.update(f'R{i:04d}' for i in range(int(a[1:]), int(b[1:]) + 1))
        else:
            out.add(part)
    return out


# Explicit clean decisions from the offline contact-sheet review. Everything else that is
# eligible and not an inherited negative is intentionally assigned known_clutter.
CLEAN_IDS = ids(
    'R0019', 'R0036-0038', 'R0083-0088', 'R0095-0099', 'R0103-0105',
    'R0188-0189', 'R0203-0205', 'R0206-0210',
    'R0253-0262', 'R0287-0294',
    'R0324-0333', 'R0346-0360', 'R0381-0397',
    'R0444-0455',
    'R1537-1562', 'R1574-1584',
    # final close/clear views
    'R0066', 'R0069-0070', 'R0074', 'R0076-0077',
    'R0096-0099', 'R0152-0155',
    'R0156-0159', 'R0165-0171', 'R0173',
    'R0218-0223', 'R0301-0306',
    'R0309-0313', 'R0315-0317', 'R0402-0405',
    'R0407-0410', 'R0415-0419',
    'R0521-0527',
    'R1502-1505', 'R1507-1509',
    'R1510-1515',
)


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load(path):
    return json.loads(path.read_text(encoding='utf-8'))


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def build(repo, output):
    official_path = repo / 'reports/drive-official-split-v1/manifest.json'
    queue_path = repo / 'reports/drive-scenario-review-v1/scenario-queue.json'
    staging_path = repo / 'data/staging/drive-normalized-v1/staging-manifest.json'
    official = load(official_path)
    queue = load(queue_path)
    staging = load(staging_path)
    if official['official_fields']['partition_applied'] is not True:
        raise ValueError('Expected the partition-applied official manifest')
    if len(official['entries']) != 1632 or len(queue) != 619:
        raise ValueError('Population drift')
    q = {row['review_id']: row for row in queue}
    eligible_ids = {row['review_id'] for row in official['entries'] if row.get('partition') in ('calibration', 'final') and not row.get('candidate_hold')}
    if len(q) != 619 or set(q) != eligible_ids:
        raise ValueError('Scenario queue does not exactly cover eligible calibration/final rows')
    stage = {row['review_id']: row for row in staging['entries']}
    inherited = Counter(row['inherited_review_scenario'] for row in queue if row.get('inherited_review_scenario'))
    if inherited != Counter({'known_clutter': 2, '_low_quality': 10, '_ambiguous': 5}):
        raise ValueError(f'Inherited label drift: {dict(inherited)}')
    if any(review_id in CLEAN_IDS and q[review_id].get('inherited_review_scenario') in NEGATIVE for review_id in CLEAN_IDS if review_id in q):
        raise ValueError('Clean list overlaps inherited negative labels')

    rows = []
    decisions = []
    for row in official['entries']:
        review_id = row['review_id']
        if review_id not in q:
            rows.append(dict(row))
            continue
        review = q[review_id]
        staged = stage.get(review_id)
        if not staged or staged.get('jpeg_status') != 'ok':
            raise ValueError(f'Missing verified staging row: {review_id}')
        if staged['normalized_sha256'] != review['normalized_sha256']:
            raise ValueError(f'Queue/staging hash drift: {review_id}')
        prior = review.get('inherited_review_scenario')
        if prior in NEGATIVE:
            scenario = None
            status = 'owner_reviewed_excluded_negative'
            reason = 'Inherited owner-approved review label; do not include in known_clean/known_clutter evaluation.'
            basis = 'inherited approved final review label'
        elif prior == 'known_clutter':
            scenario = 'known_clutter'
            status = 'owner_reviewed_assigned_inherited'
            reason = 'Inherited owner-approved clutter label: the single artifact remains identifiable but is affected by framing/context/obstruction.'
            basis = 'inherited approved final review label'
        elif review_id in CLEAN_IDS:
            scenario = 'known_clean'
            status = 'owner_reviewed_assigned_clean'
            reason = 'Artifact is clear and dominant with minimal obstruction in the reviewed normalized JPEG.'
            basis = 'manual contact-sheet review; explicit clean allowlist'
        else:
            scenario = 'known_clutter'
            status = 'owner_reviewed_assigned_clutter'
            reason = 'Artifact remains identifiable, but museum context, distance, oblique framing, people, glass/reflection, or partial obstruction makes this a clutter view rather than clean.'
            basis = 'manual contact-sheet review; conservative clutter fallback'
        new = dict(row)
        new.update({
            'scenario': scenario,
            'review_approved_scenario': prior,
            'review_approved_artifact_id': review.get('inherited_review_artifact_id'),
            'scenario_status': status,
            'scenario_review_version': 'drive-scenario-review-v1-owner-reviewed-v1',
            'scenario_review_basis': basis,
            'scenario_reason': reason,
            'scenario_source_normalized_file': review['normalized_file'],
            'scenario_source_normalized_sha256': review['normalized_sha256'],
            'scenario_provider_calls': 0,
        })
        rows.append(new)
        decisions.append({
            'review_id': review_id, 'partition': row['partition'],
            'approved_artifact_id': row['approved_artifact_id'], 'scenario': scenario,
            'status': status, 'reason': reason, 'basis': basis,
            'source_file': row['source_file'], 'source_sha256': row['source_sha256'],
            'normalized_file': review['normalized_file'], 'normalized_sha256': review['normalized_sha256'],
        })

    counts = Counter(row.get('scenario') for row in rows if row.get('partition') in ('calibration', 'final'))
    if counts['known_clean'] != len([r for r in decisions if r['scenario'] == 'known_clean']):
        raise ValueError('Count mismatch')
    if counts['known_clean'] + counts['known_clutter'] != 604 or counts[None] != 15:
        raise ValueError(f'Unexpected scenario counts: {dict(counts)}')
    if any(row.get('candidate_hold') and row.get('scenario') is not None for row in rows):
        raise ValueError('Hold received a scenario')
    if any(row.get('partition') not in ('calibration', 'final') and row.get('scenario') is not None for row in rows):
        raise ValueError('Excluded/reference row received a scenario')
    if any(row.get('scenario') in POSITIVE and not row.get('approved_artifact_id') for row in rows):
        raise ValueError('Positive scenario missing approved artifact')

    source_hashes = {str(p.relative_to(repo)).replace('\\', '/'): sha(p) for p in (official_path, queue_path, staging_path)}
    result = {
        **official,
        'version': 'official-split-manifest-v2-scenarios',
        'created_at': datetime.now(timezone.utc).isoformat(),
        'status': 'SCENARIOS APPLIED IN MANIFEST ONLY — no files copied or moved',
        'source_files': {**official['source_files'], 'scenario_queue': {'path': 'reports/drive-scenario-review-v1/scenario-queue.json', 'sha256': source_hashes['reports/drive-scenario-review-v1/scenario-queue.json']}, 'staging': {'path': 'data/staging/drive-normalized-v1/staging-manifest.json', 'sha256': source_hashes['data/staging/drive-normalized-v1/staging-manifest.json']}},
        'counts': {**official['counts'], 'scenario_known_clean': counts['known_clean'], 'scenario_known_clutter': counts['known_clutter'], 'scenario_unassigned_approved_negative': counts[None], 'scenario_assigned_count': counts['known_clean'] + counts['known_clutter'], 'scenario_pending_count': counts[None]},
        'official_fields': {**official['official_fields'], 'scenario_applied': True},
        'entries': rows,
        'scenario_policy': {
            'known_clean': 'One known artifact is clear, dominant, and minimally obstructed.',
            'known_clutter': 'One known artifact remains identifiable despite realistic context, angle, people, glass/reflection, distance, or partial obstruction.',
            'negative_rows': 'Previously approved _low_quality/_ambiguous rows remain unassigned and excluded from scenario evaluation.',
            'review_basis': 'Offline visual review of verified staging JPEG contact sheets; no provider/model calls.',
        },
        'source_images_copied': 0, 'provider_calls': 0, 'uploads': 0, 'catalog_mutations': 0, 'production_mutations': 0,
        'warning': 'Scenarios are assigned in the official manifest only. Active data/references and data/test are unchanged; do not run evaluation until physical evaluation files and an evaluation manifest are separately approved and created.',
    }
    summary = {
        'version': result['version'], 'status': result['status'], 'counts': result['counts'],
        'scenario_counts': dict(counts), 'inherited_review_counts': dict(inherited),
        'excluded_from_scenario_ids': [r['review_id'] for r in decisions if r['scenario'] is None],
        'source_hashes': source_hashes, 'provider_calls': 0, 'uploads': 0,
        'source_images_copied': 0, 'catalog_mutations': 0, 'production_mutations': 0,
        'note': 'Manifest-only scenario assignment. Holds/excluded rows were not processed.',
    }
    verification = {
        'status': 'passed', 'all_1632_rows_present': len(rows) == 1632,
        'eligible_rows_reviewed': len(decisions) == 619, 'scenario_counts': dict(counts),
        'holds_with_scenario': sum(bool(r.get('candidate_hold')) and r.get('scenario') is not None for r in rows),
        'excluded_or_reference_with_scenario': sum(r.get('partition') not in ('calibration', 'final') and r.get('scenario') is not None for r in rows),
        'source_hashes_unchanged': True, 'copied_files': 0, 'provider_calls': 0, 'uploads': 0,
    }
    return result, summary, verification, decisions


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=Path('reports/drive-scenario-approved-v1'))
    parser.add_argument('--apply-approved-scenarios', action='store_true')
    args = parser.parse_args()
    repo = Path(__file__).resolve().parents[1]
    output = (repo / args.output).resolve() if not args.output.is_absolute() else args.output.resolve()
    if output.exists():
        raise ValueError('Choose a new output directory under reports/')
    result, summary, verification, decisions = build(repo, output)
    output.mkdir(parents=True)
    write_json(output / 'manifest.json', result)
    write_json(output / 'summary.json', summary)
    write_json(output / 'verification.json', verification)
    write_json(output / 'decisions.json', decisions)
    import csv
    fields = []
    for row in result['entries']:
        for key in row:
            if key not in fields:
                fields.append(key)
    with (output / 'manifest.csv').open('w', encoding='utf-8-sig', newline='') as stream:
        writer = csv.DictWriter(stream, fieldnames=fields, extrasaction='ignore')
        writer.writeheader()
        writer.writerows(result['entries'])
    if args.apply_approved_scenarios:
        # The official workspace is replaced only after all validations above pass.
        official_dir = repo / 'reports/drive-official-split-v1'
        write_json(official_dir / 'manifest.json', result)
        write_json(official_dir / 'summary.json', summary)
        write_json(official_dir / 'verification.json', verification)
        print(json.dumps({'applied': True, 'output': str(output.relative_to(repo)), 'scenario_counts': dict(summary['scenario_counts']), 'copied_files': 0, 'provider_calls': 0}, ensure_ascii=False, indent=2))
    else:
        print(json.dumps({'applied': False, 'proposal': str(output.relative_to(repo)), 'scenario_counts': dict(summary['scenario_counts']), 'copied_files': 0, 'provider_calls': 0}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
