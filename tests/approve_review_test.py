import copy
import importlib.util
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts/approve-review.py'
spec = importlib.util.spec_from_file_location('approve_review', SCRIPT)
review = importlib.util.module_from_spec(spec)
spec.loader.exec_module(review)


def fixture():
    def row(i, action, folder='Gióng'):
        return {'review_id': f'R{i:04d}', 'action': action, 'source_folder': folder,
                'source_file': f'{folder}/{i}.HEIC', 'source_sha256': 'a' * 64,
                'camera_model': 'iPhone XR', 'holdout_device_reserved': False,
                'partition': None, 'scenario': None, 'approved_artifact_id': None,
                'proposed_artifact_id': 'stamp-giong'}
    cals = [row(i, 'calibration_candidate') for i in range(1, 565)]
    refs = [row(i, 'reference_candidate') for i in range(800, 835)]
    finals = [row(i, 'final_candidate_cross_device') for i in range(1500, 1683)]
    manual = [row(i, 'manual_review_negative_or_target', 'Khác') for i in range(1000, 1139)]
    previous = {'owner_holds_approved': True, 'held_calibration_ids': [e['review_id'] for e in cals[:28]],
                'eligible_calibration_ids': [e['review_id'] for e in cals[28:]]}
    extra = cals[28:128]
    pairs = [{'reference_id': refs[0]['review_id'], 'calibration_id': e['review_id'],
              'reference_source_sha256': 'a' * 64, 'calibration_source_sha256': 'a' * 64} for e in extra]
    pairs += [{**p, 'reference_id': refs[1]['review_id']} for p in pairs[:8]]
    burst = {'additional_hold_proposed_ids': [e['review_id'] for e in extra], 'pairs': pairs}
    scenarios = [s for s, count in review.EXPECTED.items() for _ in range(count)] + [None] * 21
    labels = []
    previews = []
    for source, scenario in zip(manual, scenarios):
        label = {**source, 'proposed_scenario': scenario, 'proposed_artifact_id': 'stamp-giong' if scenario == 'known_clutter' else None,
                 'visible_catalog_targets': ['stamp-giong'] if scenario == 'known_clutter' else [],
                 'large_preview_file': f'previews/{source["review_id"]}.jpg', 'large_preview_sha256': 'b' * 64,
                 'owner_label_approved': False, 'approved_scenario': None}
        labels.append(label)
        previews.append(dict(label))
    return {'entries': cals + refs + finals + manual}, previous, burst, {'entries': labels}, {'entries': previews}


