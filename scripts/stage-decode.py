"""Approved offline staging only: verified HEIC -> lossless sRGB; JPEG stays source.

Final JPEG encoding is performed separately by stage-jpeg.mjs via src/media.js.
Does not move source files, approve evaluation labels, or call providers.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import hashlib
import io
import json
from pathlib import Path

VERSION = 'heif8-icc-srgb-lossless-v1'
ACTIONS = {'reference_candidate': 'references', 'calibration_candidate': 'calibration', 'final_candidate_cross_device': 'final'}


def sha256(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def safe_source(root, file):
    path = Path(file)
    if path.is_absolute() or '..' in path.parts or ':' in file or chr(92) in file:
        raise ValueError('Unsafe source path')
    full = (root / path).resolve()
    if root.resolve() not in full.parents:
        raise ValueError('Source path escapes originals')
    return full


def selected_entries(manifest):
    selected = [entry for entry in manifest['entries'] if entry['action'] in ACTIONS]
    if len({entry['source_file'] for entry in selected}) != len(selected) or len({entry['review_id'] for entry in selected}) != len(selected):
        raise ValueError('Duplicate selected source or review ID')
    for entry in selected:
        if entry['camera_model'] == '22041216G' and entry['action'] != 'final_candidate_cross_device':
            raise ValueError('Holdout device must stay in final')
        if entry['action'] == 'final_candidate_cross_device' and entry['camera_model'] != '22041216G':
            raise ValueError('Cross-device final has unexpected camera')
        if entry['action'] == 'reference_candidate' and not entry.get('reference_selection_owner_approved'):
            raise ValueError('Reference choice lacks owner approval')
        if not isinstance(entry['source_sha256'], str) or len(entry['source_sha256']) != 64 or any(c not in '0123456789abcdef' for c in entry['source_sha256']):
            raise ValueError('Invalid source SHA256')
    return selected


def srgb_image(image):
    from PIL import Image, ImageCms, ImageOps
    bit_depth = int(image.info.get('bit_depth', 8))
    if bit_depth != 8:
        raise ValueError(f'{bit_depth}-bit/HDR source needs an explicitly reviewed tone-mapping policy')
    profile = image.info.get('icc_profile')
    oriented = ImageOps.exif_transpose(image)
    if profile:
        converted = ImageCms.profileToProfile(oriented.convert('RGB'), ImageCms.ImageCmsProfile(io.BytesIO(profile)), ImageCms.createProfile('sRGB'), renderingIntent=0, outputMode='RGB')
        color_policy = 'embedded-icc-to-srgb-perceptual'
    else:
        # HEIC nclx-only color needs review, not an undocumented assumption.
        if image.format in ('HEIF', 'HEIC'):
            raise ValueError('HEIC lacks embedded ICC profile; review nclx/color policy first')
        converted = oriented.convert('RGB')
        color_policy = 'rgb-no-embedded-profile'
    if 'A' in oriented.getbands():
        base = Image.new('RGB', converted.size, 'white')
        base.paste(converted, mask=oriented.getchannel('A'))
        converted = base
    return converted, color_policy


def decode_entry(task):
    from PIL import Image
    original_root, output, entry, cached = task
    row = dict(entry)
    row['proposed_role'] = ACTIONS[entry['action']]
    row['partition'] = None
    try:
        source = safe_source(original_root, entry['source_file'])
        if sha256(source) != entry['source_sha256']:
            raise ValueError('Original SHA256 mismatch')
        size = source.stat().st_size
        if not 0 < size <= 15 * 1024**2:
            raise ValueError('Source size outside application limit')
        suffix = source.suffix.lower()
        if cached and cached.get('decode_status') == 'ok' and cached.get('source_sha256') == entry['source_sha256']:
            cached_input = safe_source(original_root if cached['input_kind'] == 'original_jpeg' else output, cached['input_file'])
            if cached_input.is_file() and sha256(cached_input) == cached['input_sha256']:
                return {**cached, 'resume_verified': True}
        row['source_bytes'] = size
        if suffix in ('.jpg', '.jpeg'):
            with Image.open(source) as image:
                image.load()
                row['source_dimensions'] = list(image.size)
            row.update(decode_status='ok', input_kind='original_jpeg', input_file=entry['source_file'], input_sha256=entry['source_sha256'], input_bytes=size, color_policy='browser-native-jpeg-color-and-exif')
        elif suffix in ('.heic', '.heif'):
            with Image.open(source) as image:
                image.load()
                row['source_dimensions'] = list(image.size)
                row['heif_bit_depth'] = image.info.get('bit_depth', 8)
                converted, policy = srgb_image(image)
                row['oriented_dimensions'] = list(converted.size)
                # Clean new image ensures no inherited EXIF/GPS/XMP/orientation in intermediate.
                clean = Image.new('RGB', converted.size)
                clean.paste(converted)
                buffer = io.BytesIO()
                clean.save(buffer, 'PNG')
                extension = 'png'
                if buffer.tell() > 15 * 1024**2:
                    buffer = io.BytesIO()
                    clean.save(buffer, 'WEBP', lossless=True, exact=True)
                    extension = 'webp'
                if buffer.tell() > 15 * 1024**2:
                    raise ValueError('Lossless intermediate exceeds shared jpeg() 15 MB input limit')
                relative = f'intermediate/{entry["source_sha256"]}.{extension}'
                path = output / relative
                path.write_bytes(buffer.getvalue())
                row.update(decode_status='ok', input_kind='heic_lossless_srgb', input_file=relative, input_sha256=sha256(path), input_bytes=path.stat().st_size, color_policy=policy)
        else:
            raise ValueError(f'Unsupported input extension: {suffix}')
    except Exception as error:
        row.update(decode_status='error', error=str(error))
    return row


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest', type=Path, default=Path('reports/drive-split-candidate-v2.json'))
    parser.add_argument('--originals', type=Path, default=Path('data/incoming/drive-1jYzY5U3Yc6R_3CdUz7h0T8rYOBFGb7VH/originals'))
    parser.add_argument('--output', type=Path, default=Path('data/staging/drive-normalized-v1'))
    parser.add_argument('--allow-staging', action='store_true', help='Owner approved staging conversion only; not official split/paid calls')
    parser.add_argument('--workers', type=int, default=2, choices=range(1, 5))
    parser.add_argument('--resume', action='store_true', help='Reuse only source/input hash-verified journal records')
    args = parser.parse_args()
    if not args.allow_staging:
        raise ValueError('Explicit --allow-staging required')
    repo = Path(__file__).resolve().parents[1]
    base = (repo / 'data/staging').resolve()
    output = args.output.resolve()
    if base not in output.parents or (output.exists() and not args.resume):
        raise ValueError('Choose a NEW dataset directory inside ignored data/staging/, or explicit --resume')
    if args.resume and not (output / 'run.json').is_file():
        raise ValueError('Resume needs an existing staging run.json')
    originals = args.originals.resolve()
    if (repo / 'data/incoming').resolve() not in originals.parents:
        raise ValueError('Originals must stay inside incoming/')
    manifest = json.loads(args.manifest.read_text(encoding='utf-8'))
    selected = selected_entries(manifest)
    counts = {role: sum(ACTIONS[entry['action']] == role for entry in selected) for role in ACTIONS.values()}
    if counts != {'references': 35, 'calibration': 564, 'final': 183}:
        raise ValueError(f'Approved selection count mismatch: {counts}')
    from PIL import __version__ as pillow_version
    import pillow_heif
    pillow_heif.register_heif_opener()
    (output / 'intermediate').mkdir(parents=True, exist_ok=True)
    header = {'version': VERSION, 'created_at': datetime.now(timezone.utc).isoformat(), 'owner_staging_approved': True,
              'keep_all_17_flagged_final': True, 'originals_root': str(originals), 'candidate_manifest_sha256': sha256(args.manifest),
              'pillow_version': pillow_version, 'pillow_heif_version': pillow_heif.__version__, 'selected_counts': counts,
              'official_partitions_applied': False, 'labels_approved': False, 'paid_calls_approved': False, 'provider_calls': 0}
    cached = {}
    if args.resume:
        previous = json.loads((output / 'run.json').read_text(encoding='utf-8'))
        for field in ('version', 'originals_root', 'candidate_manifest_sha256', 'pillow_version', 'pillow_heif_version', 'selected_counts'):
            if previous[field] != header[field]:
                raise ValueError(f'Staging resume configuration drift: {field}')
        header = previous
        journal_file = output / 'decode-log.jsonl'
        if journal_file.exists():
            for line in journal_file.read_text(encoding='utf-8').splitlines():
                try:
                    item = json.loads(line)
                    if item.get('decode_status') == 'ok':
                        cached[item['source_file']] = item
                except (ValueError, KeyError):
                    pass
    else:
        (output / 'run.json').write_text(json.dumps(header, indent=2) + '\n', encoding='utf-8')
    rows = []
    with ThreadPoolExecutor(max_workers=args.workers) as pool, (output / 'decode-log.jsonl').open('a' if args.resume else 'w', encoding='utf-8') as journal:
        for index, row in enumerate(pool.map(decode_entry, ((originals, output, entry, cached.get(entry['source_file'])) for entry in selected)), 1):
            rows.append(row)
            journal.write(json.dumps(row, ensure_ascii=False) + '\n')
            journal.flush()
            if index % 50 == 0 or row['decode_status'] != 'ok' or index == len(selected):
                print(json.dumps({'decoded': index, 'total': len(selected), 'errors': sum(item['decode_status'] != 'ok' for item in rows), 'last': row['review_id']}), flush=True)
    (output / 'decode-manifest.json').write_text(json.dumps({**header, 'entries': rows}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    errors = [row for row in rows if row['decode_status'] != 'ok']
    print(json.dumps({'decoded': len(rows), 'errors': len(errors), 'selected_counts': counts}), flush=True)
    if errors:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
