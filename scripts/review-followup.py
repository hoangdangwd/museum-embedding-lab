"""Produce review-only follow-up reports from existing, manually inspected evidence.

No image conversion, inference, official partitioning, source edits, or uploads.
Refuses overwriting reports and rechecks every manual-folder source hash.
"""
import argparse
from collections import Counter, defaultdict
from datetime import datetime, timezone
import hashlib
import html
import json
from pathlib import Path
import re


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def expand_ids(text):
    result = []
    for token in text.split():
        match = re.fullmatch(r'R(\d{4})(?:-R(\d{4}))?', token)
        if not match:
            raise ValueError(f'Invalid review ID token: {token}')
        start = int(match[1])
        end = int(match[2] or match[1])
        if end < start:
            raise ValueError('Reverse ID range')
        result.extend(f'R{number:04d}' for number in range(start, end + 1))
    if len(result) != len(set(result)):
        raise ValueError('Duplicate review ID within observation')
    return result


def screen_entries(images, observations, candidates):
    manual = {entry['review_id']: entry for entry in images if entry.get('kind') == 'incoming' and entry['source_folder'] in ('Khác', 'Khác 2')}
    assignments = {}
    for section in ('visible_targets', 'unresolved'):
        for observation in observations[section]:
            for review_id in expand_ids(observation['ids']):
                if review_id not in manual or review_id in assignments:
                    raise ValueError(f'Unknown or multiply assigned ID: {review_id}')
                assignments[review_id] = (section, observation)
    attention = defaultdict(list)
    for observation in observations['quality_or_label_issues']:
        for review_id in expand_ids(observation['ids']):
            if review_id not in manual:
                raise ValueError(f'Attention flag outside manual folders: {review_id}')
            attention[review_id].append(observation['note'])
    byid = {entry['review_id']: entry for entry in candidates}
    rows = []
    for review_id, entry in sorted(manual.items()):
        source = byid[review_id]
        if source['source_sha256'] != entry['source_sha256'] or source['source_file'] != entry['source_file']:
            raise ValueError('Candidate/review source disagreement')
        section, observation = assignments.get(review_id, ('no_target_seen_on_preview', {}))
        category = {'visible_targets': 'catalog_target_visible_on_preview', 'unresolved': 'target_presence_unresolved'}.get(section, section)
        if category == 'no_target_seen_on_preview' and attention[review_id]:
            category = 'quality_or_label_review_needed'
        rows.append({
            'review_id': review_id, 'source_file': entry['source_file'], 'source_sha256': entry['source_sha256'],
            'source_folder': entry['source_folder'], 'camera_model': entry['camera_model'], 'captured_at': entry['captured_at'],
            'capture_bucket_hint': entry['capture_bucket_hint'], 'preview': entry['preview'],
            'inspection_level': 'contact_sheet_preview_screening_not_full_resolution_label',
            'screening_category': category, 'proposed_artifact_id': observation.get('artifact'),
            'reason_vi': observation.get('note', 'Chưa thấy 9 target ở preview. Không phải phê duyệt unknown; phải kiểm tra lại khung/mép và nhóm cảnh trước khi dùng làm negative.'),
            'attention_notes': attention[review_id],
            'holdout_device_reserved': source['holdout_device_reserved'],
            'needs_larger_review': category != 'no_target_seen_on_preview' or bool(attention[review_id]),
            'approved_artifact_id': None, 'approved_scenario': None, 'partition': None, 'owner_label_approved': False,
        })
    return rows


