"""Audit cached evaluation results offline; never select a production policy or call providers."""
from collections import Counter
from datetime import datetime, timezone
import csv
import hashlib
import json
from math import sqrt
from pathlib import Path
import shutil


def load(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))


def config(row):
    return {key: row[key] for key in ('aggregation', 'threshold', 'margin')}


def wilson(k, n, z=1.96):
    if not n:
        return None
    p = k / n
    d = 1 + z*z/n
    center = (p + z*z/(2*n))/d
    spread = z*sqrt((p*(1-p)+z*z/(4*n))/n)/d
    return [max(0, center-spread), min(1, center+spread)]


def metrics(rows, selected):
    """Count all accepted negatives AND wrong-artifact positives as errors."""
    output = []
    for row in rows:
        accepted = row['margin'] is not None and row['score'] >= selected['threshold'] and row['margin'] >= selected['margin']
        known = row['scenario'].startswith('known_')
        correct = known and row['predicted'] == row['expected']
        outcome = ('correct_accept' if correct else 'wrong_artifact_accept' if known else 'negative_false_accept') if accepted else ('known_reject' if known else 'negative_reject')
        output.append({**row, 'accepted': accepted, 'correct_top1': correct, 'outcome': outcome})
    known = [r for r in output if r['scenario'].startswith('known_')]
    accepted = [r for r in output if r['accepted']]
    counts = Counter(r['outcome'] for r in output)
    artifacts = sorted({r['expected'] for r in known})
    per_artifact = {}
    for artifact in artifacts:
        subset = [r for r in known if r['expected'] == artifact]
        per_artifact[artifact] = {'total': len(subset), 'top1_correct': sum(r['correct_top1'] for r in subset),
                                  'correct_accept': sum(r['outcome'] == 'correct_accept' for r in subset)}
    per_scenario = {}
    for scenario in sorted({r['scenario'] for r in output}):
        subset = [r for r in output if r['scenario'] == scenario]
        per_scenario[scenario] = {'total': len(subset), 'accepted': sum(r['accepted'] for r in subset),
                                  'correct_accept': sum(r['outcome'] == 'correct_accept' for r in subset)}
    summary = {'total': len(output), 'known_total': len(known), 'accepted_total': len(accepted),
               'top1_correct': sum(r['correct_top1'] for r in known),
               'correct_accept': counts['correct_accept'], 'wrong_artifact_accept': counts['wrong_artifact_accept'],
               'negative_false_accept': counts['negative_false_accept'], 'known_reject': counts['known_reject'],
               'precision': counts['correct_accept']/len(accepted) if accepted else None,
               'recall': counts['correct_accept']/len(known) if known else None,
               'macro_recall': sum(v['correct_accept']/v['total'] for v in per_artifact.values())/len(artifacts) if artifacts else None,
               'precision_wilson95_iid_only': wilson(counts['correct_accept'], len(accepted)),
               'per_artifact': per_artifact, 'per_scenario': per_scenario}
    return summary, output


def audit_policy(calibration, selected):
    # Never use calibration['selected'] when reporting a different candidate.
    summary, rows = metrics(calibration['rows'][selected['aggregation']], selected)
    cell = next(x for x in calibration['grid'] if config(x) == config(selected))
    assert summary['correct_accept'] == cell['correct_acceptance_known']['count']
    assert summary['accepted_total'] == cell['accepted_precision']['total']
    return summary, rows


def frontier(calibration):
    """Illustrative empirical precision constraints, not owner-approved tolerances."""
    result = []
    for floor in (.95, .98, .99):
        eligible = [x for x in calibration['grid'] if (x['accepted_precision']['rate'] or 0) >= floor]
        if not eligible:
            continue
        def key(x):
            values = x['per_artifact'].values()
            macro = sum(v['accepted_correct']['rate'] for v in values)/len(x['per_artifact'])
            return macro, x['correct_acceptance_known']['count'], x['accepted_precision']['rate'], x['threshold'], x['margin']
        chosen = max(eligible, key=key)
        summary, _ = audit_policy(calibration, chosen)
        result.append({'empirical_precision_floor': floor, 'configuration': config(chosen), 'calibration': summary})
    return result


