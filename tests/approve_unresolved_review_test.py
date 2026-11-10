import copy
import importlib.util
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / 'scripts/approve-unresolved-review.py'
spec = importlib.util.spec_from_file_location('approve_unresolved_review', SCRIPT)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ApproveUnresolvedReviewTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.proposal = json.loads((ROOT / 'reports/drive-unresolved-review-v1/proposal.json').read_text(encoding='utf-8'))
        cls.prior = json.loads((ROOT / 'reports/drive-review-approval-v2/labels-review-approved.json').read_text(encoding='utf-8'))
        cls.candidate = json.loads((ROOT / 'reports/drive-split-candidate-v2.json').read_text(encoding='utf-8'))
        cls.catalog = json.loads((ROOT / 'data/artifacts.json').read_text(encoding='utf-8'))

    def test_approval_is_cumulative_review_only(self):
        before = copy.deepcopy((self.proposal, self.prior, self.candidate))
        result = module.approve(self.proposal, self.prior, self.candidate, {row['id'] for row in self.catalog})
        self.assertEqual((self.proposal, self.prior, self.candidate), before)
        self.assertEqual(len(result['entries']), 139)
        self.assertEqual(result['approved_review_label_count'], 132)
        self.assertEqual(result['newly_approved_review_label_count'], 14)
        self.assertEqual(result['unresolved_count'], 7)
        self.assertEqual(result['review_label_counts'], {'_unknown': 33, '_low_quality': 32, 'known_clutter': 60, '_ambiguous': 7})
        self.assertFalse(result['official_partitions_applied'])
        self.assertFalse(result['official_labels_applied'])
        self.assertEqual(result['candidate_holds_unchanged'], 128)
        self.assertTrue(all(row['partition'] is None and row['scenario'] is None for row in result['entries']))

    def test_expected_unresolved_ids_remain_unapproved(self):
        result = module.approve(self.proposal, self.prior, self.candidate, {row['id'] for row in self.catalog})
        self.assertEqual(result['unresolved_ids'], ['R0865', 'R0868', 'R0869', 'R0873', 'R0981', 'R0983', 'R1083'])
        self.assertTrue(all(not row['owner_label_approved'] for row in result['entries'] if row['review_id'] in result['unresolved_ids']))

    def test_proposal_drift_is_rejected(self):
        for field in ('source_sha256', 'source_file', 'camera_model', 'holdout_device_reserved', 'large_preview_sha256'):
            proposal = copy.deepcopy(self.proposal)
            proposal['entries'][0][field] = 'drift' if isinstance(proposal['entries'][0][field], str) else not proposal['entries'][0][field]
            with self.subTest(field=field), self.assertRaises(ValueError):
                module.approve(proposal, self.prior, self.candidate, {row['id'] for row in self.catalog})

    def test_official_fields_and_scope_drift_are_rejected(self):
        for change in ('official', 'count', 'artifact', 'prior'):
            proposal = copy.deepcopy(self.proposal)
            prior = copy.deepcopy(self.prior)
            if change == 'official': self.candidate['entries'][0]['partition'] = 'calibration'
            if change == 'count': proposal['entries'][0]['proposed_scenario'] = '_ambiguous'
            if change == 'artifact': proposal['entries'][0]['proposed_artifact_id'] = 'stamp-giong'
            if change == 'prior': prior['entries'][0]['owner_label_approved'] = False
            with self.subTest(change=change), self.assertRaises(ValueError):
                module.approve(proposal, prior, self.candidate, {row['id'] for row in self.catalog})
            if change == 'official': self.candidate['entries'][0]['partition'] = None


if __name__ == '__main__':
    unittest.main()
