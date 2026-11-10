"""Record explicit owner approval of 118 review labels + 100 additional candidate holds.

Creates a NEW ignored reports directory only. Original images, frozen proposals,
staging, official labels/partitions and production stay unchanged. No network/model.
"""
import argparse
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re

EXPECTED = {'known_clutter': 60, '_unknown': 31, '_low_quality': 20, '_ambiguous': 7}


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def index_rows(rows):
    result = {row['review_id']: row for row in rows}
    if len(result) != len(rows) or any(not re.fullmatch(r'R\d{4}', rid) for rid in result):
        raise ValueError('Duplicate or invalid review IDs')
    return result


def unique_ids(ids, count):
    if len(ids) != count or len(set(ids)) != count:
        raise ValueError(f'Expected exactly {count} unique IDs')
    return set(ids)


def approve_labels(proposal, candidate, previews, artifact_ids):
    byid = index_rows(candidate['entries'])
    images = index_rows(previews['entries'])
    entries = index_rows(proposal['entries'])
    if len(entries) != 139 or set(entries) != set(images):
        raise ValueError('Approved 139-image review queue changed')
    counts = Counter(row['proposed_scenario'] for row in entries.values() if row['proposed_scenario'] is not None)
    if dict(counts) != EXPECTED or sum(row['proposed_scenario'] is None for row in entries.values()) != 21:
        raise ValueError('118-label approval scope changed')
    output = []
    for rid, row in sorted(entries.items()):
        source, preview = byid[rid], images[rid]
        if source['source_folder'] not in ('Khác', 'Khác 2') or source['action'] != 'manual_review_negative_or_target':
            raise ValueError('Approval outside manual-review scope')
        for key in ('source_file', 'source_sha256', 'camera_model', 'holdout_device_reserved'):
            if row[key] != source[key] or row[key] != preview[key]:
                raise ValueError(f'Source identity drift: {rid}/{key}')
        if any(row[key] != preview[key] for key in ('large_preview_file', 'large_preview_sha256')):
            raise ValueError('Preview identity drift')
        if row.get('owner_label_approved') or any(row.get(key) is not None for key in ('partition', 'approved_scenario', 'approved_artifact_id')):
            raise ValueError('Expected an unapproved review-only proposal')
        scenario = row['proposed_scenario']
        artifact = row['proposed_artifact_id']
        if scenario == 'known_clutter':
            if artifact not in artifact_ids or row['visible_catalog_targets'] != [artifact]:
                raise ValueError('Known label must identify exactly one catalog target')
        elif artifact is not None:
            raise ValueError('Rejection/unresolved row cannot have an approved target')
        output.append({**row, 'owner_label_approved': scenario is not None,
                       'approval_scope': 'review_only_not_official_evaluation_label',
                       'review_approved_scenario': scenario,
                       'review_approved_artifact_id': artifact if scenario == 'known_clutter' else None,
                       'partition': None, 'scenario': None, 'approved_scenario': None, 'approved_artifact_id': None})
    return {'version': 'owner-approved-manual-review-labels-v1', 'review_label_counts': dict(counts),
            'approved_review_label_count': 118, 'unresolved_count': 21,
            'remaining_666_images_unchanged': True, 'official_partitions_applied': False,
            'official_labels_applied': False, 'entries': output}


