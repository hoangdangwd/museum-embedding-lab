import copy
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('review_large', Path(__file__).resolve().parents[1] / 'scripts/review-large.py')
review = importlib.util.module_from_spec(spec)
spec.loader.exec_module(review)


class LargeReviewTests(unittest.TestCase):
    def queue(self):
        return {'entries': [{'review_id': 'R0623', 'source_folder': 'Khác 2', 'needs_larger_review': True,
                             'partition': None, 'approved_scenario': None, 'approved_artifact_id': None,
                             'owner_label_approved': False}]}

    def candidates(self):
        entries = [{'review_id': f'R{i:04d}', 'action': 'calibration_candidate', 'camera_model': 'iPhone XR',
                    'holdout_device_reserved': False} for i in range(1, 565)]
        entries += [{'review_id': 'R0800', 'action': 'reference_candidate'},
                    {'review_id': 'R0900', 'action': 'final_candidate', 'camera_model': '22041216G', 'holdout_device_reserved': True}]
        proposal = {'calibration_quarantine_candidate_ids': [f'R{i:04d}' for i in range(1, 29)]}
        return {'entries': entries}, proposal

    def test_select_queue_does_not_approve_labels(self):
        screen = self.queue()
        before = copy.deepcopy(screen)
        self.assertEqual(len(review.select_queue(screen)), 1)
        self.assertEqual(screen, before)
        screen['entries'][0]['needs_larger_review'] = False
        self.assertEqual(review.select_queue(screen), [])

    def test_scope_and_duplicate_ids_rejected(self):
        screen = self.queue()
        screen['entries'].append(dict(screen['entries'][0]))
        with self.assertRaises(ValueError):
            review.select_queue(screen)
        for field, value in [('source_folder', 'Gióng'), ('review_id', '../R0623')]:
            screen = self.queue(); screen['entries'][0][field] = value
            with self.assertRaises(ValueError):
                review.select_queue(screen)

    def test_official_labels_cannot_enter_preview_scope(self):
        for field, value in [('partition', 'final'), ('approved_scenario', '_unknown'),
                             ('approved_artifact_id', 'stamp-giong'), ('owner_label_approved', True)]:
            screen = self.queue(); screen['entries'][0][field] = value
            with self.assertRaises(ValueError):
                review.select_queue(screen)

    def test_holds_are_separate_overlay_and_only_28(self):
        candidate, proposal = self.candidates()
        before = copy.deepcopy(candidate)
        holds = review.candidate_holds(candidate, proposal)
        self.assertEqual(candidate, before)
        self.assertEqual(holds['held_calibration_count'], 28)
        self.assertEqual(len(holds['eligible_calibration_ids']), 536)
        self.assertFalse(holds['official_partitions_applied'])
        self.assertTrue(set(holds['held_calibration_ids']).isdisjoint(holds['eligible_calibration_ids']))
        self.assertNotIn('R0900', holds['eligible_calibration_ids'])

    def test_holdout_or_reference_hold_rejected(self):
        for field, value in [('camera_model', '22041216G'), ('holdout_device_reserved', True), ('action', 'reference_candidate')]:
            candidate, proposal = self.candidates(); candidate['entries'][0][field] = value
            with self.assertRaises(ValueError):
                review.candidate_holds(candidate, proposal)

    def test_hold_count_duplicate_and_population_drift_rejected(self):
        for change in ('duplicate_hold', 'missing_hold', 'duplicate_entry', 'missing_candidate'):
            candidate, proposal = self.candidates()
            if change == 'duplicate_hold': proposal['calibration_quarantine_candidate_ids'][1] = 'R0001'
            if change == 'missing_hold': proposal['calibration_quarantine_candidate_ids'].pop()
            if change == 'duplicate_entry': candidate['entries'].append(dict(candidate['entries'][0]))
            if change == 'missing_candidate': candidate['entries'].pop(100)
            with self.assertRaises(ValueError):
                review.candidate_holds(candidate, proposal)

    def test_adjacent_seconds_are_hints_not_approved_holds(self):
        def row(rid, action, time, camera='iPhone XR', folder='same'):
            return {'review_id': rid, 'action': action, 'captured_at': time, 'camera_model': camera,
                    'source_folder': folder, 'proposed_artifact_id': 'stamp-example'}
        entries = [row('R0001', 'reference_candidate', '2026:11:05 23:59:59'),
                   row('R0002', 'calibration_candidate', '2026:11:06 00:00:00'),
                   row('R0003', 'calibration_candidate', '2026:11:05 23:59:59'),
                   row('R0004', 'calibration_candidate', '2026:11:06 00:00:01'),
                   row('R0005', 'calibration_candidate', '2026:11:06 00:00:00', camera='22041216G'),
                   row('R0006', 'calibration_candidate', '2026:11:06 00:00:00', folder='other'),
                   row('R0007', 'calibration_candidate', '2026:11:06 00:00:00')]
        result = review.adjacent_second_hints({'entries': entries}, {'eligible_calibration_ids': [f'R{i:04d}' for i in range(2, 7)]})
        self.assertEqual(result['unique_calibration_candidates'], 1)
        self.assertEqual(result['pairs'][0]['calibration_id'], 'R0002')
        self.assertFalse(result['pairs'][0]['owner_hold_approved'])
        self.assertFalse(result['official_partitions_applied'])


if __name__ == '__main__':
    unittest.main()
