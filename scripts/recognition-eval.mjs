import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, extname, isAbsolute, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const aggregations = ['max', 'top2_mean'];
const scenarios = ['known_clean', 'known_clutter', 'out_of_catalog', 'ambiguous', 'low_quality'];
const partitions = ['references', 'calibration', 'final'];

export function normalize(values, dimensions) {
  if (!Array.isArray(values) || values.length !== dimensions || values.some(value => typeof value !== 'number' || !Number.isFinite(value))) throw Error('Invalid vector');
  const norm = Math.hypot(...values);
  if (!Number.isFinite(norm) || norm <= 1e-12) throw Error('Zero vector');
  return values.map(value => value / norm);
}

export async function loadManifest(file) {
  const root = dirname(resolve(file));
  const manifest = JSON.parse(await readFile(file, 'utf8'));
  if (manifest.version !== 1 || !manifest.model || !manifest.signature || !Number.isInteger(manifest.dimensions) || manifest.dimensions < 2 || !Array.isArray(manifest.entries)) throw Error('Invalid manifest metadata');
  const paths = new Set(), digests = new Set(), artifacts = new Set(), present = new Set(), entries = [];
  for (const entry of manifest.entries) {
    if (!partitions.includes(entry.partition) || typeof entry.file !== 'string' || !entry.file.startsWith(`${entry.partition}/`) || isAbsolute(entry.file) || entry.file.includes('\\') || extname(entry.file).toLowerCase() !== '.jpg' || !/^[a-f0-9]{64}$/.test(entry.sha256)) throw Error(`Invalid entry: ${entry.file}`);
    const path = resolve(root, entry.file);
    if (relative(root, path).startsWith('..') || paths.has(entry.file)) throw Error(`Invalid or duplicate path: ${entry.file}`);
    const bytes = await readFile(path);
    if (bytes[0] !== 255 || bytes[1] !== 216 || bytes.at(-2) !== 255 || bytes.at(-1) !== 217) throw Error(`Invalid JPEG: ${entry.file}`);
    const digest = createHash('sha256').update(bytes).digest('hex');
    if (digest !== entry.sha256 || digests.has(digest)) throw Error(`Digest mismatch or duplicate image: ${entry.file}`);
    paths.add(entry.file); digests.add(digest); present.add(entry.partition);
    if (entry.partition === 'references') {
      if (!entry.expected || entry.expected.startsWith('_') || entry.scenario !== undefined) throw Error(`Invalid reference: ${entry.file}`);
      artifacts.add(entry.expected);
    } else if (!scenarios.includes(entry.scenario)) throw Error(`Invalid scenario: ${entry.file}`);
    entries.push({ ...entry, path });
  }
  if (artifacts.size < 2 || partitions.some(partition => !present.has(partition))) throw Error('Need two artifacts and all partitions');
  for (const entry of entries.filter(item => item.partition !== 'references')) {
    const known = entry.scenario.startsWith('known_');
    if (known ? !artifacts.has(entry.expected) : entry.expected !== `_${entry.scenario === 'out_of_catalog' ? 'unknown' : entry.scenario}`) throw Error(`Invalid label: ${entry.file}`);
  }
  return { ...manifest, entries };
}

export function rank(scores, aggregation = 'max') {
  if (!aggregations.includes(aggregation)) throw Error(`Invalid aggregation: ${aggregation}`);
  const groups = new Map();
  for (const item of scores) {
    if (!Number.isFinite(item.score)) throw Error('Invalid score');
    if (!groups.has(item.artifact)) groups.set(item.artifact, []);
    groups.get(item.artifact).push(item);
  }
  const candidates = [...groups].map(([artifact, values]) => {
    values.sort((a, b) => b.score - a.score || a.file.localeCompare(b.file));
    const top = values.slice(0, aggregation === 'max' ? 1 : 2);
    return { artifact, score: top.reduce((sum, value) => sum + value.score, 0) / top.length, reference_scores: values };
  }).sort((a, b) => b.score - a.score || a.artifact.localeCompare(b.artifact));
  return { candidates, predicted: candidates[0]?.artifact ?? null, score: candidates[0]?.score ?? null, margin: candidates[1] ? candidates[0].score - candidates[1].score : null };
}

