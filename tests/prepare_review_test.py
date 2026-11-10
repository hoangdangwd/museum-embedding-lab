import importlib.util
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from PIL import Image

spec = importlib.util.spec_from_file_location('prepare_review', Path(__file__).resolve().parents[1] / 'scripts/prepare-review.py')
review = importlib.util.module_from_spec(spec)
spec.loader.exec_module(review)


class ReviewTests(unittest.TestCase):
    def test_hash_is_deterministic_and_has_64_bits(self):
        image = Image.new('RGB', (100, 100))
        for x in range(100):
            for y in range(100):
                image.putpixel((x, y), (x * 2, y * 2, 0))
        self.assertEqual(review.difference_hash(image), review.difference_hash(image.copy()))
        self.assertEqual(len(review.difference_hash(image)), 16)

    def test_candidates_include_baseline_and_never_approve_or_merge_labels(self):
        entries = [
            {'kind': 'incoming', 'source_file': 'a.jpg', 'dhash': '0000000000000000'},
            {'kind': 'incoming', 'source_file': 'b.jpg', 'dhash': '0000000000000001'},
            {'kind': 'baseline', 'source_file': 'old.jpg', 'dhash': '0000000000000000'},
            {'kind': 'baseline', 'source_file': 'old2.jpg', 'dhash': '0000000000000000'},
            {'kind': 'incoming', 'source_file': 'c.jpg', 'dhash': 'ffffffffffffffff'},
            {'kind': 'incoming', 'source_file': 'broken.jpg'},
        ]
        before = json.dumps(entries)
        pairs = review.candidate_pairs(entries)
        self.assertEqual(len(pairs), 5)
        self.assertTrue(all(pair['status'] == 'unreviewed_candidate' for pair in pairs))
        self.assertFalse(any(pair['left'] == 'old.jpg' and pair['right'] == 'old2.jpg' for pair in pairs))
        self.assertEqual(before, json.dumps(entries))
        self.assertEqual(sum(pair['baseline_involved'] for pair in pairs), 4)

    def test_capture_bucket_does_not_arbitrarily_split_a_continuous_shoot(self):
        entry = {'source_folder': 'Giong', 'camera_model': 'iPhone', 'captured_at': '2026:11:05 10:00:00'}
        first = review.capture_bucket(entry)
        self.assertEqual(first, review.capture_bucket({**entry, 'captured_at': '2026:11:05 10:10:00'}))
        self.assertNotEqual(first, review.capture_bucket({**entry, 'camera_model': 'Other'}))
        self.assertNotEqual(first, review.capture_bucket({**entry, 'captured_at': '2026:11:06 10:00:00'}))

    def test_full_decode_preserves_source_and_strips_preview_exif(self):
        import hashlib
        with TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'previews').mkdir()
            source = root / 'source.jpg'
            exif = Image.Exif()
            exif[274] = 6
            exif[272] = 'Camera metadata'
            Image.new('RGB', (1000, 600), 'orange').save(source, exif=exif)
            before = source.read_bytes()
            digest = hashlib.sha256(before).hexdigest()
            result = review.process_image((source, {'kind': 'incoming', 'source_file': 'source.jpg', 'expected_sha256': digest}, root))
            self.assertEqual(result['decode_status'], 'ok')
            self.assertEqual(source.read_bytes(), before)
            with Image.open(root / result['preview']) as preview:
                self.assertEqual(preview.size, (288, 480))
                self.assertEqual(len(preview.getexif()), 0)
            self.assertNotIn('partition', result)
            self.assertNotIn('approved_artifact_id', result)

    def test_hash_mismatch_or_decode_failure_does_not_produce_a_preview(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'previews').mkdir()
            source = root / 'broken.jpg'
            source.write_bytes(b'not an image')
            bad_hash = review.process_image((source, {'kind': 'incoming', 'source_file': 'broken.jpg', 'expected_sha256': 'bad'}, root))
            self.assertEqual(bad_hash['decode_status'], 'error')
            self.assertIn('hash', bad_hash['error'])
            broken = review.process_image((source, {'kind': 'incoming', 'source_file': 'broken.jpg'}, root))
            self.assertEqual(broken['decode_status'], 'error')
            self.assertEqual(list((root / 'previews').iterdir()), [])

    def test_sheets_cover_every_file_once_including_decode_errors(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'sheets').mkdir()
            entries = [{'kind': 'incoming', 'source_folder': 'Giong', 'source_file': f'{i}.jpg', 'review_id': f'R{i:04d}'} for i in range(25)]
            sheets = review.write_sheets(entries, root)
            self.assertEqual(len(sheets), 2)
            self.assertEqual(sum(len(sheet['review_ids']) for sheet in sheets), 25)
            self.assertEqual(len({item for sheet in sheets for item in sheet['review_ids']}), 25)


if __name__ == '__main__':
    unittest.main()