def burst_proposal(audit, candidates):
    byid = {entry['review_id']: entry for entry in candidates}
    byfile = {entry['source_file']: entry for entry in candidates}
    action_role = {'reference_candidate': 'references', 'calibration_candidate': 'calibration', 'final_candidate_cross_device': 'final'}
    groups = []
    for index, group in enumerate(audit['same_second_cross_role_groups'], 1):
        entries = [byid[item['review_id']] for item in group['entries']]
        if any(entry['camera_model'] != 'iPhone XR' for entry in entries):
            raise ValueError('Do not reassign a holdout device')
        references = [entry['review_id'] for entry in entries if action_role.get(entry['action']) == 'references']
        calibration = [entry['review_id'] for entry in entries if action_role.get(entry['action']) == 'calibration']
        if not references or not calibration:
            raise ValueError('Expected mixed reference/calibration group')
        groups.append({
            'group': f'burst-review-{index:02d}', 'captured_at': group['captured_at'], 'source_folder': group['source_folder'],
            'reference_ids': references, 'calibration_ids': calibration,
            'inspection_level': 'paired_existing_previews_and_source_metadata',
            'finding': 'same_second_related_views_not_independent; not necessarily identical pixels',
            'proposed_action': 'keep_selected_references_and_quarantine_calibration_siblings_pending_owner_approval',
            'owner_action_approved': False,
        })
    for pair in audit['cross_role_dhash_hints']:
        left, right = byfile[pair['left']], byfile[pair['right']]
        groups.append({'group': 'dhash-cross-role-review', 'reference_ids': [left['review_id']], 'calibration_ids': [right['review_id']],
                       'inspection_level': 'paired_existing_previews_and_source_metadata', 'hamming_distance': pair['hamming_distance'],
                       'finding': 'visually_near_repeated_view; dhash_alone_not_proof',
                       'proposed_action': 'keep_selected_reference_and_quarantine_calibration_sibling_pending_owner_approval', 'owner_action_approved': False})
    affected = sorted({review_id for group in groups for review_id in group['calibration_ids']})
    return {'groups': groups, 'calibration_quarantine_candidate_ids': affected, 'calibration_quarantine_candidates': len(affected),
            'remaining_calibration_candidates_if_approved': audit['selected_images'] - 35 - 183 - len(affected),
            'important_limit': 'Removing these cases is only a minimum safeguard, NOT complete burst deduplication. Adjacent-second bursts, same-session correlation and manual-folder scene overlap remain. No time-gap threshold or official capture groups applied.',
            'official_partitions_applied': False, 'owner_actions_approved': False, 'provider_calls': 0}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--observations', type=Path, default=Path('reports/drive-negative-screen-observations-v1.json'))
    parser.add_argument('--output', type=Path, default=Path('reports/drive-followup-review-v1'))
    args = parser.parse_args()
    repo = Path(__file__).resolve().parents[1]
    output = args.output.resolve()
    if (repo / 'reports').resolve() not in output.parents or output.exists():
        raise ValueError('Output must be a NEW directory inside ignored reports/')
    workspace = repo / 'reports/drive-review-v1'
    images = json.loads((workspace / 'images.json').read_text(encoding='utf-8'))
    candidates = json.loads((repo / 'reports/drive-split-candidate-v2.json').read_text(encoding='utf-8'))
    observations = json.loads(args.observations.read_text(encoding='utf-8'))
    rows = screen_entries(images, observations, candidates['entries'])
    if len(rows) != 805 or Counter(row['camera_model'] for row in rows) != {'iPhone XR': 799, '22041216G': 6}:
        raise ValueError('Manual review scope/device counts changed')
    originals = repo / 'data/incoming/drive-1jYzY5U3Yc6R_3CdUz7h0T8rYOBFGb7VH/originals'
    for row in rows:
        path = (originals / row['source_file']).resolve()
        if originals.resolve() not in path.parents or digest(path) != row['source_sha256']:
            raise ValueError(f'Source hash/path mismatch: {row["review_id"]}')
    sheets = [sheet for sheet in json.loads((workspace / 'sheets.json').read_text(encoding='utf-8')) if sheet['folder'] in ('Khác', 'Khác 2')]
    coverage = [review_id for sheet in sheets for review_id in sheet['review_ids']]
    if len(coverage) != 805 or len(set(coverage)) != 805 or set(coverage) != {row['review_id'] for row in rows}:
        raise ValueError('Contact-sheet coverage mismatch')
    evidence = [{**sheet, 'sha256': digest(workspace / sheet['file']), 'inspection_level': 'visually_screened_contact_sheet'} for sheet in sheets]
    audit = json.loads((repo / 'reports/drive-staging-leakage-audit-v1.json').read_text(encoding='utf-8'))
    bursts = burst_proposal(audit, candidates['entries'])
    summary = {'manual_images_screened_at_preview_level': len(rows), 'sheets_inspected': len(sheets),
               'category_counts': dict(Counter(row['screening_category'] for row in rows)),
               'larger_review_queue': sum(row['needs_larger_review'] for row in rows),
               'holdout_device_manual_images_protected': 6, 'source_hashes_verified': len(rows),
               'labels_approved_in_this_screen': 0, 'official_partitions_applied': False, 'provider_calls': 0,
               'burst_review_groups': len(bursts['groups']), 'calibration_quarantine_candidates': bursts['calibration_quarantine_candidates'],
               'warning': 'No target seen on preview is NOT an unknown label. Entire 805-image screen is provisional; never seed these entries or force labels based on folder names.'}
    output.mkdir(parents=True)
    documents = {
        'manual-screen.json': {'version': 'manual-folder-preview-screen-v1', 'created_at': datetime.now(timezone.utc).isoformat(), 'observations_sha256': digest(args.observations), 'summary': summary, 'entries': rows},
        'sheet-evidence.json': evidence,
        'burst-proposal.json': bursts,
        'summary.json': summary,
    }
    for filename, data in documents.items():
        (output / filename).write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    import os
    cards = []
    for row in rows:
        preview = Path(os.path.relpath(workspace / row['preview'], output)).as_posix()
        cards.append(f'<article><h3>{row["review_id"]} — {html.escape(row["screening_category"])}</h3><p>{html.escape(row["source_file"])}</p><img loading="lazy" src="{html.escape(preview, quote=True)}"><p>{html.escape(row["reason_vi"])}</p><p>{html.escape("; ".join(row["attention_notes"]))}</p></article>')
    (output / 'index.html').write_text('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Duyệt Khác/Khác 2 — đề xuất</title><style>body{font:16px system-ui;background:#eee;padding:20px}main{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:12px}article{background:white;padding:10px}img{width:100%;height:360px;object-fit:contain}</style><h1>805 ảnh — preview screening, CHƯA phải nhãn</h1><p>Không thấy target ở preview không đồng nghĩa unknown. Chưa có partition/nhãn được duyệt. Mọi ảnh holdout vẫn được bảo vệ.</p><main>' + ''.join(cards) + '</main>', encoding='utf-8')
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
