// Calibration-only exploratory retrieval study. No provider, final scoring, or catalog writes.
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { loadManifest, normalize, summarize } from './recognition-eval.mjs';

export const methods = ['max', 'top2_mean', 'top3_mean', 'centroid'];
const dot = (a,b) => a.reduce((sum, value, i) => sum + value*b[i], 0);
export function buildIndex(references, cache, dimensions) {
  const groups = new Map();
  for (const reference of references) {
    if (reference.partition !== 'references') throw Error('Only references may form the index');
    if (!groups.has(reference.expected)) groups.set(reference.expected, []);
    groups.get(reference.expected).push(normalize(cache.vectors[reference.sha256], dimensions));
  }
  if (groups.size < 2) throw Error('Need two reference artifacts');
  return [...groups].map(([artifact, vectors]) => ({ artifact, vectors,
    centroid: normalize(Array.from({length: dimensions}, (_,i) => vectors.reduce((s,v) => s+v[i],0)/vectors.length), dimensions) }));
}
export function rankVector(vector, index, method) {
  if (!methods.includes(method)) throw Error('Unknown method');
  const candidates = index.map(group => {
    if (method === 'centroid') return {artifact: group.artifact, score: dot(vector, group.centroid)};
    const scores = group.vectors.map(reference => dot(vector, reference)).sort((a,b)=>b-a);
    const top = scores.slice(0, method === 'max' ? 1 : method === 'top2_mean' ? 2 : 3);
    return { artifact: group.artifact, score: top.reduce((s,x)=>s+x,0)/top.length };
  }).sort((a,b)=>b.score-a.score || a.artifact.localeCompare(b.artifact));
  return {candidates, predicted: candidates[0].artifact, score: candidates[0].score, margin: candidates[0].score-candidates[1].score};
}
export function evaluateCalibration(manifest, cache, method) {
  if (cache.signature !== manifest.signature) throw Error('Cache signature mismatch');
  const index = buildIndex(manifest.entries.filter(e=>e.partition==='references'),cache,manifest.dimensions);
  // Never touch final vectors, even if the legacy loader needs a sentinel entry.
  return manifest.entries.filter(e=>e.partition==='calibration').map(query => ({
    file: query.file, expected: query.expected, scenario: query.scenario,
    ...rankVector(normalize(cache.vectors[query.sha256],manifest.dimensions),index,method),
  }));
}
export function measure(rows, threshold, margin) {
  const s = summarize(rows, threshold, margin);
  const artifacts = Object.values(s.per_artifact);
  const fa = Object.fromEntries(['unknown','ambiguous','low_quality'].map(k=>[k,s[`false_acceptance_${k}`]]));
  const negativeErrors = Object.values(fa).reduce((n,x)=>n+x.count,0);
  return {threshold, margin, correct: s.correct_acceptance_known.count, known_total: s.correct_acceptance_known.total,
    recall: s.correct_acceptance_known.rate, macro_recall: artifacts.reduce((n,x)=>n+x.accepted_correct.rate,0)/artifacts.length,
    accepted: s.accepted_precision.total, precision: s.accepted_precision.rate,
    wrong_artifact_accept: s.accepted_precision.total-s.accepted_precision.count-negativeErrors, false_acceptance: fa};
}
function operatingPoints(rows) {
  const grid = [];
  for (let t=50;t<=95;t++) for (let m=0;m<=20;m++) grid.push(measure(rows,t/100,m/100));
  const order=(a,b)=>b.macro_recall-a.macro_recall || b.correct-a.correct || b.precision-a.precision || b.threshold-a.threshold || b.margin-a.margin;
  return [.95,.98,.99].map(floor=>({empirical_precision_floor:floor, best:grid.filter(x=>x.precision!==null && x.precision>=floor).sort(order)[0] || null}));
}
async function main() {
  const [manifestFile='data/evaluation/full-calibration-manifest.json', cacheFile='data/evaluation/full-calibration-embeddings.json', output='reports/cached-retrieval-study-v1'] = process.argv.slice(2);
  try { await access(output); throw Error('Choose a new output directory'); } catch(e) { if(e.code!=='ENOENT') throw e; }
  if (!resolve(output).startsWith(resolve('reports')+'/') && !resolve(output).startsWith(resolve('reports')+'\\')) throw Error('Output must be under reports/');
  const manifest = await loadManifest(manifestFile);
  const cache = JSON.parse(await readFile(cacheFile,'utf8'));
  const experiments = [];
  for (const method of methods) {
    const rows = evaluateCalibration(manifest,cache,method);
    const known = rows.filter(r=>r.scenario.startsWith('known_'));
    const wrong = known.filter(r=>r.predicted!==r.expected);
    experiments.push({method, known_total:known.length, top1_correct:known.length-wrong.length,
      top1_errors_by_scenario:Object.fromEntries([...new Set(wrong.map(r=>r.scenario))].map(s=>[s,wrong.filter(r=>r.scenario===s).length])),
      operating_points:operatingPoints(rows), rows});
    console.log(JSON.stringify({method,top1_correct:known.length-wrong.length,known_total:known.length}));
  }
  const report={version:'calibration-retrieval-study-v1',created_at:new Date().toISOString(),
    source_sha256:{manifest:createHash('sha256').update(await readFile(manifestFile)).digest('hex'),cache:createHash('sha256').update(await readFile(cacheFile)).digest('hex')},
    references:manifest.entries.filter(e=>e.partition==='references').length,
    calibration:manifest.entries.filter(e=>e.partition==='calibration').length,
    provider_calls:0, final_scored:false, production_changed:false, experiments,
    limitations:['In-sample exploratory comparisons, not independent validation.','Empirical precision floors are illustrative, not approved production risk tolerances.','No labels, references, partitions, or production policy changed.','Centroid/top-k means may suppress distinctive sides/views; test rather than assume benefit.']};
  await mkdir(output,{recursive:true});
  await writeFile(resolve(output,'results.json'),JSON.stringify(report,null,2)+'\n');
  const lines=['# Thử nghiệm retrieval chỉ trên calibration','',
    'Không gọi provider, không tính điểm final, không đổi nhãn/catalog. Các điểm vận hành là fit trên calibration, không phải cam kết precision ngoài mẫu.','',
    '| Phương pháp | Top-1 known | Mức precision thử | Threshold / margin | Accept đúng | Macro recall | Precision | Sai artifact | FA unknown / ambiguous / low-quality |',
    '|---|---:|---:|---|---:|---:|---:|---:|---|'];
  for (const x of experiments) for (const point of x.operating_points) {
    const b=point.best; if(!b) continue;
    lines.push(`| ${x.method} | ${x.top1_correct}/${x.known_total} | ${point.empirical_precision_floor} | ${b.threshold} / ${b.margin} | ${b.correct}/${b.known_total} | ${(b.macro_recall*100).toFixed(1)}% | ${(b.precision*100).toFixed(2)}% | ${b.wrong_artifact_accept} | ${Object.values(b.false_acceptance).map(f=>`${f.count}/${f.total}`).join(' / ')} |`);
  }
  await writeFile(resolve(output,'summary.md'),lines.join('\n')+'\n');
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error=>{console.error(error.message);process.exitCode=1;});
