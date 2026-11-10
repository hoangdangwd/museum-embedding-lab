"""Offline SIFT + geometric verification study. Reads references/calibration only.
No provider calls, no final scoring, no mutation of dataset or production.
Optional dependencies: requirements-local-features.txt. Output is append-only/resumable.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import time

import cv2
import numpy as np
from PIL import Image, ImageOps, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
CONFIG = {'max_edge': 960, 'features': 1800, 'ratio': .70, 'ransac_px': 4.,
          'min_inliers': 6, 'min_inlier_ratio': .25, 'min_ref_coverage': .02,
          'min_projected_area': .0005, 'max_projected_area': 1.5, 'seed': 20261107}


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read_json(path):
    return json.loads(path.read_text(encoding='utf-8'))


def entries_for_study(manifest):
    entries = [r for r in manifest['entries'] if r['partition'] in ('references', 'calibration')]
    if len({r['file'] for r in entries}) != len(entries):
        raise ValueError('Duplicate input file')
    refs = sorted([r for r in entries if r['partition'] == 'references'], key=lambda r:r['file'])
    queries = sorted([r for r in entries if r['partition'] == 'calibration'], key=lambda r:r['file'])
    if len({r['expected'] for r in refs}) < 2 or not queries:
        raise ValueError('Need >=2 reference classes and calibration')
    if {r['sha256'] for r in refs} & {r['sha256'] for r in queries}:
        raise ValueError('Reference/calibration hash overlap')
    return refs, queries


def image_path(row):
    base = (ROOT/'data/evaluation').resolve()
    path = (base/row['file']).resolve()
    if base not in path.parents or row['partition'] not in ('references', 'calibration'):
        raise ValueError('Unsafe or non-study image')
    if digest(path) != row['sha256']:
        raise ValueError('Image hash mismatch: '+row['file'])
    return path


def prepare(manifest_path, output):
    refs, _ = entries_for_study(read_json(manifest_path))
    output.mkdir(parents=True, exist_ok=False)
    records = []
    for start in range(0, len(refs), 15):
        sheet = Image.new('RGB', (1200, 1500), 'white')
        draw = ImageDraw.Draw(sheet)
        for i, row in enumerate(refs[start:start+15]):
            key = f'F{start+i+1:02}'
            with Image.open(image_path(row)) as image:
                preview = ImageOps.contain(image.convert('RGB'), (390, 260))
            x, y = i%3*400, i//3*300
            sheet.paste(preview, (x+(400-preview.width)//2, y))
            draw.text((x+5,y+263), key+' '+row['expected'].removeprefix('stamp-'), fill='black')
            records.append({'key':key, **row, 'polygon_normalized':None, 'roi_status':'pending'})
        sheet.save(output/f'references-{start//15+1:02}.jpg', quality=94)
    (output/'reference-rois.json').write_text(json.dumps({'manifest_sha256':digest(manifest_path),
        'scope':'Research-only reference ROI, not new references or labels; no query/final crops.',
        'entries':records},indent=2)+'\n',encoding='utf-8')


def features(row, extractor):
    path = image_path(row)
    gray = cv2.imdecode(np.frombuffer(path.read_bytes(), dtype=np.uint8), cv2.IMREAD_GRAYSCALE)
    if gray is None:
        raise ValueError('Decode failed')
    factor = min(1, CONFIG['max_edge']/max(gray.shape))
    if factor < 1:
        gray = cv2.resize(gray, None, fx=factor, fy=factor, interpolation=cv2.INTER_AREA)
    keys, descriptors = extractor.detectAndCompute(gray, None)
    coords = np.float32([k.pt for k in keys]).reshape(-1,2)
    return {'coords':coords, 'descriptors':descriptors, 'shape':gray.shape}


def roi_polygon(normalized, shape):
    points = np.asarray(normalized, dtype=np.float32)
    if points.shape != (4,2) or not np.isfinite(points).all() or np.any(points<0) or np.any(points>1):
        raise ValueError('ROI must be four normalized points')
    points = points*np.float32([shape[1]-1,shape[0]-1])
    if not cv2.isContourConvex(points) or cv2.contourArea(points) <= 1:
        raise ValueError('Degenerate ROI')
    return points


def inside(points, polygon):
    return np.array([cv2.pointPolygonTest(polygon, tuple(map(float,p)), False) >= 0 for p in points], dtype=bool)


def verify_geometry(source, target, polygon, query_shape):
    """Count geometrically coherent matches, not simply descriptor similarity."""
    result = {'matches':len(source), 'inliers':0, 'inlier_ratio':0., 'ref_coverage':0.,
              'projected_area_fraction':0., 'geometry_valid':False, 'score':0, 'quad':None}
    if len(source) < CONFIG['min_inliers']:
        return result
    homography, mask = cv2.findHomography(source, target, cv2.RANSAC, CONFIG['ransac_px'],
                                         maxIters=2000, confidence=.995)
    if homography is None or mask is None or not np.isfinite(homography).all():
        return result
    inliers = mask.ravel().astype(bool)
    count = int(inliers.sum())
    coverage = float(cv2.contourArea(cv2.convexHull(source[inliers]))/cv2.contourArea(polygon)) if count >= 3 else 0.
    quad = cv2.perspectiveTransform(polygon.reshape(-1,1,2), homography).reshape(-1,2)
    height,width = query_shape
    finite = bool(np.isfinite(quad).all())
    convex = finite and bool(cv2.isContourConvex(quad))
    area = float(cv2.contourArea(quad)/(width*height)) if finite else 0.
    bounded = finite and bool(np.all(quad>=np.float32([-.1*width,-.1*height])) and np.all(quad<=np.float32([1.1*width,1.1*height])))
    valid = count >= CONFIG['min_inliers'] and count/len(source) >= CONFIG['min_inlier_ratio'] and coverage >= CONFIG['min_ref_coverage'] and convex and bounded and CONFIG['min_projected_area'] <= area <= CONFIG['max_projected_area']
    result.update(inliers=count,inlier_ratio=count/len(source),ref_coverage=coverage,
                  projected_area_fraction=area,geometry_valid=bool(valid),score=count if valid else 0,
                  quad=(quad/np.float32([width,height])).tolist() if finite else None)
    return result


def correspondences(ref, query, matcher):
    if ref['descriptors'] is None or query['descriptors'] is None or len(query['descriptors'])<2:
        return np.empty((0,2),dtype=np.float32), np.empty((0,2),dtype=np.float32)
    matches = matcher.knnMatch(ref['descriptors'], k=2)
    good = [pair[0] for pair in matches if len(pair)==2 and pair[0].distance < CONFIG['ratio']*pair[1].distance]
    # A single query feature must not vote repeatedly for multiple reference points.
    unique = {}
    for match in sorted(good,key=lambda m:m.distance):
        unique.setdefault(match.trainIdx, match)
    source = np.float32([ref['coords'][m.queryIdx] for m in unique.values()]).reshape(-1,2)
    target = np.float32([query['coords'][m.trainIdx] for m in unique.values()]).reshape(-1,2)
    return source, target


def aggregate(pairs):
    best = {}
    for pair in pairs:
        old = best.get(pair['artifact'])
        if old is None or (pair['score'],pair['inliers'],pair['reference']) > (old['score'],old['inliers'],old['reference']):
            best[pair['artifact']] = pair
    ranking = sorted(best.values(), key=lambda p:(-p['score'],p['artifact']))
    # No valid geometric evidence is abstention, not an arbitrary first artifact.
    return {'predicted':ranking[0]['artifact'] if ranking[0]['score']>0 else None,
            'score':ranking[0]['score'], 'margin':ranking[0]['score']-ranking[1]['score'], 'ranking':ranking}


def run(manifest_path, rois_path, output, limit=None, workers=4):
    cv2.setNumThreads(1)
    cv2.setRNGSeed(CONFIG['seed'])
    manifest = read_json(manifest_path)
    refs, queries = entries_for_study(manifest)
    rois = read_json(rois_path)
    if rois['manifest_sha256'] != digest(manifest_path):
        raise ValueError('ROI manifest signature mismatch')
    indexed = {r['file']:r for r in rois['entries']}
    if set(indexed) != {r['file'] for r in refs} or len(indexed)!=len(rois['entries']):
        raise ValueError('ROI reference coverage mismatch')
    for r in refs:
        if indexed[r['file']]['sha256']!=r['sha256'] or indexed[r['file']]['roi_status']!='research_reviewed':
            raise ValueError('Unreviewed ROI or hash drift')
    provenance = {'manifest_sha256':digest(manifest_path),'roi_sha256':digest(rois_path),
                  'script_sha256':digest(Path(__file__)), 'opencv':cv2.__version__, 'workers':workers, 'config':CONFIG}
    output.mkdir(parents=True, exist_ok=True)
    provenance_file = output/'provenance.json'
    if provenance_file.exists() and read_json(provenance_file)!=provenance:
        raise ValueError('Cannot resume changed experiment')
    provenance_file.write_text(json.dumps(provenance,indent=2)+'\n',encoding='utf-8')
    results_file = output/'rows.jsonl'
    done = set()
    if results_file.exists():
        rows = [json.loads(line) for line in results_file.read_text(encoding='utf-8').splitlines()]
        done = {r['file'] for r in rows}
        if len(done)!=len(rows) or not done <= {q['file'] for q in queries}:
            raise ValueError('Invalid existing rows')
    extractor = cv2.SIFT_create(nfeatures=CONFIG['features'])
    start = time.perf_counter()
    reference_features = []
    for ref in refs:
        feature = features(ref,extractor)
        reference_features.append((ref, feature, roi_polygon(indexed[ref['file']]['polygon_normalized'],feature['shape'])))
    print(json.dumps({'references':len(refs),'reference_preparation_seconds':time.perf_counter()-start,'remaining':len(queries)-len(done)}),flush=True)
    def process(query):
        start = time.perf_counter()
        # Per-image seed ensures resume doesn't change FLANN/RANSAC random state.
        cv2.setRNGSeed(int(query['sha256'][:7],16))
        feature = features(query,cv2.SIFT_create(nfeatures=CONFIG['features']))
        extraction_seconds = time.perf_counter()-start
        matcher = cv2.FlannBasedMatcher(dict(algorithm=1,trees=4),dict(checks=64))
        if feature['descriptors'] is not None and len(feature['descriptors'])>=2:
            matcher.add([feature['descriptors']]); matcher.train()
        pairs = {'full_reference':[], 'target_roi':[]}
        for ref, rf, polygon in reference_features:
            source,target = correspondences(rf,feature,matcher)
            full_bounds = roi_polygon([[0,0],[1,0],[1,1],[0,1]],rf['shape'])
            for mode in pairs:
                bounds = polygon if mode=='target_roi' else full_bounds
                selected = inside(source,polygon) if mode=='target_roi' else np.ones(len(source),dtype=bool)
                matched = verify_geometry(source[selected],target[selected],bounds,feature['shape'])
                pairs[mode].append({'artifact':ref['expected'],'reference':ref['file'],**matched})
        return {**query,'query_features':len(feature['coords']),'extraction_seconds':extraction_seconds,
                'total_seconds_both_variants':time.perf_counter()-start,
                'variants':{mode:aggregate(values) for mode,values in pairs.items()}}
    pending = [q for q in queries if q['file'] not in done]
    if limit is not None:
        pending = pending[:limit]
    wall = time.perf_counter()
    with ThreadPoolExecutor(max_workers=workers) as pool:
        for processed,result in enumerate(pool.map(process,pending),1):
            with results_file.open('a',encoding='utf-8') as handle:
                handle.write(json.dumps(result)+'\n')
            if processed%20==0 or processed==1:
                print(json.dumps({'processed_this_run':processed,'total_done':len(done)+processed,'last_seconds':result['total_seconds_both_variants']}),flush=True)
    print(json.dumps({'completed':len(done)+len(pending),'run_wall_seconds':time.perf_counter()-wall,'workers':workers}),flush=True)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['prepare','run'])
    parser.add_argument('--manifest',type=Path,default=ROOT/'data/evaluation/full-calibration-manifest.json')
    parser.add_argument('--rois',type=Path,default=ROOT/'reports/local-feature-rois-v1/reference-rois.json')
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--limit',type=int)
    parser.add_argument('--workers',type=int,default=4)
    args=parser.parse_args()
    if (ROOT/'reports').resolve() not in args.output.resolve().parents:
        raise ValueError('Output must be under reports/')
    if args.command=='prepare':
        prepare(args.manifest,args.output)
    else:
        run(args.manifest,args.rois,args.output,args.limit,args.workers)


if __name__=='__main__':
    main()
