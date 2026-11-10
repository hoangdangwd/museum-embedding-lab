"""Build offline visual sheet for hybrid evidence states; no labels changed."""
from collections import defaultdict
import json
from pathlib import Path
from PIL import Image,ImageDraw,ImageOps
ROOT=Path(__file__).resolve().parents[1]

def run():
    out=ROOT/'reports/hybrid-conflict-topology-v1';data=json.loads((out/'topology.json').read_text(encoding='utf8'))
    entries=data['review_entries']; groups=defaultdict(list)
    for row in entries:groups[row['review_group']+':'+next((k for k in ('multi_target_veto','geometry_only','embedding_only','both_agree','neither') if False), '')].append(row)
    # State is inferred from reason for errors; use selected examples by source rows and derive display state from metrics fields.
    for row in entries:
        if row['reason']=='multiple_geometric_targets':row['display_state']='multi_target_veto'
        elif row['reason']=='geometry_rescue':row['display_state']='geometry_only'
        elif row['reason']=='embedding_accept':row['display_state']='embedding_only'
        elif row['reason']=='weak_conflict':row['display_state']='embedding_only (weak conflict rejected)'
        else:row['display_state']=row['reason']
    sheet=Image.new('RGB',(1200,((len(entries)+3)//4)*360),'white');draw=ImageDraw.Draw(sheet)
    for i,row in enumerate(entries):
        path=(ROOT/'data/evaluation'/row['file']).resolve()
        base=(ROOT/'data/evaluation').resolve()
        if base not in path.parents:raise ValueError('Unsafe path')
        with Image.open(path) as im:image=im.convert('RGB')
        image=ImageOps.contain(image,(290,275));x=i%4*300;y=i//4*360
        sheet.paste(image,(x+(300-image.width)//2,y))
        draw.text((x+4,y+280),row['display_state'],fill='black')
        draw.text((x+4,y+298),'GT '+row['expected'].removeprefix('stamp-'),fill='black')
        draw.text((x+4,y+316),'E '+str(row['embedding_predicted']).removeprefix('stamp-')+' / G '+str(row['geometry_predicted']).removeprefix('stamp-'),fill='black')
        draw.text((x+4,y+334),f"E {row['embedding_score']:.3f}; G {row['geometry_inliers']}/{row['geometry_margin']}",fill='black')
    sheet.save(out/'topology-review-sheet.jpg',quality=94)
    (out/'topology-review-sheet.json').write_text(json.dumps({'entries':entries,'provider_calls':0,'labels_changed':False},indent=2)+'\n',encoding='utf8')
    print({'entries':len(entries),'provider_calls':0})
if __name__=='__main__':run()
