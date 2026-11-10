"""Audit the approved visibility semantics against cached offline metrics.
This does not infer human visibility labels and does not change production.
"""
import hashlib
import json
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]

def load(path):return json.loads(path.read_text(encoding='utf8'))
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()

def main():
    out=ROOT/'reports/visibility-policy-v2';out.mkdir(exist_ok=True)
    policy_path=out/'policy.json'; policy=load(policy_path)
    hybrid_path=ROOT/'reports/hybrid-conflict-study-v2/summary.json';hybrid=load(hybrid_path)
    local_path=ROOT/'reports/local-feature-study-v3/summary.json';local=load(local_path)
    cal_path=ROOT/'reports/evaluation-full-calibration-v1/calibration.json';cal=load(cal_path)
    current_rows=cal['rows']['max'];current_accept=[r for r in current_rows if r['score']>=.8 and r['margin']>=.05]
    embedding_candidate=next(e for e in hybrid['experiments'] if e['configuration']['name']=='embedding_candidate')
    hybrid_candidate=next(e for e in hybrid['experiments'] if e['configuration']['name']=='candidate_union_both_vetoes')
    geometry_candidate=next(e for e in hybrid['experiments'] if e['configuration']['name']=='geometry_conservative')
    # Visibility categories are deliberately unknown: no official per-image human-effort labels exist.
    report={
      'version':'visibility-policy-audit-v2',
      'policy_sha256':sha(policy_path),
      'sources':{'policy':str(policy_path.relative_to(ROOT)),'hybrid':sha(hybrid_path),'local':sha(local_path),'calibration':sha(cal_path)},
      'provider_calls':0,'final_scored':False,'production_changed':False,'official_labels_changed':False,
      'semantics':policy,
      'human_visibility_labels_available':False,
      'visibility_category_counts':None,
      'cached_operating_points':{
        'online_config_offline_45_reference_diagnostic':{
          'threshold':.8,'margin':.05,'accepted_total':len(current_accept),
          'known_correct':sum(r['scenario'].startswith('known_') and r['predicted']==r['expected'] for r in current_accept),
          'wrong_known':sum(r['scenario'].startswith('known_') and r['predicted']!=r['expected'] for r in current_accept),
          'negative_false_accept':sum(not r['scenario'].startswith('known_') for r in current_accept),
          'warning':'Not end-to-end production: 45 references offline, whereas online has 10.'},
        'embedding_candidate':embedding_candidate['metrics'],
        'geometry_conservative':geometry_candidate['metrics'],
        'hybrid_candidate':hybrid_candidate['metrics'],
      },
      'interpretation':[
        'The owner-approved semantic rule is now explicit: multi-target and too-small/too-blurry images may be rejected with retake guidance; a partial/occluded single target may be accepted when an ordinary viewer can identify it without substantial effort and no competing target is supported.',
        'The existing manifests do not contain human-effort visibility labels, so no recall/precision number for small, blurry, occluded or partial classes can be claimed yet.',
        'Local geometry 12-23 inliers is a borderline research range; 24/20 with runner-up below 10 is a stronger research gate, not an approved numeric production threshold.',
        'The current online 0.8/0.05 setting is too permissive in this offline diagnostic (wrong-known and negative accepts observed) and must not be treated as evidence that the new semantics are already implemented.',
        'Retake is a recovery action for rejection, not a confidence tier or a mandatory second image for every query.'
      ],
      'next_gate':'Create a review-only human-visibility annotation queue for calibration clutter/low-quality/ambiguous examples, then use those labels to test the semantic rule without changing official labels or production.'
    }
    (out/'audit.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
    lines=['# Visibility semantics v2 — offline audit','',
      'Semantics approved by owner for research: multi-target and too-small/too-blurry may be rejected with retake guidance; partial/occluded single target may be accepted when an ordinary viewer can identify it without substantial effort and no competing target is supported. No runtime or official label changes.','',
      '| Offline diagnostic | Correct known accepts | Wrong-known accepts | Negative false accepts | Note |','|---|---:|---:|---:|---|']
    for name,key,note in [('Online config 0.8/0.05 (45-ref diagnostic)','online_config_offline_45_reference_diagnostic','Not end-to-end online'),('Embedding candidate','embedding_candidate','45 refs; candidate only'),('Geometry conservative','geometry_conservative','SIFT research'),('Hybrid candidate','hybrid_candidate','fixed conflict/retake candidate')]:
      m=report['cached_operating_points'][key]
      lines.append(f"| {name} | {m.get('known_correct',m.get('correct_accept'))} | {m.get('wrong_known',m.get('wrong_artifact_accept'))} | {m.get('negative_false_accept')} | {note} |")
    lines += ['', '## Visibility labels', '', 'The current dataset has no approved human-effort labels for `small`, `blurry`, `occluded`, `partial_recognizable` or `too_difficult`. Therefore the report does not claim a numeric acceptance rate for those categories.', '', '## Numeric reading', '', '- Embedding cosine and local inlier counts are different scales.', '- Local 12–23 inliers is borderline in the reviewed clutter examples.', '- Local >=24 inliers, margin >=20, runner-up <10 is stronger evidence but is not production-approved and under-covers some artifact classes.', '- A retake recommendation should be attached to rejection handling, not represented as a third business outcome.', '', '## Next gate', '', report['next_gate']]
    (out/'summary.md').write_text('\n'.join(lines)+'\n',encoding='utf8')
    print(json.dumps({'output':str(out),'provider_calls':0,'human_visibility_labels_available':False}))
if __name__=='__main__':main()
