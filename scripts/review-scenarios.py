"""Build offline scenario-review sheets for the applied calibration/final partitions.

Only reads verified staging JPEGs and the official manifest. It creates review derivatives
under reports; it does not assign scenarios, copy images, or call providers.
"""
import argparse
from collections import Counter, defaultdict
from datetime import datetime, timezone
import hashlib
import html
import json
from pathlib import Path


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load(path):
    return json.loads(path.read_text(encoding='utf-8'))


def confined(root, rel):
    path = (root / rel).resolve()
    if root.resolve() not in path.parents:
        raise ValueError('Path escapes staging')
    return path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=Path('reports/drive-scenario-review-v1'))
    args = parser.parse_args()
    repo = Path(__file__).resolve().parents[1]
    output = args.output.resolve()
    if (repo / 'reports').resolve() not in output.parents or output.exists():
        raise ValueError('Choose a new output directory under ignored reports/')
    official_path = repo / 'reports/drive-official-split-v1/manifest.json'
    staging_path = repo / 'data/staging/drive-normalized-v1/staging-manifest.json'
    final_labels_path = repo / 'reports/drive-final-labels-approved-v1.json'
    paths = {'official': official_path, 'staging': staging_path, 'final_labels': final_labels_path}
    source_hashes = {key: sha(path) for key, path in paths.items()}
    official, staging, final_labels = (load(official_path), load(staging_path), load(final_labels_path))
    if official['official_fields']['partition_applied'] is not True or official['official_fields']['scenario_applied'] is not False:
        raise ValueError('Expected partition-applied/scenario-pending official manifest')
    stage = {row['review_id']: row for row in staging['entries']}
    if len(stage) != 782 or len(official['entries']) != 1632:
        raise ValueError('Staging or official population drift')
    approved_final = {row['review_id']: row for row in final_labels['entries'] if row.get('owner_label_approved')}
    selected = []
    for row in official['entries']:
        if row['partition'] not in ('calibration', 'final'):
            continue
        if row['candidate_hold'] or row['partition'] is None:
            continue
        staged = stage.get(row['review_id'])
        if not staged or staged.get('jpeg_status') != 'ok':
            raise ValueError(f'Missing verified staging JPEG: {row["review_id"]}')
        path = confined(repo / 'data/staging/drive-normalized-v1', staged['jpeg_file'])
        if sha(path) != staged['normalized_sha256']:
            raise ValueError(f'Staging hash drift: {row["review_id"]}')
        inherited = approved_final.get(row['review_id'])
        selected.append({
            'review_id': row['review_id'], 'partition': row['partition'],
            'source_file': row['source_file'], 'source_sha256': row['source_sha256'],
            'normalized_file': staged['jpeg_file'], 'normalized_sha256': staged['normalized_sha256'],
            'folder_artifact_hint': row['approved_artifact_id'], 'scenario': None,
            'scenario_status': 'review_required',
            'inherited_review_scenario': inherited.get('approved_scenario') if inherited else None,
            'inherited_review_artifact_id': inherited.get('approved_artifact_id') if inherited else None,
            'note': 'Review-only scenario queue; no scenario assigned.'
        })
    counts = Counter(row['partition'] for row in selected)
    if dict(counts) != {'calibration': 436, 'final': 183}:
        raise ValueError(f'Unexpected scenario queue counts: {dict(counts)}')
    inherited_counts = Counter(row['inherited_review_scenario'] for row in selected if row['inherited_review_scenario'])
    if inherited_counts != Counter({'_low_quality': 10, '_ambiguous': 5, 'known_clutter': 2}):
        raise ValueError(f'Unexpected inherited final labels: {dict(inherited_counts)}')
    output.mkdir(parents=True)
    sheets_dir = output / 'sheets'; sheets_dir.mkdir()
    from PIL import Image, ImageDraw, ImageFont
    groups = defaultdict(list)
    for row in selected:
        groups[row['partition']].append(row)
    sheet_records = []
    for partition, rows in sorted(groups.items()):
        for start in range(0, len(rows), 20):
            subset = rows[start:start + 20]
            canvas = Image.new('RGB', (5 * 330, 4 * 285), 'white')
            draw = ImageDraw.Draw(canvas)
            for pos, row in enumerate(subset):
                x, y = pos % 5 * 330, pos // 5 * 285
                path = confined(repo / 'data/staging/drive-normalized-v1', row['normalized_file'])
                with Image.open(path) as image:
                    image = image.convert('RGB')
                    image.thumbnail((320, 235))
                    canvas.paste(image, (x + (320 - image.width) // 2, y))
                inherited = row['inherited_review_scenario'] or 'SCENARIO?'
                draw.text((x + 5, y + 240), f"{row['review_id']} {inherited}", fill='black')
                draw.text((x + 5, y + 258), Path(row['source_file']).name[:40], fill='black')
            name = f'{partition}-{start // 20 + 1:02d}.jpg'
            canvas.save(sheets_dir / name, quality=90)
            sheet_records.append({'partition': partition, 'file': f'sheets/{name}', 'review_ids': [r['review_id'] for r in subset], 'range': [start + 1, start + len(subset)]})
    (output / 'sheets.json').write_text(json.dumps(sheet_records, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    (output / 'scenario-queue.json').write_text(json.dumps(selected, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    summary = {'version': 'scenario-review-queue-v1', 'created_at': datetime.now(timezone.utc).isoformat(), 'status': 'REVIEW ONLY — scenario is unset', 'source_files': {key: {'path': str(path.relative_to(repo)).replace('\\', '/'), 'sha256': source_hashes[key]} for key, path in paths.items()}, 'counts': {'calibration': 436, 'final': 183, 'total': 619, 'scenario_assigned': 0, 'inherited_final_review_labels': dict(inherited_counts)}, 'provider_calls': 0, 'uploads': 0, 'production_mutations': 0, 'warning': 'known_clean/known_clutter are not inferred from folder names. Review each queue; low_quality/ambiguous inherited labels are review-only until scenario approval.'}
    (output / 'summary.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    sections = ['<!doctype html><html lang="vi"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Scenario review — chưa gán</title><body style="font:16px system-ui;max-width:1200px;margin:24px auto;padding:0 16px"><h1>Scenario review — 619 ảnh, chưa gán</h1><p><b>Không có scenario nào được áp dụng.</b> Chọn `known_clean` khi ảnh có một artifact rõ và ít nhiễu; chọn `known_clutter` khi vẫn một artifact nhưng nền/góc/kính/người che gây khó; ảnh không đạt thì giữ proposal âm tính hoặc loại khỏi evaluation.</p>']
    for record in sheet_records:
        sections.append(f'<h2>{record["partition"]} — {record["range"][0]}–{record["range"][1]}</h2><img src="{html.escape(record["file"])}" style="max-width:100%">')
    sections.append('</body></html>')
    (output / 'index.html').write_text('\n'.join(sections), encoding='utf-8')
    verification = {'status': 'passed', 'source_hashes_unchanged': True, 'staging_images_verified': 619, 'scenario_assigned': 0, 'sheet_count': len(sheet_records), 'provider_calls': 0, 'uploads': 0}
    (output / 'verification.json').write_text(json.dumps(verification, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({**summary['counts'], **verification}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
