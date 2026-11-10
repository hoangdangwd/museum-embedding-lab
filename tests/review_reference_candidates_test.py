"""Safety boundary for offline reference screening; no source images or network required."""
import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('reference_review', ROOT / 'scripts/review-reference-candidates.py')
review = importlib.util.module_from_spec(spec)
spec.loader.exec_module(review)


def row(**overrides):
    return {
        'review_id': 'R0001', 'kind': 'incoming', 'current_partition': None,
        'holdout_device_reserved': False, 'candidate_hold': False,
        'reference_selection_allowed_without_resplit': True, **overrides,
    }


class ReferenceEligibilityTests(unittest.TestCase):
    def test_all_protected_states_override_permission_flag(self):
        for overrides in [
            {'current_partition': 'calibration'}, {'current_partition': 'final'},
            {'holdout_device_reserved': True}, {'candidate_hold': True},
            {'reference_selection_allowed_without_resplit': False},
        ]:
            with self.subTest(overrides=overrides):
                self.assertFalse(review.eligibility(row(**overrides))[0])

    def test_baseline_and_reference_candidates_stay_proposals(self):
        self.assertEqual(review.eligibility(row()), (True, 'offline_review_only_not_approved'))
        self.assertEqual(review.eligibility(row(current_partition='references')),
                         (True, 'offline_review_only_not_approved'))
        self.assertEqual(review.eligibility(row(kind='baseline', current_partition='references')),
                         (True, 'baseline_retention'))

    def test_unknown_permission_is_not_permission(self):
        r = row()
        del r['reference_selection_allowed_without_resplit']
        self.assertFalse(review.eligibility(r)[0])

    def test_duplicate_ids_rejected_before_preview_access(self):
        with self.assertRaisesRegex(ValueError, 'Duplicate review ID'):
            review.build_inventory([row(), row()])

    def test_build_preserves_metadata_without_inventing_labels(self):
        r = row(source_file='Khác 2/IMG_0001.HEIC', current_artifact_id=None,
                annotation={'owner_approved': False, 'crop': None})
        before = dict(r)
        result = review.build_inventory([r])[0]
        self.assertEqual(r, before)
        self.assertIsNone(result['current_artifact_id'])
        self.assertEqual(result['annotation'], {'owner_approved': False, 'crop': None})
        self.assertTrue(result['review_eligible'])
        self.assertNotIn('proposed_role', result)


if __name__ == '__main__':
    unittest.main()