def approve_holds(candidate, previous, proposal):
    byid = index_rows(candidate['entries'])
    old = unique_ids(previous['held_calibration_ids'], 28)
    extra = unique_ids(proposal['additional_hold_proposed_ids'], 100)
    if not previous.get('owner_holds_approved') or old & extra:
        raise ValueError('Prior approval missing or new holds overlap old holds')
    calibration = {rid for rid, row in byid.items() if row['action'] == 'calibration_candidate'}
    if sum(row['action'] == 'reference_candidate' for row in byid.values()) != 35 or sum(row['action'] == 'final_candidate_cross_device' for row in byid.values()) != 183:
        raise ValueError('Reference/final candidate population drift')
    if any(byid[rid]['camera_model'] != 'iPhone XR' or byid[rid]['holdout_device_reserved'] for rid in calibration):
        raise ValueError('Calibration population contains protected device')
    if len(calibration) != 564 or set(previous['eligible_calibration_ids']) != calibration - old:
        raise ValueError('Previous eligible population drift')
    unique_ids(previous['eligible_calibration_ids'], 536)
    pairs = proposal['pairs']
    if len(pairs) != 108 or len({(row['reference_id'], row['calibration_id']) for row in pairs}) != 108 or {row['calibration_id'] for row in pairs} != extra:
        raise ValueError('108-pair/100-image proposal scope changed')
    for pair in pairs:
        ref, cal = byid[pair['reference_id']], byid[pair['calibration_id']]
        if ref['action'] != 'reference_candidate' or any(
                pair[key] != row['source_sha256'] for key, row in
                (('reference_source_sha256', ref), ('calibration_source_sha256', cal))):
            raise ValueError('Burst-pair role/hash drift')
    rows = []
    for rid in sorted(old | extra):
        row = byid[rid]
        if row['action'] != 'calibration_candidate' or row['camera_model'] != 'iPhone XR' or row['holdout_device_reserved']:
            raise ValueError('Hold cannot affect reference/final/holdout device')
        if any(row.get(key) is not None for key in ('partition', 'scenario', 'approved_artifact_id')):
            raise ValueError('Official partition/label unexpectedly set')
        rows.append({key: row[key] for key in ('review_id', 'source_file', 'source_sha256', 'proposed_artifact_id', 'camera_model')} |
                    {'owner_hold_approved': True, 'reason': 'previous_28_approved_holds' if rid in old else 'additional_100_adjacent_second_holds',
                     'candidate_eligible': False, 'partition': None})
    return {'version': 'approved-candidate-holds-v2', 'owner_holds_approved': True,
            'applies_at': 'candidate_eligibility_overlay_only; no files moved/deleted; no official split',
            'held_calibration_ids': sorted(old | extra), 'eligible_calibration_ids': sorted(calibration - old - extra),
            'held_calibration_count': 128, 'eligible_calibration_count': 436,
            'previously_held_count': 28, 'newly_held_count': 100,
            'reference_candidates_unchanged': 35, 'final_candidates_unchanged': 183,
            'official_partitions_applied': False, 'capture_groups_independent': False,
            'warning': 'Supersedes previous 28-hold overlay. Frozen v2 candidate and 782 historical staging JPEGs stay unchanged. Remaining 436 same-session candidates are NOT independent. No transitive capture-group boundary established.',
            'entries': rows}