def main():
    repo = Path(__file__).resolve().parents[1]
    out = repo / 'reports/evaluation-full-calibration-v1'
    paths = {'calibration': out/'calibration.json', 'policy': out/'policy.json', 'final': out/'final-v2.json'}
    cal, policy, final = (load(paths[k]) for k in ('calibration', 'policy', 'final'))
    assert config(policy['selected']) == config(final['selected']), 'Policy/final configuration mismatch'
    calibration, cal_rows = audit_policy(cal, policy['selected'])
    final_summary, final_rows = metrics(final['rows'][final['selected']['aggregation']], final['selected'])
    assert final_summary['correct_accept'] == final['summary']['correct_acceptance_known']['count']
    cache = load(repo/'data/evaluation/full-calibration-embeddings.json')
    manifest = load(repo/'data/evaluation/full-calibration-manifest.json')
    for entry in manifest['entries']:
        vector = cache['vectors'].get(entry['sha256'])
        assert vector and len(vector) == manifest['dimensions'], 'Missing or invalid cached vector'
    candidates = frontier(cal)
    report = {
        'version': 'full-calibration-audit-v3', 'created_at': datetime.now(timezone.utc).isoformat(),
        'status': 'RESEARCH CANDIDATES ONLY; NO PRODUCTION POLICY APPROVED',
        'candidate_configuration': config(policy['selected']),
        'calibration': calibration, 'reused_final_diagnostic': final_summary,
        'calibration_only_operating_points': candidates,
        'corrections': [
            'Earlier v2 report incorrectly displayed calibration.selected (0.90/0.10) instead of policy.selected (0.86/0.13). Raw scores are unchanged.',
            'Ambiguous labels remain rejection targets. Two accepted ambiguous calibration images are errors, not uncertain annotations to discount.',
            'Final score sweeps occurred before v2 policy was written. This is a reused diagnostic set, NOT a new independent holdout test.',
            'A lower threshold is not automatically the best policy; tolerance for false collection additions has not been numerically approved.',
        ],
        'limitations': [
            'Calibration and final are same-session correlated; Wilson intervals assume independence and are descriptive only, not production guarantees.',
            'The precision constraints shown are fitted calibration rates, not guarantees on unseen images.',
            'Final contains zero out_of_catalog images; final unknown false acceptance is unmeasured.',
            'Image quality labels are preserved; no relabeling based on model scores has occurred.',
            'Local exact cosine search is not an end-to-end production Vectorize/integration test.',
        ],
        'cost': {
            'cached_vectors': len(cache['vectors']), 'cached_descriptions': len(cache.get('descriptions', {})),
            'manifest_required': len(manifest['entries']), 'new_provider_calls_this_audit': 0,
            'historical_account_usage_delta_full_extension_usd': 0.397089374,
            'exact_total_evaluation_cost_usd': None,
            'note': 'No pre-first-request billing snapshot or complete per-request usage journal exists. Previous $0.5447 total is not a verified total; account deltas may include unrelated usage.',
        },
        'source_hashes': {key: hashlib.sha256(path.read_bytes()).hexdigest() for key, path in paths.items()},
        'originals_changed': False, 'production_changed': False,
    }
    # Keep previous claims available for audit rather than silently erasing them.
    for name in ('summary.json', 'summary.md'):
        source = out/name
        backup = out/('pre-audit-'+name)
        if source.exists() and not backup.exists():
            shutil.copy2(source, backup)
    (out/'summary.json').write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    with (out/'calibration-decisions.csv').open('w', encoding='utf-8-sig', newline='') as stream:
        fields = ['file', 'scenario', 'expected', 'predicted', 'score', 'margin', 'accepted', 'outcome']
        writer = csv.DictWriter(stream, fieldnames=fields, extrasaction='ignore')
        writer.writeheader(); writer.writerows(cal_rows)
    lines = ['# Báo cáo kiểm toán calibration đầy đủ — v3', '',
             '**Trạng thái: nghiên cứu, chưa áp dụng production.**', '',
             '## Đính chính', '',
             '- Báo cáo v2 trước lấy nhầm số liệu calibration của cấu hình 0.90/0.10. Bản này tính lại trực tiếp từ từng score của đúng cấu hình 0.86/0.13.',
             '- `_ambiguous` vẫn là nhóm cần từ chối; 2/7 được accept là lỗi thực, không bỏ qua hay đổi nhãn.',
             '- Đã từng quét nhiều ngưỡng trên final trước khi viết policy v2. Không được gọi lần đánh giá lại này là kiểm thử độc lập chưa từng xem.',
             '- Tổng chi phí $0.5447 trước đây không đủ chứng từ để xác nhận. Cache không chứng minh số request thực tế hay phí retry.', '',
             '## Cấu hình đang kiểm toán: max / 0.86 / 0.13', '',
             f"- Calibration: {calibration['correct_accept']}/{calibration['known_total']} accept đúng; precision {calibration['precision']:.2%}; macro recall {calibration['macro_recall']:.2%}.",
             f"- Accept sai artifact trên positive: {calibration['wrong_artifact_accept']}; accept negative: {calibration['negative_false_accept']}.",
             f"- Final đã xem trước: {final_summary['correct_accept']}/{final_summary['known_total']} accept đúng, không phải bằng chứng kiểm định độc lập cho policy mới.", '',
             '## Các điểm vận hành tính từ calibration, không chọn theo final', '',
             'Các mức 95%/98%/99% dưới đây chỉ để so sánh trade-off, chưa phải dung sai lỗi được chủ dự án phê duyệt.', '',
             '| Cấu hình | Recall known | Macro recall | Precision | Sai artifact | FA unknown / ambiguous / low-quality |',
             '|---|---:|---:|---:|---:|---|']
    for candidate in candidates:
        c, s = candidate['configuration'], candidate['calibration']
        fa = ' / '.join(f"{s['per_scenario'][k]['accepted']}/{s['per_scenario'][k]['total']}" for k in ('out_of_catalog','ambiguous','low_quality'))
        lines.append(f"| {c['aggregation']} / {c['threshold']} / {c['margin']} | {s['correct_accept']}/{s['known_total']} ({s['recall']:.1%}) | {s['macro_recall']:.1%} | {s['precision']:.2%} | {s['wrong_artifact_accept']} | {fa} |")
    lines += ['', '## Giới hạn và kết luận', '',
              '- 508 calibration = 436 positive + 33 unknown + 7 ambiguous + 32 low-quality; 45 references giữ nguyên.',
              '- Calibration vẫn cùng buổi/burst. Không coi tăng số ảnh là tăng tương ứng số quan sát độc lập.',
              '- Không có unknown trong final. Precision trên tập này không đại diện đầy đủ ảnh ngoài danh mục.',
              '- Không chia vùng confidence, không sửa gameplay/UI, không yêu cầu ảnh thứ hai.',
              '- Chưa có cấu hình ngưỡng đơn giản nào được chứng minh vừa xác nhận phần lớn ảnh đúng vừa tránh thêm sai. Không tự triển khai policy chỉ vì tốt hơn baseline bảo thủ.',
              '- Nên rà lỗi calibration theo ảnh nguồn và thử cải thiện reference/ranking bằng cache trước; nhãn chỉ đổi sau review riêng, không đổi để làm đẹp số liệu.',
              '- Không gọi provider mới trong audit; không sửa originals, không seed/deploy. Cấu hình 45 reference chưa có trên production.',
              '- `calibration-decisions.csv` ghi từng quyết định, `summary.json` chứa số liệu đầy đủ.']
    (out/'summary.md').write_text('\n'.join(lines)+'\n', encoding='utf-8')
    print(json.dumps({'report': str(out/'summary.md'), 'calibration_correct_accept': calibration['correct_accept'],
                      'final_diagnostic_correct_accept': final_summary['correct_accept'], 'provider_calls': 0}))


if __name__ == '__main__':
    main()
