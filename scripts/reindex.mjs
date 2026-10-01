// Rebuild existing Vectorize entries through authenticated admin endpoints.
// Saved vectors are reused; old references without a saved vector use one embedding.
const base=process.argv[2];
if(!base) throw new Error('Usage: node scripts/reindex.mjs http://localhost:5173');
const origin=new URL(base).origin;
const headers={};
if(process.env.CF_ACCESS_CLIENT_ID && process.env.CF_ACCESS_CLIENT_SECRET) {
  headers['CF-Access-Client-Id']=process.env.CF_ACCESS_CLIENT_ID;
  headers['CF-Access-Client-Secret']=process.env.CF_ACCESS_CLIENT_SECRET;
}
async function api(path,options={}) {
  const response=await fetch(origin+path,{...options,headers,signal:AbortSignal.timeout(60000)});
  if(!response.ok) throw new Error(`HTTP ${response.status} at ${path}`);
  return response.json();
}
const catalog=await api('/api/admin/artifacts');
let done=0,failed=0;
for(const artifact of catalog.artifacts) {
  const {images}=await api(`/api/admin/artifacts/${artifact.id}/images`);
  for(const image of images) {
    try { await api(`/api/admin/images/${image.id}/reindex`,{method:'POST'});done++; }
    catch(error) {failed++;console.error(`${image.id}: ${error.message}`);}
  }
}
console.log(JSON.stringify({rebuilt:done,failed}));
if(failed) process.exitCode=1;
