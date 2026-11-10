// Approved offline crop derivatives only. No provider/network/catalog calls.
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve, relative, isAbsolute } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { prepareImages } from './seed-stamps.mjs';
import { signature } from '../worker/pipeline.js';
const root=fileURLToPath(new URL('../',import.meta.url));
const hash=b=>createHash('sha256').update(b).digest('hex');
const scenarios=new Set(['known_clean','known_clutter','out_of_catalog','ambiguous','low_quality']);
const artifactIds=new Set(['stamp-bac-ho-viet-bac','stamp-binh-phong','stamp-canh-cua-cham-rong','stamp-em-thuy','stamp-giong','stamp-hai-thieu-nu-em-be','stamp-hoang-hau-ngoc-truc','stamp-ket-nap-dang-dien-bien','stamp-phat-ba-quan-am']);
export function validateCropReviews(queue,review,queueHash) {
  if(queue.version!=='camera-crop-review-v1'||review.version!=='camera-crop-annotations-v1'||review.queue_sha256!==queueHash||review.coordinate_space!=='exif-oriented-normalized'||!Array.isArray(review.entries))throw Error('Queue/review signature mismatch');
  const sources=new Map(queue.entries.map(e=>[e.review_id,e]));
  if(sources.size!==queue.entries.length)throw Error('Duplicate source ID');
  const seen=new Set(),approved=[];
  for(const e of review.entries){
    const q=sources.get(e.review_id),a=e.annotation;
    if(!q||seen.has(e.review_id)||e.source_sha256!==q.source_sha256||!a)throw Error('Unknown/duplicate ID or source hash mismatch');
    seen.add(e.review_id);
    if(a.owner_approved!==true||a.proposed_role==='excluded')continue;
    const c=a.crop,role=a.proposed_role,known=a.post_crop_scenario?.startsWith('known_');
    if(!c||a.coordinate_space!=='exif-oriented-normalized'||![c.x,c.y,c.w,c.h].every(Number.isFinite)||c.x<0||c.y<0||c.w<=0||c.h<=0||c.x+c.w>1.000001||c.y+c.h>1.000001)throw Error(`Invalid/unreviewed crop ${e.review_id}`);
    if(!['references','calibration','final'].includes(role))throw Error(`Invalid role ${e.review_id}`);
    if(q.current_partition&&role!==q.current_partition)throw Error(`Split change needs separate approval: ${e.review_id}`);
    if(q.holdout_device_reserved&&role!=='final')throw Error(`Holdout device cannot become reference/development: ${e.review_id}`);
    if(role==='references'&&(!q.reference_selection_allowed_without_resplit||!artifactIds.has(a.post_crop_artifact_id)||a.quality!=='clear_complete'||!a.view_or_side?.trim()))throw Error(`Reference lacks clear complete view/label/approval: ${e.review_id}`);
    if(role!=='references'&&(!scenarios.has(a.post_crop_scenario)||(known?!artifactIds.has(a.post_crop_artifact_id):a.post_crop_artifact_id!=null&&a.post_crop_artifact_id!=='')))throw Error(`Post-crop label required; old label cannot be assumed: ${e.review_id}`);
    if(q.current_artifact_id&&artifactIds.has(q.current_artifact_id)&&a.post_crop_artifact_id!==q.current_artifact_id)throw Error(`Known intended target cannot silently change after crop: ${e.review_id}`);
    if(!a.capture_group?.trim()||!a.duplicate_group?.trim())throw Error(`Capture/duplicate group review required: ${e.review_id}`);
    const expected=role==='references'||known?a.post_crop_artifact_id:({'out_of_catalog':'_unknown','ambiguous':'_ambiguous','low_quality':'_low_quality'})[a.post_crop_scenario];
    approved.push({...q,annotation:a,partition:role,expected});
  }
  for(const key of ['source_sha256','capture_group','duplicate_group']){
    const groups=new Map();for(const e of approved){const v=key==='source_sha256'?e[key]:e.annotation[key];if(!groups.has(v))groups.set(v,new Set());groups.get(v).add(e.partition);}
    if([...groups.values()].some(s=>s.size>1))throw Error(`Cross-partition ${key} leakage; no silent split relaxation`);
  }
  return approved;
}
function safe(base,file){if(typeof file!=='string'||isAbsolute(file)||file.includes('\\')||file.includes(':'))throw Error('Unsafe source path');const p=resolve(base,file);if(relative(base,p).startsWith('..'))throw Error('Source escapes root');return p;}
async function main(){
  const [queueFile,reviewFile,output,...flags]=process.argv.slice(2);
  if(!queueFile||!reviewFile||!output||flags.some(f=>f!=='--write'))throw Error('Usage: node scripts/prepare-camera-crops.mjs queue.json annotations.json reports/output [--write] (offline only)');
  const out=resolve(output);if(!relative(resolve(root,'reports'),out)||relative(resolve(root,'reports'),out).startsWith('..')||isAbsolute(relative(resolve(root,'reports'),out)))throw Error('Output must be inside ignored reports/');
  const queueBytes=await readFile(queueFile),queue=JSON.parse(queueBytes),review=JSON.parse(await readFile(reviewFile));
  const approved=validateCropReviews(queue,review,hash(queueBytes));
  const sourcePaths=['data/staging/drive-normalized-v1/staging-manifest.json','data/staging/drive-full-negative-calibration-v1/staging-manifest.json'];
  const decoded=new Map();for(const p of sourcePaths){const m=JSON.parse(await readFile(resolve(root,p)));for(const e of m.entries)if(e.decode_status==='ok'&&e.input_kind!=='original_jpeg')decoded.set(e.source_sha256,{path:safe(dirname(resolve(root,p)),e.input_file),sha256:e.input_sha256});}
  const originals=resolve(root,'data/incoming/drive-1jYzY5U3Yc6R_3CdUz7h0T8rYOBFGb7VH/originals');
  const inputs=[],missing=[];
  for(const e of approved){
    let source=e.kind==='baseline'?{path:safe(resolve(root,'data'),e.source_file),sha256:e.source_sha256}:/\.jpe?g$/i.test(e.source_file)?{path:safe(originals,e.source_file),sha256:e.source_sha256}:decoded.get(e.source_sha256);
    if(!source){missing.push(e.review_id);continue;}
    const bytes=await readFile(source.path);if(hash(bytes)!==source.sha256)throw Error(`Full-resolution source digest changed: ${e.review_id}`);
    inputs.push({...e,file:relative(root,source.path).replaceAll('\\','/'),crop:e.annotation.crop});
  }
  const plan={scope:'Offline approved crops only; no provider calls, no production mutation',queue_sha256:hash(queueBytes),approved:approved.length,ready_full_resolution_sources:inputs.length,needs_lossless_decode:missing,pending_or_excluded:queue.entries.length-approved.length,upper_bound_provider_calls:approved.length*2,reference_counts:Object.fromEntries([...artifactIds].map(id=>[id,approved.filter(e=>e.partition==='references'&&e.expected===id).length]))};
  await mkdir(out,{recursive:true});await writeFile(resolve(out,'plan.json'),JSON.stringify(plan,null,2)+'\n');console.log(JSON.stringify(plan,null,2));
  if(!flags.includes('--write'))return;
  if(!approved.length||missing.length)throw Error('No approved crop rows or full-resolution inputs missing; no crop manifest written');
  const prepared=await prepareImages(inputs,pathToFileURL(root+'/'));
  const entries=[],digests=new Set();
  for(const e of prepared){const digest=hash(e.bytes);if(digests.has(digest))throw Error('Duplicate cropped bytes across rows');digests.add(digest);const file=`${e.partition}/${e.expected}/${digest}.jpg`;entries.push({file,partition:e.partition,expected:e.expected,...(e.partition!=='references'?{scenario:e.annotation.post_crop_scenario}:{}),sha256:digest,source_review_id:e.review_id,source_sha256:e.source_sha256,crop:e.crop,capture_group:e.annotation.capture_group,duplicate_group:e.annotation.duplicate_group});}
  // No partial write before all images decode and all duplicate checks pass.
  for(let i=0;i<entries.length;i++){const dest=resolve(out,entries[i].file);await mkdir(dirname(dest),{recursive:true});await writeFile(dest,prepared[i].bytes);}
  const pipeline={mode:'image-description-v1',description_model:'google/gemini-2.5-flash',embedding_version:'1',preprocess_version:'rgb-exif-white-jpeg95-max1600-v1'};
  const env={RECOGNITION_PIPELINE:pipeline.mode,DESCRIPTION_MODEL:pipeline.description_model,EMBEDDING_VERSION:pipeline.embedding_version,PREPROCESS_VERSION:pipeline.preprocess_version};
  await writeFile(resolve(out,'manifest.json'),JSON.stringify({version:1,model:'google/gemini-embedding-2',dimensions:1536,signature:signature(env),pipeline,crop_protocol:'owner-reviewed-exif-oriented-roi-v1',camera_crop_version:queue.camera_crop_version,queue_sha256:hash(queueBytes),scope:'Manual intended-target crops simulate user framing, not automatic target detection. Never tune on final. Requires complete partitions/labels before evaluation runner will accept.',entries},null,2)+'\n');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(e=>{console.error(e.message);process.exitCode=1;});
