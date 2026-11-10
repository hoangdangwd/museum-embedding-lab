"""Explicitly authorized reference-first review over ALL incoming sources.

Old split/hold metadata is provenance, never an eligibility filter in this mode.
This does not move files, apply partitions, approve paid calls, or mutate a catalog.
Reviewing former final/holdout sources retires their blind-evaluation status.
"""
import argparse
import hashlib
import json
from pathlib import Path
from collections import Counter


def inventory_all_sources(entries, *, all_source_review_approved=False):
    if not all_source_review_approved:
        raise ValueError('Explicit all-source review authorization required')
    if len({e['review_id'] for e in entries}) != len(entries):
        raise ValueError('Duplicate review ID')
    result = []
    for e in entries:
        if e.get('kind') not in ('incoming', 'baseline'):
            raise ValueError('Unknown source kind')
        result.append({**e, 'visual_review_allowed': True,
                       'reference_proposal_allowed_after_visual_review': e['kind'] == 'incoming',
                       'old_split_is_not_reference_selection_filter': True,
                       'independent_evaluation_after_this_review': False,
                       'new_partition_applied': False, 'production_approved': False})
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--all-source-review-approved', action='store_true')
    parser.add_argument('--output', default='reports/reference-selection-v3-all-source')
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    out = (root / args.output).resolve()
    if out.parent != root / 'reports':
        raise ValueError('Output must be a direct child of ignored reports/')
    queue_file = root / 'reports/camera-crop-dataset-v1/queue.json'
    queue_bytes = queue_file.read_bytes()
    entries = inventory_all_sources(json.loads(queue_bytes)['entries'],
                                    all_source_review_approved=args.all_source_review_approved)
    incoming = {e['review_id'] for e in entries if e['kind'] == 'incoming'}
    existing_sheets = json.loads((root / 'reports/drive-review-v1/sheets.json').read_text(encoding='utf8'))
    sheets = [s for s in existing_sheets if any(rid in incoming for rid in s['review_ids'])]
    ids = [rid for s in sheets for rid in s['review_ids']]
    if len(ids) != len(set(ids)) or set(ids) != incoming:
        raise ValueError('Contact-sheet coverage does not exactly match incoming sources')
    payload = {
        'version': 'reference-first-all-source-v3',
        'authorization': 'Owner explicitly requested selection from ALL 1632 source images, regardless of prior split/hold.',
        'status': 'OFFLINE REFERENCE-FIRST REVIEW; NO DATA/CATALOG MUTATION',
        'queue_sha256': hashlib.sha256(queue_bytes).hexdigest(),
        'incoming_sources': len(incoming), 'baseline_comparisons': len(entries) - len(incoming),
        'sources_excluded_by_old_split': 0,
        'prior_partition_counts': dict(Counter(e.get('current_partition') or 'unassigned' for e in entries if e['kind'] == 'incoming')),
        'independent_evaluation_after_this_review': False,
        'warning': 'All inspected sources are development/reference-selection material. Old final/holdout is no longer blind; rebuild evaluation only AFTER reference freeze. No partition moves or paid calls approved by this review mode.',
        'provider_calls': 0, 'production_mutations': 0, 'source_partition_mutations': 0,
        'entries': entries, 'sheets': sheets,
    }
    out.mkdir(exist_ok=True)
    (out / 'inventory.json').write_text(json.dumps(payload, ensure_ascii=False, indent=2) + '\n', encoding='utf8')
    print(json.dumps({k: v for k, v in payload.items() if k not in ('entries', 'sheets')}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
