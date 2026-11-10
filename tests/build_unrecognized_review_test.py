import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('review', Path(__file__).resolve().parents[1] / 'scripts/build-unrecognized-review.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class UnrecognizedReviewTest(unittest.TestCase):
    def test_evaluate_sample_false_accept(self):
        e = {
            'file': 'calibration/negative/R0745.jpg',
            'expected': '_unknown',
            'scenario': 'out_of_catalog',
            'score': 0.89,
            'margin': 0.12,
            'predicted': 'stamp-phat-ba-quan-am',
        }
        g_planar = {'score': 0, 'margin': 0, 'predicted': None, 'ranking': [{'score': 0}, {'score': 0}]}
        g_sculpt = {'score': 0, 'margin': 0, 'predicted': None, 'ranking': [{'score': 0}, {'score': 0}]}

        res = m.evaluate_sample(e, g_planar, g_sculpt)
        self.assertEqual(res['status'], 'false_accept')
        self.assertEqual(res['decision'], 'accept')
        self.assertEqual(res['predicted'], 'stamp-phat-ba-quan-am')
        self.assertFalse(res['near_miss'])

    def test_evaluate_sample_unaccepted_positive_near_miss(self):
        e = {
            'file': 'cal/test.jpg',
            'expected': 'stamp-bac-ho-viet-bac',
            'scenario': 'known_clutter',
            'score': 0.76,
            'margin': 0.08,
            'predicted': 'stamp-bac-ho-viet-bac',
        }
        g_planar = {'score': 0, 'margin': 0, 'predicted': None, 'ranking': [{'score': 0}, {'score': 0}]}
        g_sculpt = {'score': 0, 'margin': 0, 'predicted': None, 'ranking': [{'score': 0}, {'score': 0}]}

        res = m.evaluate_sample(e, g_planar, g_sculpt)
        self.assertEqual(res['status'], 'unaccepted_positive')
        self.assertEqual(res['decision'], 'reject')
        self.assertTrue(res['near_miss'])

    def test_collect_evaluation_rows_counts(self):
        with tempfile.TemporaryDirectory() as td:
            cal_file = Path(td) / 'calibration.json'
            geo_file = Path(td) / 'rows.jsonl'

            cal_data = {
                'rows': {
                    'max': [
                        {
                            'file': 'cal/clean.jpg',
                            'expected': 'stamp-giong',
                            'scenario': 'known_clean',
                            'score': 0.90,
                            'margin': 0.15,
                            'predicted': 'stamp-giong',
                        },
                        {
                            'file': 'cal/unrec.jpg',
                            'expected': 'stamp-giong',
                            'scenario': 'known_clutter',
                            'score': 0.70,
                            'margin': 0.02,
                            'predicted': 'stamp-giong',
                        },
                        {
                            'file': 'cal/fa.jpg',
                            'expected': '_unknown',
                            'scenario': 'out_of_catalog',
                            'score': 0.85,
                            'margin': 0.12,
                            'predicted': 'stamp-phat-ba-quan-am',
                        },
                    ]
                }
            }
            cal_file.write_text(json.dumps(cal_data), encoding='utf-8')

            geo_data = [
                {
                    'file': 'cal/clean.jpg',
                    'variants': {
                        'planar': {'score': 0, 'margin': 0, 'predicted': None, 'ranking': [{'score': 0}, {'score': 0}]},
                        'sculpture_affine': {'score': 0, 'margin': 0, 'predicted': None, 'ranking': [{'score': 0}, {'score': 0}]},
                    }
                },
                {
                    'file': 'cal/unrec.jpg',
                    'variants': {
                        'planar': {'score': 0, 'margin': 0, 'predicted': None, 'ranking': [{'score': 0}, {'score': 0}]},
                        'sculpture_affine': {'score': 0, 'margin': 0, 'predicted': None, 'ranking': [{'score': 0}, {'score': 0}]},
                    }
                },
                {
                    'file': 'cal/fa.jpg',
                    'variants': {
                        'planar': {'score': 0, 'margin': 0, 'predicted': None, 'ranking': [{'score': 0}, {'score': 0}]},
                        'sculpture_affine': {'score': 0, 'margin': 0, 'predicted': None, 'ranking': [{'score': 0}, {'score': 0}]},
                    }
                },
            ]
            geo_file.write_text('\n'.join(json.dumps(x) for x in geo_data), encoding='utf-8')

            fa, unrec, all_rows = m.collect_evaluation_rows(cal_file, geo_file)
            self.assertEqual(len(fa), 1)
            self.assertEqual(fa[0]['id'], 'ERR01')
            self.assertEqual(len(unrec), 1)
            self.assertEqual(unrec[0]['id'], 'U001')
            self.assertEqual(len(all_rows), 3)


if __name__ == '__main__':
    unittest.main()
