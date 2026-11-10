"""Recompute selected diagnostic pairs to visualize inlier locations (not new policy scores).
No final/provider access. Pair-only FLANN/RANSAC RNG ordering differs from full study.
"""
import importlib.util
import json
from pathlib import Path
import cv2
import numpy as np

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('local_features',ROOT/'scripts/local-feature-study.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)


def run(output, keys=('G011','G015','G026')):
    manifest=m.read_json(ROOT/'data/evaluation/full-calibration-manifest.json')
    refs,queries=m.entries_for_study(manifest)
    inputs={r['file']:r for r in refs+queries}
    rois={r['file']:r for r in m.read_json(ROOT/'reports/local-feature-rois-v1/reference-rois.json')['entries']}
    index=m.read_json(output/'diagnostic-index.json')['entries']
    cv2.setNumThreads(1)
    logs=[]
    for key in keys:
        row=next(r for r in index if r['review_key']==key)
        chosen=row['best_matches'][0]
        ref=inputs[chosen['reference']];query=inputs[row['file']]
        cv2.setRNGSeed(int(query['sha256'][:7],16))
        detector=cv2.SIFT_create(nfeatures=m.CONFIG['features'])
        rf=m.features(ref,detector);qf=m.features(query,detector)
        polygon=m.roi_polygon(rois[ref['file']]['polygon_normalized'],rf['shape'])
        matcher=cv2.FlannBasedMatcher(dict(algorithm=1,trees=4),dict(checks=64))
        matcher.add([qf['descriptors']]);matcher.train()
        source,target=m.correspondences(rf,qf,matcher)
        valid=m.inside(source,polygon);source=source[valid];target=target[valid]
        _,mask=cv2.findHomography(source,target,cv2.RANSAC,m.CONFIG['ransac_px'],maxIters=2000,confidence=.995)
        if mask is None:raise ValueError('Diagnostic no homography')
        source=source[mask.ravel().astype(bool)];target=target[mask.ravel().astype(bool)]
        def image(entry,shape):
            im=cv2.imdecode(np.frombuffer(m.image_path(entry).read_bytes(),dtype=np.uint8),cv2.IMREAD_COLOR)
            return cv2.resize(im,(shape[1],shape[0]),interpolation=cv2.INTER_AREA)
        left=image(ref,rf['shape']);right=image(query,qf['shape'])
        canvas=np.full((max(left.shape[0],right.shape[0]),left.shape[1]+right.shape[1],3),255,dtype=np.uint8)
        canvas[:left.shape[0],:left.shape[1]]=left;canvas[:right.shape[0],left.shape[1]:]=right
        cv2.polylines(canvas,[polygon.astype(np.int32)],True,(0,0,255),2)
        # All inliers drawn as circles; a deterministic 20-line subset avoids unreadable tangles.
        for i,(a,b) in enumerate(zip(source,target)):
            p=tuple(a.astype(int));q=tuple((b+np.float32([left.shape[1],0])).astype(int))
            cv2.circle(canvas,p,4,(0,255,0),2);cv2.circle(canvas,q,4,(0,255,0),2)
            if i%max(1,len(source)//20)==0:cv2.line(canvas,p,q,(255,200,0),1)
        ok,buffer=cv2.imencode('.jpg',canvas,[cv2.IMWRITE_JPEG_QUALITY,94])
        if not ok:raise ValueError('Encode failed')
        (output/f'{key}-inliers.jpg').write_bytes(buffer.tobytes())
        logs.append({'key':key,'reference':ref['file'],'query':query['file'],'original_inliers':chosen['inliers'],
                     'pair_recomputed_inliers':len(source),'note':'Pair-only diagnostic recompute, not reused for selection or summary metrics.'})
    (output/'inlier-visualization-audit.json').write_text(json.dumps(logs,indent=2)+'\n',encoding='utf-8')


if __name__=='__main__':run(ROOT/'reports/local-feature-study-v3')
