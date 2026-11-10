"""All-source visual authorization must not imply split/model/catalog authorization."""
import copy
import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('review_all_sources', ROOT / 'scripts/review-all-reference-sources.py')
review = importlib.util.module_from_spec(spec)
spec.loader.exec_module(review)


def entry(**changes):
    return {'review_id': 'R0001', 'kind': 'incoming', 'current_partition': 'final',
            'holdout_device_reserved': True, 'candidate_hold': True,
            'reference_selection_allowed_without_resplit': False,
            'current_artifact_id': None, 'source_sha256': 'a' * 64,
            'annotation': {'owner_approved': False, 'crop': None}, **changes}


class AllSourceReviewTests(unittest.TestCase):
    def test_requires_explicit_visual_authorization(self):
        with self.assertRaisesRegex(ValueError, 'Explicit all-source review authorization required'):
            review.inventory_all_sources([entry()])

    def test_prior_protected_metadata_is_not_a_visual_filter(self):
        for changes in ({'current_partition': 'final'}, {'current_partition': 'calibration'},
                        {'current_partition': 'references'}, {'current_partition': None},
                        {'holdout_device_reserved': True}, {'candidate_hold': True}):
            with self.subTest(changes=changes):
                result = review.inventory_all_sources([entry(**changes)], all_source_review_approved=True)
                self.assertEqual(len(result), 1)
                self.assertTrue(result[0]['visual_review_allowed'])
                self.assertTrue(result[0]['reference_proposal_allowed_after_visual_review'])
                self.assertTrue(result[0]['old_split_is_not_reference_selection_filter'])

    def test_does_not_grant_production_or_partition_approval(self):
        result = review.inventory_all_sources([entry()], all_source_review_approved=True)[0]
        self.assertFalse(result['production_approved'])
        self.assertFalse(result['new_partition_applied'])
        self.assertFalse(result['independent_evaluation_after_this_review'])
        self.assertFalse(result['annotation']['owner_approved'])
        self.assertIsNone(result['annotation']['crop'])
        self.assertNotIn('provider_budget_approved', result)

    def test_baselines_are_comparisons_not_new_reference_proposals(self):
        result = review.inventory_all_sources([entry(kind='baseline')], all_source_review_approved=True)[0]
        self.assertTrue(result['visual_review_allowed'])
        self.assertFalse(result['reference_proposal_allowed_after_visual_review'])

    def test_preserves_provenance_without_inventing_labels_or_mutating_input(self):
        source = entry(source_file='Khác/IMG_001.HEIC', captured_at='2026:11:05 10:00:00')
        before = copy.deepcopy(source)
        result = review.inventory_all_sources([source], all_source_review_approved=True)[0]
        self.assertEqual(source, before)
        for key, value in before.items():
            self.assertEqual(result[key], value)
        self.assertIsNone(result['current_artifact_id'])
        self.assertNotIn('proposed_role', result)

    def test_duplicate_ids_and_unknown_source_kinds_fail(self):
        with self.assertRaisesRegex(ValueError, 'Duplicate review ID'):
            review.inventory_all_sources([entry(), entry()], all_source_review_approved=True)
        with self.assertRaisesRegex(ValueError, 'Unknown source kind'):
            review.inventory_all_sources([entry(kind='remote')], all_source_review_approved=True)


if __name__ == '__main__':
    unittest.main()
