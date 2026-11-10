"""Create a deterministic, review-only split proposal after owner-approved policy.

This does not move files, alter review.csv, create test/reference images, call a model,
or approve labels. It produces candidate labels and a proposed reference list only.
"""
import argparse
import csv
import json
import html
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

TARGETS = {
    'Bác Hồ ở chiến khu Việt Bắc': 8,
    'Bình phong': 12,
    'Cánh cửa chạm rồng': 8,
    'Em Thúy': 8,
    'Gióng': 8,
    'Hai thiếu nữ và em bé': 8,
    'Hoàng hậu Ngọc Trúc': 10,
    'Kết nạp Đảng ở Điện Biên Phủ': 8,
    'Phật Bà Quan Âm': 10,
}
ARTIFACTS = {
    'Bác Hồ ở chiến khu Việt Bắc': 'stamp-bac-ho-viet-bac',
    'Bình phong': 'stamp-binh-phong',
    'Cánh cửa chạm rồng': 'stamp-canh-cua-cham-rong',
    'Em Thúy': 'stamp-em-thuy',
    'Gióng': 'stamp-giong',
    'Hai thiếu nữ và em bé': 'stamp-hai-thieu-nu-em-be',
    'Hoàng hậu Ngọc Trúc': 'stamp-hoang-hau-ngoc-truc',
    'Kết nạp Đảng ở Điện Biên Phủ': 'stamp-ket-nap-dang-dien-bien',
    'Phật Bà Quan Âm': 'stamp-phat-ba-quan-am',
}


def apply_screening(rows, screening):
    """Only narrow draft reference choices; never approve labels or move to test."""
    indexed = {row['review_id']: row for row in rows}
    seen = set()
    for entry in screening['entries']:
        review_id = entry['review_id']
        if review_id in seen or review_id not in indexed:
            raise ValueError(f'Unknown/duplicate screening ID: {review_id}')
        seen.add(review_id)
        row = indexed[review_id]
        if row['source_file'] != entry['source_file'] or row['proposed_action'] != 'reference_candidate':
            raise ValueError(f'Screening source/action mismatch: {review_id}')
        if entry['recommendation'] not in ('retain_for_owner_review', 'defer_reference'):
            raise ValueError(f'Unknown screening recommendation: {review_id}')
        row['screening_recommendation'] = entry['recommendation']
        row['screening_reason'] = entry['reason']
        row['proposal_reason'] += ' Preview screen: ' + entry['reason']
        if entry['recommendation'] == 'defer_reference':
            row['proposed_action'] = 'reference_deferred_after_screen'
            row['proposed_partition'] = ''
            row['proposal_status'] = 'needs_replacement_or_query_review'
        else:
            row['proposal_status'] = 'preview_screened_owner_approval_pending'
    return rows


def distance(left, right):
    return (int(left, 16) ^ int(right, 16)).bit_count()


def choose_diverse(rows, count):
    """Greedy dHash max-min sample. It is a diversity hint, not visual approval."""
    if count <= 0:
        return []
    rows = sorted(rows, key=lambda row: (row['captured_at'], row['source_file']))
    if len(rows) <= count:
        return rows
    chosen = [rows[0]]
    remaining = rows[1:]
    while len(chosen) < count:
        best = max(remaining, key=lambda row: (min(distance(row['dhash'], other['dhash']) for other in chosen), row['source_file']),)
        chosen.append(best)
        remaining.remove(best)
    return sorted(chosen, key=lambda row: (row['captured_at'], row['source_file']))