const fraction = (count, total) => ({ count, total, rate: total ? count / total : null });

export function summarize(rows, threshold, margin) {
  const accepted = rows.filter(row => row.score >= threshold && row.margin !== null && row.margin >= margin);
  const known = rows.filter(row => row.scenario.startsWith('known_'));
  const correct = accepted.filter(row => row.scenario.startsWith('known_') && row.predicted === row.expected);
  const falseAccept = scenario => fraction(accepted.filter(row => row.scenario === scenario).length, rows.filter(row => row.scenario === scenario).length);
  const artifacts = [...new Set(known.map(row => row.expected))].sort();
  return {
    total: rows.length,
    top1_accuracy_known: fraction(known.filter(row => row.predicted === row.expected).length, known.length),
    correct_acceptance_known: fraction(correct.length, known.length),
    accepted_precision: fraction(correct.length, accepted.length),
    false_acceptance_unknown: falseAccept('out_of_catalog'),
    false_acceptance_ambiguous: falseAccept('ambiguous'),
    false_acceptance_low_quality: falseAccept('low_quality'),
    rejection: fraction(rows.length - accepted.length, rows.length),
    per_artifact: Object.fromEntries(artifacts.map(artifact => {
      const subset = rows.filter(row => row.expected === artifact);
      const acceptedSubset = accepted.filter(row => row.expected === artifact);
      return [artifact, {
        total: subset.length,
        top1_correct: fraction(subset.filter(row => row.predicted === artifact).length, subset.length),
        accepted_correct: fraction(acceptedSubset.filter(row => row.predicted === artifact).length, subset.length),
      }];
    })),
    per_scenario: Object.fromEntries(scenarios.map(scenario => {
      const subset = rows.filter(row => row.scenario === scenario);
      return [scenario, { total: subset.length,
        accepted: fraction(accepted.filter(row => row.scenario === scenario).length, subset.length) }];
    })),
  };
}

export function calibrate(rows) {
  const grid = [];
  for (const aggregation of ['max', 'top2_mean']) {
    for (let threshold = 50; threshold <= 95; threshold++) {
      for (let margin = 0; margin <= 20; margin++) {
        grid.push({ aggregation, threshold: threshold / 100, margin: margin / 100,
          ...summarize(rows[aggregation], threshold / 100, margin / 100) });
      }
    }
  }
  const safe = grid.filter(row => row.false_acceptance_unknown.total && row.false_acceptance_ambiguous.total &&
    !row.false_acceptance_unknown.count && !row.false_acceptance_ambiguous.count);
  safe.sort((a, b) => (b.correct_acceptance_known.rate ?? -1) - (a.correct_acceptance_known.rate ?? -1) ||
    (b.accepted_precision.rate ?? -1) - (a.accepted_precision.rate ?? -1) || b.threshold - a.threshold ||
    b.margin - a.margin || aggregations.indexOf(a.aggregation) - aggregations.indexOf(b.aggregation));
  return { grid, selected: safe[0] ?? null };
}

export function rescore(report) {
  if (report.partition !== 'calibration' || !report.rows?.max || !report.rows?.top2_mean) throw Error('Expected calibration report');
  return { signature: report.signature, model: report.model, partition: report.partition, rows: report.rows, ...calibrate(report.rows) };
}

