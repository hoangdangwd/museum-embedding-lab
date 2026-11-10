import csv
import importlib.util
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

spec = importlib.util.spec_from_file_location('lock_split', Path(__file__).resolve().parents[1] / 'scripts' / 'lock-split-candidate.py')
lock = importlib.util.module_from_spec(spec)
spec.loader.exec_module(lock)


def write_proposal(root):
    path = root / 'proposal.csv'
    fields = ['source_file', 'source_sha256', 'review_id', 'source_folder', 'camera_model', 'captured_at', 'proposed_action', 'proposed_artifact_id', 'partition', 'approved_artifact_id', 'reviewed']
    counts = [('reference_candidate', 35), ('reference_deferred_after_screen', 45), ('calibration_candidate', 564), ('final_candidate_cross_device', 183), ('manual_review_negative_or_target', 805)]
    rows = []
    for action, count in counts:
        for index in range(count):
            other = action == 'manual_review_negative_or_target'
            camera = '22041216G' if action == 'final_candidate_cross_device' or (other and index < 6) else 'iPhone XR'
            number = len(rows)
            rows.append({'source_file': f'folder/image-{number}.jpg', 'source_sha256': f'{number:064x}', 'review_id': f'R{number:04d}', 'source_folder': 'Khác' if other else 'Gióng', 'camera_model': camera,
                         'captured_at': '2026:11:05 10:00:00', 'proposed_action': action, 'proposed_artifact_id': '' if other else 'stamp-giong', 'partition': '', 'approved_artifact_id': '', 'reviewed': 'false'})
    with path.open('w', encoding='utf-8-sig', newline='') as stream:
        writer = csv.DictWriter(stream, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)
    return path


class LockCandidateTests(unittest.TestCase):
    def test_manifest_preserves_policy_without_approving_partitions(self):
        repo = Path(__file__).resolve().parents[1]
        with TemporaryDirectory(dir=repo / 'reports', prefix='lock-test-') as directory:
            source = write_proposal(Path(directory))
            output = Path(directory) / 'candidate.json'
            import sys
            old = sys.argv
            try:
                sys.argv = ['lock-split-candidate.py', '--proposal', str(source), '--output', str(output)]
                lock.main()
            finally:
                sys.argv = old
            manifest = json.loads(output.read_text(encoding='utf-8'))
            self.assertEqual(manifest['counts'], {'reference_candidate': 35, 'reference_deferred': 45, 'calibration_candidate': 564, 'final_candidate': 183, 'manual_review': 805})
            self.assertFalse(manifest['official_partitions_applied'])
            self.assertEqual(manifest['provider_calls'], 0)
            self.assertEqual(sum(entry['holdout_device_reserved'] for entry in manifest['entries']), 189)
            self.assertTrue(all(entry['partition'] is None and entry['approved_artifact_id'] is None and entry['scenario'] is None for entry in manifest['entries']))

    def test_existing_output_is_never_overwritten(self):
        repo = Path(__file__).resolve().parents[1]
        with TemporaryDirectory(dir=repo / 'reports', prefix='lock-test-') as directory:
            source = write_proposal(Path(directory))
            output = Path(directory) / 'candidate.json'
            output.write_text('keep', encoding='utf-8')
            import sys
            old = sys.argv
            try:
                sys.argv = ['lock-split-candidate.py', '--proposal', str(source), '--output', str(output)]
                with self.assertRaisesRegex(ValueError, 'exists'):
                    lock.main()
            finally:
                sys.argv = old
            self.assertEqual(output.read_text(encoding='utf-8'), 'keep')


if __name__ == '__main__':
    unittest.main()
