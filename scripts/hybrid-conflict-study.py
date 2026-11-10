"""Fixed-rule, offline ablation of embedding/geometry conflicts. No model calls or final reads.
Plan is persisted before scoring; no threshold sweep or production policy selection.
"""
import argparse
from collections import Counter
import csv
import hashlib
import importlib.util
import json
import math
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('audit_metrics',ROOT/'scripts/report-full-calibration-evaluation.py')
metrics_module=importlib.util.module_from_spec(spec);spec.loader.exec_module(metrics_module)


def policies():
    # Reuse previously inspected operating points; these are NOT preregistered before seeing this dataset.
    base={'embedding_threshold':.86,'embedding_margin':.13,'geometry_inliers':24,'geometry_margin':20,
          'other_artifact_limit':10,'weak_conflict_limit':None,'agreement_required':False}
    return [
        {'name':'embedding_candidate','kind':'embedding',**base},
        {'name':'embedding_strict','kind':'embedding',**base,'embedding_threshold':.90,'embedding_margin':.10},
        {'name':'geometry_conservative','kind':'geometry',**base},
        {'name':'candidate_union','kind':'hybrid',**base,'other_artifact_limit':None},
        {'name':'strict_union','kind':'hybrid',**base,'other_artifact_limit':None,'embedding_threshold':.90,'embedding_margin':.10},
        {'name':'candidate_union_multi_veto','kind':'hybrid',**base},
        {'name':'candidate_union_weak_conflict_veto','kind':'hybrid',**base,'other_artifact_limit':None,'weak_conflict_limit':6},
        {'name':'candidate_union_both_vetoes','kind':'hybrid',**base,'weak_conflict_limit':6},
        {'name':'strict_union_both_vetoes','kind':'hybrid',**base,'embedding_threshold':.90,'embedding_margin':.10,'weak_conflict_limit':6},
        {'name':'agreement_required','kind':'hybrid',**base,'agreement_required':True},
    ]


def decide(embedding, geometry, policy):
    """Only predictions/scores enter decisions. Expected label/scenario must never be used."""
    ep=embedding['predicted'];gp=geometry['predicted']
    ea=embedding['score']>=policy['embedding_threshold'] and embedding['margin'] is not None and embedding['margin']>=policy['embedding_margin']
    strong=gp is not None and geometry['score']>=policy['geometry_inliers'] and geometry['margin']>=policy['geometry_margin']
    multi=policy['other_artifact_limit'] is not None and geometry['ranking'][1]['score']>=policy['other_artifact_limit']
    def result(predicted,reason):return {'accepted':predicted is not None,'predicted':predicted,'reason':reason}
    if policy['kind']=='embedding':return result(ep,'embedding_accept') if ea else result(None,'embedding_reject')
    if multi:return result(None,'multiple_geometric_targets')
    if policy['kind']=='geometry':return result(gp,'geometry_accept') if strong else result(None,'geometry_reject')
    if ea:
        if strong and gp!=ep:return result(None,'strong_conflict')
        if policy['weak_conflict_limit'] is not None and gp is not None and geometry['score']>=policy['weak_conflict_limit'] and gp!=ep:
            return result(None,'weak_conflict')
        if policy['agreement_required'] and not (strong and gp==ep):return result(None,'missing_agreement')
        return result(ep,'embedding_accept')
    if strong:
        if policy['agreement_required'] and gp!=ep:return result(None,'missing_agreement')
        return result(gp,'geometry_rescue')
    return result(None,'insufficient_evidence')


def load(path):return json.loads(path.read_text(encoding='utf-8'))
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()