export async function embed(manifest, cacheFile, request = fetch) {
  let cache;
  try { cache = JSON.parse(await readFile(cacheFile, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; cache = { signature: manifest.signature, vectors: {}, timings: {} }; }
  if (cache.signature !== manifest.signature || !cache.vectors) throw Error('Embedding cache signature mismatch');
  for (const entry of manifest.entries) {
    if (cache.vectors[entry.sha256]) { normalize(cache.vectors[entry.sha256], manifest.dimensions); continue; }
    if (!process.env.OPENROUTER_API_KEY) throw Error('Set OPENROUTER_API_KEY before embedding');
    const started = performance.now();
    const bytes = await readFile(entry.path);
    const response = await request('https://openrouter.ai/api/v1/embeddings', {
      method: 'POST', signal: AbortSignal.timeout(90_000),
      headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json', 'X-Title': 'Museum Embedding Lab' },
      body: JSON.stringify({ model: manifest.model, dimensions: manifest.dimensions, encoding_format: 'float',
        input: [{ content: [{ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${bytes.toString('base64')}` } }] }] }),
    });
    if (!response.ok) throw Error(`OpenRouter HTTP ${response.status} for ${entry.file}`);
    const result = await response.json();
    if (![manifest.model, manifest.model.split('/').pop()].includes(result.model)) throw Error(`Unexpected response model for ${entry.file}`);
    cache.vectors[entry.sha256] = normalize(result.data?.[0]?.embedding, manifest.dimensions);
    cache.timings ??= {};
    cache.timings[entry.sha256] = Math.round(performance.now() - started);
    await writeFile(cacheFile, JSON.stringify(cache));
  }
  return cache;
}

export function evaluate(manifest, cache, partition, selected = { aggregation: 'max', threshold: .8, margin: .05 }) {
  if (!['calibration', 'final'].includes(partition) || cache.signature !== manifest.signature) throw Error('Invalid partition or cache signature');
  if (partition === 'final' && (!aggregations.includes(selected.aggregation) || !Number.isFinite(selected.threshold) || !Number.isFinite(selected.margin))) throw Error('Invalid calibration selection');
  const references = manifest.entries.filter(entry => entry.partition === 'references');
  const queries = manifest.entries.filter(entry => entry.partition === partition);
  if (!queries.length) throw Error(`No ${partition} images`);
  const rows = Object.fromEntries(aggregations.map(aggregation => [aggregation, []]));
  const referenceVectors = references.map(entry => normalize(cache.vectors[entry.sha256], manifest.dimensions));
  for (const query of queries) {
    const vector = normalize(cache.vectors[query.sha256], manifest.dimensions);
    const scores = references.map((reference, index) => ({ artifact: reference.expected, file: reference.file,
      score: vector.reduce((sum, value, dimension) => sum + value * referenceVectors[index][dimension], 0) }));
    for (const aggregation of aggregations) rows[aggregation].push({ file: query.file, expected: query.expected,
      scenario: query.scenario, embedding_ms: cache.timings?.[query.sha256] ?? null, ...rank(scores, aggregation) });
  }
  const report = { signature: manifest.signature, model: manifest.model, partition, created_at: new Date().toISOString(),
    note: 'Exact local cosine search over all references; Vectorize topK and eventual consistency may differ.', rows };
  if (partition === 'calibration') Object.assign(report, calibrate(rows));
  else {
    for (const row of rows[selected.aggregation]) row.accepted = row.score >= selected.threshold && row.margin !== null && row.margin >= selected.margin;
    Object.assign(report, { selected: { aggregation: selected.aggregation, threshold: selected.threshold, margin: selected.margin },
      summary: summarize(rows[selected.aggregation], selected.threshold, selected.margin) });
  }
  return report;
}

async function main() {
  const [command, source, output, partition, calibrationFile] = process.argv.slice(2);
  if (!source || !output) throw Error('Usage: node scripts/recognition-eval.mjs <embed|evaluate|rescore> <manifest|report> <output> [calibration|final] [calibration-report]');
  if (command === 'rescore') {
    await writeFile(output, JSON.stringify(rescore(JSON.parse(await readFile(source, 'utf8'))), null, 2));
    return;
  }
  const manifest = await loadManifest(source);
  if (command === 'embed') {
    await embed(manifest, output);
    return;
  }
  if (command !== 'evaluate') throw Error(`Unknown command: ${command}`);
  const cache = JSON.parse(await readFile(resolve(dirname(source), 'embeddings.json'), 'utf8'));
  let selected;
  if (partition === 'final') {
    if (!calibrationFile) throw Error('Final evaluation requires a calibration report');
    selected = JSON.parse(await readFile(calibrationFile, 'utf8')).selected;
    if (!selected) throw Error('Calibration found no safe configuration');
  }
  await writeFile(output, JSON.stringify(evaluate(manifest, cache, partition, selected), null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
