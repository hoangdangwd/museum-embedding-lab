"""Record explicit owner approval of the 14 second-pass review proposals.

This creates a new review-only overlay. It never changes originals, frozen proposals,
official partitions, staging, catalog, or production. No network/model calls.
"""
import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re

EXPECTED = {'_low_quality': 12, '_unknown': 2, None: 7}


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load(path):
    return json.loads(path.read_text(encoding='utf-8'))


def index(rows):
    result = {row['review_id']: row for row in rows}
    if len(result) != len(rows) or any(not re.fullmatch(r'R\d{4}', key) for key in result):
        raise ValueError('Duplicate or invalid review IDs')
    return result


def approve(proposal, prior, candidate, catalog_ids):
    proposal_rows = index(proposal['entries'])
    prior_all = index(prior['entries'])
    prior_rows = {rid: row for rid, row in prior_all.items() if not row.get('owner_label_approved')}
    candidate_rows = index(candidate['entries'])
    if any(row.get(key) is not None for row in candidate_rows.values() for key in ('partition', 'scenario', 'approved_artifact_id')):
        raise ValueError('Official candidate fields unexpectedly set')
    if set(proposal_rows) != set(prior_rows) or len(proposal_rows) != 21:
        raise ValueError('Second-pass proposal must contain exactly the prior 21 unresolved IDs')
    if sum(row.get('owner_label_approved') is True for row in prior_all.values()) != 118:
        raise ValueError('Prior approved label count drift')
    counts = Counter(row['proposed_scenario'] for row in proposal_rows.values())
    if dict(counts) != EXPECTED:
        raise ValueError(f'Proposal counts changed: {dict(counts)}')
    if proposal.get('currently_approved_review_labels_unchanged') != 118 or proposal.get('candidate_holds_unchanged') != 128:
        raise ValueError('Proposal provenance scope changed')
    output = [row for rid, row in sorted(prior_all.items()) if row.get('owner_label_approved')]
    for rid in sorted(prior_rows):
        old = prior_rows[rid]
        new = proposal_rows[rid]
        candidate_row = candidate_rows[rid]
        for key in ('source_file', 'source_sha256', 'camera_model', 'holdout_device_reserved'):
            if old.get(key) != new.get(key) or old.get(key) != candidate_row.get(key):
                raise ValueError(f'Source identity drift: {rid}/{key}')
        for key in ('large_preview_file', 'large_preview_sha256'):
            if old.get(key) != new.get(key):
                raise ValueError(f'Preview identity drift: {rid}/{key}')
        if any(candidate_row.get(key) is not None for key in ('partition', 'scenario', 'approved_artifact_id')):
            raise ValueError('Official candidate fields unexpectedly set')
        proposed = new['proposed_scenario']
        if proposed not in EXPECTED:
            raise ValueError('Unsupported proposal label')
        if new.get('proposed_artifact_id') is not None:
            raise ValueError('Second-pass proposal cannot assign an artifact')
        if proposed is None:
            if old.get('owner_label_approved') or old.get('review_approved_scenario') is not None:
                raise ValueError(f'Unresolved row was already approved: {rid}')
            approved = False
            approved_scenario = None
        else:
            if old.get('owner_label_approved') or old.get('review_approved_scenario') is not None:
                raise ValueError(f'Expected unresolved prior row: {rid}')
            approved = True
            approved_scenario = proposed
        output.append({**old,
                       'owner_label_approved': approved,
                       'review_approved_scenario': approved_scenario,
                       'review_approved_artifact_id': None,
                       'approval_scope': 'review_only_not_official_evaluation_label',
                       'partition': None, 'scenario': None, 'approved_scenario': None,
                       'approved_artifact_id': None,
                       'second_pass_proposal': proposed,
                       'second_pass_note': new['note']})
    prior_count = sum(row.get('owner_label_approved') is True for row in prior_all.values())
    if prior_count != 118 or len(output) != 139 or sum(row['owner_label_approved'] for row in output) != 132:
        raise ValueError('Cumulative approval count drift')
    if sum(row['review_approved_scenario'] is None for row in output) != 7:
        raise ValueError('Expected exactly 7 unresolved rows after approval')
    if any(row['review_approved_scenario'] is not None and row['review_approved_scenario'] not in ('_low_quality', '_unknown', 'known_clutter', '_ambiguous') for row in output):
        raise ValueError('Unsupported approved scenario')
    if len(catalog_ids) != 9:
        raise ValueError('Catalog population drift')
    return {'version': 'owner-approved-manual-review-labels-v2',
            'review_label_counts': dict(Counter(row['review_approved_scenario'] for row in output if row['review_approved_scenario'] is not None)),
            'approved_review_label_count': 132, 'newly_approved_review_label_count': 14,
            'previously_approved_review_label_count': 118, 'unresolved_count': 7,
            'unresolved_ids': [row['review_id'] for row in output if not row['owner_label_approved']],
            'remaining_666_images_unchanged': True, 'official_partitions_applied': False,
            'official_labels_applied': False, 'candidate_holds_unchanged': 128,
            'eligible_calibration_unchanged': 436, 'entries': output}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--approve-14-second-pass-labels', action='store_true')
    parser.add_argument('--output', type=Path, default=Path('reports/drive-review-approval-v3'))
    args = parser.parse_args()
    if not args.approve_14_second_pass_labels:
        raise ValueError('Explicit owner approval flag required')
    repo = Path(__file__).resolve().parents[1]
    output = args.output.resolve()
    if (repo / 'reports').resolve() not in output.parents or output.exists():
        raise ValueError('Choose a NEW output directory under ignored reports/')
    proposal_path = repo / 'reports/drive-unresolved-review-v1/proposal.json'
    prior_path = repo / 'reports/drive-review-approval-v2/labels-review-approved.json'
    candidate_path = repo / 'reports/drive-split-candidate-v2.json'
    catalog_path = repo / 'data/artifacts.json'
    files = {'proposal': proposal_path, 'prior_approval': prior_path, 'candidate': candidate_path, 'catalog': catalog_path,
             'proposal_verification': repo / 'reports/drive-unresolved-review-v1/verification.json',
             'proposal_observations': repo / 'reports/drive-unresolved-review-v1/observations.json'}
    hashes = {key: sha(path) for key, path in files.items()}
    proposal, prior, candidate, catalog = (load(proposal_path), load(prior_path), load(candidate_path), load(catalog_path))
    if proposal.get('status', '').startswith('PROPOSAL ONLY') is False or proposal['official_partitions_applied'] or proposal['official_labels_applied']:
        raise ValueError('Proposal is not a review-only frozen proposal')
    if proposal['source_files_sha256'].get('reports/drive-review-approval-v2/summary.json') is None:
        raise ValueError('Proposal missing approval provenance')
    result = approve(proposal, prior, candidate, {row['id'] for row in catalog})
    provenance = {'recorded_at': datetime.now(timezone.utc).isoformat(),
                  'approval_basis': 'User: ok duyệt, approving the 14 second-pass review proposals (12 _low_quality + 2 _unknown); 7 remain unresolved. Review-only; no official split/copy/provider/upload/production approval.',
                  'source_files': {key: {'path': str(path.relative_to(repo)).replace('\\', '/'), 'sha256': hashes[key]} for key, path in files.items()},
                  'provider_calls': 0, 'uploads': 0, 'production_mutations': 0}
    summary = {**provenance, 'review_label_counts': result['review_label_counts'],
               'approved_review_label_count': 132, 'newly_approved_review_label_count': 14,
               'unresolved_count': 7, 'unresolved_ids': result['unresolved_ids'],
               'candidate_holds_unchanged': 128, 'eligible_calibration_unchanged': 436,
               'holdout_device_protected_count': 189, 'official_partitions_applied': False,
               'official_labels_applied': False}
    output.mkdir(parents=True)
    for name, data in [('labels-review-approved-v2.json', result), ('summary.json', summary)]:
        with (output / name).open('x', encoding='utf-8') as file:
            file.write(json.dumps({**provenance, **data}, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({key: value for key, value in summary.items() if key != 'source_files'}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
