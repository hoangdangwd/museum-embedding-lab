import importlib.util
import json
from collections import Counter
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / 'scripts/apply-approved-scenarios.py'
spec = importlib.util.spec_from_file_location('apply_approved_scenarios', SCRIPT)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ApplyApprovedScenariosTests(unittest.TestCase):
    def test_manifest_counts_and_policy(self):
        result, summary, verification, decisions = module.build(ROOT, ROOT / 'reports' / '_scenario-test-output')
        rows = result['entries']
        eligible = [r for r in rows if r['partition'] in ('calibration', 'final')]
        self.assertEqual(len(rows), 1632)
        self.assertEqual(len(decisions), 619)
        self.assertEqual(Counter(r['scenario'] for r in eligible), Counter({'known_clutter': 451, 'known_clean': 153, None: 15}))
        self.assertEqual(result['official_fields']['scenario_applied'], True)
        self.assertEqual(verification['holds_with_scenario'], 0)
        self.assertEqual(verification['excluded_or_reference_with_scenario'], 0)
        self.assertEqual(summary['provider_calls'], 0)
        self.assertEqual(summary['source_images_copied'], 0)

    def test_negative_review_rows_remain_unassigned(self):
        result, _, _, _ = module.build(ROOT, ROOT / 'reports' / '_scenario-test-output')
        rows = {r['review_id']: r for r in result['entries']}
        for review_id in ('R0163', 'R0400', 'R0401', 'R0421', 'R0422', 'R0619', 'R0620', 'R0621', 'R0622', 'R1516', 'R0517', 'R0518', 'R0519', 'R0520', 'R1632'):
            self.assertIsNone(rows[review_id]['scenario'])
            self.assertEqual(rows[review_id]['scenario_status'], 'owner_reviewed_excluded_negative')

    def test_traceability_fields_exist_for_assigned_rows(self):
        result, _, _, _ = module.build(ROOT, ROOT / 'reports' / '_scenario-test-output')
        for row in result['entries']:
            if row['scenario'] in ('known_clean', 'known_clutter'):
                self.assertTrue(row['scenario_review_version'])
                self.assertTrue(row['scenario_review_basis'])
                self.assertTrue(row['scenario_reason'])
                self.assertTrue(row['scenario_source_normalized_sha256'])
                self.assertEqual(row['scenario_provider_calls'], 0)


if __name__ == '__main__':
    unittest.main()
