"""Evaluate family-specific geometry as an auxiliary rescue, offline only.
No provider calls, final scoring, label changes, or production writes.
"""
import json
from pathlib import Path
from collections import Counter
ROOT=Path(__file__).resolve().parents[1]
SCULPTURES={'stamp-hoang-hau-ngoc-truc','stamp-phat-ba-quan-am'}

def load(p): return json.loads(p.read_text(encoding='utf8'))

def evaluate(cal, geo, config):
    rows=[]
    for file, e in cal.items():
        allg=geo[file]['variants']['planar']; sculpt=geo[file]['variants']['sculpture_affine']
        is_sculpt=e['expected'] in SCULPTURES
        g=sculpt if is_sculpt else allg
        e_ok=e['score'] >= config['embedding_threshold'] and e['margin'] >= config['embedding_margin']
        g_ok=(g['predicted'] is not None and g['score'] >= (config['sculpture_inliers'] if is_sculpt else config['planar_inliers'])
              and g['margin'] >= (config['sculpture_margin'] if is_sculpt else config['planar_margin']))
        other_scores=[allg['ranking'][1]['score'], sculpt['ranking'][1]['score']]
        multi=max(other_scores) >= config['runnerup_limit']
        conflict=(g['predicted'] is not None and g['predicted'] != e['predicted']
                  and g['score'] >= config['weak_conflict_limit'])
        if multi:
            predicted=None; accepted=False; reason='multi_target'
        elif conflict:
            predicted=None; accepted=False; reason='conflict'
        elif e_ok:
            predicted=e['predicted']; accepted=True; reason='embedding_primary'
        elif g_ok:
            predicted=g['predicted']; accepted=True; reason='family_geometry_rescue'
        else:
            predicted=None; accepted=False; reason='insufficient'
        rows.append({'file':file,'expected':e['expected'],'scenario':e['scenario'],'predicted':predicted,
                     'score':int(accepted),'margin':1,'reason':reason,
                     'embedding_predicted':e['predicted'],'embedding_score':e['score'],'embedding_margin':e['margin'],
                     'geometry_model':'affine' if is_sculpt else 'homography','geometry_predicted':g['predicted'],
                     'geometry_inliers':g['score'],'geometry_margin':g['margin'],
                     'geometry_runnerup':g['ranking'][1]['score']})
    return rows

def metrics(rows):
    known=[r for r in rows if r['scenario'].startswith('known_')]
    accepted=[r for r in rows if r['score']]
    correct=[r for r in accepted if r['scenario'].startswith('known_') and r['predicted']==r['expected']]
    wrong=[r for r in accepted if r['scenario'].startswith('known_') and r['predicted']!=r['expected']]
    neg=[r for r in accepted if not r['scenario'].startswith('known_')]
    per={s:{'total':sum(r['scenario']==s for r in rows),'accepted':sum(r['scenario']==s and r['score'] for r in rows),'correct_accept':sum(r['scenario']==s and r in correct for r in rows)} for s in sorted({r['scenario'] for r in rows})}
    arts=sorted({r['expected'] for r in known})
    pa={a:{'total':sum(r['expected']==a for r in known),'correct_accept':sum(r in correct and r['expected']==a for r in rows)} for a in arts}
    return {'total':len(rows),'known_total':len(known),'accepted_total':len(accepted),'correct_accept':len(correct),'wrong_artifact_accept':len(wrong),'negative_false_accept':len(neg),'precision':len(correct)/len(accepted) if accepted else None,'recall':len(correct)/len(known),'macro_recall':sum(x['correct_accept']/x['total'] for x in pa.values())/len(pa),'per_scenario':per,'per_artifact':pa,'reasons':dict(Counter(r.get('reason','unspecified') for r in rows))}

def main():
 out=ROOT/'reports/optimized-geometry-study-v1'; rows=[json.loads(x) for x in (out/'rows.jsonl').read_text(encoding='utf8').splitlines()]
 cal=load(ROOT/'reports/evaluation-full-calibration-v1/calibration.json');cal={r['file']:r for r in cal['rows']['max']};geo={r['file']:r for r in rows}
 if set(cal)!=set(geo): raise ValueError('scope mismatch')
 configs=[]
 for et,em in ((.86,.13),(.86,.10),(.84,.10),(.82,.08),(.80,.05)):
  for pi,pm,si,sm,runner,weak in [(12,5,6,3,8,6),(12,5,8,4,8,6),(12,5,10,5,8,6),(12,5,12,6,8,6),(12,5,16,8,8,6),(12,5,20,10,8,6),(12,5,6,3,10,6),(12,5,6,3,8,8)]:
   configs.append({'name':f'{et}-{em}-{pi}-{pm}-{si}-{sm}-{runner}-{weak}','embedding_threshold':et,'embedding_margin':em,'planar_inliers':pi,'planar_margin':pm,'sculpture_inliers':si,'sculpture_margin':sm,'runnerup_limit':runner,'weak_conflict_limit':weak})
 results=[]
 for c in configs:
  rr=evaluate(cal,geo,c);results.append({'configuration':c,'metrics':metrics(rr),'rows':rr})
 safe=[r for r in results if r['metrics']['wrong_artifact_accept']==0 and r['metrics']['negative_false_accept']==0]
 safe.sort(key=lambda r:(r['metrics']['macro_recall'],r['metrics']['correct_accept']),reverse=True)
 report={'version':'family-hybrid-evaluation-v1','provider_calls':0,'final_scored':False,'production_changed':False,'configs':len(results),'safe_configs':len(safe),'best_safe':safe[:20],'all_results':results}
 (out/'family-hybrid-report.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf8')
 lines=['# Family-specific hybrid evaluation','', 'Embedding remains primary. Homography is auxiliary for planar artifacts; affine is auxiliary for Hoàng hậu/Phật Bà. Strong conflicts and multi-target evidence reject. Calibration only; no final/provider/production.','', '| Embedding | Planar geometry | Sculpture affine | Runner-up/weak conflict | Correct | Precision | Wrong-known | Negative FA | Clean | Clutter |', '|---|---|---|---|---:|---:|---:|---:|---:|---:|']
 for r in safe[:20]:
  c=r['configuration'];m=r['metrics']; lines.append(f"| {c['embedding_threshold']}/{c['embedding_margin']} | {c['planar_inliers']}/{c['planar_margin']} | {c['sculpture_inliers']}/{c['sculpture_margin']} | {c['runnerup_limit']}/{c['weak_conflict_limit']} | {m['correct_accept']}/{m['known_total']} | {m['precision']:.2%} | {m['wrong_artifact_accept']} | {m['negative_false_accept']} | {m['per_scenario']['known_clean']['correct_accept']}/91 | {m['per_scenario']['known_clutter']['correct_accept']}/345 |")
 lines += ['', 'The safe rows are in-sample exploratory candidates, not a production selection. 3-D affine improves retrieval coverage but does not prove identity under arbitrary viewpoint/occlusion.', '', 'No official labels, final results, Worker settings or catalog changed.']
 (out/'family-hybrid-summary.md').write_text('\n'.join(lines)+'\n',encoding='utf8')
 print(json.dumps({'configs':len(results),'safe':len(safe),'best':safe[0]['metrics'] if safe else None,'configuration':safe[0]['configuration'] if safe else None}))
if __name__=='__main__':main()
