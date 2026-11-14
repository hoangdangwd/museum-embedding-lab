import { VERSION, MODEL, CUTOFF } from './jev-protocol.js';
import { NORMALIZATION } from './jev-images.js';
// Reserve the full262144-token context at $.042/M plus rounding/headroom.
// Unknown outcomes retain the entire reservation; no refunds/retry on timeout.
export const RESERVATION_MICROUSD = 12000;
export function jevConfig(env) {
  const mode=env.JEV_MODE??'off';
  if(!['off','shadow','enforce'].includes(mode))throw Error('INVALID_CONFIGURATION');
  const integer=(name,fallback,min,max)=>{const x=Number(env[name]??fallback);if(!Number.isSafeInteger(x)||x<min||x>max)throw Error('INVALID_CONFIGURATION');return x;};
  return {mode,dailyLimit:integer('JEV_DAILY_LIMIT',100000,0,100000),dailyBudget:integer('JEV_DAILY_BUDGET_MICROUSD',5000000,0,100000000),concurrency:integer('JEV_MAX_CONCURRENCY',2,1,10),timeout:integer('JEV_TIMEOUT_MS',5000,100,5000)};
}
export async function reserveJev(env,config,now=Date.now()) {
  const id=crypto.randomUUID(), day=new Date(now).toISOString().slice(0,10), stamp=Math.floor(now/1000);
  // The count, money, circuit and global concurrency tests are in the SAME D1
  // write. No per-isolate counters or race-prone SELECT-then-UPDATE quotas.
  const row=await env.DB.prepare(`INSERT INTO jev_attempts(id,day,started_at,lease_until,state,charged_microusd)
    SELECT ?,?,?,?,'reserved',? WHERE
    (SELECT COUNT(*) FROM jev_attempts WHERE day=?) < ? AND
    (SELECT COALESCE(SUM(charged_microusd),0) FROM jev_attempts WHERE day=?) <= ?-? AND
    (SELECT COUNT(*) FROM jev_attempts WHERE finished_at IS NULL AND lease_until>?) < ? AND
    EXISTS(SELECT 1 FROM jev_circuit WHERE id=1 AND blocked_until<=?)
    RETURNING id`)
    .bind(id,day,stamp,stamp+60,RESERVATION_MICROUSD,day,config.dailyLimit,day,config.dailyBudget,RESERVATION_MICROUSD,stamp,config.concurrency,stamp).first();
  return row?.id??null;
}
const allowed=new Set(['confirmed','not_confirmed','TIMEOUT','PROVIDER_ERROR','INVALID_RESPONSE','INVALID_IMAGE','REFERENCE_UNAVAILABLE','NORMALIZER_UNAVAILABLE','INTERNAL_ERROR','COST_LIMIT']);
export async function settleJev(env,id,result,elapsed,now=Date.now()) {
  const state=allowed.has(result.state)||/^HTTP_[1-5][0-9]{2}$/.test(result.state)?result.state:'INTERNAL_ERROR', valid=result.ok===true;
  const cost=typeof result.cost==='number'&&Number.isSafeInteger(result.cost)&&result.cost>=0?result.cost:null;
  const stamp=Math.floor(now/1000);
  await env.DB.batch([
    env.DB.prepare(`UPDATE jev_attempts SET finished_at=?,state=?,elapsed_ms=?,charged_microusd=?,cost_known=? WHERE id=? AND finished_at IS NULL`)
      .bind(stamp,state,Math.max(0,Math.round(elapsed)),cost??RESERVATION_MICROUSD,cost===null?0:1,id),
    env.DB.prepare(`UPDATE jev_circuit SET failures=CASE WHEN ? THEN 0 ELSE failures+1 END,
      blocked_until=CASE WHEN ? THEN blocked_until WHEN failures+1>=5 THEN MAX(blocked_until,?+60) ELSE blocked_until END WHERE id=1`)
      .bind(valid?1:0,valid?1:0,stamp),
  ]);
}
export async function jevStatus(env) {
  const config=jevConfig(env),day=new Date().toISOString().slice(0,10), now=Math.floor(Date.now()/1000);
  if(config.mode==='off')return {mode:'off',version:VERSION,model:MODEL,cutoff:CUTOFF};
  const usage=await env.DB.prepare(`SELECT COUNT(*) AS attempts,COALESCE(SUM(charged_microusd),0) AS charged_microusd,
    COALESCE(SUM(CASE WHEN cost_known=1 THEN charged_microusd ELSE 0 END),0) AS known_cost_microusd,
    COALESCE(SUM(CASE WHEN cost_known=0 THEN 1 ELSE 0 END),0) AS unknown_cost_attempts FROM jev_attempts WHERE day=?`).bind(day).first();
  const states=await env.DB.prepare('SELECT state,COUNT(*) AS count FROM jev_attempts WHERE day=? GROUP BY state').bind(day).all();
  const circuit=await env.DB.prepare('SELECT failures,blocked_until FROM jev_circuit WHERE id=1').first();
  const active=await env.DB.prepare('SELECT COUNT(*) AS count FROM jev_attempts WHERE finished_at IS NULL AND lease_until>?').bind(now).first();
  return {mode:config.mode,version:VERSION,model:MODEL,cutoff:CUTOFF,normalization:NORMALIZATION,timeout_ms:config.timeout,daily_limit:config.dailyLimit,daily_budget_microusd:config.dailyBudget,reservation_microusd:RESERVATION_MICROUSD,max_concurrency:config.concurrency,active_leases:active.count,day,usage,states:states.results,circuit};
}
export async function cleanupJev(env) {
  // Seven-day aggregate-only diagnostic retention. No query bytes/hash, names,
  // prompts, provider response bodies, user IDs or secrets are written here.
  await env.DB.prepare('DELETE FROM jev_attempts WHERE started_at<?').bind(Math.floor(Date.now()/1000)-7*86400).run();
}
