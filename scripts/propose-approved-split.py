"""Create a deterministic split draft from owner-approved review overlays.

Proposal only: no official fields, files, staging, catalog or production are changed.
No image decoding, provider/model calls, uploads or network access are performed.
"""
import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re

EXPECTED_ACTIONS = {
    'reference_candidate': 35,
    'reference_deferred_after_screen': 45,
    'calibration_candidate': 564,
    'final_candidate_cross_device': 183,
    'manual_review_negative_or_target': 805,
}


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load(path):
    return json.loads(path.read_text(encoding='utf-8'))


def index(rows):
    result = {row['review_id']: row for row in rows}
    if len(result) != len(rows) or any(not re.fullmatch(r'R\d{4}', rid) for rid in result):
        raise ValueError('Duplicate or invalid review IDs')
    return result


def source_record(path, repo):
    return {'path': str(path.relative_to(repo)).replace('\\', '/'), 'sha256': sha(path)}


def make_draft(candidate, labels, holds, catalog):
    candidates = index(candidate['entries'])
    approved = index(labels['entries'])
    if len(candidates) != 1632 or len(approved) != 139:
        raise ValueError('Frozen candidate/approved-label population drift')
    if len(set(candidates) & set(approved)) != 139:
        raise ValueError('Approved review IDs are outside candidate manifest')
    action_counts = Counter(row['action'] for row in candidates.values())
    if dict(action_counts) != EXPECTED_ACTIONS:
        raise ValueError(f'Candidate action counts changed: {dict(action_counts)}')
    if labels['approved_review_label_count'] != 132 or labels['unresolved_count'] != 7:
        raise ValueError('Approved label overlay scope changed')
    if holds['held_calibration_count'] != 128 or holds['eligible_calibration_count'] != 436:
        raise ValueError('Hold overlay scope changed')
    held = set(holds['held_calibration_ids'])
    eligible = set(holds['eligible_calibration_ids'])
    calibration = {rid for rid, row in candidates.items() if row['action'] == 'calibration_candidate'}
    if len(held) != 128 or len(eligible) != 436 or held & eligible or held | eligible != calibration:
        raise ValueError('Calibration hold/eligibility sets changed')
    if any(candidates[rid]['action'] != 'calibration_candidate' for rid in held | eligible):
        raise ValueError('Hold overlay contains non-calibration candidate')
    if any(candidates[rid]['camera_model'] != 'iPhone XR' or candidates[rid]['holdout_device_reserved'] for rid in calibration):
        raise ValueError('Calibration contains protected device')
    if len(catalog) != 9:
        raise ValueError('Catalog population changed')
    catalog_ids = {row['id'] for row in catalog}
    rows = []
    for rid, source in sorted(candidates.items()):
        label = approved.get(rid)
        review_scenario = label.get('review_approved_scenario') if label else None
        review_artifact = label.get('review_approved_artifact_id') if label else None
        if label and label.get('owner_label_approved') and review_scenario is None:
            raise ValueError(f'Approved row has no review scenario: {rid}')
        if review_artifact is not None and review_artifact not in catalog_ids:
            raise ValueError(f'Unknown approved review artifact: {rid}')
        if source.get('partition') is not None or source.get('scenario') is not None or source.get('approved_artifact_id') is not None:
            raise ValueError(f'Official candidate field unexpectedly set: {rid}')
        held_flag = rid in held
        if source['action'] == 'reference_candidate':
            role, eligibility, reason = 'reference_candidate', 'candidate_pending_owner_approval', 'Existing 35-reference shortlist; not copied or officially approved.'
        elif source['action'] == 'calibration_candidate':
            role = 'calibration_candidate'
            eligibility = 'held_by_owner_burst_overlay' if held_flag else 'eligible_candidate_pending_owner_approval'
            reason = 'Adjacent-burst hold overlay.' if held_flag else 'Same-session iPhone XR development candidate; not independent of reference session.'
        elif source['action'] == 'final_candidate_cross_device':
            role, eligibility, reason = 'final_candidate_cross_device', 'candidate_pending_visual_and_owner_approval', '22041216G cross-device candidate; reserved device, not official final partition.'
        else:
            role, eligibility, reason = 'manual_review', 'excluded_from_split_draft', 'Manual review/deferred reference; no automatic partition.'
        if source['action'] == 'manual_review_negative_or_target' and review_scenario:
            reason += f' Approved review-only scenario: {review_scenario}.'
        rows.append({
            'review_id': rid,
            'source_file': source['source_file'],
            'source_sha256': source['source_sha256'],
            'camera_model': source['camera_model'],
            'captured_at': source['captured_at'],
            'source_folder': source['source_folder'],
            'holdout_device_reserved': source['holdout_device_reserved'],
            'candidate_action': source['action'],
            'draft_role': role,
            'draft_eligibility': eligibility,
            'draft_reason': reason,
            'folder_artifact_hint': source.get('proposed_artifact_id'),
            'review_approved_scenario': review_scenario,
            'review_approved_artifact_id': review_artifact,
            'candidate_hold': held_flag,
            'official_artifact_id': None,
            'official_scenario': None,
            'official_partition': None,
        })
    role_counts = Counter(row['draft_role'] for row in rows)
    eligible_counts = Counter(row['draft_eligibility'] for row in rows)
    return rows, role_counts, eligible_counts


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=Path('reports/drive-approved-split-proposal-v1'))
    args = parser.parse_args()
    repo = Path(__file__).resolve().parents[1]
    output = args.output.resolve()
    if (repo / 'reports').resolve() not in output.parents or output.exists():
        raise ValueError('Choose a new output directory under ignored reports/')
    paths = {
        'candidate': repo / 'reports/drive-split-candidate-v2.json',
        'labels': repo / 'reports/drive-review-approval-v3/labels-review-approved-v2.json',
        'holds': repo / 'reports/drive-review-approval-v2/candidate-holds-approved.json',
        'catalog': repo / 'data/artifacts.json',
        'label_summary': repo / 'reports/drive-review-approval-v3/summary.json',
        'hold_summary': repo / 'reports/drive-review-approval-v2/summary.json',
    }
    before = {key: sha(path) for key, path in paths.items()}
    candidate, labels, holds, catalog = (load(paths['candidate']), load(paths['labels']), load(paths['holds']), load(paths['catalog']))
    rows, role_counts, eligible_counts = make_draft(candidate, labels, holds, catalog)
    if any(sha(path) != before[key] for key, path in paths.items()):
        raise ValueError('Input changed during draft creation')
    if role_counts != Counter({'manual_review': 850, 'calibration_candidate': 564, 'final_candidate_cross_device': 183, 'reference_candidate': 35}):
        raise ValueError(f'Unexpected role counts: {dict(role_counts)}')
    if sum(row['candidate_hold'] for row in rows) != 128 or sum(row['draft_eligibility'] == 'eligible_candidate_pending_owner_approval' for row in rows) != 436:
        raise ValueError('Eligibility counts changed')
    provenance = {key: source_record(path, repo) for key, path in paths.items()}
    summary = {
        'version': 'approved-split-proposal-v1',
        'created_at': datetime.now(timezone.utc).isoformat(),
        'policy': 'A',
        'status': 'PROPOSAL ONLY — no official partition or copy',
        'source_files': provenance,
        'counts': {
            'reference_candidates': role_counts['reference_candidate'],
            'calibration_candidates_total': role_counts['calibration_candidate'],
            'calibration_held': sum(row['candidate_hold'] for row in rows if row['draft_role'] == 'calibration_candidate'),
            'calibration_eligible': sum(row['draft_eligibility'] == 'eligible_candidate_pending_owner_approval' for row in rows),
            'final_cross_device_candidates': role_counts['final_candidate_cross_device'],
            'manual_review_or_deferred': role_counts['manual_review'],
            'approved_review_labels': labels['approved_review_label_count'],
            'unresolved_review_labels': labels['unresolved_count'],
            'holdout_device_reserved': sum(row['holdout_device_reserved'] for row in rows),
        },
        'review_label_counts': labels['review_label_counts'],
        'unresolved_ids': labels['unresolved_ids'],
        'constraints': {
            'max_new_references': 80,
            'reference_limit_respected': role_counts['reference_candidate'] <= 80,
            'holdout_device_excluded_from_reference_and_calibration': all(not row['holdout_device_reserved'] for row in rows if row['draft_role'] in ('reference_candidate', 'calibration_candidate')),
            'same_session_calibration_not_independent': True,
            'manual_review_not_automatically_unknown': True,
            'official_fields_all_null': all(row['official_partition'] is None and row['official_artifact_id'] is None and row['official_scenario'] is None for row in rows),
        },
        'provider_calls': 0,
        'uploads': 0,
        'production_mutations': 0,
        'warning': 'Folder artifact hints and review-only labels are not official ground truth. Final/reference/calibration still require owner approval, capture-group review, and separate copy/partition approval.',
    }
    output.mkdir(parents=True)
    (output / 'proposal.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    (output / 'candidates.json').write_text(json.dumps(rows, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    for name, predicate in [('reference-candidates.json', lambda r: r['draft_role'] == 'reference_candidate'),
                            ('calibration-candidates.json', lambda r: r['draft_role'] == 'calibration_candidate' and not r['candidate_hold']),
                            ('calibration-held.json', lambda r: r['draft_role'] == 'calibration_candidate' and r['candidate_hold']),
                            ('final-candidates.json', lambda r: r['draft_role'] == 'final_candidate_cross_device'),
                            ('manual-review.json', lambda r: r['draft_role'] == 'manual_review')]:
        (output / name).write_text(json.dumps([r for r in rows if predicate(r)], ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    fields = ['review_id', 'source_file', 'source_sha256', 'source_folder', 'camera_model', 'captured_at', 'holdout_device_reserved', 'candidate_action', 'draft_role', 'draft_eligibility', 'draft_reason', 'folder_artifact_hint', 'review_approved_scenario', 'review_approved_artifact_id', 'candidate_hold', 'official_artifact_id', 'official_scenario', 'official_partition']
    with (output / 'proposal.csv').open('w', encoding='utf-8-sig', newline='') as stream:
        stream.write(','.join(fields) + '\n')
        import csv
        writer = csv.DictWriter(stream, fieldnames=fields, extrasaction='ignore')
        writer.writerows(rows)
    sections = ['<!doctype html><html lang="vi"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Draft chia tập — chưa áp dụng</title>', '<body style="font:16px system-ui;max-width:1100px;margin:24px auto;padding:0 16px"><h1>Draft chia tập — chưa áp dụng</h1><p><b>PROPOSAL ONLY:</b> không copy, không gán partition, không gọi provider.</p><pre>' + json.dumps(summary['counts'], ensure_ascii=False, indent=2) + '</pre><p>Folder hint và review-only label không phải ground truth chính thức. Còn 7 unresolved; calibration cùng session không được coi độc lập.</p>']
    for role, title in [('reference_candidate', '35 reference candidates — chưa duyệt'), ('calibration_candidate', '436 calibration candidates — holdout overlay áp dụng'), ('final_candidate_cross_device', '183 final cross-device candidates — chưa duyệt'), ('manual_review', '850 manual/deferred — ngoài draft split')]:
        subset = [r for r in rows if r['draft_role'] == role and (role != 'calibration_candidate' or not r['candidate_hold'])]
        sections.append(f'<h2>{title}</h2><p>{len(subset)} dòng</p><table border="1" cellpadding="5" cellspacing="0"><tr><th>ID</th><th>Source</th><th>Folder hint</th><th>Review-only</th><th>Eligibility</th></tr>')
        sections.extend(f'<tr><td>{r["review_id"]}</td><td>{r["source_file"]}</td><td>{r["folder_artifact_hint"] or ""}</td><td>{r["review_approved_scenario"] or ""}</td><td>{r["draft_eligibility"]}</td></tr>' for r in subset)
        sections.append('</table>')
    sections.append('</body></html>')
    (output / 'index.html').write_text('\n'.join(sections), encoding='utf-8')
    verification = {'status': 'passed', 'input_hashes_unchanged': True, 'candidate_count': len(rows), 'official_fields_null': summary['constraints']['official_fields_all_null'], 'provider_calls': 0, 'uploads': 0, 'production_mutations': 0}
    (output / 'verification.json').write_text(json.dumps(verification, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({**summary['counts'], **verification}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