def confined(root, relative):
    path = (root / relative).resolve()
    if root.resolve() not in path.parents:
        raise ValueError('Path escapes approved source root')
    return path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--approve-118-review-labels', action='store_true')
    parser.add_argument('--approve-100-additional-holds', action='store_true')
    parser.add_argument('--output', type=Path, default=Path('reports/drive-review-approval-v2'))
    args = parser.parse_args()
    if not args.approve_118_review_labels or not args.approve_100_additional_holds:
        raise ValueError('Both explicit owner approval flags required')
    repo = Path(__file__).resolve().parents[1]
    output = args.output.resolve()
    if (repo / 'reports').resolve() not in output.parents or output.exists():
        raise ValueError('Choose a NEW output directory under ignored reports/')
    review = repo / 'reports/drive-large-manual-review-v1'
    files = {'candidate': repo / 'reports/drive-split-candidate-v2.json',
             'labels_proposal': review / 'visual-review-proposal.json',
             'previews': review / 'manifest.json', 'previous_holds': review / 'candidate-holds-approved.json',
             'burst_proposal': review / 'adjacent-burst-proposal.json',
             'observations': review / 'visual-observations.json',
             'catalog': repo / 'data/artifacts.json', 'prior_final_approval': repo / 'reports/drive-final-labels-approved-v1.json'}
    hashes = {key: sha(path) for key, path in files.items()}
    docs = {key: json.loads(path.read_text(encoding='utf-8')) for key, path in files.items()}
    if docs['previews']['candidate_manifest_sha256'] != hashes['candidate'] or docs['previous_holds']['candidate_manifest_sha256'] != hashes['candidate'] or docs['labels_proposal']['observations_sha256'] != hashes['observations']:
        raise ValueError('Frozen proposal provenance drift')
    labels = approve_labels(docs['labels_proposal'], docs['candidate'], docs['previews'], {row['id'] for row in docs['catalog']})
    holds = approve_holds(docs['candidate'], docs['previous_holds'], docs['burst_proposal'])
    inventory = json.loads((repo / 'reports/drive-review-v1/images.json').read_text(encoding='utf-8'))
    originals = repo / 'data/incoming/drive-1jYzY5U3Yc6R_3CdUz7h0T8rYOBFGb7VH/originals'
    checks = [(confined(originals if row['kind'] == 'incoming' else repo / 'data', row['source_file']), row['source_sha256']) for row in inventory]
    checks += [(confined(review, row['large_preview_file']), row['large_preview_sha256']) for row in docs['previews']['entries']]
    stage = repo / 'data/staging/drive-normalized-v1'
    staging = json.loads((stage / 'staging-manifest.json').read_text(encoding='utf-8'))
    checks += [(confined(stage, row['jpeg_file']), row['normalized_sha256']) for row in staging['entries']]
    def verify(check):
        if sha(check[0]) != check[1]:
            raise ValueError(f'Hash mismatch: {check[0]}')
    with ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(verify, checks))
    candidates = docs['candidate']['entries']
    if len(inventory) != 1642 or len(candidates) != 1632 or len(staging['entries']) != 782:
        raise ValueError('Frozen inventory/candidate/staging population drift')
    reserved = [row for row in candidates if row['camera_model'] == '22041216G']
    if len(reserved) != 189 or not all(row['holdout_device_reserved'] and row['action'] in ('final_candidate_cross_device', 'manual_review_negative_or_target') for row in reserved):
        raise ValueError('189-image holdout-device protection drift')
    if any(row.get(key) is not None for row in candidates for key in ('partition', 'scenario', 'approved_artifact_id')):
        raise ValueError('Official candidate fields must remain unset')
    if any(sha(path) != hashes[key] for key, path in files.items()):
        raise ValueError('Input changed during verification')
    provenance = {'recorded_at': datetime.now(timezone.utc).isoformat(),
                  'approval_basis': 'User: đồng ý cả hai, in reply to approval of the 118 review-label proposals (21 remain unresolved) and 100 additional temporary candidate holds. No official split/copy/provider/upload/production approval.',
                  'source_files': {key: {'path': str(path.relative_to(repo)).replace('\\', '/'), 'sha256': hashes[key]} for key, path in files.items()},
                  'provider_calls': 0, 'uploads': 0, 'production_mutations': 0}
    summary = {**provenance, 'review_label_counts': labels['review_label_counts'], 'approved_review_label_count': 118,
               'unresolved_manual_review_ids': [row['review_id'] for row in labels['entries'] if not row['owner_label_approved']],
               'total_held_calibration_candidates': 128, 'remaining_calibration_candidates': 436,
               'reference_candidates_unchanged': 35, 'final_candidates_unchanged': 183,
               'holdout_device_protected_count': 189, 'official_partitions_applied': False, 'official_labels_applied': False,
               'hash_verified': {'inventory': len(inventory), 'large_previews': len(docs['previews']['entries']), 'staging_jpegs': len(staging['entries'])}}
    output.mkdir(parents=True)
    for name, data in [('labels-review-approved.json', labels), ('candidate-holds-approved.json', holds), ('summary.json', summary)]:
        with (output / name).open('x', encoding='utf-8') as file:
            file.write(json.dumps({**provenance, **data}, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({key: value for key, value in summary.items() if key != 'source_files'}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
