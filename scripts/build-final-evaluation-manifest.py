"""Build the cost-optimized final evaluation manifest after the pilot cache exists."""
from collections import Counter
from datetime import datetime, timezone
import json
from pathlib import Path


def main():
    repo = Path(__file__).resolve().parents[1]
    full = json.loads((repo / 'data/evaluation/manifest.json').read_text(encoding='utf-8'))
    pilot = json.loads((repo / 'data/evaluation/pilot-manifest.json').read_text(encoding='utf-8'))
    refs = [row for row in pilot['entries'] if row['partition'] == 'references']
    calibration = [row for row in pilot['entries'] if row['partition'] == 'calibration']
    final = [row for row in full['entries'] if row['partition'] == 'final']
    entries = refs + calibration + final
    if len(refs) != 45 or len(calibration) != 97 or len(final) != 183 or len(entries) != 325:
        raise ValueError('Final evaluation manifest counts drifted')
    if len({row['file'] for row in entries}) != len(entries) or len({row['sha256'] for row in entries}) != len(entries):
        raise ValueError('Final evaluation manifest contains duplicates')
    result = {
        **{key: full[key] for key in ('version', 'model', 'dimensions', 'pipeline', 'signature')},
        'evaluation_version': 'evaluation-cost-optimized-v1',
        'created_at': datetime.now(timezone.utc).isoformat(),
        'provider_calls': 0,
        'entries': entries,
        'selection': {
            'references': len(refs),
            'calibration': len(calibration),
            'final': len(final),
            'full_calibration_rows_deferred': 436 - 72,
            'final_is_cross_device_holdout': True,
        },
        'notes': [
            'Calibration uses 72 stratified positive rows plus 25 review-approved negative rows.',
            'The 183 final rows are not used to select thresholds.',
            'The deferred 364 positive calibration rows remain available for sensitivity analysis.',
        ],
    }
    path = repo / 'data/evaluation/cost-optimized-manifest.json'
    path.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'path': str(path), 'entries': len(entries), 'counts': dict(Counter(row['partition'] for row in entries))}, ensure_ascii=False))


if __name__ == '__main__':
    main()