def validate_inputs(manifest, calibration, geometry_rows, provenance, manifest_hash):
    if calibration['partition']!='calibration' or calibration['signature']!=manifest['signature'] or provenance['manifest_sha256']!=manifest_hash:
        raise ValueError('Scope/signature drift')
    expected={r['file']:r for r in manifest['entries'] if r['partition']=='calibration'}
    erows=calibration['rows']['max'];embedding={r['file']:r for r in erows}
    geo={r['file']:r for r in geometry_rows}
    if len(expected)!=len(erows) or len(expected)!=len(geometry_rows) or set(expected)!=set(embedding) or set(expected)!=set(geo):
        raise ValueError('Missing/duplicate/unexpected calibration rows')
    for file,reference in expected.items():
        for row in (embedding[file],geo[file]):
            if any(row[k]!=reference[k] for k in ('expected','scenario')):raise ValueError('Label mismatch')
        if geo[file]['partition']!='calibration' or geo[file]['sha256']!=reference['sha256']:raise ValueError('Geometry image lineage mismatch')
        g=geo[file]['variants']['target_roi'];e=embedding[file]
        if len(g['ranking'])<2:raise ValueError('Need >=2 geometry candidates')
        values=[e['score'],e['margin'],g['score'],g['margin'],*[x['score'] for x in g['ranking']]]
        if any(x is None or not isinstance(x,(int,float)) or not math.isfinite(x) for x in values):raise ValueError('Non-finite score')
    return expected,embedding,geo


def evaluate(expected, embedding, geometry, policy):
    rows=[]
    for file,truth in sorted(expected.items()):
        g=geometry[file]['variants']['target_roi'];e=embedding[file]
        d=decide(e,g,policy)
        rows.append({'file':file,'expected':truth['expected'],'scenario':truth['scenario'],
                     'predicted':d['predicted'],'score':int(d['accepted']),'margin':1,'reason':d['reason'],
                     'embedding_predicted':e['predicted'],'embedding_score':e['score'],'embedding_margin':e['margin'],
                     'geometry_predicted':g['predicted'],'geometry_inliers':g['score'],'geometry_margin':g['margin'],
                     'geometry_runnerup_inliers':g['ranking'][1]['score']})
    summary,decisions=metrics_module.metrics(rows,{'threshold':1,'margin':1})
    # Rejected hybrid decisions have no target, so these are NOT retrieval top-1 metrics.
    summary.pop('top1_correct',None)
    for values in summary['per_artifact'].values():values.pop('top1_correct',None)
    for row in decisions:row['accepted_target_matches_label']=row.pop('correct_top1')
    return {'configuration':policy,'metrics':summary,'reasons':dict(Counter(r['reason'] for r in decisions)),
            'rows':decisions}


def pair(a,b):
    old={r['file'] for r in a['rows'] if r['outcome']=='correct_accept'}
    new={r['file'] for r in b['rows'] if r['outcome']=='correct_accept'}
    old_errors={r['file'] for r in a['rows'] if r['accepted'] and r['outcome']!='correct_accept'}
    new_errors={r['file'] for r in b['rows'] if r['accepted'] and r['outcome']!='correct_accept'}
    return {'new_correct':len(new-old),'lost_correct':len(old-new),'shared_correct':len(old&new),
            'new_error_files':sorted(new_errors-old_errors),'removed_error_files':sorted(old_errors-new_errors)}


