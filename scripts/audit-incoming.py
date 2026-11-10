"""Offline inventory for downloaded originals; no conversion, splitting or model calls.

Requires Pillow + pillow-heif for metadata/preview support of HEIC originals.
Reports stay under reports/ by default and do not expose GPS EXIF fields.
"""
import argparse
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import csv


def inspect_file(task):
    from PIL import Image
    root, item = task
    path = root / 'originals' / item['path']
    record = {'file': item['path'], 'folder': Path(item['path']).parts[0], 'drive_file_id': item['drive_file_id'], 'extension': path.suffix.lower()}
    try:
        record['bytes'] = path.stat().st_size
        digest = hashlib.sha256()
        with path.open('rb') as stream:
            for block in iter(lambda: stream.read(1024 * 1024), b''):
                digest.update(block)
        record['sha256'] = digest.hexdigest()
        with Image.open(path) as image:
            record.update(width=image.width, height=image.height, format=image.format)
            exif = image.getexif()
            details = exif.get_ifd(34665) if 34665 in exif else {}
            record['camera_make'] = str(exif.get(271, '')).strip()
            record['camera_model'] = str(exif.get(272, '')).strip()
            record['captured_at'] = str(details.get(36867, exif.get(306, ''))).strip()
        record['status'] = 'metadata_readable'
    except Exception as error:
        record.update(status='error', error=str(error))
    return record


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('dataset', type=Path)
    parser.add_argument('--output', type=Path, default=Path('reports/drive-inventory'))
    parser.add_argument('--contact-sheets', action='store_true')
    args = parser.parse_args()
    from PIL import Image, ImageDraw, ImageOps
    import pillow_heif
    pillow_heif.register_heif_opener()
    items = json.loads((args.dataset / 'source-files.json').read_text(encoding='utf-8'))
    args.output.mkdir(parents=True, exist_ok=True)
    with ThreadPoolExecutor(max_workers=4) as pool:
        entries = list(pool.map(inspect_file, ((args.dataset, item) for item in items)))
    fields = ['file', 'folder', 'drive_file_id', 'extension', 'bytes', 'sha256', 'width', 'height', 'format', 'camera_make', 'camera_model', 'captured_at', 'status', 'error']
    with (args.output / 'files.csv').open('w', newline='', encoding='utf-8-sig') as stream:
        writer = csv.DictWriter(stream, fieldnames=fields)
        writer.writeheader()
        writer.writerows(entries)
    groups, hashes = defaultdict(list), defaultdict(list)
    for entry in entries:
        groups[entry['folder']].append(entry)
        if entry.get('sha256'):
            hashes[entry['sha256']].append(entry['file'])
    summaries = []
    for index, (folder, images) in enumerate(sorted(groups.items())):
        times = sorted(image['captured_at'] for image in images if image.get('captured_at'))
        summary = {'folder': folder, 'files': len(images), 'bytes': sum(image.get('bytes', 0) for image in images), 'extensions': dict(Counter(image['extension'] for image in images)),
                   'metadata_errors': sum(image['status'] == 'error' for image in images),
                   'camera_models': dict(Counter(image.get('camera_model', '') for image in images)),
                   'capture_start': times[0] if times else None, 'capture_end': times[-1] if times else None}
        if args.contact_sheets:
            readable = [image for image in images if image['status'] != 'error']
            readable.sort(key=lambda image: (image.get('captured_at', ''), image['file']))
            selected = [readable[round(i * (len(readable) - 1) / 15)] for i in range(16)] if len(readable) > 16 else readable
            sheet = Image.new('RGB', (4 * 320, 4 * 270), 'white')
            draw = ImageDraw.Draw(sheet)
            for j, entry in enumerate(selected):
                x, y = (j % 4) * 320, (j // 4) * 270
                try:
                    with Image.open(args.dataset / 'originals' / entry['file']) as image:
                        preview = ImageOps.exif_transpose(image)
                        preview.thumbnail((310, 235))
                        sheet.paste(preview.convert('RGB'), (x + (320 - preview.width) // 2, y))
                    draw.text((x + 5, y + 240), Path(entry['file']).name, fill='black')
                except Exception as error:
                    draw.text((x + 5, y + 5), 'Preview failed', fill='red')
                    summary.setdefault('preview_errors', []).append({'file': entry['file'], 'error': str(error)})
            sheet_name = f'{index + 1:02d}-contact.jpg'
            sheet.save(args.output / sheet_name, quality=85)
            summary['sample_sheet'] = sheet_name
        summaries.append(summary)
        print(json.dumps(summary, ensure_ascii=True), flush=True)
    report = {'created_at': datetime.now(timezone.utc).isoformat(), 'total_files': len(entries), 'total_bytes': sum(entry.get('bytes', 0) for entry in entries),
              'extensions': dict(Counter(entry['extension'] for entry in entries)), 'metadata_errors': [entry for entry in entries if entry['status'] == 'error'],
              'exact_duplicate_groups': [files for files in hashes.values() if len(files) > 1], 'folders': summaries,
              'note': 'Metadata read for every original; contact sheets decode sampled images only. Not full pixel validation, label review or near-duplicate detection.'}
    (args.output / 'summary.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'total_files': report['total_files'], 'total_bytes': report['total_bytes'], 'metadata_errors': len(report['metadata_errors']), 'duplicate_groups': len(report['exact_duplicate_groups'])}), flush=True)
    if report['metadata_errors']:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