def write_candidate_gallery(rows, images_file, output, prefix, title, note):
    from PIL import Image, ImageDraw
    groups = defaultdict(list)
    for row in rows:
        groups[row['source_folder']].append(row)
    sheets = []
    sections = []
    number = 0
    for folder, entries in sorted(groups.items()):
        for start in range(0, len(entries), 24):
            number += 1
            subset = entries[start:start + 24]
            canvas = Image.new('RGB', (4 * 320, 6 * 280), 'white')
            draw = ImageDraw.Draw(canvas)
            for index, entry in enumerate(subset):
                x, y = index % 4 * 320, index // 4 * 280
                with Image.open(images_file.parent / entry['preview']) as preview:
                    preview.thumbnail((310, 235))
                    canvas.paste(preview, (x + (320 - preview.width) // 2, y))
                draw.text((x + 5, y + 240), entry['review_id'] + ' ' + Path(entry['source_file']).name, fill='black')
                draw.text((x + 5, y + 256), 'CROSS-DEVICE CANDIDATE', fill='black')
            filename = f'{prefix}-{number:02d}.jpg'
            canvas.save(output / filename, quality=88)
            sheets.append({'folder': folder, 'file': filename, 'review_ids': [entry['review_id'] for entry in subset]})
            sections.append(f'<h2>{html.escape(folder)} — {start + 1}-{start + len(subset)}</h2><img src="{filename}" style="max-width:100%">')
    (output / f'{prefix}-sheets.json').write_text(json.dumps(sheets, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    page = f'<!doctype html><html lang="vi"><meta charset="utf-8"><title>{html.escape(title)}</title><body style="font:16px system-ui;margin:24px"><h1>{html.escape(title)}</h1><p>{html.escape(note)}</p>' + ''.join(sections) + '</body></html>'
    (output / f'{prefix}.html').write_text(page, encoding='utf-8')


def write_reference_gallery(rows, images_file, output):
    from PIL import Image, ImageDraw
    grouped = defaultdict(list)
    for row in rows:
        grouped[row['source_folder']].append(row)
    sections = []
    gallery_entries = []
    for index, (folder, entries) in enumerate(sorted(grouped.items()), 1):
        canvas = Image.new('RGB', (4 * 320, 3 * 280), 'white')
        draw = ImageDraw.Draw(canvas)
        for number, entry in enumerate(entries):
            x, y = number % 4 * 320, number // 4 * 280
            with Image.open(images_file.parent / entry['preview']) as preview:
                preview.thumbnail((310, 235))
                canvas.paste(preview, (x + (320 - preview.width) // 2, y))
            draw.text((x + 5, y + 240), entry['review_id'] + ' ' + Path(entry['source_file']).name, fill='black')
            draw.text((x + 5, y + 256), 'CANDIDATE - NOT APPROVED', fill='black')
        filename = f'references-{index:02d}.jpg'
        canvas.save(output / filename, quality=88)
        gallery_entries.append({'folder': folder, 'file': filename, 'review_ids': [entry['review_id'] for entry in entries]})
        sections.append(f'<h2>{html.escape(folder)}</h2><img src="{filename}" style="max-width:100%">')
    (output / 'reference-sheets.json').write_text(json.dumps(gallery_entries, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    page = '<!doctype html><html lang="vi"><meta charset="utf-8"><title>Reference candidates</title><body style="font:16px system-ui;margin:24px"><h1>Ứng viên reference — chưa duyệt</h1><p>Gợi ý bằng dHash không đánh giá chất lượng hoặc độ đúng nhãn. Cần loại ảnh mờ, thiếu vật, nhiều vật và cân bằng hai mặt Bình phong.</p>' + ''.join(sections) + '</body></html>'
    (output / 'reference-candidates.html').write_text(page, encoding='utf-8')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--review', type=Path, default=Path('reports/drive-review-v1/review.csv'))
    parser.add_argument('--images', type=Path, default=Path('reports/drive-review-v1/images.json'))
    parser.add_argument('--output', type=Path, default=Path('reports/drive-split-proposal-v1'))
    parser.add_argument('--screening', type=Path, help='Optional visual screening notes for draft reference candidates; never owner approval.')
    args = parser.parse_args()
    repo = Path(__file__).resolve().parents[1]
    if (repo / 'reports').resolve() not in args.output.resolve().parents:
        raise ValueError('Output must be inside ignored reports/, never active reference/test folders.')
    if args.output.exists():
        raise ValueError('Proposal output exists; choose a new --output to avoid overwriting review decisions.')
    args.output.mkdir(parents=True)
    with args.review.open(encoding='utf-8-sig', newline='') as stream:
        review = {row['source_file']: row for row in csv.DictReader(stream)}
    images = {item['source_file']: item for item in json.loads(args.images.read_text(encoding='utf-8')) if item['kind'] == 'incoming'}
    rows = []
    for source, row in sorted(review.items()):
        enriched = {**row, **images[source]}
        enriched['source_folder'] = source.split('/')[0]
        enriched['holdout_device_reserved'] = enriched.get('camera_model') == '22041216G'
        enriched['proposal_status'] = 'manual_review'
        enriched['proposed_partition'] = ''
        enriched['proposed_action'] = 'hold'
        enriched['proposal_reason'] = ''
        if enriched['source_folder'] in ARTIFACTS:
            enriched['proposed_artifact_id'] = ARTIFACTS[enriched['source_folder']]
            if enriched['camera_model'] == '22041216G' and enriched['source_file'].lower().endswith('.jpg'):
                enriched['proposed_partition'] = 'final'
                enriched['proposed_action'] = 'final_candidate_cross_device'
                enriched['proposal_reason'] = 'Owner-approved A policy; JPG from 22041216G, visual label still pending.'
            elif enriched['camera_model'] == 'iPhone XR':
                enriched['proposed_partition'] = 'calibration_candidate'
                enriched['proposed_action'] = 'calibration_candidate'
                enriched['proposal_reason'] = 'Owner-approved A policy; iPhone source, visual label and capture-group review still pending.'
            else:
                enriched['proposal_reason'] = 'Known folder but unexpected device/extension; manual review.'
        else:
            enriched['proposed_action'] = 'manual_review_negative_or_target'
            enriched['proposal_reason'] = 'Khác/Khác 2 may contain a partial target; do not auto-label unknown.'
            if enriched['holdout_device_reserved']:
                enriched['proposal_reason'] += ' Device reserved for final under A: no reference/calibration use, even before label approval.'
        rows.append(enriched)
    selected_by_folder = {}
    for folder, count in TARGETS.items():
        candidates = [row for row in rows if row['source_folder'] == folder and row['camera_model'] == 'iPhone XR' and row['decode_status'] == 'ok']
        selected = choose_diverse(candidates, count)
        selected_by_folder[folder] = {row['source_file'] for row in selected}
        for row in selected:
            row['proposed_action'] = 'reference_candidate'
            row['proposed_partition'] = 'references_candidate'
            row['proposal_status'] = 'needs_visual_approval'
            row['proposal_reason'] = 'Max-min dHash diversity sample from iPhone XR; not approved, inspect contact sheet and near-duplicate hints.'
    selected_sources = {source for sources in selected_by_folder.values() for source in sources}
    for row in rows:
        if row['source_file'] in selected_sources:
            continue
        if row['proposed_action'] == 'calibration_candidate':
            row['proposal_status'] = 'needs_group_review'
            row['proposal_reason'] += ' Must not share a burst/capture group with reference candidates.'
        elif row['proposed_action'] == 'final_candidate_cross_device':
            row['proposal_status'] = 'needs_visual_approval'
    if args.screening:
        apply_screening(rows, json.loads(args.screening.read_text(encoding='utf-8')))
    fields = ['review_id', 'source_file', 'source_sha256', 'source_folder', 'camera_model', 'captured_at', 'dhash', 'near_duplicate_candidate_count',
              'proposed_artifact_id', 'proposal_status', 'proposed_action', 'proposed_partition', 'holdout_device_reserved', 'proposal_reason', 'approved_artifact_id', 'capture_group',
              'duplicate_group', 'view_or_side', 'quality', 'scenario', 'partition', 'reviewed', 'screening_recommendation', 'screening_reason']
    with (args.output / 'proposal.csv').open('w', encoding='utf-8-sig', newline='') as stream:
        writer = csv.DictWriter(stream, fieldnames=fields, extrasaction='ignore')
        writer.writeheader(); writer.writerows(rows)
    refs = [row for row in rows if row['proposed_action'] == 'reference_candidate']
    final = [row for row in rows if row['proposed_action'] == 'final_candidate_cross_device']
    calibration = [row for row in rows if row['proposed_action'] == 'calibration_candidate']
    manual = [row for row in rows if row['proposed_action'] == 'manual_review_negative_or_target']
    deferred = [row for row in rows if row['proposed_action'] == 'reference_deferred_after_screen']
    proposal = {'version': 'split-proposal-v1', 'created_at': datetime.now(timezone.utc).isoformat(), 'policy': 'A',
                'reference_candidates': len(refs), 'reference_target_max': sum(TARGETS.values()), 'final_cross_device_candidates': len(final),
                'holdout_device_reserved_total': sum(row['holdout_device_reserved'] for row in rows),
                'holdout_device_manual_label_pending': sum(row['holdout_device_reserved'] for row in manual),
                'calibration_candidates_before_group_review': len(calibration), 'manual_review_candidates': len(manual),
                'reference_candidates_deferred_after_preview': len(deferred),
                'screening_notes': str(args.screening) if args.screening else None,
                'group_leakage_risk': 'Reference/calibration candidates share same-day source buckets; not approved independent splits.',
                'reference_by_artifact': dict(Counter(row['proposed_artifact_id'] for row in refs)),
                'final_by_artifact': dict(Counter(row['proposed_artifact_id'] for row in final)),
                'unknown_not_approved': True, 'partitions_applied': False,
                'warning': 'This is a proposal. Labels, capture groups, duplicate groups, quality, scenario, final and references still require owner review. Khác/Khác 2 are not automatically negative.'}
    (args.output / 'summary.json').write_text(json.dumps(proposal, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    (args.output / 'reference-candidates.json').write_text(json.dumps(refs, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    (args.output / 'final-candidates.json').write_text(json.dumps(final, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    (args.output / 'reference-deferred.json').write_text(json.dumps(deferred, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    (args.output / 'manual-review.json').write_text(json.dumps(manual, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    write_reference_gallery(refs, args.images, args.output)
    write_candidate_gallery(final, args.images, args.output, 'final', 'Final cross-device candidates', f'{len(final)} ảnh JPG ứng viên từ 22041216G; nhãn, vật nhìn thấy, chất lượng và nhóm chụp vẫn cần duyệt; chưa phải final partition.')
    print(json.dumps(proposal, ensure_ascii=True, indent=2))


if __name__ == '__main__':
    main()
