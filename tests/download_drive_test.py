import importlib.util
from pathlib import Path
import unittest
from tempfile import TemporaryDirectory
from unittest.mock import MagicMock, patch

spec = importlib.util.spec_from_file_location('download_drive', Path(__file__).resolve().parents[1] / 'scripts' / 'download-drive.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
audit_spec = importlib.util.spec_from_file_location('audit_incoming', Path(__file__).resolve().parents[1] / 'scripts' / 'audit-incoming.py')
audit = importlib.util.module_from_spec(audit_spec)
audit_spec.loader.exec_module(audit)


class DriveListingTests(unittest.TestCase):
    def item(self, path='Gi\u00f3ng/IMG_001.HEIC', file_id='abc-123_X'):
        return {'url': f'https://drive.google.com/uc?id={file_id}', 'path': path}

    def test_preserves_folder_names_and_canonicalizes_url(self):
        item = module.validate_listing([self.item()])[0]
        self.assertEqual(item['path'], 'Gi\u00f3ng/IMG_001.HEIC')
        self.assertEqual(item['drive_file_id'], 'abc-123_X')

    def test_rejects_traversal_absolute_paths_and_windows_ads(self):
        for path in ['../photo.jpg', '/photo.jpg', 'C:/photo.jpg', 'folder/../photo.jpg', 'folder/file.jpg:stream', 'folder//file.jpg', './photo.jpg']:
            with self.subTest(path=path), self.assertRaises(ValueError):
                module.validate_listing([self.item(path)])

    def test_rejects_case_insensitive_collisions(self):
        with self.assertRaisesRegex(ValueError, 'Duplicate destination'):
            module.validate_listing([self.item('folder/A.jpg'), self.item('folder/a.JPG', 'other-id')])

    def test_rejects_wrong_host_or_protocol(self):
        for url in ['http://drive.google.com/uc?id=abc', 'https://example.com/uc?id=abc', 'https://drive.google.com/uc']:
            with self.subTest(url=url), self.assertRaises(ValueError):
                module.validate_listing([{'path': 'image.jpg', 'url': url}])

    def test_rejects_duplicate_ids(self):
        with self.assertRaisesRegex(ValueError, 'Duplicate Drive file ID'):
            module.validate_listing([self.item('a.jpg'), self.item('b.jpg')])


class PublicTransferTests(unittest.TestCase):
    def response(self, body, expected=None):
        response = MagicMock()
        response.__enter__.return_value = response
        response.headers = {'Content-Type': 'image/jpeg', 'Content-Length': str(len(body) if expected is None else expected)}
        response.iter_content.return_value = iter([body])
        return response

    def test_streams_public_image_and_checks_byte_count(self):
        with TemporaryDirectory() as directory:
            target = Path(directory) / 'photo.part'
            with patch('requests.get', return_value=self.response(b'jpeg-bytes')):
                module.download_public_file('https://drive.google.com/uc?id=abc', target)
            self.assertEqual(target.read_bytes(), b'jpeg-bytes')

    def test_short_response_is_not_accepted_as_a_completed_file(self):
        with TemporaryDirectory() as directory:
            target = Path(directory) / 'photo.part'
            with patch('requests.get', side_effect=lambda *a, **kw: self.response(b'short', expected=100)), patch.object(module.time, 'sleep'):
                with self.assertRaisesRegex(RuntimeError, 'Incomplete transfer'):
                    module.download_public_file('https://drive.google.com/uc?id=abc', target)


class InventoryTests(unittest.TestCase):
    def test_inventory_reads_metadata_without_exporting_gps(self):
        from PIL import Image
        with TemporaryDirectory() as directory:
            root = Path(directory)
            path = root / 'originals' / 'folder' / 'photo.jpg'
            path.parent.mkdir(parents=True)
            exif = Image.Exif()
            exif[272] = 'Test camera'
            exif[306] = '2026:11:05 10:00:00'
            Image.new('RGB', (128, 96), 'blue').save(path, exif=exif)
            result = audit.inspect_file((root, {'path': 'folder/photo.jpg', 'drive_file_id': 'abc'}))
            self.assertEqual(result['status'], 'metadata_readable')
            self.assertEqual((result['width'], result['height']), (128, 96))
            self.assertEqual(result['camera_model'], 'Test camera')
            self.assertEqual(result['captured_at'], '2026:11:05 10:00:00')
            self.assertEqual(len(result['sha256']), 64)
            self.assertNotIn('gps', str(result).lower())

    def test_corrupt_or_missing_image_is_reported_not_silently_counted(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            item = {'path': 'folder/missing.jpg', 'drive_file_id': 'abc'}
            self.assertEqual(audit.inspect_file((root, item))['status'], 'error')
            target = root / 'originals' / item['path']
            target.parent.mkdir(parents=True)
            target.write_bytes(b'not an image')
            self.assertEqual(audit.inspect_file((root, item))['status'], 'error')


if __name__ == '__main__':
    unittest.main()
