import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';

// Execute production SQL and constraints rather than mocking SQL string matches.
export function database() {
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  for (const file of readdirSync(new URL('../migrations/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort()) sqlite.exec(readFileSync(new URL(`../migrations/${file}`,import.meta.url),'utf8'));
  return {
    sqlite,
    prepare(sql) {
      function bound(args=[]) { return {
        bind(...values) { return bound(values); },
        async first() { return sqlite.prepare(sql).get(...args) || null; },
        async all() { return { results:sqlite.prepare(sql).all(...args) }; },
        async run() { const result=sqlite.prepare(sql).run(...args); return {meta:{changes:Number(result.changes)}}; },
      }; }
      return bound();
    },
    async batch(statements) {
      sqlite.exec('BEGIN');
      try { const values=[]; for(const statement of statements) values.push(await statement.run()); sqlite.exec('COMMIT'); return values; }
      catch(error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  };
}

export const envDefaults={ALLOW_ADMIN_LOCAL:'true',RECOGNITION_PIPELINE:'image-v1',OPENROUTER_API_KEY:'fake-test-key',OPENROUTER_MODEL:'google/gemini-embedding-2',EMBEDDING_DIMENSIONS:'1536',EMBEDDING_VERSION:'2',PREPROCESS_VERSION:'test',DAILY_EMBEDDING_LIMIT:'200'};
export const testSignature='openrouter|google/gemini-embedding-2|2|1536|test';
export function seed(db, count=3, pipelineSignature=testSignature) {
  for(let i=1;i<=count;i++) {
    db.sqlite.prepare('INSERT INTO artifacts(id,name,name_key) VALUES(?,?,?)').run(`a${i}`,`Hiện vật ${i}`,`artifact-${i}`);
    db.sqlite.prepare("INSERT INTO reference_images(id,artifact_id,filename,digest,r2_key,vector_id,status,signature) VALUES(?,?,?,?,?,?,'ready',?)")
      .run(`ref${i}`,`a${i}`,`ref${i}.jpg`,`digest${i}`,`images/${i}`,`v${i}`,pipelineSignature);
  }
}

export function imageBlob(suffix=0) { return new Blob([new Uint8Array([255,216,255,224,suffix,255,217])],{type:'image/jpeg'}); }
