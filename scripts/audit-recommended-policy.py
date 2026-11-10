"""Validate and report the recommended offline policy without deployment or provider calls."""
import hashlib
import json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]

def load(p):return json.loads(p.read_text(encoding='utf8'))
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def main():
 out=ROOT/'reports/recommended-policy-v1';policy=load(out/'policy.json');hybrid=load(ROOT/'reports/hybrid-conflict-study-v2/summary.json');
 e=next(x for x in hybrid['experiments'] if x['configuration']['name']=='candidate_union_both_vetoes')
 assert e['metrics']['correct_accept']==policy['offline_result']['correct_accepts']
 assert e['metrics']['wrong_artifact_accept']==0 and e['metrics']['negative_false_accept']==0
 assert e['metrics']['per_scenario']['ambiguous']['accepted']==0
 report={'policy_sha256':sha(out/'policy.json'),'source_sha256':sha(ROOT/'reports/hybrid-conflict-study-v2/summary.json'),'provider_calls':0,'final_scored':False,'production_changed':False,'verified':True,'metrics':e['metrics'],'reasons':e['reasons'],'notes':['Verification is arithmetic/provenance only. It does not approve deployment.','The 5.1% Wilson upper bound is an iid descriptive interval for 72 negatives, not a production guarantee.']}
 (out/'audit.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf8')
 lines=['# Recommended policy v1 — offline verification','',
 'Kết luận đề xuất: không dùng một scalar threshold. Dùng hybrid rule bảo thủ: embedding `max` 0.86/0.13 + local geometry 24 inliers, margin 20, runner-up <10; conflict/multi-target thì reject và gợi ý retake. Đây là recommendation, chưa deploy.','',
 '| Metric | Result |','|---|---:|',
 f"| Correct accepts | {e['metrics']['correct_accept']}/436 |",
 f"| Observed precision | {e['metrics']['precision']:.2%} |",
 f"| Wrong artifact accepts | {e['metrics']['wrong_artifact_accept']} |",
 f"| Out-of-catalog false accepts | {e['metrics']['per_scenario']['out_of_catalog']['accepted']}/33 |",
 f"| Ambiguous false accepts | {e['metrics']['per_scenario']['ambiguous']['accepted']}/7 |",
 f"| Low-quality false accepts | {e['metrics']['per_scenario']['low_quality']['accepted']}/32 |",
 f"| Known clean | {e['metrics']['per_scenario']['known_clean']['correct_accept']}/91 |",
 f"| Known clutter | {e['metrics']['per_scenario']['known_clutter']['correct_accept']}/345 |",'',
 '## Why not scalar-only?', '',
 '- Current online-style 0.8/0.05 diagnostic with 45 references accepted 276 correct known images but also 18 wrong-known and 14 negative rows.',
 '- Safer scalar-only 0.90/0.10 produced 77/436 correct accepts: too conservative for partial/occluded but recognizable targets.',
 '- The hybrid separates “target is visible but small” from “two artifacts conflict” better than cosine alone, but local geometry is not independent evidence and still needs production engineering.',
 '', '## Deployment status', '',
 'Not approved/deployed. Local code, references, catalog, Worker settings and online site remain unchanged.']
 (out/'summary.md').write_text('\n'.join(lines)+'\n',encoding='utf8')
 print(json.dumps({'verified':True,'correct_accepts':e['metrics']['correct_accept'],'provider_calls':0,'production_changed':False}))
if __name__=='__main__':main()
