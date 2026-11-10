import importlib.util
from pathlib import Path
import unittest

AVAILABLE = all(importlib.util.find_spec(name) for name in ('cv2','numpy','PIL'))
if AVAILABLE:
    spec=importlib.util.spec_from_file_location('local_feature_study',Path(__file__).resolve().parents[1]/'scripts/local-feature-study.py')
    module=importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    import cv2
    import numpy as np


@unittest.skipUnless(AVAILABLE, 'optional local-feature dependencies not installed')
class LocalFeatureStudyTest(unittest.TestCase):
    def test_excludes_final_and_rejects_reference_leakage(self):
        rows=[{'file':'r1','partition':'references','expected':'a','sha256':'a'},
              {'file':'r2','partition':'references','expected':'b','sha256':'b'},
              {'file':'q','partition':'calibration','sha256':'q'},
              {'file':'missing','partition':'final'}]
        refs,queries=module.entries_for_study({'entries':rows})
        self.assertEqual(len(refs),2);self.assertEqual(len(queries),1)
        rows[2]['sha256']='a'
        with self.assertRaisesRegex(ValueError,'overlap'):module.entries_for_study({'entries':rows})

    def test_roi_validation(self):
        for roi in ([[0,0],[1,0],[1,1]], [[0,0],[1,1],[0,1],[1,0]], [[0,0],[2,0],[1,1],[0,1]]):
            with self.assertRaises(ValueError):module.roi_polygon(roi,(100,100))
        polygon=module.roi_polygon([[0,0],[1,0],[1,1],[0,1]],(100,200))
        self.assertAlmostEqual(cv2.contourArea(polygon),199*99)

    def test_valid_planar_geometry(self):
        cv2.setRNGSeed(1)
        source=np.float32([[x,y] for x in [10,30,50,70,90] for y in [10,30,50,70,90]])
        target=source*2+40
        polygon=np.float32([[0,0],[100,0],[100,100],[0,100]])
        result=module.verify_geometry(source,target,polygon,(400,400))
        self.assertTrue(result['geometry_valid']);self.assertEqual(result['score'],25)
        self.assertAlmostEqual(result['ref_coverage'],.64)

    def test_tiny_cluster_is_not_whole_object_evidence(self):
        source=np.float32([[x,y] for x in [10,11,12] for y in [10,11,12]])
        polygon=np.float32([[0,0],[100,0],[100,100],[0,100]])
        result=module.verify_geometry(source,source+30,polygon,(300,300))
        self.assertFalse(result['geometry_valid']);self.assertEqual(result['score'],0)

    def test_insufficient_matches_abstain(self):
        points=np.float32([[0,0],[1,1]])
        result=module.verify_geometry(points,points,np.float32([[0,0],[10,0],[10,10],[0,10]]),(100,100))
        self.assertFalse(result['geometry_valid']);self.assertEqual(result['score'],0)
        pairs=[{'artifact':a,'reference':a,'score':0,'inliers':0} for a in ['a','b']]
        self.assertIsNone(module.aggregate(pairs)['predicted'])

    def test_margin_uses_other_artifact_not_second_view(self):
        pairs=[{'artifact':a,'reference':r,'score':n,'inliers':n} for a,r,n in [('a','a1',20),('a','a2',19),('b','b1',8)]]
        result=module.aggregate(pairs)
        self.assertEqual(result['predicted'],'a');self.assertEqual(result['margin'],12)

    def test_reference_roi_excludes_background_points(self):
        polygon=np.float32([[20,20],[80,20],[80,80],[20,80]])
        flags=module.inside(np.float32([[0,0],[30,30],[20,20],[90,90]]),polygon)
        self.assertEqual(flags.tolist(),[False,True,True,False])
        empty=np.empty((0,2),dtype=np.float32)
        self.assertEqual(empty[module.inside(empty,polygon)].shape,(0,2))


if __name__=='__main__':unittest.main()
