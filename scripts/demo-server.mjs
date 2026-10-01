// Isolated, in-memory browser test/demo. No keys, remote databases or paid calls.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import worker from '../worker/index.js';
import { database, seed, envDefaults } from '../tests/fixtures.mjs';
import { signature } from '../worker/pipeline.js';

const demoDefaults = { ...envDefaults, RECOGNITION_PIPELINE: 'image-description-v1' };

const port=Number(process.env.DEMO_PORT || 4179);
const root=resolve('dist/client');
let db,scenario,embeddings;
const imageStorage=new Map();
function illustration(key) {
  const shapes=[
    '<path d="M160 80h80l-8 90c0 28 65 53 65 104 0 59-41 71-97 71s-97-12-97-71c0-51 65-76 65-104z" fill="#bd7959"/><path d="M120 251q80 45 160 0M120 282q80 45 160 0" fill="none" stroke="#f5dcc0" stroke-width="9"/><ellipse cx="200" cy="81" rx="40" ry="10" fill="#713f32"/>',
    '<rect x="100" y="85" width="200" height="250" rx="10" fill="#214a39"/><path d="M125 85v250" stroke="#c3a66d" stroke-width="4"/><rect x="155" y="130" width="110" height="140" rx="3" fill="none" stroke="#c3a66d" stroke-width="3"/><path d="M180 185h60m-60 20h60m-60 20h40" stroke="#c3a66d" stroke-width="4"/>',
    '<path d="M270 145h30q65 65-10 105h-35" fill="none" stroke="#c17d4e" stroke-width="20"/><path d="M100 130h170v140q0 60-85 60t-85-60z" fill="#d4a676"/><ellipse cx="185" cy="130" rx="85" ry="22" fill="#9a6947"/><path d="M100 195h170" stroke="#f8ead3" stroke-width="13"/>',
    '<circle cx="200" cy="200" r="122" fill="#fff9e9" stroke="#926c42" stroke-width="14"/><path d="M200 97v20m103 83h-20m-83 103v-20M97 200h20" stroke="#926c42" stroke-width="6"/><path d="M200 130v70l60 38" fill="none" stroke="#254d3c" stroke-width="9" stroke-linecap="round"/><circle cx="200" cy="200" r="10" fill="#254d3c"/>',
    '<g transform="rotate(-30 200 200)"><circle cx="150" cy="160" r="57" fill="none" stroke="#b6944b" stroke-width="25"/><path d="M194 198l114 110m-36-37l-25 25m8-42l-25 25" fill="none" stroke="#b6944b" stroke-width="24"/></g>',
  ];
  const index=Number(String(key).split('/').pop())-1;
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400"><rect width="400" height="400" fill="#f0e9db"/><ellipse cx="200" cy="354" rx="115" ry="12" fill="#ddd3bf"/>${shapes[index] || shapes[0]}<text x="200" y="387" text-anchor="middle" font-family="sans-serif" font-size="10" letter-spacing="3" fill="#806e50">MINH HỌA DEMO</text></svg>`);
}
function reset() {
  imageStorage.clear();
  db?.sqlite.close();db=database();seed(db,5,signature(demoDefaults));scenario={winner:1,score:.95,second:.5};embeddings=0;
  ['Chiếc bình gốm','Cuốn sách nhỏ','Chiếc cốc','Chiếc đồng hồ','Chiếc chìa khóa'].forEach((name,i)=>{
    db.sqlite.prepare('UPDATE artifacts SET name=? WHERE id=?').run(name,`a${i+1}`);
  });
}
reset();
const nativeFetch=globalThis.fetch;
globalThis.fetch=async (url,options) => {
  if(!String(url).startsWith('https://openrouter.ai/')) return nativeFetch(url,options);
  if(String(url).endsWith('/models')) return Response.json({data:[{id:envDefaults.OPENROUTER_MODEL,architecture:{input_modalities:['image','text']}}]});
  if(String(url).endsWith('/chat/completions')) return Response.json({model:'google/gemini-2.5-flash',choices:[{finish_reason:'stop',message:{content:'A printed stamp showing a distinctive central illustration.'}}]});
  embeddings++;
  if(scenario.delay) await new Promise(r=>setTimeout(r,scenario.delay));
  if(scenario.error) return new Response('',{status:502});
  return Response.json({model:envDefaults.OPENROUTER_MODEL,data:[{embedding:[1,...Array(1535).fill(0)]}]});
};
function environment() { return {...demoDefaults,DB:db,
  VECTORIZE:{query:async(vector,options)=>({matches:db.sqlite.prepare("SELECT vector_id,artifact_id FROM reference_images WHERE status='ready' ORDER BY artifact_id,vector_id").all().map((row,i)=>({id:row.vector_id,score:row.artifact_id===(typeof scenario.winner==='number'?`a${scenario.winner}`:scenario.winner)?scenario.score:scenario.second-i*.01,metadata:{artifact_id:row.artifact_id}})).filter(match=>match.metadata.artifact_id!==options.filter?.artifact_id?.$ne)}),upsert:async()=>({}),deleteByIds:async()=>({})},
  IMAGES:{get:async key=>{
    const entry=imageStorage.get(key) || {body:illustration(key),httpMetadata:{contentType:'image/svg+xml'}};
    return {...entry,arrayBuffer:async()=>entry.body};
  },put:async(key,body,options)=>{imageStorage.set(key,{body:Buffer.from(body),httpMetadata:options?.httpMetadata});},delete:async key=>{imageStorage.delete(key);}},
  ASSETS:{fetch:async request=>{
    const path=decodeURIComponent(new URL(request.url).pathname);
    const full=resolve(root,`.${path}`);
    if(full!==root && !full.startsWith(root+sep)) return new Response('Not found',{status:404});
    const mime={'.js':'text/javascript','.css':'text/css','.html':'text/html','.svg':'image/svg+xml'};
    try { return new Response(await readFile(full),{headers:{'Content-Type':mime[extname(full)]||'application/octet-stream'}}); }
    catch { return new Response(await readFile(resolve(root,'index.html')),{headers:{'Content-Type':'text/html'}}); }
  }},
}; }
const server=createServer(async(req,res)=>{
  try {
    const chunks=[];for await(const chunk of req) chunks.push(chunk);const body=Buffer.concat(chunks);
    if(req.url==='/__test/reset') {reset();res.end('ok');return;}
    if(req.url==='/__test/scenario') {scenario={...scenario,...JSON.parse(body.toString())};res.end('ok');return;}
    if(req.url==='/__test/stats') {res.setHeader('Content-Type','application/json');res.end(JSON.stringify({embeddings}));return;}
    const request=new Request(`http://${req.headers.host}${req.url}`,{method:req.method,headers:req.headers,...(!['GET','HEAD'].includes(req.method)?{body}: {})});
    let response=await worker.fetch(request,environment());
    if(req.url === '/api/admin/usage' && response.ok) response=Response.json({...await response.json(),demo:true},{status:response.status,headers:response.headers});
    res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
  } catch(error) {console.error(error);res.statusCode=500;res.end('Demo server error');}
});
server.listen(port,'127.0.0.1',()=>console.log(`Isolated demo: http://localhost:${port} (simulated recognition, no API charges)`));
