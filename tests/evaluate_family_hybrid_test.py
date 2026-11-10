import importlib.util
from pathlib import Path
import unittest

spec=importlib.util.spec_from_file_location('family',Path(__file__).resolve().parents[1]/'scripts/evaluate-family-hybrid.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class FamilyHybridTest(unittest.TestCase):
    def test_multi_target_reject_precedes_embedding(self):
        cal={'q':{'expected':'a','scenario':'known_clean','score':.9,'margin':.2,'predicted':'a'}}
        geo={'q':{'variants':{
            'planar':{'predicted':'a','score':30,'margin':30,'ranking':[{'score':30},{'score':10}]},
            'sculpture_affine':{'predicted':'a','score':0,'margin':0,'ranking':[{'score':0},{'score':0}]}}}}
        c={'embedding_threshold':.86,'embedding_margin':.13,'planar_inliers':12,'planar_margin':5,'sculpture_inliers':6,'sculpture_margin':3,'runnerup_limit':10,'weak_conflict_limit':6}
        row=m.evaluate(cal,geo,c)[0];self.assertFalse(row['score']);self.assertEqual(row['reason'],'multi_target')

    def test_sculpture_uses_affine_rescue_not_planar(self):
        cal={'q':{'expected':'stamp-hoang-hau-ngoc-truc','scenario':'known_clutter','score':.7,'margin':.01,'predicted':'stamp-hoang-hau-ngoc-truc'}}
        geo={'q':{'variants':{
            'planar':{'predicted':None,'score':0,'margin':0,'ranking':[{'score':0},{'score':0}]},
            'sculpture_affine':{'predicted':'stamp-hoang-hau-ngoc-truc','score':8,'margin':8,'ranking':[{'score':8},{'score':0}]}}}}
        c={'embedding_threshold':.86,'embedding_margin':.13,'planar_inliers':12,'planar_margin':5,'sculpture_inliers':6,'sculpture_margin':3,'runnerup_limit':10,'weak_conflict_limit':6}
        row=m.evaluate(cal,geo,c)[0];self.assertTrue(row['score']);self.assertEqual(row['reason'],'family_geometry_rescue')

    def test_wrong_family_geometry_conflict_is_rejected(self):
        cal={'q':{'expected':'stamp-hoang-hau-ngoc-truc','scenario':'known_clutter','score':.9,'margin':.2,'predicted':'stamp-hoang-hau-ngoc-truc'}}
        geo={'q':{'variants':{
            'planar':{'predicted':None,'score':0,'margin':0,'ranking':[{'score':0},{'score':0}]},
            'sculpture_affine':{'predicted':'stamp-phat-ba-quan-am','score':8,'margin':8,'ranking':[{'score':8},{'score':0}]}}}}
        c={'embedding_threshold':.86,'embedding_margin':.13,'planar_inliers':12,'planar_margin':5,'sculpture_inliers':6,'sculpture_margin':3,'runnerup_limit':10,'weak_conflict_limit':6}
        row=m.evaluate(cal,geo,c)[0];self.assertFalse(row['score']);self.assertEqual(row['reason'],'conflict')

    def test_metrics_count_wrong_and_negative(self):
        rows=[{'expected':'a','scenario':'known_clean','predicted':'a','score':1,'margin':1}, {'expected':'b','scenario':'known_clutter','predicted':'a','score':1,'margin':1}, {'expected':'_unknown','scenario':'out_of_catalog','predicted':'a','score':1,'margin':1}]
        r=m.metrics(rows);self.assertEqual(r['correct_accept'],1);self.assertEqual(r['wrong_artifact_accept'],1);self.assertEqual(r['negative_false_accept'],1)

if __name__=='__main__':unittest.main()
