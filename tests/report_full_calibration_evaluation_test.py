import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('report_full', Path(__file__).resolve().parents[1] / 'scripts/report-full-calibration-evaluation.py')
report = importlib.util.module_from_spec(spec)
spec.loader.exec_module(report)


def row(expected, predicted, scenario, score=.87, margin=.14):
    return {'file': expected + '.jpg', 'expected': expected, 'predicted': predicted,
            'scenario': scenario, 'score': score, 'margin': margin}


class EvaluationReportTests(unittest.TestCase):
    def setUp(self):
        self.selected = {'aggregation': 'max', 'threshold': .86, 'margin': .13}

    def test_counts_negative_and_wrong_artifact_accepts_as_errors(self):
        rows = [row('a', 'a', 'known_clean'), row('b', 'a', 'known_clutter'),
                row('_ambiguous', 'a', 'ambiguous'), row('_unknown', 'a', 'out_of_catalog', .5)]
        summary, decisions = report.metrics(rows, self.selected)
        self.assertEqual(summary['correct_accept'], 1)
        self.assertEqual(summary['wrong_artifact_accept'], 1)
        self.assertEqual(summary['negative_false_accept'], 1)
        self.assertEqual(summary['precision'], 1/3)
        self.assertEqual(decisions[2]['outcome'], 'negative_false_accept')

    def test_boundaries_and_missing_margin(self):
        rows = [row('a', 'a', 'known_clean', .86, .13),
                row('a', 'a', 'known_clean', .86, None),
                row('a', 'a', 'known_clean', .859, .2)]
        summary, _ = report.metrics(rows, self.selected)
        self.assertEqual(summary['correct_accept'], 1)
        self.assertEqual(summary['known_reject'], 2)

    def test_macro_not_micro_for_imbalanced_artifacts(self):
        rows = [row('a', 'a', 'known_clean')]*9 + [row('b', 'b', 'known_clutter', .5)]
        summary, _ = report.metrics(rows, self.selected)
        self.assertEqual(summary['recall'], .9)
        self.assertEqual(summary['macro_recall'], .5)

    def test_audit_uses_candidate_not_old_selected(self):
        rows = [row('a', 'a', 'known_clean')]
        calibration = {'selected': {'threshold': .9, 'correct_acceptance_known': {'count': 0}},
                       'rows': {'max': rows}, 'grid': [{**self.selected,
                           'correct_acceptance_known': {'count': 1}, 'accepted_precision': {'total': 1}}]}
        summary, _ = report.audit_policy(calibration, self.selected)
        self.assertEqual(summary['correct_accept'], 1)

    def test_inconsistent_saved_grid_rejected(self):
        calibration = {'rows': {'max': [row('a', 'a', 'known_clean')]},
                       'grid': [{**self.selected, 'correct_acceptance_known': {'count': 0},
                                 'accepted_precision': {'total': 1}}]}
        with self.assertRaises(AssertionError):
            report.audit_policy(calibration, self.selected)

    def test_empty_denominators_not_reported_as_perfect(self):
        summary, _ = report.metrics([row('_unknown', 'a', 'out_of_catalog', .5)], self.selected)
        self.assertIsNone(summary['precision'])
        self.assertIsNone(summary['recall'])
        self.assertIsNone(report.wilson(0, 0))
        self.assertGreater(report.wilson(0, 7)[1], .3)


if __name__ == '__main__':
    unittest.main()
