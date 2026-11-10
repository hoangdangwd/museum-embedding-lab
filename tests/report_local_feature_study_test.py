import importlib.util
from pathlib import Path
import unittest

spec=importlib.util.spec_from_file_location('report_local_features',Path(__file__).resolve().parents[1]/'scripts/report-local-feature-study.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)


def row(file, expected, scenario, prediction='a', score=20, other=0):
    return {'file':file,'expected':expected,'scenario':scenario,
            'variants':{'target_roi':{'predicted':prediction,'score':score,'margin':score-other,
                                     'ranking':[{'score':score},{'score':other}]}}}


class LocalFeatureReportTest(unittest.TestCase):
    def test_multiple_target_veto_and_no_evidence(self):
        r=row('q','a','known_clean',other=6)
        self.assertTrue(module.decide(r,'target_roi',12,5,None))
        self.assertFalse(module.decide(r,'target_roi',12,5,6))
        self.assertFalse(module.decide(row('q','a','known_clean',prediction=None,score=0),'target_roi',0,0,None))

    def test_negatives_and_wrong_known_count_as_errors(self):
        rows=[row('1','a','known_clean'),row('2','b','known_clutter'),row('3','_ambiguous','ambiguous')]
        baseline={r['file']:{**r,'score':.5,'margin':0,'predicted':'b'} for r in rows}
        c={'mode':'target_roi','rule':'geometry_only','minimum_inliers':12,'margin_inliers':5,'other_artifact_limit':None}
        result,_=module.measure(rows,baseline,c)
        self.assertEqual(result['correct_accept'],1)
        self.assertEqual(result['wrong_artifact_accept'],1)
        self.assertEqual(result['negative_false_accept'],1)
        self.assertEqual(result['precision'],1/3)

    def test_out_of_catalog_is_rejection_target(self):
        rows=[row('q','_unknown','out_of_catalog')]
        baseline={'q':{'score':.1,'margin':0,'predicted':'a'}}
        config={'mode':'target_roi','rule':'geometry_only','minimum_inliers':12,'margin_inliers':5,'other_artifact_limit':None}
        result,_=module.measure(rows,baseline,config)
        self.assertEqual(result['negative_false_accept'],1)
        self.assertEqual(result['per_scenario']['out_of_catalog']['accepted'],1)
        self.assertEqual(result['precision'],0)

    def test_rescue_keeps_existing_errors_instead_of_hiding_them(self):
        rows=[row('1','a','known_clean'),row('2','_ambiguous','ambiguous',prediction=None,score=0)]
        baseline={'1':{'score':.7,'margin':.1,'predicted':'b'},'2':{'score':.9,'margin':.2,'predicted':'b'}}
        c={'mode':'target_roi','rule':'rescue_rejects','minimum_inliers':12,'margin_inliers':5,'other_artifact_limit':None}
        result,decisions=module.measure(rows,baseline,c)
        self.assertEqual(result['correct_accept'],1)
        self.assertEqual(result['negative_false_accept'],1)
        self.assertEqual(decisions[1]['decision_source'],'baseline')
        self.assertEqual(decisions[1]['predicted'],'b')


if __name__=='__main__':unittest.main()
