import copy
import importlib.util
from pathlib import Path
import unittest

spec=importlib.util.spec_from_file_location('hybrid_conflict',Path(__file__).resolve().parents[1]/'scripts/hybrid-conflict-study.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
POLICIES={p['name']:p for p in m.policies()}


def embedding(predicted='a',score=.9,margin=.2):
    return {'predicted':predicted,'score':score,'margin':margin}


def geometry(predicted='a',score=30,other=0):
    return {'predicted':predicted,'score':score,'margin':score-other,'ranking':[{'score':score},{'score':other}]}


class HybridConflictTest(unittest.TestCase):
    def decide(self,name,e=None,g=None):
        return m.decide(e or embedding(),g or geometry(),POLICIES[name])

    def test_embedding_fallback_for_no_geometric_evidence(self):
        d=self.decide('candidate_union_both_vetoes',g=geometry(None,0))
        self.assertTrue(d['accepted']);self.assertEqual(d['predicted'],'a')

    def test_strong_conflict_rejects_both(self):
        d=self.decide('candidate_union',g=geometry('b'))
        self.assertFalse(d['accepted']);self.assertEqual(d['reason'],'strong_conflict')

    def test_weak_conflict_ablation(self):
        g=geometry('b',6)
        self.assertTrue(self.decide('candidate_union',g=g)['accepted'])
        self.assertEqual(self.decide('candidate_union_weak_conflict_veto',g=g)['reason'],'weak_conflict')
        self.assertTrue(self.decide('candidate_union_weak_conflict_veto',g=geometry('b',5))['accepted'])

    def test_runnerup_veto_is_global_and_inclusive(self):
        g=geometry('a',40,10)
        self.assertTrue(self.decide('candidate_union',g=g)['accepted'])
        self.assertEqual(self.decide('candidate_union_multi_veto',g=g)['reason'],'multiple_geometric_targets')
        self.assertTrue(self.decide('candidate_union_multi_veto',g=geometry('a',40,9))['accepted'])

    def test_rescue_without_embedding_threshold_but_no_fake_agreement(self):
        e=embedding('b',.7,.01)
        self.assertTrue(self.decide('candidate_union_both_vetoes',e=e)['accepted'])
        self.assertFalse(self.decide('agreement_required',e=e)['accepted'])
        self.assertTrue(self.decide('agreement_required',e=embedding('a',.7,.01))['accepted'])

    def test_labels_do_not_influence_decision(self):
        e=embedding();g=geometry();baseline=self.decide('candidate_union_both_vetoes',e,g)
        e.update(expected='b',scenario='ambiguous');g.update(expected='b',scenario='out_of_catalog')
        self.assertEqual(baseline,self.decide('candidate_union_both_vetoes',e,g))

    def test_geometry_boundaries_and_missing_prediction(self):
        self.assertTrue(self.decide('geometry_conservative',g=geometry('a',24,4))['accepted'])
        self.assertFalse(self.decide('geometry_conservative',g=geometry('a',24,5))['accepted'])
        self.assertFalse(self.decide('geometry_conservative',g=geometry(None,0))['accepted'])

    def test_metric_counts_negatives_and_wrong_known(self):
        truth={f:{'expected':expected,'scenario':scenario} for f,expected,scenario in [('1','a','known_clean'),('2','b','known_clutter'),('3','_ambiguous','ambiguous')]}
        es={f:embedding() for f in truth};gs={f:{'variants':{'target_roi':geometry()}} for f in truth}
        r=m.evaluate(truth,es,gs,POLICIES['candidate_union'])['metrics']
        self.assertEqual(r['correct_accept'],1);self.assertEqual(r['wrong_artifact_accept'],1)
        self.assertEqual(r['negative_false_accept'],1);self.assertEqual(r['precision'],1/3)

    def test_scope_and_duplicate_validation(self):
        manifest={'signature':'s','entries':[{'file':'q','partition':'calibration','expected':'a','scenario':'known_clean','sha256':'hash'}, {'file':'final-not-read','partition':'final'}]}
        cal={'partition':'calibration','signature':'s','rows':{'max':[{'file':'q','expected':'a','scenario':'known_clean',**embedding()}]}}
        rows=[{'file':'q','partition':'calibration','sha256':'hash','expected':'a','scenario':'known_clean','variants':{'target_roi':geometry()}}]
        provenance={'manifest_sha256':'manifest'}
        self.assertEqual(len(m.validate_inputs(manifest,cal,rows,provenance,'manifest')[0]),1)
        with self.assertRaisesRegex(ValueError,'duplicate'):
            m.validate_inputs(manifest,cal,rows+rows,provenance,'manifest')
        bad=copy.deepcopy(cal);bad['partition']='final'
        with self.assertRaisesRegex(ValueError,'Scope'):
            m.validate_inputs(manifest,bad,rows,provenance,'manifest')
        bad=copy.deepcopy(cal);bad['rows']['max'][0]['score']=float('nan')
        with self.assertRaisesRegex(ValueError,'Non-finite'):
            m.validate_inputs(manifest,bad,rows,provenance,'manifest')

    def test_hybrid_metrics_are_not_retrieval_top1_metrics(self):
        truth={'q':{'expected':'a','scenario':'known_clean'}};es={'q':embedding('a')};gs={'q':{'variants':{'target_roi':geometry('a')}}}
        r=m.evaluate(truth,es,gs,POLICIES['candidate_union'])['metrics']
        self.assertNotIn('top1_correct',r);self.assertNotIn('top1_correct',r['per_artifact']['a'])


if __name__=='__main__':unittest.main()
