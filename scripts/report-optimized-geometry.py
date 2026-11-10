"""Evaluate optimized family-specific geometry against cached embedding calibration.
All outputs are offline exploratory; no final/provider/production changes.
"""
import importlib.util,json,itertools,statistics
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('h',ROOT/'scripts/hybrid-conflict-study.py');h=importlib.util.module_from_spec(spec);spec.loader.exec_module(h)

def evaluate(expected,emb,geo,config):
 rows=[]
 for f,t in expected.items():
  e=emb[f];g=geo[f]['variants'][config['geometry_variant']];ep,gp=e['predicted'],g['predicted'];eok=e['score']>=config['embedding_threshold'] and e['margin']>=config['embedding_margin'];gok=gp is not None and g['score']>=config['geometry_inliers'] and g['margin']>=config['geometry_margin'];multi=g['ranking'][1]['score']>=config['runnerup_limit'];weak_conflict=gp is not None and gp!=ep and g['score']>=config['weak_conflict_limit']
  if multi:pred=None;accepted=False;reason='multi_target'
  elif eok and gok and ep!=gp:pred=None;accepted=False;reason='strong_conflict'
  elif eok and weak_conflict:pred=None;accepted=False;reason='weak_conflict'
  elif eok:pred=ep;accepted=True;reason='embedding_primary'
  elif gok:pred=gp;accepted=True;reason='geometry_rescue'
  else:pred=None;accepted=False;reason='insufficient'
  rows.append({'file':f,'expected':t['expected'],'scenario':t['scenario'],'predicted':pred,'score':int(accepted),'margin':1,'reason':reason,'embedding_score':e['score'],'embedding_margin':e['margin'],'embedding_predicted':ep,'geometry_predicted':gp,'geometry_inliers':g['score'],'geometry_margin':g['margin'],'geometry_runnerup':g['ranking'][1]['score']})
 summary,decisions=h.metrics_module.metrics(rows,{'threshold':1,'margin':1});return summary,decisions

def main():
 out=ROOT/'reports/optimized-geometry-study-v1';rows=[json.loads(x) for x in (out/'rows.jsonl').read_text(encoding='utf8').splitlines()];manifest=h.load(ROOT/'data/evaluation/full-calibration-manifest.json');cal=h.load(ROOT/'reports/evaluation-full-calibration-v1/calibration.json');expected={r['file']:r for r in manifest['entries'] if r['partition']=='calibration'};emb={r['file']:r for r in cal['rows']['max']};geo={r['file']:r for r in rows}
 if set(expected)!=set(geo) or set(expected)!=set(emb):raise ValueError('scope mismatch')
 for f in expected:
  if geo[f]['sha256']!=expected[f]['sha256'] or geo[f]['partition']!='calibration':raise ValueError('lineage mismatch')
 configs=[]
 for variant in ('planar','sculpture_affine','all_affine'):
  for et,em in ((.86,.13),(.86,.10),(.84,.10),(.82,.08),(.80,.05)):
   for mi,mm,runner,weak in itertools.product((12,16,20,24),(5,10,16,20),(8,10,12),(6,10)):
    configs.append({'name':f'{variant}-{et}-{em}-{mi}-{mm}-{runner}-{weak}','geometry_variant':variant,'embedding_threshold':et,'embedding_margin':em,'geometry_inliers':mi,'geometry_margin':mm,'runnerup_limit':runner,'weak_conflict_limit':weak})
 results=[]
 for c in configs:
  s,d=evaluate(expected,emb,geo,c);results.append({'configuration':c,'metrics':s,'reasons':{k:sum(r['reason']==k for r in d) for k in set(r['reason'] for r in d)},'rows':d})
 # Pareto and descriptive frontiers; no winner selected for deployment.
 safe=[r for r in results if r['metrics']['wrong_artifact_accept']==0 and r['metrics']['negative_false_accept']==0]
 safe=sorted(safe,key=lambda r:(r['metrics']['macro_recall'],r['metrics']['correct_accept']),reverse=True)
 precision98=[r for r in results if r['metrics']['precision'] is not None and r['metrics']['precision']>=.98]
 precision98=sorted(precision98,key=lambda r:(r['metrics']['macro_recall'],r['metrics']['correct_accept']),reverse=True)
 report={'version':'optimized-geometry-offline-report-v1','rows':len(rows),'provider_calls':0,'final_scored':False,'production_changed':False,'source_provenance':h.load(out/'provenance.json'),'counts':{'all_configs':len(results),'zero_observed_error_configs':len(safe)},'safe_frontier':safe[:30],'precision98_frontier':precision98[:30],'baseline_comparison':{'embedding_candidate':next(r for r in results if r['configuration']['geometry_variant']=='planar' and r['configuration']['embedding_threshold']==.86 and r['configuration']['embedding_margin']==.13 and r['configuration']['geometry_inliers']==24 and r['configuration']['geometry_margin']==20 and r['configuration']['runnerup_limit']==10 and r['configuration']['weak_conflict_limit']==6),'old_hybrid':h.load(ROOT/'reports/hybrid-conflict-study-v2/summary.json')['experiments'][5]}}
 (out/'report.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf8')
 lines=['# Optimized geometry — offline calibration report','', 'Family-specific experiment: planar artifacts use homography; Hoàng hậu/Phật Bà use affine; `all_affine` is a control. Embedding remains primary; geometry rescues/rejects conflicts. 508 calibration only; no final/provider/production.','',f"Tested **{len(results)}** fixed combinations; **{len(safe)}** had zero observed wrong-known/negative accepts. This is post-hoc exploratory, not an unseen-data guarantee.",'', '| Family model | Embedding | Geometry inliers/margin | Runner-up / weak conflict | Correct / 436 | Precision | Wrong-known | Negative FA | Macro recall |','|---|---|---|---|---:|---:|---:|---:|---:|']
 for label,arr in [('Best zero-error candidates',safe[:12]),('Best >=98% precision candidates',precision98[:12])]:
  lines += ['',f'## {label}']
  for r in arr:
   c=r['configuration'];m=r['metrics']; lines.append(f"| {c['geometry_variant']} | {c['embedding_threshold']}/{c['embedding_margin']} | {c['geometry_inliers']}/{c['geometry_margin']} | {c['runnerup_limit']}/{c['weak_conflict_limit']} | {m['correct_accept']}/{m['known_total']} | {m['precision']:.2%} | {m['wrong_artifact_accept']} | {m['negative_false_accept']} | {m['macro_recall']:.2%} |")
 lines += ['', '## Caveats','', '- The report intentionally does not promote the top row to production. The grid was run after repeated calibration inspection.', '- Affine is more suitable than planar homography for some 3-D views but can also accept accidental arrangements if too permissive.', '- Human-effort visibility labels are still unavailable; numbers cannot distinguish all “recognizable” from “requires guessing” cases.', '- Current Worker has not changed; these are local CPU diagnostics.']
 (out/'summary.md').write_text('\n'.join(lines)+'\n',encoding='utf8')
 print(json.dumps({'configs':len(results),'safe':len(safe),'best_safe':safe[0]['metrics'] if safe else None,'best_safe_config':safe[0]['configuration'] if safe else None}))
if __name__=='__main__':main()
