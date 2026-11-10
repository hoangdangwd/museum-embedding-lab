"""Produce a reproducible, detailed offline evaluation report from evaluation JSON files."""
from datetime import datetime, timezone
import json
from math import sqrt
from pathlib import Path


def load(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))


def wilson(k, n, z=1.96):
    if not n:
        return None
    p = k / n
    d = 1 + z * z / n
    center = (p + z * z / (2 * n)) / d
    spread = z * sqrt((p * (1 - p) + z * z / (4 * n)) / n) / d
    return {'rate': p, 'low95': max(0, center - spread), 'high95': min(1, center + spread)}


def metric(count, total):
    return {'count': count, 'total': total, 'wilson95': wilson(count, total)}


def enrich(summary):
    return {
        'top1_accuracy_known': metric(summary['top1_accuracy_known']['count'], summary['top1_accuracy_known']['total']),
        'accepted_correct_known': metric(summary['correct_acceptance_known']['count'], summary['correct_acceptance_known']['total']),
        'accepted_precision': metric(summary['accepted_precision']['count'], summary['accepted_precision']['total']),
        'false_acceptance_unknown': metric(summary['false_acceptance_unknown']['count'], summary['false_acceptance_unknown']['total']),
        'false_acceptance_ambiguous': metric(summary['false_acceptance_ambiguous']['count'], summary['false_acceptance_ambiguous']['total']),
        'false_acceptance_low_quality': metric(summary['false_acceptance_low_quality']['count'], summary['false_acceptance_low_quality']['total']),
        'rejection': metric(summary['rejection']['count'], summary['rejection']['total']),
    }