def run(output):
    paths={'manifest':ROOT/'data/evaluation/full-calibration-manifest.json',
           'embedding':ROOT/'reports/evaluation-full-calibration-v1/calibration.json',
           'geometry':ROOT/'reports/local-feature-study-v3/rows.jsonl',
           'geometry_provenance':ROOT/'reports/local-feature-study-v3/provenance.json'}
    output.mkdir(parents=True,exist_ok=False)
    plan={'version':'hybrid-conflicts-fixed-ablation-v1','policies':policies(),
          'source_sha256':{k:sha(p) for k,p in paths.items()},'script_sha256':sha(Path(__file__)),
          'provider_calls':0,'final_scored':False,'production_changed':False,'label_changes':False,
          'notes':['Rules written before this run, but reuse prior calibration inspection; not a blind preregistration.',
                   'No threshold sweep or selection of one production winner. All ten ablations reported.',
                   'Inliers and embedding cosine are not calibrated probabilities. Two branches share references and images, not independent evidence.',
                   'A missing secondary match does not prove only one artifact is visible.']}
    (output/'plan.json').write_text(json.dumps(plan,indent=2)+'\n',encoding='utf-8')
    manifest=load(paths['manifest']);cal=load(paths['embedding'])
    grows=[json.loads(line) for line in paths['geometry'].read_text(encoding='utf-8').splitlines()]
    expected,embedding,geometry=validate_inputs(manifest,cal,grows,load(paths['geometry_provenance']),plan['source_sha256']['manifest'])
    experiments=[evaluate(expected,embedding,geometry,p) for p in plan['policies']]
    base=experiments[0]
    for e in experiments:
        e['paired_vs_embedding_candidate']=pair(base,e)
        with (output/(e['configuration']['name']+'-decisions.csv')).open('w',encoding='utf-8',newline='') as handle:
            writer=csv.DictWriter(handle,fieldnames=list(e['rows'][0]));writer.writeheader();writer.writerows(e['rows'])
    # Error/rejection evidence for every policy, rather than visual review of only winners.
    evidence=[]
    for e in experiments:
        for row in e['rows']:
            if row['reason'] in ('strong_conflict','weak_conflict','multiple_geometric_targets') or (row['accepted'] and row['outcome']!='correct_accept'):
                evidence.append({'policy':e['configuration']['name'],**row})
    (output/'conflicts-and-errors.json').write_text(json.dumps(evidence,indent=2)+'\n',encoding='utf-8')
    # Stage transitions isolate cost/benefit of guards without reoptimizing thresholds.
    by_name={e['configuration']['name']:e for e in experiments}
    ablations=[]
    for name in ('candidate_union_multi_veto','candidate_union_weak_conflict_veto','candidate_union_both_vetoes'):
        ablations.append({'from':'candidate_union','to':name,**pair(by_name['candidate_union'],by_name[name])})
    report={'plan':plan,'calibration_count':len(expected),'experiments':experiments,'guard_ablations':ablations}
    (output/'summary.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    lines=['# Kết hợp embedding + geometry: fixed-rule ablation','',
           'Chỉ dùng 508 calibration đã chấm. Không provider, không final, không đổi nhãn hoặc production. Không chọn ngưỡng mới bằng grid. Các tham số kế thừa nghiên cứu trước nên đây vẫn là exploratory, không kiểm định độc lập.','',
           '| Policy | Correct / 436 | Precision | Macro recall | Wrong-known | FA unknown / ambiguous / low-quality | Gains / losses vs candidate |',
           '|---|---:|---:|---:|---:|---|---|']
    for e in experiments:
        m=e['metrics'];p=e['paired_vs_embedding_candidate']
        fa=' / '.join(str(m['per_scenario'][s]['accepted'])+'/'+str(m['per_scenario'][s]['total']) for s in ('out_of_catalog','ambiguous','low_quality'))
        precision=f"{100*m['precision']:.2f}%" if m['precision'] is not None else '—'
        lines.append(f"| {e['configuration']['name']} | {m['correct_accept']}/{m['known_total']} | {precision} | {100*m['macro_recall']:.2f}% | {m['wrong_artifact_accept']} | {fa} | +{p['new_correct']} / −{p['lost_correct']} |")
    lines+=['','## Rules','',
        '- Embedding candidate: 0.86/0.13; embedding strict: 0.90/0.10. Neither is claimed to be current production.',
        '- Geometry: target-ROI, >=24 inliers and >=20 inlier margin. Geometry-only also requires runner-up <10.',
        '- Union: accept an eligible branch; reject if both are eligible but name different artifacts. No multi-target veto unless named.',
        '- Multi-veto: reject any query with >=10 valid runner-up inliers, including previously accepted embedding results.',
        '- Weak-conflict veto: before accepting embedding, reject a different geometry leader with >=6 valid inliers. Geometry rescues do not require low-score embedding agreement.',
        '- Agreement-required: both sources must name the same artifact and geometry must meet its threshold; does not require embedding threshold if geometry is strong. Multi-veto remains enabled.',
        '', '## Guard ablations',*['- '+json.dumps(a,ensure_ascii=False) for a in ablations],
        '', '## Limits','',
        'Same-session correlated photos, only 72 negatives, prior repeated calibration inspection. Zero observed errors is not zero population risk. A missing geometry match cannot establish absence of a second artwork. No class-specific thresholds or label edits were introduced.']
    (output/'summary.md').write_text('\n'.join(lines)+'\n',encoding='utf-8')
    print(json.dumps({'output':str(output),'calibration':len(expected),'policies':len(experiments),'provider_calls':0}))


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--output',type=Path,default=ROOT/'reports/hybrid-conflict-study-v2')
    args=parser.parse_args()
    if (ROOT/'reports').resolve() not in args.output.resolve().parents:raise ValueError('Output must be under reports/')
    run(args.output)
