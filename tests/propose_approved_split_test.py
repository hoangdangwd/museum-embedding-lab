import copy
import importlib.util
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / 'scripts/propose-approved-split.py'
spec = importlib.util.spec_from_file_location('propose_approved_split', SCRIPT)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ApprovedSplitProposalTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.candidate = json.loads((ROOT / 'reports/drive-split-candidate-v2.json').read_text(encoding='utf-8'))
        cls.labels = json.loads((ROOT / 'reports/drive-review-approval-v3/labels-review-approved-v2.json').read_text(encoding='utf-8'))
        cls.holds = json.loads((ROOT / 'reports/drive-review-approval-v2/candidate-holds-approved.json').read_text(encoding='utf-8'))
        cls.catalog = json.loads((ROOT / 'data/artifacts.json').read_text(encoding='utf-8'))

    def build(self, candidate=None, labels=None, holds=None):
        return module.make_draft(candidate or copy.deepcopy(self.candidate), labels or copy.deepcopy(self.labels), holds or copy.deepcopy(self.holds), self.catalog)

    def test_draft_counts_and_official_fields_are_null(self):
        rows, roles, eligibility = self.build()
        self.assertEqual(len(rows), 1632)
        self.assertEqual(roles, {'reference_candidate': 35, 'calibration_candidate': 564, 'final_candidate_cross_device': 183, 'manual_review': 850})
        self.assertEqual(sum(row['candidate_hold'] for row in rows), 128)
        self.assertEqual(sum(row['draft_eligibility'] == 'eligible_candidate_pending_owner_approval' for row in rows), 436)
        self.assertEqual(sum(row['review_approved_scenario'] is not None for row in rows), 132)
        self.assertEqual(sum(row['review_approved_scenario'] is None for row in rows if row['review_approved_scenario'] is not None), 0)
        self.assertTrue(all(row['official_partition'] is None and row['official_scenario'] is None and row['official_artifact_id'] is None for row in rows))

    def test_holdout_and_manual_scope(self):
        rows, _, _ = self.build()
        self.assertEqual(sum(row['holdout_device_reserved'] for row in rows), 189)
        self.assertTrue(all(not row['holdout_device_reserved'] for row in rows if row['draft_role'] in ('reference_candidate', 'calibration_candidate')))
        manual = [row for row in rows if row['draft_role'] == 'manual_review']
        self.assertEqual(len(manual), 850)
        self.assertEqual(sum(row['review_approved_scenario'] is not None for row in manual), 132)
        self.assertEqual(sum(row['review_approved_scenario'] is None for row in manual), 718)

    def test_input_objects_unchanged(self):
        candidate, labels, holds = copy.deepcopy(self.candidate), copy.deepcopy(self.labels), copy.deepcopy(self.holds)
        self.build(candidate, labels, holds)
        self.assertEqual(candidate, self.candidate)
        self.assertEqual(labels, self.labels)
        self.assertEqual(holds, self.holds)

    def test_scope_drift_rejected(self):
        for name in ('candidate_action', 'hold', 'approved_label', 'official'):
            candidate, labels, holds = copy.deepcopy(self.candidate), copy.deepcopy(self.labels), copy.deepcopy(self.holds)
            if name == 'candidate_action': candidate['entries'][0]['action'] = 'manual_review_negative_or_target'
            if name == 'hold': holds['held_calibration_ids'].append('R0002')
            if name == 'approved_label': labels['approved_review_label_count'] = 131
            if name == 'official': candidate['entries'][0]['partition'] = 'reference'
            with self.subTest(name=name), self.assertRaises(ValueError):
                self.build(candidate, labels, holds)


if __name__ == '__main__':
    unittest.main()