def main():
    repo = Path(__file__).resolve().parents[1]
    pilot_manifest = load(repo / 'data/evaluation/pilot-manifest.json')
    optimized_manifest = load(repo / 'data/evaluation/cost-optimized-manifest.json')
    pilot_cal = load(repo / 'reports/eval-cost-plan-v1/pilot-calibration.json')
    final = load(repo / 'reports/evaluation-final.json')
    baseline_cal = load(repo / 'reports/eval-cost-plan-v1/baseline-calibration.json')
    baseline_final = load(repo / 'reports/eval-cost-plan-v1/baseline-final.json')
    cache = load(repo / 'data/evaluation/cost-optimized-embeddings.json')

    final_rows = final['rows'][final['selected']['aggregation']]
    wrong = [
        {'file': row['file'], 'expected': row['expected'], 'predicted': row['predicted'], 'score': row['score'], 'margin': row['margin']}
        for row in final_rows if row['scenario'].startswith('known_') and row['predicted'] != row['expected']
    ]
    accepted = [
        {'file': row['file'], 'expected': row['expected'], 'predicted': row['predicted'], 'score': row['score'], 'margin': row['margin']}
        for row in final_rows if row.get('accepted')
    ]
    report = {
        'version': 'evaluation-cost-optimized-report-v1',
        'created_at': datetime.now(timezone.utc).isoformat(),
        'provider': {
            'model': optimized_manifest['model'],
            'description_model': optimized_manifest['pipeline']['description_model'],
            'pipeline_signature': optimized_manifest['signature'],
            'unique_images_embedded': len(cache['vectors']),
            'descriptions_cached': len(cache.get('descriptions', {})),
            'timings_cached': len(cache.get('timings', {})),
            'provider_calls_after_resume': 'one description and one embedding request per unique image; cache prevented repeats',
        },
        'data': {
            'pilot_entries': len(pilot_manifest['entries']),
            'optimized_entries': len(optimized_manifest['entries']),
            'references': 45,
            'positive_calibration': 72,
            'negative_calibration_unknown': 18,
            'negative_calibration_ambiguous': 7,
            'final_entries': 183,
            'deferred_positive_calibration': 364,
            'final_holdout_device': '22041216G',
        },
        'calibration_expanded_references': {
            'selected': pilot_cal['selected'],
            'metrics_with_95_percent_wilson': enrich(pilot_cal['selected']),
            'interpretation': 'Pilot threshold has zero false accepts on this negative slice but low acceptance of known positives; it is conservative and uncertain because the calibration sample is small and correlated.',
        },
        'calibration_baseline_references': {
            'selected': baseline_cal['selected'],
            'metrics_with_95_percent_wilson': enrich(baseline_cal['selected']),
        },
        'final_expanded_references': {
            'selected': final['selected'],
            'summary': final['summary'],
            'metrics_with_95_percent_wilson': enrich(final['summary']),
            'wrong_known_predictions': wrong,
            'accepted_rows': accepted,
        },
        'final_baseline_threshold_comparison': {
            'selected': baseline_final['selected'],
            'summary': baseline_final['summary'],
            'metrics_with_95_percent_wilson': enrich(baseline_final['summary']),
            'interpretation': 'This is a diagnostic comparison on the same final holdout, not a second independent final test. Its threshold was selected from the baseline-reference calibration view.',
        },
        'limitations': [
            'Calibration positive rows come from the same museum session and are not independent capture sessions.',
            'Negative calibration contains unknown and ambiguous rows but no low_quality rows; low_quality rejection is reported only on final.',
            'The final holdout has 168 known rows plus 15 negative rows; it has no out_of_catalog rows because the 18 out_of_catalog rows were deliberately kept out of final.',
            'The final threshold was frozen from calibration before final scores were inspected; no threshold tuning was performed on final.',
            'The small pilot calibration sample produces wide confidence intervals; results should not be interpreted as production accuracy guarantees.',
            'No production catalog or deployment was changed by this evaluation.',
        ],
        'cost_audit': {
            'theoretical_max_requests': 325 * 2,
            'cache_vectors': len(cache['vectors']),
            'cache_descriptions': len(cache.get('descriptions', {})),
            'note': 'Provider dashboard usage should be used as the billing authority. The local runner does not persist per-request usage fields.',
        },
    }
    out = repo / 'reports/evaluation-cost-optimized-v1'
    out.mkdir(parents=True, exist_ok=True)
    (out / 'summary.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    md = []
    md.append('# Báo cáo đánh giá recognition — cost-optimized v1\n')
    md.append(f"- Thời điểm: `{report['created_at']}`\n- Pipeline: `{report['provider']['pipeline_signature']}`\n- Không seed catalog/deploy production.\n")
    md.append('## Phạm vi và chi phí kỹ thuật\n')
    md.append('- 45 reference; 72 calibration positive; 18 `_unknown`; 7 `_ambiguous`; 183 final cross-device.')
    md.append('- 325 ảnh duy nhất được embedding; cache có 325 description và 325 vector; tối đa 650 request provider.')
    md.append('- 364 positive calibration còn lại được giữ lại, chưa gọi model.\n')
    md.append('## Calibration pilot với 45 reference\n')
    s = pilot_cal['selected']; md.append(f"- Selected: `{s['aggregation']}`, threshold `{s['threshold']}`, margin `{s['margin']}`.")
    md.append(f"- Top-1 known: **{s['top1_accuracy_known']['count']}/{s['top1_accuracy_known']['total']}**; accepted correct: **{s['correct_acceptance_known']['count']}/{s['correct_acceptance_known']['total']}**; accepted precision: **{s['accepted_precision']['count']}/{s['accepted_precision']['total']}**.")
    md.append(f"- False acceptance: unknown **{s['false_acceptance_unknown']['count']}/{s['false_acceptance_unknown']['total']}**, ambiguous **{s['false_acceptance_ambiguous']['count']}/{s['false_acceptance_ambiguous']['total']}**.")
    md.append('- Diễn giải: threshold rất bảo thủ; zero false accept trên slice nhỏ không chứng minh zero false accept ngoài mẫu.\n')
    md.append('## Final 183 ảnh với 45 reference\n')
    s = final['summary']; md.append(f"- Top-1 known: **{s['top1_accuracy_known']['count']}/{s['top1_accuracy_known']['total']} = {s['top1_accuracy_known']['rate']:.1%}**.")
    md.append(f"- Được accept đúng: **{s['correct_acceptance_known']['count']}/{s['correct_acceptance_known']['total']} = {s['correct_acceptance_known']['rate']:.1%}**.")
    md.append(f"- Precision trong các accept: **{s['accepted_precision']['count']}/{s['accepted_precision']['total']} = {s['accepted_precision']['rate']:.1%}**.")
    md.append(f"- Rejection: **{s['rejection']['count']}/{s['rejection']['total']} = {s['rejection']['rate']:.1%}**.")
    md.append('- Final negative: ambiguous **0/5** false accept; low-quality **0/10** false accept; out-of-catalog không có trong final.')
    md.append(f"- Sai top-1 known: `{len(wrong)}` ảnh; chi tiết được lưu trong `summary.json`.\n")
    md.append('## Kết luận kỹ thuật\n')
    md.append('- Hệ thống nhận diện top-1 khá tốt trên known final, nhưng threshold hiện tại từ pilot quá bảo thủ: chỉ accept 18/168 known final.')
    md.append('- Không được đưa threshold hoặc 45 reference lên production dựa trên báo cáo này; cần owner review và có thể cần mở rộng calibration hoặc điều chỉnh mục tiêu false-accept/coverage.')
    md.append('- Kết quả final đã được giữ độc lập khỏi bước chọn threshold; đây là kết quả đánh giá, không phải tuning lại.\n')
    (out / 'summary.md').write_text('\n'.join(md) + '\n', encoding='utf-8')
    print(json.dumps({'summary_json': str(out / 'summary.json'), 'summary_md': str(out / 'summary.md')}, ensure_ascii=False))


if __name__ == '__main__':
    main()
