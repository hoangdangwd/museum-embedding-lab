"""Describe evidence-state topology for the fixed hybrid ablation.
No policy selection, provider calls, final scoring, labels, or production writes.
"""
from collections import Counter, defaultdict
import hashlib
import json
from pathlib import Path
import sys

ROOT=Path(__file__).resolve().parents[1]

def load(path): return json.loads(path.read_text(encoding='utf-8'))
def sha(path): return hashlib.sha256(path.read_bytes()).hexdigest()

def state(row, policy):
    e_ok=row['embedding_score']>=policy['embedding_threshold'] and row['embedding_margin']>=policy['embedding_margin']
    g_ok=row['geometry_inliers']>=policy['geometry_inliers'] and row['geometry_margin']>=policy['geometry_margin']
    multi=policy['other_artifact_limit'] is not None and row['geometry_runnerup_inliers']>=policy['other_artifact_limit']
    ep,gp=row['embedding_predicted'],row['geometry_predicted']
    if multi: return 'multi_target_veto'
    if e_ok and g_ok and ep==gp: return 'both_agree'
    if e_ok and g_ok and ep!=gp: return 'strong_conflict'
    if e_ok and not g_ok: return 'embedding_only'
    if not e_ok and g_ok: return 'geometry_only'
    return 'neither'

def run(output):
    study=load(ROOT/'reports/hybrid-conflict-study-v2/summary.json')
    exp=next(e for e in study['experiments'] if e['configuration']['name']=='candidate_union_both_vetoes')
    policy=exp['configuration']; rows=exp['rows']
    source=ROOT/'reports/hybrid-conflict-study-v2/summary.json'
    if not source.exists(): raise ValueError('Missing source')
    output.mkdir(parents=True,exist_ok=False)
    states=Counter(state(r,policy) for r in rows)
    by_state=defaultdict(list)
    for r in rows: by_state[state(r,policy)].append(r)
    state_metrics={}
    for name,items in sorted(by_state.items()):
        state_metrics[name]={
            'total':len(items),
            'known':sum(r['scenario'].startswith('known_') for r in items),
            'accepted':sum(r['accepted'] for r in items),
            'correct_accept':sum(r['outcome']=='correct_accept' for r in items),
            'wrong_artifact_accept':sum(r['outcome']=='wrong_artifact_accept' for r in items),
            'negative_false_accept':sum(r['outcome']=='negative_false_accept' for r in items),
            'scenario_counts':dict(Counter(r['scenario'] for r in items)),
            'artifact_counts':dict(Counter(r['expected'] for r in items if r['scenario'].startswith('known_'))),
        }
    selected=[]
    # Keep all errors, plus deterministic examples from each state/artifact for offline review.
    for r in rows:
        if r['accepted'] and r['outcome']!='correct_accept': selected.append({'review_group':'error',**r})
    for name in sorted(by_state):
        candidates=sorted(by_state[name],key=lambda r:(r['scenario'],r['expected'],r['file']))
        for r in candidates[:3]: selected.append({'review_group':'state_example',**r})
    artifact_state={}
    for artifact in sorted({r['expected'] for r in rows if r['scenario'].startswith('known_')}):
        subset=[r for r in rows if r['expected']==artifact]
        artifact_state[artifact]={name:{'total':sum(state(r,policy)==name for r in subset),
                                        'accepted':sum(state(r,policy)==name and r['accepted'] for r in subset),
                                        'correct_accept':sum(state(r,policy)==name and r['outcome']=='correct_accept' for r in subset)} for name in sorted(states)}
    report={'version':'hybrid-conflict-topology-v1','source_sha256':sha(source),'policy':policy,
            'provider_calls':0,'final_scored':False,'labels_changed':False,'production_changed':False,
            'states':dict(states),'state_metrics':state_metrics,'artifact_state':artifact_state,
            'review_entries':selected,
            'interpretation':['State labels use only scores/predictions, never expected labels.',
                'multi_target_veto is a guard based on runner-up geometric inliers, not proof that exactly two artworks are visible.',
                'Geometry-only state can represent a correct target or a wrong target; it is not automatically a rescue.',
                'This topology is derived from previously inspected calibration and is not independent validation.']}
    (output/'topology.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    lines=['# Hybrid evidence topology — calibration only','',
           f"Policy: `{policy['name']}`; 508 calibration rows; no provider/final/production.",'',
           '| State | Rows | Known | Accepted | Correct accepts | Wrong-known accepts | Negative false accepts |',
           '|---|---:|---:|---:|---:|---:|---:|']
    for name,m in state_metrics.items():
        lines.append(f"| {name} | {m['total']} | {m['known']} | {m['accepted']} | {m['correct_accept']} | {m['wrong_artifact_accept']} | {m['negative_false_accept']} |")
    lines += ['', '## Interpretation', '',
              '- `both_agree` is the strongest-looking state but can still be wrong outside this sample.',
              '- `embedding_only` contains the cases saved by whole-image evidence when geometry is absent/weak; accepting them retains no local confirmation.',
              '- `geometry_only` contains local rescues; it must be reviewed separately because a local match can identify a different visible artwork.',
              '- `strong_conflict` means both branches pass their own gates but name different artifacts; it is rejection under the fixed hybrid rule.',
              '- `multi_target_veto` is a conservative guard and can reject correct clutter photos; it does not solve annotation semantics.',
              '', 'This is a descriptive audit, not a recommendation or production policy.']
    (output/'summary.md').write_text('\n'.join(lines)+'\n',encoding='utf-8')
    print(json.dumps({'states':dict(states),'review_entries':len(selected),'provider_calls':0}))

if __name__=='__main__':
    run(Path(sys.argv[1]) if len(sys.argv)>1 else ROOT/'reports/hybrid-conflict-topology-v1')
