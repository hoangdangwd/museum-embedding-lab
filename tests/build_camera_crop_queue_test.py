import importlib.util
from pathlib import Path
import unittest

spec=importlib.util.spec_from_file_location('crop_queue',Path(__file__).resolve().parents[1]/'scripts/build-camera-crop-queue.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class CropQueueTest(unittest.TestCase):
    def image(self,rid,**kwargs):
        return dict(review_id=rid,kind='incoming',source_file='folder/'+rid+'.HEIC',source_sha256='a'*64,preview='previews/'+rid+'.jpg',proposed_artifact_id='stamp-giong',**kwargs)
    def test_preserves_test_roles_and_does_not_invent_roi_or_labels_from_folders(self):
        rows=m.build_queue([self.image('R1'),self.image('R2'),self.image('R3')],[dict(review_id='R1',partition='calibration',approved_artifact_id='stamp-giong'),dict(review_id='R2',partition='final',holdout_device_reserved=True)],[])
        self.assertFalse(rows[0]['reference_selection_allowed_without_resplit'])
        self.assertFalse(rows[1]['reference_selection_allowed_without_resplit'])
        self.assertIsNone(rows[2]['current_artifact_id'])
        self.assertEqual(rows[2]['folder_hint'],'stamp-giong')
        self.assertTrue(all(e['annotation']['crop'] is None and not e['annotation']['owner_approved'] for e in rows))
    def test_review_only_negative_and_camera_holdout_are_not_reference_candidates(self):
        rows=m.build_queue([self.image('N1'),self.image('N2',camera_model='22041216G')],[],[dict(review_id='N1',scenario='out_of_catalog')])
        self.assertEqual(rows[0]['current_partition'],'calibration')
        self.assertFalse(rows[0]['reference_selection_allowed_without_resplit'])
        self.assertFalse(rows[1]['reference_selection_allowed_without_resplit'])
        self.assertIsNone(rows[0]['annotation']['post_crop_scenario'])
    def test_duplicate_ids_fail(self):
        with self.assertRaises(ValueError):m.build_queue([self.image('R1'),self.image('R1')],[])

if __name__=='__main__':unittest.main()
