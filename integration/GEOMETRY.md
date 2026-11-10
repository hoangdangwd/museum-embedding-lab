# Planar geometry boundary — not enabled in production

Current deployment: `RECOGNITION_GEOMETRY_MODE=off`. `worker/geometry.js` is a private service adapter and evidence validator, **not a feature extractor**. There is no deployed `PLANAR_GEOMETRY` service binding yet. The research Python/OpenCV scripts and research-only ROIs must not be represented as live production evidence.

## Active decision architecture

1. Existing image description, same prompt/model/signature as references.
2. Conservative description-derived scene classification. Explicit multi-artifact scenes without an explicit dominant target, or explicit no-clear-artifact descriptions, return `uncertain` before embedding/retrieval. This is a deterministic language heuristic, not independent segmentation/vision; unseen phrasings may be missed. Its `unknown` class does not prove there is one artifact.
3. Existing image+text embedding, Vectorize and D1-authoritative ranking.
4. Runtime family mapping by D1 `external_object_id`, never evaluation `expected` labels or client-submitted values.
5. Seven planar/near-planar artifacts: embedding now, optional trusted planar geometry when separately configured and validated.
6. Sculptures: embedding without mandatory geometry. **Only** `stamp-phat-ba-quan-am` queries the reject-only bank. `stamp-hoang-hau-ngoc-truc` has no bank requirement. Unknown/custom IDs use embedding only.

The scene guard deliberately preserves descriptions with an explicit primary target, even if background artworks are mentioned. Figures/leaves/panels within one artwork are not counted as separate physical artifacts. Existing labels are not altered.

## Future trusted extractor contract

Configure a Cloudflare service binding `PLANAR_GEOMETRY` with `fetch(Request)`, not an arbitrary client URL. Give that separately deployed service read access to the same reference R2 bucket, and provision approved target-only reference ROIs keyed by reference digest. It must verify the R2 bytes against the supplied digest and avoid matching walls, frames and labels. Do not silently promote research ROIs to approved production ROIs.

POST to the binding uses the private logical URL `https://planar-geometry.internal/match` and multipart fields:

- `file`: normalized query JPEG; no query persistence required.
- `version`: `planar-target-roi-v1`.
- `pipeline_signature`: current embedding signature.
- `references`: JSON array of authoritative current ready planar reference rows: `id`, `artifact_id`, `digest`, `r2_key`, `external_object_id`. The service reads reference bytes via its own R2 binding. It must not enumerate/use other catalog views or calibration images.

Response:

```json
{
  "version": "planar-target-roi-v1",
  "pipeline_signature": "...",
  "matches": [{
    "reference_id": "reference UUID from request",
    "reference_digest": "same digest from request",
    "roi_scope": "artifact_only_approved",
    "inliers": 30,
    "match_count": 40,
    "reference_coverage": 0.4,
    "query_coverage": 0.2,
    "reprojection_error": 1.0,
    "projected_quad_valid": true
  }]
}
```

No duplicate/unknown reference IDs, mismatched signatures/digests, invalid counts, unapproved/full-image ROI evidence, NaN/infinite numbers or responses over 128 KiB are accepted. Reference lists are bounded at 64 planar references and 256 total ready references; larger catalogs need an explicit bounded strategy. Missing/malformed/failed service evidence is marked `unavailable`, never treated as a geometry match. Geometry is auxiliary: unavailable evidence cannot rescue an embedding rejection; it leaves existing embedding acceptance unchanged.

Projection error is measured in pixels in the extractor's normalized feature coordinate system; use a fixed documented feature scale before calibrating gates. Coverage fractions must be spatial spread/area, not simply the fraction of descriptors matched. `projected_quad_valid` requires finite, convex, non-degenerate, plausible projection; the trusted extractor must implement these checks, not just echo true.

## Candidate quality and decision gates

These values are implemented and tested as **policy candidates**, not measured guarantees for a production extractor:

- inlier ratio >= 0.45;
- reference spatial coverage >= 0.20;
- query spatial coverage >= 0.02;
- reprojection error <= 3 px and valid projected quadrilateral;
- strong rescue >= 24 inliers, >= 20 inlier gap, runner-up < 10;
- quality-valid runner-up >= 10: multi-target veto;
- quality-valid different target >= 6 with passing embedding: conflict veto;
- aggregate multiple views using max per artifact, not multiple competing targets;
- rescue only the same top embedding artifact; never switch to a different artifact under conflict;
- no embedding minimum such as 0.75 may veto a strong same-target rescue;
- sculptures/unknown families ignore this evidence entirely.

## Activation gate

1. Implement/deploy extractor under an approved hosting/runtime choice. No new paid vision/embedding model is needed.
2. Approve artifact-only reference ROIs; keep calibration/final images out of the reference bank.
3. Replay with the **actual 10 production references**, not the 45-reference exploratory catalog. Do not select thresholds from final images.
4. Configure the trusted binding and use `shadow`: evidence is reported but cannot change a decision.
5. Review latency/CPU, mismatch and per-artifact error/coverage data; explicitly approve `enforce` and calibrate its numeric quality gates against that extractor.

Setting shadow/enforce without the service binding is a configuration error before paid work, not an implicit fallback or a claim that geometry is active.

## Budget and compatibility

The description prompt, provider and embedding signature are unchanged; no re-embedding, catalog synchronization or new reference imports are required for this code deployment. The atomic daily reservation is still 2 units for an uncached description+embedding pipeline. Early scene rejection skips the real embedding request, but does not refund unused reserved daily units. Existing idempotency keys continue replaying their old result for 24 hours; use a new user action/key to test the new policy.
