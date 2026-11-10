import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('review_followup', Path(__file__).resolve().parents[1] / 'scripts/review-followup.py')
review = importlib.util.module_from_spec(spec)
spec.loader.exec_module(review)


class FollowupTests(unittest.TestCase):
    def fixture(self):
        image = {'kind': 'incoming', 'review_id': 'R0623', 'source_file': 'Khác 2/a.HEIC', 'source_folder': 'Khác 2',
                 'source_sha256': 'a' * 64, 'camera_model': 'iPhone XR', 'captured_at': '2026:11:05 10:00:00',
                 'capture_bucket_hint': 'not_an_independent_group', 'preview': 'previews/a.jpg'}
        candidate = {**image, 'holdout_device_reserved': False}
        observations = {'visible_targets': [], 'unresolved': [], 'quality_or_label_issues': []}
        return [image], observations, [candidate]

    def test_id_ranges_and_reject_invalid(self):
        self.assertEqual(review.expand_ids('R0623-R0625 R0630'), ['R0623', 'R0624', 'R0625', 'R0630'])
        for value in ['R0625-R0623', 'R1', '../image', 'R0623 R0623']:
            with self.assertRaises(ValueError):
                review.expand_ids(value)

    def test_no_target_preview_is_not_unknown_or_approved(self):
        row = review.screen_entries(*self.fixture())[0]
        self.assertEqual(row['screening_category'], 'no_target_seen_on_preview')
        self.assertIsNone(row['approved_artifact_id'])
        self.assertIsNone(row['approved_scenario'])
        self.assertIsNone(row['partition'])
        self.assertFalse(row['owner_label_approved'])

    def test_visible_target_remains_proposal(self):
        images, observations, candidates = self.fixture()
        observations['visible_targets'] = [{'ids': 'R0623', 'artifact': 'stamp-giong', 'note': 'Visible partial target'}]
        row = review.screen_entries(images, observations, candidates)[0]
        self.assertEqual(row['proposed_artifact_id'], 'stamp-giong')
        self.assertTrue(row['needs_larger_review'])
        self.assertIsNone(row['approved_scenario'])

    def test_holdout_protection_inherited(self):
        images, observations, candidates = self.fixture()
        images[0]['camera_model'] = candidates[0]['camera_model'] = '22041216G'
        candidates[0]['holdout_device_reserved'] = True
        self.assertTrue(review.screen_entries(images, observations, candidates)[0]['holdout_device_reserved'])

    def test_observations_cannot_conflict_or_escape_scope(self):
        for ids in ['R0001', 'R0623 R0623']:
            images, observations, candidates = self.fixture()
            observations['unresolved'] = [{'ids': ids}]
            with self.assertRaises(ValueError):
                review.screen_entries(images, observations, candidates)
        images, observations, candidates = self.fixture()
        observations['visible_targets'] = [{'ids': 'R0623'}]
        observations['unresolved'] = [{'ids': 'R0623'}]
        with self.assertRaises(ValueError):
            review.screen_entries(images, observations, candidates)

    def test_source_hash_drift_rejected(self):
        images, observations, candidates = self.fixture()
        candidates[0]['source_sha256'] = 'b' * 64
        with self.assertRaises(ValueError):
            review.screen_entries(images, observations, candidates)

    def test_burst_actions_not_applied_and_holdout_rejected(self):
        reference = {'review_id': 'R0001', 'source_file': 'a', 'camera_model': 'iPhone XR', 'action': 'reference_candidate'}
        calibration = {'review_id': 'R0002', 'source_file': 'b', 'camera_model': 'iPhone XR', 'action': 'calibration_candidate'}
        audit = {'selected_images': 782, 'cross_role_dhash_hints': [], 'same_second_cross_role_groups': [
            {'entries': [{'review_id': 'R0001'}, {'review_id': 'R0002'}], 'captured_at': 'same_second', 'source_folder': 'test'}]}
        proposal = review.burst_proposal(audit, [reference, calibration])
        self.assertFalse(proposal['owner_actions_approved'])
        self.assertFalse(proposal['official_partitions_applied'])
        self.assertEqual(proposal['calibration_quarantine_candidate_ids'], ['R0002'])
        calibration['camera_model'] = '22041216G'
        with self.assertRaises(ValueError):
            review.burst_proposal(audit, [reference, calibration])


if __name__ == '__main__':
    unittest.main()
