"""Download a public Drive listing into quarantined data/incoming/, never seed it.

Discovery (gdown >= 6.5):
  python -m gdown --folder DRIVE_URL --json --no-cookies > reports/drive-discovery.json
Download (resumable by verified completion records, no browser cookies required):
  python scripts/download-drive.py reports/drive-discovery.json data/incoming/DATASET
Requires requests; gdown is used for Drive confirmation pages. See requirements-dataset.txt.
Install into an ignored tool directory and set PYTHONPATH if desired.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path, PurePosixPath
import shutil
import threading
import time
from urllib.parse import parse_qs, urlparse


def sha256(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def validate_listing(listing):
    result, paths, ids = [], set(), set()
    for item in listing:
        # No absolute paths, traversal, Windows drive/ADS syntax or aliases.
        raw = item['path'].replace(chr(92), '/')
        path = PurePosixPath(raw)
        if path.is_absolute() or any(part in ('', '.', '..') or ':' in part for part in raw.split('/')):
            raise ValueError(f'Unsafe destination: {raw}')
        key = raw.casefold()
        if key in paths:
            raise ValueError(f'Duplicate destination: {raw}')
        parsed = urlparse(item['url'])
        file_id = parse_qs(parsed.query).get('id', [''])[0]
        if parsed.scheme != 'https' or parsed.hostname != 'drive.google.com' or not file_id or not all(c.isalnum() or c in '-_' for c in file_id):
            raise ValueError(f'Invalid public Drive URL for {raw}')
        if file_id in ids:
            raise ValueError(f'Duplicate Drive file ID: {file_id}')
        paths.add(key)
        ids.add(file_id)
        result.append({'path': raw, 'drive_file_id': file_id, 'url': f'https://drive.google.com/uc?id={file_id}'})
    return result


def download_public_file(url, partial):
    """Stream the public response; use gdown only for Drive confirmation pages."""
    import requests
    last_error = None
    for attempt in range(4):
        try:
            with requests.get(url, stream=True, timeout=(20, 90)) as response:
                response.raise_for_status()
                content_type = response.headers.get('Content-Type', '').lower()
                if 'text/html' in content_type:
                    import gdown
                    gdown.download(url, str(partial), quiet=True, use_cookies=False, timeout=(20, 90), retries=2, resume=False)
                else:
                    expected = response.headers.get('Content-Length')
                    size = 0
                    with partial.open('wb') as stream:
                        for chunk in response.iter_content(1024 * 1024):
                            stream.write(chunk)
                            size += len(chunk)
                    if expected and not response.headers.get('Content-Encoding') and size != int(expected):
                        raise RuntimeError(f'Incomplete transfer: {size}/{expected} bytes')
                return
        except Exception as error:
            last_error = error
            if attempt < 3:
                time.sleep(2 ** attempt)
    raise RuntimeError(f'Public download failed after retries: {last_error}')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('listing', type=Path)
    parser.add_argument('destination', type=Path)
    parser.add_argument('--workers', type=int, default=4, choices=range(1, 9))
    args = parser.parse_args()
    items = validate_listing(json.loads(args.listing.read_text(encoding='utf-8-sig')))
    root = args.destination.resolve()
    # Prevent an accidental download into active references/test.
    incoming = (Path(__file__).resolve().parents[1] / 'data' / 'incoming').resolve()
    if root == incoming or incoming not in root.parents:
        raise ValueError('Destination must be a dataset directory inside data/incoming/')
    root.mkdir(parents=True, exist_ok=True)
    (root / 'source-files.json').write_text(json.dumps(items, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    journal = root / 'download-log.jsonl'
    completed = {}
    if journal.exists():
        for line in journal.read_text(encoding='utf-8').splitlines():
            try:
                entry = json.loads(line)
                if entry.get('status') == 'complete':
                    completed[entry['path']] = entry
            except (ValueError, KeyError):
                pass  # Interrupted final journal line is not a completion marker.
    lock = threading.Lock()
    counter = {'complete': 0, 'skipped': 0, 'failed': 0, 'bytes': 0}
    started = time.monotonic()

    def record(entry):
        with lock:
            with journal.open('a', encoding='utf-8') as stream:
                stream.write(json.dumps(entry, ensure_ascii=False) + '\n')
            counter['complete' if entry['status'] == 'complete' else 'failed'] += 1
            counter['bytes'] += entry.get('bytes', 0)
            counter['skipped'] += int(entry.get('skipped', False))
            done = counter['complete'] + counter['failed']
            if done % 25 == 0 or entry['status'] != 'complete' or done == len(items):
                print(json.dumps({'processed': done, 'total': len(items), **counter, 'elapsed_s': round(time.monotonic() - started), 'last': entry['path']}), flush=True)

    def download(item):
        target = root / 'originals' / item['path']
        entry = {'path': item['path'], 'drive_file_id': item['drive_file_id'], 'time': datetime.now(timezone.utc).isoformat()}
        try:
            previous = completed.get(item['path'])
            if previous and target.is_file() and target.stat().st_size == previous['bytes'] and sha256(target) == previous['sha256']:
                record({**entry, 'status': 'complete', 'bytes': previous['bytes'], 'sha256': previous['sha256'], 'skipped': True})
                return
            if shutil.disk_usage(root).free < 2 * 1024**3:
                raise RuntimeError('Less than 2 GiB free disk space; download stopped for this file')
            target.parent.mkdir(parents=True, exist_ok=True)
            partial = target.with_name(target.name + '.part')
            download_public_file(item['url'], partial)
            if not partial.is_file() or partial.stat().st_size == 0:
                raise RuntimeError('Download did not produce a nonempty file')
            with partial.open('rb') as stream:
                head = stream.read(256).lstrip().lower()
            if head.startswith((b'<!doctype html', b'<html')):
                raise RuntimeError('Drive returned an HTML page, not an image')
            digest = sha256(partial)
            partial.replace(target)
            record({**entry, 'status': 'complete', 'bytes': target.stat().st_size, 'sha256': digest})
        except Exception as error:
            record({**entry, 'status': 'failed', 'error': str(error)})

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = [pool.submit(download, item) for item in items]
        for future in as_completed(futures):
            future.result()
    summary = {'expected': len(items), **counter, 'elapsed_s': round(time.monotonic() - started), 'finished_at': datetime.now(timezone.utc).isoformat()}
    (root / 'download-summary.json').write_text(json.dumps(summary, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(summary), flush=True)
    if counter['failed']:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
