"""Offline review sheets: all known top-1 errors, negative accepts, and fixed correct controls.
No label/partition changes and no provider calls. Review is not model validation.
"""
from collections import Counter
import hashlib
import html
import json
from pathlib import Path
from urllib.parse import quote
from PIL import Image, ImageOps, ImageDraw, ImageFont


def build(repo, output):
    report_path = repo / 'reports/evaluation-full-calibration-v1/calibration.json'
    report = json.loads(report_path.read_text(encoding='utf-8'))
    rows = report['rows']['max']
    errors = [r for r in rows if r['scenario'].startswith('known_') and r['predicted'] != r['expected']]
    negative_accepts = [r for r in rows if not r['scenario'].startswith('known_') and r['score'] >= .86 and r['margin'] >= .13]
    controls = []
    for artifact in sorted({r['expected'] for r in rows if r['scenario'].startswith('known_')}):
        correct = sorted([r for r in rows if r['expected'] == artifact and r['predicted'] == artifact], key=lambda r:r['file'])
        # Include one accepted and one rejected correct-top1 image where possible.
        for accepted in (True, False):
            eligible = [r for r in correct if (r['score'] >= .86 and r['margin'] >= .13) == accepted]
            if eligible:
                controls.append(eligible[len(eligible)//2])
    queue = []
    for group, subset in [('wrong_top1', errors), ('negative_accept', negative_accepts), ('correct_control', controls)]:
        for row in subset:
            path = (repo/'data/evaluation'/row['file']).resolve()
            if (repo/'data/evaluation').resolve() not in path.parents:
                raise ValueError('Unsafe evaluation path')
            queue.append({**row, 'review_group': group, 'review_key': f'Q{len(queue)+1:03}',
                          'image_sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
                          'visual_review_status': 'pending', 'label_changed': False})
    if output.exists():
        raise ValueError('Choose a new output directory')
    output.mkdir(parents=True)
    font_path = Path('C:/Windows/Fonts/arial.ttf')
    font = ImageFont.truetype(str(font_path), 16) if font_path.exists() else ImageFont.load_default()
    small = ImageFont.truetype(str(font_path), 13) if font_path.exists() else ImageFont.load_default()
    sheets = []
    for start in range(0,len(queue),24):
        subset = queue[start:start+24]
        sheet = Image.new('RGB',(1200,6*285),'#eeeeee')
        draw = ImageDraw.Draw(sheet)
        for i,row in enumerate(subset):
            x,y = (i%4)*300,(i//4)*285
            with Image.open(repo/'data/evaluation'/row['file']) as image:
                image.load()
                preview = ImageOps.contain(image.convert('RGB'),(292,205))
            sheet.paste(preview,(x+(300-preview.width)//2,y))
            draw.text((x+5,y+207),row['review_key']+' '+row['review_group'],font=font,fill='black')
            draw.text((x+5,y+229),'GT: '+row['expected'].removeprefix('stamp-'),font=small,fill='black')
            draw.text((x+5,y+247),'Top: '+row['predicted'].removeprefix('stamp-'),font=small,fill='black')
            draw.text((x+5,y+265),f"s={row['score']:.3f} m={row['margin']:.3f}",font=small,fill='black')
        name=f'sheet-{start//24+1:02}.jpg'
        sheet.save(output/name,quality=92)
        sheets.append({'file':name,'review_keys':[r['review_key'] for r in subset]})
    result={'version':'calibration-review-v1','source_sha256':hashlib.sha256(report_path.read_bytes()).hexdigest(),
            'counts':dict(Counter(r['review_group'] for r in queue)), 'provider_calls':0,'final_used':False,
            'labels_changed':False,'entries':queue,'sheets':sheets}
    (output/'queue.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    body=['<!doctype html><meta charset="utf-8"><title>Calibration review</title>',
          '<style>body{font-family:sans-serif}article{border:1px solid #aaa;padding:12px;margin:12px}img{max-width:800px;max-height:650px}</style>',
          '<h1>Review-only: labels unchanged</h1>']
    for r in queue:
        url='../../data/evaluation/'+quote(r['file'],safe='/')
        body.append(f'<article id="{r["review_key"]}"><h2>{r["review_key"]} — {r["review_group"]}</h2><p>GT: {html.escape(r["expected"])}; top-1: {html.escape(r["predicted"])}</p><a href="{url}"><img loading="lazy" src="{url}" alt="{r["review_key"]}"></a><p>{html.escape(r["file"])}</p></article>')
    (output/'index.html').write_text('\n'.join(body),encoding='utf-8')
    return result


if __name__ == '__main__':
    repo=Path(__file__).resolve().parents[1]
    result=build(repo,repo/'reports/calibration-error-review-v1')
    print(json.dumps({'counts':result['counts'],'sheets':len(result['sheets']),'provider_calls':0}))
