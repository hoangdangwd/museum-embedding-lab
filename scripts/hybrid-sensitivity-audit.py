"""Post-hoc sensitivity audit of fixed hybrid candidate. Do not select a new policy."""
import importlib.util
from itertools import product
import json
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('hybrid',ROOT/'scripts/hybrid-conflict-study.py')
h=importlib.util.module_from_spec(spec);spec.loader.exec_module(h)


def variants(base):
    result=[]
    for minimum,margin,other,weak in product((20,24,28),(16,20,24),(8,10,12),(6,10,14)):
        result.append({'family':'geometry_neighborhood','configuration':{**base,'geometry_inliers':minimum,
                       'geometry_margin':margin,'other_artifact_limit':other,'weak_conflict_limit':weak}})
    for key,values in [('embedding_threshold',(.85,.87)),('embedding_margin',(.11,.15))]:
        for value in values:result.append({'family':key,'configuration':{**base,key:value}})
    return result


def run():
    output=ROOT/'reports/hybrid-sensitivity-v1';output.mkdir(exist_ok=False)
    study_path=ROOT/'reports/hybrid-conflict-study-v2/summary.json'
    study=h.load(study_path)
    base=next(e for e in study['experiments'] if e['configuration']['name']=='candidate_union_both_vetoes')
    plan={'post_hoc':True,'base':base['configuration'],'variants':variants(base['configuration']),
          'source_study_sha256':h.sha(study_path),'select_new_policy':False,'final_scored':False,'provider_calls':0,
          'purpose':'Expose sensitivity of apparent zero-error calibration result, not optimize to remove observed errors.'}
    (output/'plan.json').write_text(json.dumps(plan,indent=2)+'\n',encoding='utf-8')
    manifest_path=ROOT/'data/evaluation/full-calibration-manifest.json'
    cal_path=ROOT/'reports/evaluation-full-calibration-v1/calibration.json'
    geo_path=ROOT/'reports/local-feature-study-v3/rows.jsonl'
    provenance_path=ROOT/'reports/local-feature-study-v3/provenance.json'
    for key,path in [('manifest',manifest_path),('embedding',cal_path),('geometry',geo_path),('geometry_provenance',provenance_path)]:
        if h.sha(path)!=study['plan']['source_sha256'][key]:raise ValueError('Source study drift')
    rows=[json.loads(line) for line in geo_path.read_text(encoding='utf-8').splitlines()]
    expected,embedding,geometry=h.validate_inputs(h.load(manifest_path),h.load(cal_path),rows,h.load(provenance_path),h.sha(manifest_path))
    results=[];error_files={}
    for item in plan['variants']:
        e=h.evaluate(expected,embedding,geometry,item['configuration'])
        errors=[r for r in e['rows'] if r['accepted'] and r['outcome']!='correct_accept']
        for row in errors:
            if row['file'] not in error_files:error_files[row['file']]={'expected':row['expected'],'scenario':row['scenario'],'variant_count':0}
            error_files[row['file']]['variant_count']+=1
        results.append({**item,'metrics':e['metrics'],'paired_vs_base':h.pair(base,e),'error_files':[r['file'] for r in errors]})
    grouped={}
    for family in sorted({r['family'] for r in results}):
        subset=[r for r in results if r['family']==family]
        counts=[r['metrics']['correct_accept'] for r in subset]
        errors=[r['metrics']['wrong_artifact_accept']+r['metrics']['negative_false_accept'] for r in subset]
        grouped[family]={'variants':len(subset),'correct_accept_range':[min(counts),max(counts)],
                         'errors_range':[min(errors),max(errors)],'zero_observed_error_variants':sum(x==0 for x in errors)}
    report={'plan':plan,'base_metrics':base['metrics'],'families':grouped,'error_files':error_files,'variants':results}
    (output/'summary.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    lines=['# Post-hoc sensitivity: không chọn policy mới','',
           'Giữ labels/final/production nguyên trạng. 81 tổ hợp lân cận geometry + 4 thay đổi embedding một biến; không chọn cấu hình thắng từ kết quả này.','',
           '| Nhóm | Số thử | Correct accepts (min–max) | Errors (min–max) | Số thử không quan sát lỗi |',
           '|---|---:|---|---|---:|']
    for family,m in grouped.items():
        lines.append(f"| {family} | {m['variants']} | {m['correct_accept_range']} | {m['errors_range']} | {m['zero_observed_error_variants']} |")
    lines+=['','Các tổ hợp không phải mẫu thống kê độc lập, nên tỷ lệ tổ hợp không lỗi không phải độ tin cậy/coverage probability.',
            'Đây là cùng calibration đã xem nhiều lần; không chứng minh generalization. Full per-variant error files trong summary.json.']
    (output/'summary.md').write_text('\n'.join(lines)+'\n',encoding='utf-8')
    print(json.dumps(grouped,indent=2))


if __name__=='__main__':run()
