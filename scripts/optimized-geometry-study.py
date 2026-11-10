"""Optimized offline geometry study: planar homography vs affine for artifact families.
No provider calls, no final scoring, no label/catalog/production mutation.
"""
import argparse,json,hashlib,time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import cv2,numpy as np
ROOT=Path(__file__).resolve().parents[1]
import importlib.util
spec=importlib.util.spec_from_file_location('local',ROOT/'scripts/local-feature-study.py');local=importlib.util.module_from_spec(spec);spec.loader.exec_module(local)

FAMILY={'stamp-hoang-hau-ngoc-truc':'sculpture','stamp-phat-ba-quan-am':'sculpture'}
def family(artifact):return FAMILY.get(artifact,'planar')

def valid_quad(quad,shape):
 if quad is None or not np.isfinite(quad).all():return False
 h,w=shape
 return bool(cv2.isContourConvex(quad) and np.all(quad>=np.float32([-.1*w,-.1*h])) and np.all(quad<=np.float32([1.1*w,1.1*h])))

def verify(source,target,polygon,shape,model):
 out={'matches':len(source),'inliers':0,'inlier_ratio':0.,'ref_coverage':0.,'projected_area_fraction':0.,'geometry_valid':False,'score':0,'quad':None,'model':model}
 if len(source)<6:return out
 if model=='homography':
  matrix,mask=cv2.findHomography(source,target,cv2.RANSAC,4.,maxIters=2000,confidence=.995)
 else:
  matrix,mask=cv2.estimateAffine2D(source,target,method=cv2.RANSAC,ransacReprojThreshold=4.,maxIters=2000,confidence=.995,refineIters=10)
 if matrix is None or mask is None or not np.isfinite(matrix).all():return out
 inside_mask=mask.ravel().astype(bool); n=int(inside_mask.sum())
 ref_area=cv2.contourArea(polygon);coverage=float(cv2.contourArea(cv2.convexHull(source[inside_mask]))/ref_area) if n>=3 and ref_area>0 else 0.
 if model=='homography':quad=cv2.perspectiveTransform(polygon.reshape(-1,1,2),matrix).reshape(-1,2)
 else:quad=cv2.transform(polygon.reshape(-1,1,2),matrix).reshape(-1,2)
 h,w=shape;finite=bool(np.isfinite(quad).all());area=float(cv2.contourArea(quad)/(w*h)) if finite else 0.
 geom=valid_quad(quad,shape) and n>=6 and n/len(source)>=.25 and coverage>=.02 and .0005<=area<=1.5
 out.update(inliers=n,inlier_ratio=n/len(source),ref_coverage=coverage,projected_area_fraction=area,geometry_valid=bool(geom),score=n if geom else 0,quad=(quad/np.float32([w,h])).tolist() if finite else None)
 return out

def process_query(query,refs,rois):
 cv2.setRNGSeed(int(query['sha256'][:7],16));det=cv2.SIFT_create(nfeatures=local.CONFIG['features']);qf=local.features(query,det)
 matcher=cv2.FlannBasedMatcher(dict(algorithm=1,trees=4),dict(checks=64))
 results={'planar':[],'sculpture_affine':[],'all_affine':[]}
 for ref,rf,polygon in refs:
  if rf['descriptors'] is None or qf['descriptors'] is None:source=target=np.empty((0,2),dtype=np.float32)
  else:
   matcher.clear();matcher.add([qf['descriptors']]);matcher.train()
   # correspondences expects ref descriptors as query and query descriptors as train; use same matcher API by ref/query.
   source,target=local.correspondences(rf,qf,matcher)
  allowed=local.inside(source,polygon) if len(source) else np.zeros(0,dtype=bool)
  source,target=source[allowed],target[allowed]
  art=ref['expected']; model='affine' if family(art)=='sculpture' else 'homography'
  item={'artifact':art,'reference':ref['file']}
  results['planar' if model=='homography' else 'sculpture_affine'].append({**item,**verify(source,target,polygon,qf['shape'],model)})
  results['all_affine'].append({**item,**verify(source,target,polygon,qf['shape'],'affine')})
 def aggregate(items):
  best={}
  for x in items:
   old=best.get(x['artifact'])
   if old is None or (x['score'],x['inliers'],x['reference'])>(old['score'],old['inliers'],old['reference']):best[x['artifact']]=x
  rank=sorted(best.values(),key=lambda x:(-x['score'],x['artifact']))
  return {'predicted':rank[0]['artifact'] if rank[0]['score']>0 else None,'score':rank[0]['score'],'margin':rank[0]['score']-(rank[1]['score'] if len(rank)>1 else 0),'ranking':rank}
 return {k:aggregate(v) for k,v in results.items()}

def main():
 p=argparse.ArgumentParser();p.add_argument('--output',type=Path,default=ROOT/'reports/optimized-geometry-study-v1');p.add_argument('--workers',type=int,default=4);p.add_argument('--limit',type=int)
 a=p.parse_args();out=a.output;out.mkdir(exist_ok=False)
 manifest=local.read_json(ROOT/'data/evaluation/full-calibration-manifest.json');refs,queries=local.entries_for_study(manifest);roi=local.read_json(ROOT/'reports/local-feature-rois-v1/reference-rois.json');rmap={r['file']:r for r in roi['entries']}
 ref_features=[];t=time.perf_counter();
 for r in refs:
  f=local.features(r,cv2.SIFT_create(nfeatures=local.CONFIG['features']));ref_features.append((r,f,local.roi_polygon(rmap[r['file']]['polygon_normalized'],f['shape'])))
 prov={'manifest_sha256':local.digest(ROOT/'data/evaluation/full-calibration-manifest.json'),'roi_sha256':local.digest(ROOT/'reports/local-feature-rois-v1/reference-rois.json'),'script_sha256':local.digest(Path(__file__)),'opencv':cv2.__version__,'config':local.CONFIG,'family_map':FAMILY,'workers':a.workers,'provider_calls':0,'final_scored':False}
 (out/'provenance.json').write_text(json.dumps(prov,indent=2)+'\n',encoding='utf8')
 rows=[];pending=queries[:a.limit] if a.limit else queries
 with ThreadPoolExecutor(max_workers=a.workers) as pool:
  for i,(q,res) in enumerate(zip(pending,pool.map(lambda x:process_query(x,ref_features,rmap),pending)),1):
   rows.append({**q,'variants':res});
   if i%20==0 or i==1:print(json.dumps({'processed':i,'total':len(pending)}),flush=True)
 (out/'rows.jsonl').write_text('\n'.join(json.dumps(r) for r in rows)+'\n',encoding='utf8')
 print(json.dumps({'rows':len(rows),'reference_seconds':time.perf_counter()-t,'provider_calls':0}))
if __name__=='__main__':main()
