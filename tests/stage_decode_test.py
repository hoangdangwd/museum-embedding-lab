"""Offline staging safety tests; no incoming data or provider calls required."""
import hashlib
import importlib.util
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('stage_decode', Path(__file__).resolve().parents[1] / 'scripts/stage-decode.py')
staging = importlib.util.module_from_spec(spec)
spec.loader.exec_module(staging)


class StagingTests(unittest.TestCase):
    def entry(self, **overrides):
        return {'source_file': 'artifact/a.jpg', 'review_id': 'R0001', 'source_sha256': 'a' * 64,
                'camera_model': 'iPhone XR', 'action': 'reference_candidate', 'reference_selection_owner_approved': True, **overrides}

    def test_paths_confined(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            self.assertEqual(staging.safe_source(root, 'artifact/a.jpg'), root.resolve() / 'artifact/a.jpg')
            for value in ['../a.jpg', '/a.jpg', 'C:/a.jpg', 'artifact\\a.jpg']:
                with self.assertRaises(ValueError):
                    staging.safe_source(root, value)

    def test_reference_approval_required(self):
        with self.assertRaises(ValueError):
            staging.selected_entries({'entries': [self.entry(reference_selection_owner_approved=False)]})

    def test_holdout_device_enforced_both_directions(self):
        for entry in [self.entry(camera_model='22041216G'), self.entry(action='final_candidate_cross_device')]:
            with self.assertRaises(ValueError):
                staging.selected_entries({'entries': [entry]})
        good = self.entry(camera_model='22041216G', action='final_candidate_cross_device')
        self.assertEqual(len(staging.selected_entries({'entries': [good]})), 1)

    def test_duplicates_rejected(self):
        a = self.entry()
        with self.assertRaises(ValueError):
            staging.selected_entries({'entries': [a, dict(a)]})

    def test_manual_and_deferred_not_selected(self):
        self.assertEqual(staging.selected_entries({'entries': [self.entry(action='manual_review'), self.entry(action='reference_deferred')]}), [])

    def test_hash_validation(self):
        for digest in ['a', 'g' * 64, 'A' * 64, None]:
            with self.assertRaises(ValueError):
                staging.selected_entries({'entries': [self.entry(source_sha256=digest)]})

    def test_color_conversion_records_actual_intent_and_hdr_rejected(self):
        from PIL import Image, ImageCms
        image = Image.new('RGB', (100, 100), (100, 120, 150))
        image.info['icc_profile'] = ImageCms.ImageCmsProfile(ImageCms.createProfile('sRGB')).tobytes()
        converted, policy = staging.srgb_image(image)
        self.assertEqual(policy, 'embedded-icc-to-srgb-perceptual')
        self.assertEqual(converted.size, image.size)
        image.info['bit_depth'] = 10
        with self.assertRaises(ValueError):
            staging.srgb_image(image)

    def test_resume_only_reuses_verified_input_and_source(self):
        from PIL import Image
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            source = root / 'artifact/a.jpg'
            source.parent.mkdir()
            Image.new('RGB', (100, 100), 'red').save(source)
            entry = self.entry(source_sha256=hashlib.sha256(source.read_bytes()).hexdigest())
            first = staging.decode_entry((root, root, entry, None))
            self.assertEqual(first['decode_status'], 'ok')
            resumed = staging.decode_entry((root, root, entry, first))
            self.assertTrue(resumed['resume_verified'])
            stale = {**first, 'input_sha256': 'f' * 64}
            regenerated = staging.decode_entry((root, root, entry, stale))
            self.assertNotIn('resume_verified', regenerated)
            source.write_bytes(b'changed')
            rejected = staging.decode_entry((root, root, entry, first))
            self.assertEqual(rejected['decode_status'], 'error')


if __name__ == '__main__':
    unittest.main()
