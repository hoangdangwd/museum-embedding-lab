// Install ONLY the owner-reviewed gallery guard release; never invokes models.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { adminClient } from './seed-stamps.mjs';
import { normalizeVector } from './seed-hard-negative.mjs';
import release from '../data/hard-negative-releases/false-accept-gallery-v1.json' with { type: 'json' };
import catalog from '../data/production-catalog.json' with { type: 'json' };

const EXPECTED = new Map([
 ['canh-cua-cham-rong-gallery-confuser-v1',['stamp-canh-cua-cham-rong','S2-08 S2-09 S2-10 S2-11 S2-12']],
 ['hai-thieu-nu-gallery-confuser-v1',['stamp-hai-thieu-nu-em-be','V0047 V0309']],
 ['em-thuy-gallery-confuser-v1',['stamp-em-thuy','V0354']],
 ['hoang-hau-crop-gallery-confuser-v1',['stamp-hoang-hau-ngoc-truc','R0740']],
]);
export function validateRelease(value = release) {
 if(value.id!=='false-accept-gallery-guards-v1'||value.owner_production_approved!==true||value.provider_calls!==0||value.reference_mutations!==0||value.dimensions!==1536||value.production_gap!==-.009||value.signature!==catalog.signature||value.catalog_release!==catalog.id||!Array.isArray(value.banks)||value.banks.length!==4)throw Error('Invalid gallery guard release');
 const ids=new Set(),groups=new Set();
 for(const bank of value.banks){
  const expected=EXPECTED.get(bank.group_key);
  if(!expected||groups.has(bank.group_key)||bank.target_external_object_id!==expected[0]||bank.vectors.map(v=>v.review_id).join(' ')!==expected[1])throw Error('Unexpected gallery guard group');
  groups.add(bank.group_key);
  for(const item of bank.vectors){
   if(!/^[a-f0-9]{64}$/.test(item.digest)||item.id!==`hn-fa-v1-${item.digest.slice(0,32)}`||ids.has(item.id))throw Error('Invalid gallery guard identity');
   ids.add(item.id);normalizeVector(item.vector);
  }
 }
 return value;
}
export function buildGalleryPayloads(value = release) {
 return validateRelease(value).banks.map(bank=>({group_key:bank.group_key,target_external_object_id:bank.target_external_object_id,signature:value.signature,vectors:bank.vectors.map(({id,digest,vector})=>({id,digest,vector:normalizeVector(vector)}))}));
}
export async function main(args = process.argv.slice(2)) {
 const [base,flag,...extra]=args;
 if(!base||extra.length||flag&&flag!=='--apply')throw Error('Usage: node scripts/seed-false-accept-guards.mjs <deployed HTTPS URL> [--apply]');
 const apply=flag==='--apply',api=adminClient(base),root='reports/false-accept-guards-v1';
 await mkdir(root,{recursive:true});
 const status=await api('/api/admin/catalog-release?check_index=1');
 if(!status.catalog_complete||status.policy?.threshold!==.8||status.policy?.margin!==.05||status.policy?.hard_negative_gap!==-.009)throw Error('Production policy/catalog drift; do not seed');
 const current=await api('/api/admin/hard-negatives');
 const backupFile=`${root}/guard-metadata-before.json`;
 try { await readFile(backupFile); } catch(e) { if(e.code!=='ENOENT')throw e; await writeFile(backupFile,JSON.stringify(current,null,2)+'\n',{flag:'wx'}); }
 const results=[];
 for(const body of buildGalleryPayloads()){
  if(apply){const result=await api(`/api/admin/hard-negatives/${encodeURIComponent(body.group_key)}`,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(body)});results.push({...result,applied:true});}
  else results.push({group_key:body.group_key,target_external_object_id:body.target_external_object_id,vector_count:body.vectors.length,applied:false});
 }
 const result={release:release.id,apply,provider_calls:0,catalog_reference_changes:0,results};
 await writeFile(`${root}/${apply?'apply':'dry-run'}.json`,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(error=>{console.error(error.message);process.exitCode=1;});
