"""Freeze the owner-approved split policy as a review manifest without moving images.

The result is a candidate manifest only: source files stay in incoming/, official
partition/labels remain pending, and no provider is called.
"""
import argparse
import csv
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--proposal', type=Path, default=Path('reports/drive-split-proposal-v5/proposal.csv'))
    parser.add_argument('--output', type=Path, default=Path('reports/drive-split-candidate-v1.json'))
    args = parser.parse_args()
    repo = Path(__file__).resolve().parents[1]
    if (repo / 'reports').resolve() not in args.output.resolve().parents:
        raise ValueError('Output must be inside ignored reports/, not active dataset folders')
    if args.output.exists():
        raise ValueError('Candidate manifest exists; use a new output to preserve prior review')
    with args.proposal.open(encoding='utf-8-sig', newline='') as stream:
        rows = list(csv.DictReader(stream))
    if len(rows) != 1632 or len({row['source_file'] for row in rows}) != len(rows):
        raise ValueError('Expected 1,632 unique proposal rows')
    counts = {
        'reference_candidate': sum(row['proposed_action'] == 'reference_candidate' for row in rows),
        'reference_deferred': sum(row['proposed_action'] == 'reference_deferred_after_screen' for row in rows),
        'calibration_candidate': sum(row['proposed_action'] == 'calibration_candidate' for row in rows),
        'final_candidate': sum(row['proposed_action'] == 'final_candidate_cross_device' for row in rows),
        'manual_review': sum(row['proposed_action'] == 'manual_review_negative_or_target' for row in rows),
    }
    expected = {'reference_candidate': 35, 'reference_deferred': 45, 'calibration_candidate': 564, 'final_candidate': 183, 'manual_review': 805}
    if counts != expected:
        raise ValueError(f'Proposal counts changed: {counts}')
    entries = []
    for row in rows:
        action = row['proposed_action']
        if row['partition'] or row['approved_artifact_id'] or row['reviewed'] != 'false':
            raise ValueError('Input contains official labels/partitions; do not overwrite reviewed decisions')
        if row['camera_model'] == '22041216G' and action in ('reference_candidate', 'calibration_candidate'):
            raise ValueError('Holdout device cannot enter reference or calibration candidates')
        entries.append({
            'source_file': row['source_file'], 'source_sha256': row['source_sha256'], 'review_id': row['review_id'],
            'source_folder': row['source_folder'], 'camera_model': row['camera_model'], 'captured_at': row['captured_at'],
            'holdout_device_reserved': row['camera_model'] == '22041216G',
            'reference_selection_owner_approved': action == 'reference_candidate',
            'approved_artifact_id': None, 'partition': None,
            'proposed_artifact_id': row['proposed_artifact_id'] if row['source_folder'] in {
                'Bác Hồ ở chiến khu Việt Bắc', 'Bình phong', 'Cánh cửa chạm rồng', 'Em Thúy', 'Gióng',
                'Hai thiếu nữ và em bé', 'Hoàng hậu Ngọc Trúc', 'Kết nạp Đảng ở Điện Biên Phủ', 'Phật Bà Quan Âm'} else None,
            'partition_proposal': {'reference_candidate': 'references', 'reference_deferred_after_screen': 'quarantine_reference',
                                  'calibration_candidate': 'calibration', 'final_candidate_cross_device': 'final',
                                  'manual_review_negative_or_target': 'manual_review'}[action],
            'action': action, 'scenario': None, 'capture_group': None, 'duplicate_group': None,
            'status': 'owner_policy_approved_candidate_pending_visual_label_and_group_review',
        })
    manifest = {
        'version': 'split-candidate-v1', 'created_at': datetime.now(timezone.utc).isoformat(),
        'source': 'Google Drive folder 1jYzY5U3Yc6R_3CdUz7h0T8rYOBFGb7VH',
        'owner_policy': {'holdout_policy': 'A', 'holdout_device': '22041216G', 'max_new_references': 80,
                         'partial_or_multiple_rule': 'known_clutter only when one target remains clear; otherwise ambiguous/unknown/low_quality per review',
                         'same_session_calibration_accepted': True,
                         'selected_reference_list_35_approved': True,
                         'continue_final_visual_screening_approved': True,
                         'conversion_copy_and_paid_calls_approved': False},
        'counts': counts, 'official_partitions_applied': False, 'provider_calls': 0,
        'source_hash_algorithm': 'sha256', 'entries': entries,
        'warnings': [
            'This manifest records a policy-approved candidate split, not official evaluation labels.',
            'Scenario, capture_group and duplicate_group remain unset pending visual/group review.',
            'Calibration is same-day/same-session iPhone development data and must not be reported as independent generalization.',
            'Final is cross-device but same-day/same museum-session; it is not a different-day test.',
            'Khác/Khác 2 remain manual review and are not automatically unknown.',
            'No HEIC was converted and no image was copied into data/references or data/test.',
        ],
    }
    manifest['proposal_sha256'] = hashlib.sha256(args.proposal.read_bytes()).hexdigest()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'output': str(args.output), 'counts': counts, 'official_partitions_applied': False, 'provider_calls': 0}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
