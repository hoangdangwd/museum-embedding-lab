import contextlib
import csv
import importlib.util
import io
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch
from PIL import Image

spec = importlib.util.spec_from_file_location('propose_split', Path(__file__).resolve().parents[1] / 'scripts/propose-split.py')
proposal = importlib.util.module_from_spec(spec)
spec.loader.exec_module(proposal)


class ProposalTests(unittest.TestCase):
    def test_diversity_sampling_is_deterministic_bounded_and_handles_empty_budget(self):
        rows = [{'source_file': f'{i}.jpg', 'captured_at': str(i), 'dhash': f'{i:016x}'} for i in range(20)]
        first = proposal.choose_diverse(rows, 5)
        self.assertEqual(len(first), 5)
        self.assertEqual(first, proposal.choose_diverse(list(reversed(rows)), 5))
        self.assertEqual(proposal.choose_diverse(rows, 0), [])
        self.assertEqual(proposal.choose_diverse([], 8), [])
        self.assertEqual(len(proposal.choose_diverse(rows, 80)), 20)

    def test_screening_can_only_narrow_a_draft_reference_not_approve_or_send_it_to_test(self):
        rows = [{'review_id': 'R1', 'source_file': 'a.jpg', 'proposed_action': 'reference_candidate', 'proposed_partition': 'references_candidate', 'proposal_reason': '', 'partition': '', 'reviewed': 'false'}]
        screen = {'entries': [{'review_id': 'R1', 'source_file': 'a.jpg', 'recommendation': 'defer_reference', 'reason': 'blurry preview'}]}
        result = proposal.apply_screening(rows, screen)[0]
        self.assertEqual(result['proposed_partition'], '')
        self.assertEqual(result['partition'], '')
        self.assertEqual(result['reviewed'], 'false')
        self.assertEqual(result['proposed_action'], 'reference_deferred_after_screen')

    def test_screening_rejects_mismatched_source_or_nonreference_action(self):
        row = {'review_id': 'R1', 'source_file': 'a.jpg', 'proposed_action': 'final_candidate_cross_device', 'proposal_reason': ''}
        screen = {'entries': [{'review_id': 'R1', 'source_file': 'a.jpg', 'recommendation': 'defer_reference', 'reason': 'test'}]}
        with self.assertRaisesRegex(ValueError, 'mismatch'):
            proposal.apply_screening([row], screen)

    def test_cli_keeps_other_device_out_of_references_and_unknowns_unlabeled(self):
        repo = Path(__file__).resolve().parents[1]
        with TemporaryDirectory(dir=repo / 'reports', prefix='proposal-test-') as directory:
            root = Path(directory)
            output = root / 'output'
            records = []
            for index, (folder, camera) in enumerate([('Gióng', 'iPhone XR'), ('Gióng', 'iPhone XR'), ('Gióng', '22041216G'), ('Khác', '22041216G')], 1):
                preview = f'preview-{index}.jpg'
                Image.new('RGB', (80, 60), 'blue').save(root / preview)
                records.append({'source_file': f'{folder}/photo-{index}.jpg', 'review_id': f'R{index:04d}', 'kind': 'incoming', 'source_folder': folder,
                                'camera_model': camera, 'captured_at': '2026:11:05 10:00:00', 'source_sha256': str(index) * 64,
                                'dhash': f'{index:016x}', 'decode_status': 'ok', 'preview': preview,
                                'partition': '', 'reviewed': 'false', 'approved_artifact_id': ''})
            images = root / 'images.json'
            images.write_text(json.dumps(records), encoding='utf-8')
            review = root / 'review.csv'
            with review.open('w', encoding='utf-8-sig', newline='') as stream:
                writer = csv.DictWriter(stream, fieldnames=list(records[0]))
                writer.writeheader()
                writer.writerows(records)
            original = review.read_bytes()
            args = ['propose-split.py', '--review', str(review), '--images', str(images), '--output', str(output)]
            with patch('sys.argv', args), contextlib.redirect_stdout(io.StringIO()):
                proposal.main()
            with (output / 'proposal.csv').open(encoding='utf-8-sig', newline='') as stream:
                result = list(csv.DictReader(stream))
            self.assertEqual([r['proposed_action'] for r in result], ['reference_candidate', 'reference_candidate', 'final_candidate_cross_device', 'manual_review_negative_or_target'])
            self.assertTrue(all(not r['partition'] and r['reviewed'] == 'false' and not r['approved_artifact_id'] for r in result))
            self.assertEqual(result[2]['holdout_device_reserved'], 'True')
            self.assertEqual(result[3]['holdout_device_reserved'], 'True')
            self.assertEqual(result[0]['holdout_device_reserved'], 'False')
            summary = json.loads((output / 'summary.json').read_text(encoding='utf-8'))
            self.assertEqual(summary['holdout_device_reserved_total'], 2)
            self.assertEqual(summary['holdout_device_manual_label_pending'], 1)
            self.assertEqual(review.read_bytes(), original)
            self.assertEqual(len(json.loads((output / 'reference-candidates.json').read_text(encoding='utf-8'))), 2)
            self.assertTrue((output / 'reference-candidates.html').is_file())
            with patch('sys.argv', args), self.assertRaisesRegex(ValueError, 'exists'):
                proposal.main()


if __name__ == '__main__':
    unittest.main()
