"""Create an offline review workspace, not training labels or a dataset split.

Full-decodes originals, verifies inventory hashes, writes metadata-free previews,
contact sheets and candidate-only dHash pairs including existing references.
Never edits originals, active reference/test folders, or remote services.
"""
import argparse
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
import csv
from datetime import datetime, timezone
import hashlib
import html
import json
from pathlib import Path

VERSION = 'offline-review-v1'


def difference_hash(image):
    from PIL import Image
    pixels = list(image.convert('L').resize((9, 8), Image.Resampling.LANCZOS).getdata())
    value = 0
    for y in range(8):
        for x in range(8):
            value = (value << 1) | (pixels[y * 9 + x] > pixels[y * 9 + x + 1])
    return f'{value:016x}'


def candidate_pairs(entries, max_distance=4):
    """Similarity hints only: low-information images can collide; crops can be missed."""
    valid = [entry for entry in entries if entry.get('dhash')]
    values = [int(entry['dhash'], 16) for entry in valid]
    pairs = []
    for i, left in enumerate(valid):
        for j in range(i + 1, len(valid)):
            right = valid[j]
            if left['kind'] == right['kind'] == 'baseline':
                continue
            distance = (values[i] ^ values[j]).bit_count()
            if distance <= max_distance:
                pairs.append({'left': left['source_file'], 'right': right['source_file'], 'hamming_distance': distance,
                              'baseline_involved': left['kind'] == 'baseline' or right['kind'] == 'baseline', 'status': 'unreviewed_candidate'})
    return sorted(pairs, key=lambda pair: (pair['hamming_distance'], pair['left'], pair['right']))


def capture_bucket(entry):
    # A conservative source block, not an approved independent capture group.
    # Don't arbitrarily split continuous bursts on an unapproved time-gap threshold.
    components = [entry.get('source_folder', ''), entry.get('camera_model', ''), entry.get('captured_at', '')[:10]]
    return 'source-' + hashlib.sha256(json.dumps(components, ensure_ascii=False).encode()).hexdigest()[:12]


def process_image(task):
    from PIL import Image, ImageOps
    path, entry, output = task
    result = dict(entry)
    try:
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        if entry.get('expected_sha256') and digest != entry['expected_sha256']:
            raise ValueError('Source hash does not match inventory; do not trust this file')
        result['source_sha256'] = digest
        with Image.open(path) as original:
            original.load()  # Decode all primary-image pixels, not just EXIF/header.
            result['source_width'], result['source_height'] = original.size
            oriented = ImageOps.exif_transpose(original)
            rgb = oriented.convert('RGB')
            result['dhash'] = difference_hash(rgb)
            # Derivatives are disposable review previews, NOT pipeline evaluation JPEGs.
            rgb.thumbnail((480, 480), Image.Resampling.LANCZOS)
            preview = Image.new('RGB', rgb.size, 'white')
            preview.paste(rgb)
            filename = f"previews/{entry['kind']}-{digest}.jpg"
            preview.save(output / filename, quality=85, exif=b'')
            result['preview'] = filename
            result['preview_width'], result['preview_height'] = preview.size
        result['decode_status'] = 'ok'
    except Exception as error:
        result['decode_status'] = 'error'
        result['error'] = str(error)
    return result