class ApproveReviewTests(unittest.TestCase):
    def test_118_review_labels_only_and_21_unresolved_no_mutation(self):
        c, previous, burst, proposal, previews = fixture()
        before = copy.deepcopy((c, proposal, previews))
        result = review.approve_labels(proposal, c, previews, {'stamp-giong'})
        self.assertEqual((c, proposal, previews), before)
        self.assertEqual(result['review_label_counts'], review.EXPECTED)
        self.assertEqual(sum(e['owner_label_approved'] for e in result['entries']), 118)
        self.assertEqual(sum(e['review_approved_scenario'] is None for e in result['entries']), 21)
        for e in result['entries']:
            self.assertTrue(all(e[k] is None for k in ('partition', 'scenario', 'approved_scenario', 'approved_artifact_id')))
            self.assertEqual(e['review_approved_artifact_id'], 'stamp-giong' if e['review_approved_scenario'] == 'known_clutter' else None)

    def test_label_source_preview_and_approval_drift_rejected(self):
        for field, value in [('source_sha256', 'wrong'), ('source_file', '../escape'), ('camera_model', '22041216G'),
                             ('holdout_device_reserved', True), ('large_preview_sha256', 'wrong'),
                             ('partition', 'final'), ('owner_label_approved', True), ('approved_scenario', '_unknown')]:
            with self.subTest(field=field):
                c, _, _, p, images = fixture(); p['entries'][0][field] = value
                with self.assertRaises(ValueError):
                    review.approve_labels(p, c, images, {'stamp-giong'})

    def test_queue_population_duplicates_label_counts_and_target_drift(self):
        for change in ('population', 'duplicate', 'label_count', 'artifact', 'multi_target', 'reject_target', 'folder'):
            with self.subTest(change=change):
                c, _, _, p, images = fixture()
                if change == 'population': p['entries'].pop()
                if change == 'duplicate': p['entries'][1] = dict(p['entries'][0])
                if change == 'label_count': p['entries'][0]['proposed_scenario'] = '_unknown'
                if change == 'artifact': p['entries'][0]['proposed_artifact_id'] = 'stamp-other'
                if change == 'multi_target': p['entries'][0]['visible_catalog_targets'].append('stamp-other')
                if change == 'reject_target': p['entries'][60]['proposed_artifact_id'] = 'stamp-giong'
                if change == 'folder': c['entries'][-139]['source_folder'] = 'Gióng'
                with self.assertRaises(ValueError):
                    review.approve_labels(p, c, images, {'stamp-giong'})

    def test_cumulative_128_holds_and_436_remaining_no_mutation(self):
        c, old, burst, _, _ = fixture(); before = copy.deepcopy((c, old, burst))
        result = review.approve_holds(c, old, burst)
        self.assertEqual((c, old, burst), before)
        self.assertEqual(len(result['held_calibration_ids']), 128)
        self.assertEqual(len(result['eligible_calibration_ids']), 436)
        self.assertTrue(set(result['held_calibration_ids']).isdisjoint(result['eligible_calibration_ids']))
        self.assertFalse(result['capture_groups_independent'])
        self.assertFalse(result['official_partitions_applied'])
        self.assertTrue(all(e['owner_hold_approved'] and not e['candidate_eligible'] for e in result['entries']))

    def test_hold_scope_role_device_and_hash_drift_rejected(self):
        for change in ('overlap', 'duplicate', 'prior_unapproved', 'eligible_drift', 'protected', 'reference',
                       'pair_hash', 'missing_pair', 'duplicate_pair', 'official_partition'):
            with self.subTest(change=change):
                c, old, burst, _, _ = fixture()
                if change == 'overlap': burst['additional_hold_proposed_ids'][0] = 'R0001'
                if change == 'duplicate': burst['additional_hold_proposed_ids'][1] = burst['additional_hold_proposed_ids'][0]
                if change == 'prior_unapproved': old['owner_holds_approved'] = False
                if change == 'eligible_drift': old['eligible_calibration_ids'].pop()
                if change == 'protected': c['entries'][28]['holdout_device_reserved'] = True
                if change == 'reference': c['entries'][28]['action'] = 'reference_candidate'
                if change == 'pair_hash': burst['pairs'][0]['reference_source_sha256'] = 'wrong'
                if change == 'missing_pair': burst['pairs'].pop()
                if change == 'duplicate_pair': burst['pairs'][-1] = dict(burst['pairs'][0])
                if change == 'official_partition': c['entries'][0]['partition'] = 'calibration'
                with self.assertRaises(ValueError):
                    review.approve_holds(c, old, burst)

    def test_cli_requires_both_flags_and_new_confined_output(self):
        repo = SCRIPT.parents[1]
        with tempfile.TemporaryDirectory() as temporary:
            for args in [[], ['--approve-118-review-labels'], ['--approve-118-review-labels', '--approve-100-additional-holds', '--output', temporary],
                         ['--approve-118-review-labels', '--approve-100-additional-holds', '--output', str(repo / 'reports')]]:
                result = subprocess.run([sys.executable, str(SCRIPT), *args], capture_output=True, text=True)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('ValueError', result.stderr)
            self.assertEqual(list(Path(temporary).iterdir()), [])

    def test_path_confinement(self):
        root = Path(tempfile.gettempdir()) / 'approval-root'
        self.assertEqual(review.confined(root, 'previews/R0623.jpg'), (root / 'previews/R0623.jpg').resolve())
        with self.assertRaises(ValueError):
            review.confined(root, '../outside')


if __name__ == '__main__':
    unittest.main()
