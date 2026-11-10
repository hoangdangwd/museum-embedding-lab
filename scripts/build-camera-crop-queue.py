"""Read-only full inventory for crop review. No label/split/catalog changes or providers."""
import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import shutil

VERSION = 'camera-crop-review-v1'

def build_queue(images, official, negative_rows=(), labels=()):
    by_id = {x['review_id']: x for x in official}
    negatives = {x['review_id']: x for x in negative_rows}
    reviewed = {x['review_id']: x for x in labels}
    entries = []
    seen = set()
    for image in images:
        rid = image['review_id']
        if rid in seen:
            raise ValueError('Duplicate review ID')
        seen.add(rid)
        o = by_id.get(rid, {})
        n = negatives.get(rid, {})
        baseline = image['kind'] == 'baseline'
        partition = 'references' if baseline else 'calibration' if n else o.get('partition')
        holdout = bool(o.get('holdout_device_reserved') or image.get('camera_model') == '22041216G')
        expected = image.get('proposed_artifact_id') if baseline else o.get('approved_artifact_id')
        scenario = n.get('scenario') or o.get('scenario')
        label = reviewed.get(rid, {})
        if not baseline and not partition:
            expected = label.get('review_approved_artifact_id')
        # Folder hints are explicitly NOT labels, and cropped scenes need fresh review.
        entries.append({
            'review_id': rid, 'kind': image['kind'], 'source_file': image['source_file'],
            'source_sha256': image['source_sha256'], 'preview': '../drive-review-v1/' + image['preview'],
            'folder_hint': image.get('proposed_artifact_id'), 'camera_model': image.get('camera_model'),
            'captured_at': image.get('captured_at'), 'capture_bucket_hint': image.get('capture_bucket_hint'),
            'current_partition': partition, 'current_artifact_id': expected,
            'current_scenario': scenario, 'review_only_scenario': label.get('review_approved_scenario'),
            'holdout_device_reserved': holdout, 'candidate_hold': bool(o.get('candidate_hold')),
            'reference_selection_allowed_without_resplit': not holdout and partition not in ('calibration', 'final'),
            'annotation': {'crop': None, 'coordinate_space': 'exif-oriented-normalized',
                           'proposed_role': None, 'post_crop_scenario': None, 'post_crop_artifact_id': None,
                           'view_or_side': '', 'capture_group': '', 'duplicate_group': '',
                           'quality': '', 'reason': '', 'owner_approved': False},
        })
    return entries

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', default='reports/camera-crop-dataset-v1')
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    out = (root / args.output).resolve()
    if root / 'reports' not in out.parents:
        raise ValueError('Output must be inside ignored reports/')
    load = lambda p: json.loads((root / p).read_text(encoding='utf-8'))
    paths = ['reports/drive-review-v1/images.json', 'reports/drive-official-split-v1/manifest.json',
             'data/staging/drive-full-negative-calibration-v1/staging-manifest.json',
             'reports/drive-review-approval-v3/labels-review-approved-v2.json']
    images, official, negative, labels = [load(p) for p in paths]
    entries = build_queue(images, official['entries'], negative['entries'], labels['entries'])
    assert sum(x['kind'] == 'incoming' for x in entries) == 1632
    assert sum(x['kind'] == 'baseline' for x in entries) == 10
    payload = {'version': VERSION, 'created_at': datetime.now(timezone.utc).isoformat(),
               'status': 'CROP AND POST-CROP LABEL REVIEW PENDING; NOT AN EVALUATION OR SEED MANIFEST',
               'camera_crop_version': 'camera-guide-v1',
               'source_hashes': {p: hashlib.sha256((root/p).read_bytes()).hexdigest() for p in paths},
               'entries': entries}
    raw = json.dumps(payload, ensure_ascii=False, indent=2) + '\n'
    out.mkdir(parents=True, exist_ok=True)
    target = out / 'queue.json'
    if target.exists() and target.read_text(encoding='utf-8') != raw:
        # Do not overwrite a queue whose hash may already be referenced by annotations.
        old = json.loads(target.read_text(encoding='utf-8'))
        if old['entries'] != entries or old['source_hashes'] != payload['source_hashes']:
            raise ValueError('Queue already exists with different sources; use a new reports output directory')
        raw = target.read_text(encoding='utf-8')
    else:
        target.write_text(raw, encoding='utf-8')
    queue_hash = hashlib.sha256(raw.encode('utf-8')).hexdigest()
    summary = {'version': VERSION, 'total': len(entries),
               'current_partitions': dict(Counter(x['current_partition'] or 'unassigned' for x in entries)),
               'holdout_reserved': sum(x['holdout_device_reserved'] for x in entries),
               'reference_pool_before_quality_and_group_review': sum(x['reference_selection_allowed_without_resplit'] for x in entries),
               'crop_review_pending': len(entries), 'approved_crops': 0,
               'upper_bound_new_provider_calls_if_every_image_needs_description_and_embedding': 2*len(entries),
               'queue_sha256': queue_hash, 'provider_calls': 0, 'production_mutations': 0,
               'warning': '3284 calls is an upper bound, NOT a budget approval or dollar estimate. Existing whole-image vectors cannot represent newly cropped bytes. Full dataset tuning is exploratory; never claim independent holdout after using its images for selection/tuning.'}
    (out/'summary.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2)+'\n',encoding='utf-8')
    # Relative image links assume output is a direct child of reports/.
    if out.parent != root/'reports':
        raise ValueError('Viewer output must be a direct child of reports/')
    embedded = json.dumps({'queue_sha256': queue_hash, 'entries': entries}, ensure_ascii=False).replace('<','\\u003c')
    html = (root/'scripts/camera-crop-review.html').read_text(encoding='utf-8').replace('/*QUEUE_DATA*/',embedded)
    (out/'index.html').write_text(html,encoding='utf-8')
    shutil.copyfile(root/'scripts/camera-crop-review-ui.js',out/'review-ui.js')
    print(json.dumps(summary,ensure_ascii=True,indent=2))

if __name__ == '__main__':
    main()
