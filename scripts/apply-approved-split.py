"""Apply the owner-approved partition role to a new immutable official manifest.

This is intentionally not a file move/copy and not an evaluation manifest. It records
partition and artifact decisions while leaving scenario unset until clean/clutter review.
Originals, frozen candidates, staging, active data, catalog and production are unchanged.
"""
import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re

EXPECTED = {'references': 35, 'calibration': 436, 'final': 183}


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load(path):
    return json.loads(path.read_text(encoding='utf-8'))


def index(rows):
    result = {row['review_id']: row for row in rows}
    if len(result) != len(rows) or any(not re.fullmatch(r'R\d{4}', rid) for rid in result):
        raise ValueError('Duplicate or invalid review IDs')
    return result


def apply(candidate, draft_summary, draft_rows, labels, holds):
    source = index(candidate['entries'])
    rows = index(draft_rows)
    approved = index(labels['entries'])
    if len(source) != 1632 or len(rows) != 1632 or len(approved) != 139:
        raise ValueError('Frozen source/draft/label population drift')
    if set(source) != set(rows):
        raise ValueError('Draft does not cover candidate manifest')
    if draft_summary['status'] != 'PROPOSAL ONLY — no official partition or copy' or draft_summary['constraints']['official_fields_all_null'] is not True:
        raise ValueError('Draft was already applied or is not the expected proposal')
    if labels['approved_review_label_count'] != 132 or labels['unresolved_count'] != 7:
        raise ValueError('Review label approval scope drift')
    if holds['held_calibration_count'] != 128 or holds['eligible_calibration_count'] != 436:
        raise ValueError('Calibration hold scope drift')
    held = set(holds['held_calibration_ids'])
    eligible = set(holds['eligible_calibration_ids'])
    if held & eligible or len(held) != 128 or len(eligible) != 436:
        raise ValueError('Invalid hold overlay')
    if any(row.get(key) is not None for row in source.values() for key in ('partition', 'scenario', 'approved_artifact_id')):
        raise ValueError('Frozen candidate contains official fields')
    if any(row.get(key) is not None for row in rows.values() for key in ('official_partition', 'official_scenario', 'official_artifact_id')):
        raise ValueError('Draft contains official fields')
    out = []
    for rid in sorted(source):
        source_row, draft_row = source[rid], rows[rid]
        if source_row['source_sha256'] != draft_row['source_sha256'] or source_row['source_file'] != draft_row['source_file']:
            raise ValueError(f'Source drift: {rid}')
        partition = None
        artifact = None
        status = 'excluded_from_official_split'
        reason = 'Manual/deferred or held candidate; no official partition assigned.'
        if draft_row['draft_role'] == 'reference_candidate':
            partition, artifact, status = 'references', draft_row['folder_artifact_hint'], 'official_partition_applied_scenario_not_required'
            reason = 'Owner-approved draft reference role; source remains in incoming and is not copied.'
        elif draft_row['draft_role'] == 'calibration_candidate' and not draft_row['candidate_hold']:
            partition, artifact, status = 'calibration', draft_row['folder_artifact_hint'], 'official_partition_applied_scenario_pending'
            reason = 'Owner-approved eligible calibration role; scenario clean/clutter remains unset.'
        elif draft_row['draft_role'] == 'final_candidate_cross_device':
            partition, artifact, status = 'final', draft_row['folder_artifact_hint'], 'official_partition_applied_scenario_pending'
            reason = 'Owner-approved cross-device final role; scenario clean/clutter remains unset.'
        if partition and (not artifact or not re.fullmatch(r'stamp-[a-z0-9-]+', artifact)):
            raise ValueError(f'Missing/invalid artifact for partitioned row: {rid}')
        review = approved.get(rid)
        out.append({
            'review_id': rid,
            'source_file': source_row['source_file'],
            'source_sha256': source_row['source_sha256'],
            'camera_model': source_row['camera_model'],
            'captured_at': source_row['captured_at'],
            'source_folder': source_row['source_folder'],
            'holdout_device_reserved': source_row['holdout_device_reserved'],
            'partition': partition,
            'approved_artifact_id': artifact,
            'scenario': None,
            'scenario_status': 'not_assigned_requires_clean_clutter_review' if partition != 'references' and partition is not None else ('not_required_for_reference' if partition == 'references' else 'not_in_split'),
            'partition_status': status,
            'partition_reason': reason,
            'candidate_hold': rid in held,
            'review_approved_scenario': review.get('review_approved_scenario') if review else None,
            'review_approved_artifact_id': review.get('review_approved_artifact_id') if review else None,
            'official_source_path': None,
        })
    counts = Counter(row['partition'] for row in out if row['partition'] is not None)
    if dict(counts) != EXPECTED:
        raise ValueError(f'Applied partition counts changed: {dict(counts)}')
    if any(row['candidate_hold'] and row['partition'] is not None for row in out):
        raise ValueError('Held calibration candidate entered official partition')
    if any(row['holdout_device_reserved'] and row['partition'] in ('references', 'calibration') for row in out):
        raise ValueError('Holdout device entered reference/calibration')
    if sum(row['scenario'] is None for row in out) != 1632:
        raise ValueError('Scenario must remain unset in this manifest')
    return out, counts


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply-approved-partitions', action='store_true')
    parser.add_argument('--output', type=Path, default=Path('reports/drive-official-split-v1'))
    args = parser.parse_args()
    if not args.apply_approved_partitions:
        raise ValueError('Explicit partition application flag required')
    repo = Path(__file__).resolve().parents[1]
    output = args.output.resolve()
    if (repo / 'reports').resolve() not in output.parents or output.exists():
        raise ValueError('Choose a new output directory under ignored reports/')
    paths = {
        'candidate': repo / 'reports/drive-split-candidate-v2.json',
        'draft': repo / 'reports/drive-approved-split-proposal-v1/proposal.json',
        'draft_rows': repo / 'reports/drive-approved-split-proposal-v1/candidates.json',
        'labels': repo / 'reports/drive-review-approval-v3/labels-review-approved-v2.json',
        'holds': repo / 'reports/drive-review-approval-v2/candidate-holds-approved.json',
    }
    before = {key: sha(path) for key, path in paths.items()}
    candidate, draft, labels, holds = load(paths['candidate']), load(paths['draft']), load(paths['labels']), load(paths['holds'])
    rows, counts = apply(candidate, draft, load(paths['draft_rows']), labels, holds)
    if any(sha(path) != before[key] for key, path in paths.items()):
        raise ValueError('Input changed during application')
    provenance = {key: {'path': str(path.relative_to(repo)).replace('\\', '/'), 'sha256': digest} for (key, path), digest in zip(paths.items(), before.values())}
    summary = {
        'version': 'official-split-manifest-v1',
        'created_at': datetime.now(timezone.utc).isoformat(),
        'status': 'PARTITION APPLIED IN MANIFEST ONLY — no files copied or moved',
        'source_files': provenance,
        'counts': {'references': counts['references'], 'calibration': counts['calibration'], 'final': counts['final'], 'excluded': sum(row['partition'] is None for row in rows)},
        'scenario_assigned_count': 0,
        'scenario_pending_count': 619,
        'manual_or_held_excluded_count': 978,
        'holdout_device_reserved_count': sum(row['holdout_device_reserved'] for row in rows),
        'candidate_hold_count': sum(row['candidate_hold'] for row in rows),
        'official_fields': {'partition_applied': True, 'approved_artifact_id_applied': True, 'scenario_applied': False},
        'source_images_copied': 0,
        'provider_calls': 0,
        'uploads': 0,
        'catalog_mutations': 0,
        'production_mutations': 0,
        'warning': 'The manifest has official partition/artifact assignments, but calibration/final scenario is intentionally unset. Do not run evaluation until scenarios are assigned and normalized evaluation JPEGs are created.',
    }
    output.mkdir(parents=True)
    (output / 'manifest.json').write_text(json.dumps({'version': 1, **summary, 'entries': rows}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    (output / 'summary.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    (output / 'verification.json').write_text(json.dumps({'status': 'passed', 'input_hashes_unchanged': True, 'all_1632_rows_present': True, 'partition_counts': dict(counts), 'all_scenarios_unset': True, 'copied_files': 0, 'provider_calls': 0, 'uploads': 0}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    fields = list(rows[0])
    import csv
    with (output / 'manifest.csv').open('w', encoding='utf-8-sig', newline='') as stream:
        writer = csv.DictWriter(stream, fieldnames=fields, extrasaction='ignore')
        writer.writeheader(); writer.writerows(rows)
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
