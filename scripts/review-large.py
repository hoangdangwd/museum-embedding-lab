"""Owner-approved review previews and candidate-only burst holds; never official data.

Writes only a NEW ignored reports directory. Frozen proposals/staging stay unchanged.
No network, model calls, active references/test writes, crop or upscaling.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import hashlib
import html
import importlib.util
import json
from pathlib import Path
import re


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def select_queue(screen):
    entries = screen['entries']
    if len({e['review_id'] for e in entries}) != len(entries):
        raise ValueError('Duplicate review ID')
    queue = [e for e in entries if e['needs_larger_review']]
    for e in queue:
        if not re.fullmatch(r'R\d{4}', e['review_id']) or e['source_folder'] not in ('Khác', 'Khác 2'):
            raise ValueError('Queue outside approved manual-folder scope')
        if any(e.get(key) is not None for key in ('partition', 'approved_scenario', 'approved_artifact_id')) or e.get('owner_label_approved'):
            raise ValueError('Do not apply labels/partitions during preview export')
    return queue


def candidate_holds(candidate, proposal):
    ids = proposal['calibration_quarantine_candidate_ids']
    if len(ids) != len(set(ids)) or len(ids) != 28:
        raise ValueError('Expected exactly the 28 approved candidate holds')
    byid = {e['review_id']: e for e in candidate['entries']}
    if len(byid) != len(candidate['entries']):
        raise ValueError('Duplicate candidate ID')
    for rid in ids:
        entry = byid[rid]
        if entry['action'] != 'calibration_candidate' or entry['camera_model'] != 'iPhone XR' or entry['holdout_device_reserved']:
            raise ValueError('Hold cannot affect reference/final/holdout device')
    eligible = sorted(e['review_id'] for e in candidate['entries'] if e['action'] == 'calibration_candidate' and e['review_id'] not in ids)
    if len(eligible) != 536:
        raise ValueError('Expected 536 remaining calibration candidates')
    return {'version': 'approved-candidate-holds-v1', 'owner_holds_approved': True,
            'approval_basis': 'User: đồng ý cả hai (139 large review previews and temporary holds for 28 calibration candidates).',
            'applies_at': 'candidate_eligibility_overlay_only; no physical file moved or deleted',
            'held_calibration_ids': sorted(ids), 'eligible_calibration_ids': eligible,
            'held_calibration_count': 28, 'eligible_calibration_count': 536,
            'reference_candidates_unchanged': 35, 'final_candidates_unchanged': 183,
            'official_partitions_applied': False, 'provider_calls': 0,
            'warning': 'Load this overlay with the frozen candidate manifest. Existing 782 staging images remain historical derivatives, not 782 currently eligible candidates. No independent capture groups established.'}


def adjacent_second_hints(candidate, holds):
    """Timing hints only: no capture-group boundary inferred or extra hold applied."""
    references = [e for e in candidate['entries'] if e['action'] == 'reference_candidate']
    calibration = [e for e in candidate['entries'] if e['review_id'] in holds['eligible_calibration_ids']]
    pairs = []
    for reference in references:
        for entry in calibration:
            if (reference['source_folder'], reference['camera_model']) != (entry['source_folder'], entry['camera_model']):
                continue
            delta = abs((datetime.strptime(reference['captured_at'], '%Y:%m:%d %H:%M:%S') - datetime.strptime(entry['captured_at'], '%Y:%m:%d %H:%M:%S')).total_seconds())
            if delta == 1:
                pairs.append({'reference_id': reference['review_id'], 'calibration_id': entry['review_id'],
                              'reference_time': reference['captured_at'], 'calibration_time': entry['captured_at'],
                              'seconds_apart': delta, 'proposed_artifact_id': reference['proposed_artifact_id'],
                              'status': 'adjacent_second_review_hint_not_confirmed_duplicate', 'owner_hold_approved': False})
    return {'method': 'Exactly adjacent EXIF seconds, same camera/source artifact folder. Candidate hints only; not an approved grouping threshold. Existing 28 approved holds excluded.',
            'pairs': pairs, 'unique_calibration_candidates': len({e['calibration_id'] for e in pairs}),
            'provider_calls': 0, 'official_partitions_applied': False}


def export_preview(task):
    from PIL import Image
    originals, output, entry, source_helper = task
    row = dict(entry)
    try:
        source = source_helper.safe_source(originals, entry['source_file'])
        if sha(source) != entry['source_sha256']:
            raise ValueError('Original SHA256 mismatch')
        with Image.open(source) as image:
            image.load()
            row['source_dimensions'] = list(image.size)
            converted, policy = source_helper.srgb_image(image)
            converted.thumbnail((1600, 1600), Image.Resampling.LANCZOS)
            clean = Image.new('RGB', converted.size, 'white')
            clean.paste(converted)
            file = f'previews/{entry["review_id"]}.jpg'
            clean.save(output / file, 'JPEG', quality=95, exif=b'')
        row.update(large_preview_file=file, large_preview_sha256=sha(output / file),
                   large_preview_dimensions=list(clean.size), color_policy=policy,
                   preview_status='ok', derivative_purpose='review_only_not_app_normalized_evaluation',
                   partition=None, approved_scenario=None, approved_artifact_id=None)
    except Exception as error:
        row.update(preview_status='error', error=str(error))
    return row


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--allow-large-review', action='store_true')
    parser.add_argument('--approve-28-holds', action='store_true')
    parser.add_argument('--output', type=Path, default=Path('reports/drive-large-manual-review-v1'))
    args = parser.parse_args()
    if not args.allow_large_review or not args.approve_28_holds:
        raise ValueError('Explicit owner approval flags required for both actions')
    repo = Path(__file__).resolve().parents[1]
    output = args.output.resolve()
    if (repo / 'reports').resolve() not in output.parents or output.exists():
        raise ValueError('Choose a NEW directory within ignored reports/')
    candidate_file = repo / 'reports/drive-split-candidate-v2.json'
    screen_file = repo / 'reports/drive-followup-review-v1/manual-screen.json'
    burst_file = repo / 'reports/drive-followup-review-v1/burst-proposal.json'
    candidate = json.loads(candidate_file.read_text(encoding='utf-8'))
    queue = select_queue(json.loads(screen_file.read_text(encoding='utf-8')))
    if len(queue) != 139:
        raise ValueError('Approved large-preview queue changed')
    holds = candidate_holds(candidate, json.loads(burst_file.read_text(encoding='utf-8')))
    byid = {e['review_id']: e for e in candidate['entries']}
    for entry in queue:
        original = byid[entry['review_id']]
        if any(entry[key] != original[key] for key in ('source_file', 'source_sha256', 'camera_model', 'holdout_device_reserved')):
            raise ValueError('Screen/candidate source disagreement')
    import pillow_heif
    from PIL import __version__ as pillow_version
    pillow_heif.register_heif_opener()
    spec = importlib.util.spec_from_file_location('stage_decode', repo / 'scripts/stage-decode.py')
    helper = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(helper)
    originals = repo / 'data/incoming/drive-1jYzY5U3Yc6R_3CdUz7h0T8rYOBFGb7VH/originals'
    output.mkdir(parents=True)
    (output / 'previews').mkdir()
    provenance = {'created_at': datetime.now(timezone.utc).isoformat(), 'candidate_manifest_sha256': sha(candidate_file),
                  'screen_manifest_sha256': sha(screen_file), 'burst_proposal_sha256': sha(burst_file),
                  'preview_script_sha256': sha(Path(__file__)), 'color_helper_sha256': sha(repo / 'scripts/stage-decode.py'),
                  'pillow_version': pillow_version, 'pillow_heif_version': pillow_heif.__version__,
                  'owner_large_previews_approved': True, 'provider_calls': 0, 'official_partitions_applied': False}
    (output / 'candidate-holds-approved.json').write_text(json.dumps({**provenance, **holds}, indent=2) + '\n', encoding='utf-8')
    (output / 'adjacent-second-hints.json').write_text(json.dumps(adjacent_second_hints(candidate, holds), indent=2) + '\n', encoding='utf-8')
    rows = []
    with ThreadPoolExecutor(max_workers=2) as pool, (output / 'preview-log.jsonl').open('x', encoding='utf-8') as journal:
        for row in pool.map(export_preview, ((originals, output, e, helper) for e in queue)):
            rows.append(row)
            journal.write(json.dumps(row, ensure_ascii=False) + '\n'); journal.flush()
            if len(rows) % 20 == 0 or row['preview_status'] != 'ok':
                print(json.dumps({'processed': len(rows), 'errors': sum(e['preview_status'] != 'ok' for e in rows)}), flush=True)
    summary = {'selected': len(queue), 'successful_previews': sum(e['preview_status'] == 'ok' for e in rows),
               'errors': sum(e['preview_status'] != 'ok' for e in rows), 'new_labels_approved': 0,
               'held_calibration_candidates': 28, 'remaining_calibration_candidates': 536,
               'official_partitions_applied': False, 'provider_calls': 0}
    (output / 'manifest.json').write_text(json.dumps({**provenance, 'summary': summary, 'entries': rows}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    cards = [f'<article><h2>{e["review_id"]}</h2><p>{html.escape(e["source_file"])}</p><a href="{e["large_preview_file"]}"><img loading="lazy" src="{e["large_preview_file"]}"></a><p>{html.escape(e["reason_vi"])}</p></article>' for e in rows if e['preview_status'] == 'ok']
    (output / 'index.html').write_text('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>139 ảnh — duyệt lớn</title><style>body{font:16px system-ui;background:#eee;margin:20px}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(450px,1fr));gap:20px}article{background:white;padding:15px}img{width:100%;height:750px;object-fit:contain}</style><h1>139 ảnh review — không phải reference/test</h1><p>Chưa duyệt nhãn mới. Bấm ảnh để xem JPEG <=1600px. Không upload.</p><main>' + ''.join(cards) + '</main>', encoding='utf-8')
    print(json.dumps(summary), flush=True)
    if summary['errors']:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
