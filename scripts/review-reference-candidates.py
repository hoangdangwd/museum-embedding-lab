"""Offline candidate-only visual review pack. Never reads locked test pixels or calls providers."""
import argparse
from collections import Counter,defaultdict
import hashlib
import json
from pathlib import Path

def eligibility(row):
    if row.get('current_partition') in ('calibration','final'):
        return False,'protected_'+row['current_partition']
    if row.get('holdout_device_reserved'):
        return False,'protected_holdout_device'
    if row.get('candidate_hold'):
        return False,'held_candidate_requires_separate_review'
    if not row.get('reference_selection_allowed_without_resplit'):
        return False,'protected_by_queue'
    return True,'baseline_retention' if row.get('kind')=='baseline' else 'offline_review_only_not_approved'

def build_inventory(entries):
    if len({e['review_id'] for e in entries})!=len(entries):raise ValueError('Duplicate review ID')
    return [dict(e,review_eligible=eligibility(e)[0],eligibility_reason=eligibility(e)[1]) for e in entries]

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',default='reports/reference-selection-v2')
    args=parser.parse_args()
    root=Path(__file__).resolve().parents[1];out=(root/args.output).resolve()
    if out.parent!=root/'reports':raise ValueError('Output must be direct child of ignored reports/')
    queuefile=root/'reports/camera-crop-dataset-v1/queue.json'
    rows=build_inventory(json.loads(queuefile.read_text(encoding='utf8'))['entries'])
    from PIL import Image,ImageDraw,ImageFont
    font=ImageFont.truetype('C:/Windows/Fonts/arial.ttf',18)
    out.mkdir(exist_ok=True);(out/'sheets').mkdir(exist_ok=True)
    groups=defaultdict(list)
    for row in rows:
        if row['review_eligible']:
            group='baseline' if row['kind']=='baseline' else row['source_file'].split('/')[0]
            groups[group].append(row)
    sheets=[]
    for gi,(group,entries) in enumerate(sorted(groups.items())):
        for offset in range(0,len(entries),25):
            subset=entries[offset:offset+25];sheet=Image.new('RGB',(1200,70+350*((len(subset)+4)//5)),'#dddddd');draw=ImageDraw.Draw(sheet)
            draw.text((12,8),f'{group} — eligible source previews only — page {offset//25+1}',font=font,fill='black')
            for i,e in enumerate(subset):
                x=(i%5)*240;y=60+(i//5)*350
                p=(root/'reports/camera-crop-dataset-v1'/e['preview']).resolve()
                if root/'reports' not in p.parents:raise ValueError('Unsafe preview path')
                with Image.open(p) as im:
                    im=im.convert('RGB');im.thumbnail((230,300));sheet.paste(im,(x+(240-im.width)//2,y+30))
                draw.text((x+5,y),e['review_id']+' '+(e['current_partition'] or 'unassigned'),font=font,fill='black')
            file=f'sheets/{gi:02d}-{offset//25+1:02d}.jpg';sheet.save(out/file,quality=90)
            sheets.append({'file':file,'group':group,'ids':[e['review_id'] for e in subset]})
    payload={'status':'OFFLINE VISUAL REVIEW; NOT APPROVAL OR CATALOG CHANGE','queue_sha256':hashlib.sha256(queuefile.read_bytes()).hexdigest(),'total':len(rows),'eligible':sum(e['review_eligible'] for e in rows),'protected_not_opened':sum(not e['review_eligible'] for e in rows),'eligibility_reasons':dict(Counter(e['eligibility_reason'] for e in rows)),'provider_calls':0,'production_mutations':0,'entries':rows,'sheets':sheets}
    (out/'inventory.json').write_text(json.dumps(payload,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
    print(json.dumps({k:v for k,v in payload.items() if k not in ('entries','sheets')},ensure_ascii=True,indent=2))
    print(json.dumps(sheets,ensure_ascii=True,indent=2))
if __name__=='__main__':main()