def write_sheets(entries, output):
    from PIL import Image, ImageDraw
    folders = defaultdict(list)
    for entry in entries:
        if entry['kind'] == 'incoming':
            folders[entry['source_folder']].append(entry)
    sheets = []
    for folder_index, (folder, items) in enumerate(sorted(folders.items()), 1):
        items.sort(key=lambda item: (item.get('camera_model', ''), item.get('captured_at', ''), item['source_file']))
        for start in range(0, len(items), 24):
            sheet = Image.new('RGB', (4 * 320, 6 * 275), 'white')
            draw = ImageDraw.Draw(sheet)
            selected = items[start:start + 24]
            for i, entry in enumerate(selected):
                x, y = (i % 4) * 320, (i // 4) * 275
                if entry.get('preview'):
                    with Image.open(output / entry['preview']) as preview:
                        preview.thumbnail((312, 235))
                        sheet.paste(preview, (x + (320 - preview.width) // 2, y))
                else:
                    draw.text((x + 5, y + 40), 'DECODE ERROR', fill='red')
                label = f"{entry['review_id']} {Path(entry['source_file']).name}"
                draw.text((x + 4, y + 240), label[:49], fill='black')
                draw.text((x + 4, y + 255), entry.get('camera_model', ''), fill='black')
            name = f'sheets/{folder_index:02d}-{start // 24 + 1:02d}.jpg'
            sheet.save(output / name, quality=85)
            sheets.append({'folder': folder, 'file': name, 'review_ids': [entry['review_id'] for entry in selected]})
    return sheets


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('dataset', type=Path)
    parser.add_argument('--inventory', type=Path, default=Path('reports/drive-inventory/files.csv'))
    parser.add_argument('--output', type=Path, default=Path('reports/drive-review-v1'))
    parser.add_argument('--workers', type=int, default=2, choices=range(1, 5))
    args = parser.parse_args()
    repo = Path(__file__).resolve().parents[1]
    output = args.output.resolve()
    if (repo / 'reports').resolve() not in output.parents:
        raise ValueError('Output must be inside ignored reports/; never active data folders')
    # Never overwrite human annotations from an earlier review workspace.
    if (output / 'review.csv').exists():
        raise ValueError('Review workspace already exists. Use a new --output; do not overwrite reviewed decisions.')
    for folder in ['previews', 'sheets']:
        (output / folder).mkdir(parents=True, exist_ok=True)
    from PIL import __version__ as pillow_version
    import pillow_heif
    pillow_heif.register_heif_opener()
    catalog = json.loads((repo / 'data/artifacts.json').read_text(encoding='utf-8'))
    mapping = {artifact['name']: artifact['id'] for artifact in catalog}
    with args.inventory.open(encoding='utf-8-sig', newline='') as stream:
        inventory = list(csv.DictReader(stream))
    tasks = []
    for row in sorted(inventory, key=lambda row: row['file']):
        relative = Path(row['file'])
        if relative.is_absolute() or '..' in relative.parts or ':' in row['file']:
            raise ValueError('Unsafe inventory path')
        entry = {'kind': 'incoming', 'source_file': row['file'], 'source_folder': row['folder'],
                 'expected_sha256': row['sha256'], 'proposed_artifact_id': mapping.get(row['folder'], ''),
                 'label_status': 'folder_hint_only' if row['folder'] in mapping else 'negative_candidate_only',
                 'camera_model': row.get('camera_model', ''), 'captured_at': row.get('captured_at', '')}
        entry['capture_bucket_hint'] = capture_bucket(entry)
        tasks.append((args.dataset / 'originals' / relative, entry, output))
    for artifact in catalog:
        for file in artifact['files']:
            entry = {'kind': 'baseline', 'source_file': file, 'source_folder': 'baseline', 'proposed_artifact_id': artifact['id']}
            tasks.append((repo / 'data' / file, entry, output))
    entries = []
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        for index, entry in enumerate(pool.map(process_image, tasks), 1):
            entry['review_id'] = f'R{index:04d}' if entry['kind'] == 'incoming' else f'B{index:04d}'
            entries.append(entry)
            if index % 100 == 0 or index == len(tasks):
                print(json.dumps({'decoded': index, 'total': len(tasks), 'errors': sum(item['decode_status'] == 'error' for item in entries)}), flush=True)
    pairs = candidate_pairs(entries)
    flagged = Counter(file for pair in pairs for file in (pair['left'], pair['right']))
    fields = ['review_id', 'source_file', 'source_sha256', 'proposed_artifact_id', 'label_status', 'camera_model', 'captured_at',
              'capture_bucket_hint', 'decode_status', 'near_duplicate_candidate_count', 'approved_artifact_id', 'capture_group',
              'duplicate_group', 'view_or_side', 'quality', 'scenario', 'partition', 'reason', 'reviewed', 'preview', 'error']
    with (output / 'review.csv').open('w', encoding='utf-8-sig', newline='') as stream:
        writer = csv.DictWriter(stream, fieldnames=fields, extrasaction='ignore')
        writer.writeheader()
        for entry in entries:
            if entry['kind'] == 'incoming':
                writer.writerow({**entry, 'near_duplicate_candidate_count': flagged[entry['source_file']], 'reviewed': 'false'})
    sheets = write_sheets(entries, output)
    for filename, value in [('images.json', entries), ('candidate-pairs.json', pairs), ('sheets.json', sheets)]:
        (output / filename).write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    summary = {'version': VERSION, 'created_at': datetime.now(timezone.utc).isoformat(), 'pillow': pillow_version,
               'pillow_heif': pillow_heif.__version__, 'incoming': sum(entry['kind'] == 'incoming' for entry in entries),
               'baseline': sum(entry['kind'] == 'baseline' for entry in entries), 'decode_errors': [entry for entry in entries if entry['decode_status'] != 'ok'],
               'contact_sheets': len(sheets), 'candidate_pairs': len(pairs), 'candidate_baseline_pairs': sum(pair['baseline_involved'] for pair in pairs),
               'source_buckets_hint': len({entry['capture_bucket_hint'] for entry in entries if entry['kind'] == 'incoming'}),
               'partitions_assigned': 0, 'labels_approved': 0,
               'warning': 'dHash <= 4 is only a review hint, NOT proof of duplication. Misses crops/perspective changes. Source buckets are not independent capture groups. Previews are not production-normalized images.'}
    (output / 'summary.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    cards = ''.join(f'<section><h2>{html.escape(sheet["folder"])} — {i + 1}</h2><a href="{sheet["file"]}"><img loading="lazy" src="{sheet["file"]}" width="960"></a></section>' for i, sheet in enumerate(sheets))
    document = '<!doctype html><html lang="vi"><meta charset="utf-8"><title>Duyệt ảnh offline</title><style>body{font:16px system-ui;margin:24px;background:#eee}img{max-width:100%;height:auto}section{background:white;padding:16px;margin:16px 0}</style><h1>Bảng ảnh duyệt offline — chưa gán nhãn/chia tập</h1><p>Đối chiếu mã Rxxxx với review.csv. Giữ trống partition cho tới khi duyệt; dHash chỉ gợi ý gần trùng. Không dùng preview làm ảnh đánh giá.</p>' + cards + '</html>'
    (output / 'index.html').write_text(document, encoding='utf-8')
    print(json.dumps(summary, ensure_ascii=True), flush=True)
    if summary['decode_errors']:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
