"""Offline visibility/partial-target review queue with score bins; no label changes."""
import json
from collections import defaultdict
from pathlib import Path
from PIL import Image,ImageDraw,ImageOps
ROOT=Path(__file__).resolve().parents[1]

def run():
    cal={r['file']:r for r in json.loads((ROOT/'reports/evaluation-full-calibration-v1/calibration.json').read_text(encoding='utf8'))['rows']['max']}
    geo={r['file']:r for r in (json.loads(x) for x in (ROOT/'reports/local-feature-study-v3/rows.jsonl').read_text(encoding='utf8').splitlines())}
    # Select geometry-correct rows near the proposed 24-inlier boundary, stratified by artifact.
    selected=[]
    for artifact in sorted({r['expected'] for r in cal.values() if r['scenario']=='known_clutter'}):
        candidates=[]
        for file,r in cal.items():
            if r['scenario']!='known_clutter' or r['expected']!=artifact:continue
            g=geo[file]['variants']['target_roi']
            if g['predicted']==r['expected'] and 12<=g['score']<=26:
                candidates.append((abs(g['score']-20),file))
        for _,file in sorted(candidates)[:3]:selected.append(file)
    out=ROOT/'reports/visibility-threshold-review-v1';out.mkdir(exist_ok=False)
    rows=[]
    sheet=Image.new('RGB',(1200,((len(selected)+3)//4)*370),'white');draw=ImageDraw.Draw(sheet)
    for i,file in enumerate(selected):
        r=cal[file];g=geo[file]['variants']['target_roi'];
        with Image.open(ROOT/'data/evaluation'/file) as im:image=im.convert('RGB')
        image=ImageOps.contain(image,(290,285));x=i%4*300;y=i//4*370;sheet.paste(image,(x+(300-image.width)//2,y))
        accepted24=g['score']>=24 and g['margin']>=20 and g['ranking'][1]['score']<10
        accepted12=g['score']>=12 and g['margin']>=5 and g['ranking'][1]['score']<10
        row={'file':file,'expected':r['expected'],'scenario':r['scenario'],'embedding_score':r['score'],'embedding_margin':r['margin'],'embedding_predicted':r['predicted'],'geometry_predicted':g['predicted'],'geometry_inliers':g['score'],'geometry_margin':g['margin'],'geometry_runnerup':g['ranking'][1]['score'],'accepted_geometry_24_20':accepted24,'accepted_geometry_12_5':accepted12}
        rows.append(row)
        draw.text((x+4,y+290),r['expected'].removeprefix('stamp-'),fill='black');draw.text((x+4,y+307),f"E {r['score']:.3f}/{r['margin']:.3f} G {g['score']}/{g['margin']}/{g['ranking'][1]['score']}",fill='black');draw.text((x+4,y+324),f"24/20={'Y' if accepted24 else 'N'}  12/5={'Y' if accepted12 else 'N'}",fill='black')
    sheet.save(out/'near-boundary-sheet.jpg',quality=94)
    (out/'queue.json').write_text(json.dumps({'version':'visibility-threshold-review-v1','scope':'known_clutter only; score-stratified review, not labels','entries':rows,'provider_calls':0,'final_scored':False,'labels_changed':False},indent=2)+'\n',encoding='utf8')
    print({'entries':len(rows),'provider_calls':0})
if __name__=='__main__':run()
