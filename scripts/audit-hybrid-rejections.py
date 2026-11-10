"""Offline audit of known-positive rejections under recommended hybrid policy."""
import json,statistics
from collections import Counter,defaultdict
from pathlib import Path
from PIL import Image,ImageDraw,ImageOps
ROOT=Path(__file__).resolve().parents[1]

def load(p):return json.loads(p.read_text(encoding='utf8'))
def choose(rows,n=4):
    # deterministic spread over geometry score, not tuned to labels beyond the known artifact.
    rows=sorted(rows,key=lambda r:(r['geometry_inliers'],r['embedding_score'],r['file']))
    if len(rows)<=n:return rows
    return [rows[round(i*(len(rows)-1)/(n-1))] for i in range(n)]
def main():
 out=ROOT/'reports/hybrid-rejection-audit-v1';out.mkdir(exist_ok=False)
 h=load(ROOT/'reports/hybrid-conflict-study-v2/summary.json');e=next(x for x in h['experiments'] if x['configuration']['name']=='candidate_union_both_vetoes')
 rows=[r for r in e['rows'] if r['scenario'].startswith('known_') and not r['accepted']]
 # Original source scores from hybrid rows include embedding and geometry diagnostics.
 bins=lambda r: '0' if r['geometry_inliers']==0 else '1-11' if r['geometry_inliers']<12 else '12-23' if r['geometry_inliers']<24 else '24+'
 stats={}
 for art in sorted({r['expected'] for r in rows}):
  subset=[r for r in rows if r['expected']==art];stats[art]={'total':len(subset),'reasons':dict(Counter(r['reason'] for r in subset)),'geometry_bins':dict(Counter(bins(r) for r in subset)),'embedding_score':{'min':min(r['embedding_score'] for r in subset),'median':statistics.median(r['embedding_score'] for r in subset),'max':max(r['embedding_score'] for r in subset)},'embedding_margin':{'min':min(r['embedding_margin'] for r in subset),'median':statistics.median(r['embedding_margin'] for r in subset),'max':max(r['embedding_margin'] for r in subset)}}
 selected=[]
 for art in sorted({r['expected'] for r in rows}):
  for reason in ('multiple_geometric_targets','insufficient_evidence'):
   for band in ('0','1-11','12-23','24+'):
    candidates=[r for r in rows if r['expected']==art and r['reason']==reason and bins(r)==band]
    selected += choose(candidates,2)
 # dedupe
 unique={r['file']:r for r in selected};selected=list(unique.values())
 queue=[]
 for i,r in enumerate(selected,1):queue.append({'review_key':f'R{i:03}',**r,'review_only_status':'pending','human_visibility_label':None,'official_label_changed':False})
 sheet=Image.new('RGB',(1200,((len(queue)+3)//4)*360),'white');draw=ImageDraw.Draw(sheet)
 for i,r in enumerate(queue):
  with Image.open(ROOT/'data/evaluation'/r['file']) as im:image=im.convert('RGB')
  image=ImageOps.contain(image,(290,275));x=i%4*300;y=i//4*360;sheet.paste(image,(x+(300-image.width)//2,y))
  draw.text((x+4,y+280),r['review_key']+' '+r['expected'].removeprefix('stamp-'),fill='black')
  draw.text((x+4,y+298),r['reason']+' geo '+str(r['geometry_inliers']),fill='black')
  draw.text((x+4,y+316),f"emb {r['embedding_score']:.3f}/{r['embedding_margin']:.3f}",fill='black')
  draw.text((x+4,y+334),'human label: pending',fill='black')
 sheet.save(out/'representative-rejections.jpg',quality=94)
 (out/'queue.json').write_text(json.dumps({'version':'hybrid-rejection-audit-v1','total_known_rejections':len(rows),'coverage':'deterministic representatives across artifact/reason/geometry bins; not exhaustive','entries':queue,'stats_by_artifact':stats,'provider_calls':0,'final_scored':False,'official_labels_changed':False},ensure_ascii=False,indent=2)+'\n',encoding='utf8')
 lines=['# Hybrid rejection audit — known positives only','',f'Total known-positive rejects: **{len(rows)}/436**. This is review-only; no official labels changed.','', '| Artifact | Rejected | Geometry 0 / 1–11 / 12–23 / 24+ | Embedding score median | Margin median |','|---|---:|---|---:|---:|']
 for art,m in stats.items():lines.append(f"| {art} | {m['total']} | {' / '.join(str(m['geometry_bins'].get(x,0)) for x in ('0','1-11','12-23','24+'))} | {m['embedding_score']['median']:.3f} | {m['embedding_margin']['median']:.3f} |")
 lines += ['', 'The category `known_clutter` means the requested artwork is the approved target even if other context is visible; it does not by itself mean a human can identify the target without effort. The proposed human-effort/visibility label remains pending.', '', 'Review sheet: `representative-rejections.jpg`.']
 (out/'summary.md').write_text('\n'.join(lines)+'\n',encoding='utf8')
 print({'known_rejections':len(rows),'representatives':len(queue),'provider_calls':0})
if __name__=='__main__':main()
