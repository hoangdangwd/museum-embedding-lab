import copy
import importlib.util
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / 'scripts/apply-approved-split.py'
spec = importlib.util.spec_from_file_location('apply_approved_split', SCRIPT)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ApplyApprovedSplitTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.candidate = json.loads((ROOT / 'reports/drive-split-candidate-v2.json').read_text(encoding='utf-8'))
        cls.draft = json.loads((ROOT / 'reports/drive-approved-split-proposal-v1/proposal.json').read_text(encoding='utf-8'))
        cls.draft_rows = json.loads((ROOT / 'reports/drive-approved-split-proposal-v1/candidates.json').read_text(encoding='utf-8'))
        cls.labels = json.loads((ROOT / 'reports/drive-review-approval-v3/labels-review-approved-v2.json').read_text(encoding='utf-8'))
        cls.holds = json.loads((ROOT / 'reports/drive-review-approval-v2/candidate-holds-approved.json').read_text(encoding='utf-8'))

    def apply(self, candidate=None, draft=None, draft_rows=None, labels=None, holds=None):
        return module.apply(candidate or copy.deepcopy(self.candidate), draft or copy.deepcopy(self.draft), draft_rows or copy.deepcopy(self.draft_rows), labels or copy.deepcopy(self.labels), holds or copy.deepcopy(self.holds))

    def test_partition_counts_and_scenarios_pending(self):
        rows, counts = self.apply()
        self.assertEqual(counts, {'references': 35, 'calibration': 436, 'final': 183})
        self.assertEqual(len(rows), 1632)
        self.assertEqual(sum(row['partition'] is None for row in rows), 978)
        self.assertEqual(sum(row['scenario'] is None for row in rows), 1632)
        self.assertEqual(sum(row['candidate_hold'] for row in rows), 128)
        self.assertEqual(sum(row['holdout_device_reserved'] for row in rows), 189)

    def test_holdout_and_hold_never_partitioned(self):
        rows, _ = self.apply()
        self.assertTrue(all(not row['holdout_device_reserved'] for row in rows if row['partition'] in ('references', 'calibration')))
        self.assertTrue(all(row['partition'] is None for row in rows if row['candidate_hold']))
        self.assertTrue(all(row['partition'] is None for row in rows if row['partition_status'] == 'excluded_from_official_split'))

    def test_review_only_labels_remain_separate(self):
        rows, _ = self.apply()
        known = [row for row in rows if row['review_approved_scenario'] == 'known_clutter']
        self.assertEqual(len(known), 60)
        self.assertTrue(all(row['approved_artifact_id'] is None or row['partition'] in ('references', 'calibration', 'final') for row in rows))
        self.assertTrue(all(row['scenario'] is None and row['review_approved_scenario'] is not None for row in rows if row['review_approved_scenario'] is not None))

    def test_source_objects_unchanged(self):
        candidate, draft, draft_rows, labels, holds = map(copy.deepcopy, (self.candidate, self.draft, self.draft_rows, self.labels, self.holds))
        self.apply(candidate, draft, draft_rows, labels, holds)
        self.assertEqual(candidate, self.candidate)
        self.assertEqual(draft, self.draft)
        self.assertEqual(draft_rows, self.draft_rows)
        self.assertEqual(labels, self.labels)
        self.assertEqual(holds, self.holds)

    def test_drift_is_rejected(self):
        for kind in ('official_source', 'draft_applied', 'hold', 'label_count', 'source'):
            candidate, draft, draft_rows, labels, holds = map(copy.deepcopy, (self.candidate, self.draft, self.draft_rows, self.labels, self.holds))
            if kind == 'official_source': candidate['entries'][0]['partition'] = 'references'
            if kind == 'draft_applied': draft['status'] = 'APPLIED'
            if kind == 'hold': holds['held_calibration_count'] = 127
            if kind == 'label_count': labels['approved_review_label_count'] = 131
            if kind == 'source': draft_rows[0]['source_sha256'] = 'wrong'
            with self.subTest(kind=kind), self.assertRaises(ValueError):
                self.apply(candidate, draft, draft_rows, labels, holds)


if __name__ == '__main__':
    unittest.main()
