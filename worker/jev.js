import { jevConfig, reserveJev, settleJev } from './jev-budget.js';
import { payload, verifyBody, CUTOFF, VERSION } from './jev-protocol.js';
import { MAX_SOURCE_BYTES } from './jev-images.js';
import { normalizeJevPair, NORMALIZER_VERSION } from './jev-normalizer.js';
import { signature, sha256 } from './pipeline.js';
import { approvedCatalogReference, APPROVED_RELEASE_ID } from './catalog-release.js';

async function referenceBytes(env,winner) {
  if(!winner?.reference?.vector_id)throw Error('REFERENCE_UNAVAILABLE');
  const row=await env.DB.prepare(`SELECT i.r2_key,i.digest,a.external_object_id FROM reference_images i JOIN artifacts a ON a.id=i.artifact_id
    WHERE i.vector_id=? AND i.artifact_id=? AND i.digest=? AND i.status='ready' AND i.signature=?`)
    .bind(winner.reference.vector_id,winner.id,winner.reference.digest,signature(env)).first();
  if(!row||row.external_object_id!==winner.external_object_id)throw Error('REFERENCE_UNAVAILABLE');
  // Exact serving winner; not first arbitrary view, not a more convenient view.
  approvedCatalogReference(APPROVED_RELEASE_ID,row.digest,row.external_object_id,env);
  const object=await env.IMAGES.get(row.r2_key);
  if(!object||!Number.isFinite(object.size)||object.size>MAX_SOURCE_BYTES)throw Error('REFERENCE_UNAVAILABLE');
  const bytes=await object.arrayBuffer();
  if(await sha256(bytes)!==row.digest)throw Error('REFERENCE_UNAVAILABLE');
  return bytes;
}
export async function applyJev(baseline,queryBytes,env,winner) {
  // Even configuration/SQL/reference/codec failures must never retain a match
  // in enforce mode. An invalid mode is treated as enforce, never silent off.
  if(env.JEV_MODE==='off'||env.JEV_MODE===undefined||!baseline.recognized)return baseline;
  const mode=env.JEV_MODE,started=performance.now();let config,lease,attempted=false,result={ok:false,code:'INTERNAL_ERROR',cost:0};
  try {
    config=jevConfig(env);
    if(typeof env.OPENROUTER_API_KEY!=='string'||!env.OPENROUTER_API_KEY.trim())throw Error('INTERNAL_ERROR');
    lease=await reserveJev(env,config);
    if(!lease)throw Error('LIMIT_OR_CIRCUIT');
    const ref=await referenceBytes(env,winner);
    // Remote query normalization + precomputed R2 reference: no local codec
    // fallback on service/cache failure. Baseline bytes remain unchanged.
    const normalized=await normalizeJevPair(queryBytes,ref,env),reference=normalized.reference.bytes,query=normalized.query.bytes;
    const body=JSON.stringify(payload(query,reference));
    attempted=true;
    result=await verifyBody(body,env.OPENROUTER_API_KEY,fetch,config.timeout);
    if(result.cost>12000)result={ok:false,code:'COST_LIMIT',cost:result.cost};
    result.state=result.ok&&result.probability>=CUTOFF?'confirmed':result.ok?'not_confirmed':result.code;
  } catch(error) {
    const safe=new Set(['INVALID_IMAGE','REFERENCE_UNAVAILABLE','NORMALIZER_UNAVAILABLE','LIMIT_OR_CIRCUIT']);
    result={ok:false,code:safe.has(error.message)?error.message:'INTERNAL_ERROR',cost:attempted?null:0,state:safe.has(error.message)?error.message:'INTERNAL_ERROR'};
  }
  const confirmed=result.ok===true&&result.probability>=CUTOFF;
  const state=confirmed?'confirmed':result.ok?'not_confirmed':result.code;
  if(lease){try{await settleJev(env,lease,{...result,state},performance.now()-started);}catch{result={ok:false,code:'ACCOUNTING_UNAVAILABLE'};}}
  const allowed=result.ok===true&&result.probability>=CUTOFF;
  const verifier={version:VERSION,normalization:NORMALIZER_VERSION,mode:mode==='shadow'?'shadow':'enforce',status:allowed?'confirmed':result.ok?'not_confirmed':'unavailable'};
  // No images, request IDs, body/prompt, provider error text or secrets in logs.
  console.log(JSON.stringify({event:'jev_verdict',version:VERSION,mode:verifier.mode,status:verifier.status,elapsed_ms:Math.round(performance.now()-started),cost_known:result.cost!==null&&result.cost!==undefined}));
  const timings={...baseline.timings,jev_ms:Math.round(performance.now()-started)};
  if(mode==='shadow')return {...baseline,verifier_shadow:{...verifier,would_recognize:allowed},timings};
  if(allowed)return {...baseline,verifier,timings};
  return {...baseline,recognized:false,status:'uncertain',artifact_id:null,artifact:null,source:null,decision_source:null,
    reason:result.ok?'pairwise_identity_not_confirmed':'pairwise_verifier_unavailable',verifier,timings};
}
