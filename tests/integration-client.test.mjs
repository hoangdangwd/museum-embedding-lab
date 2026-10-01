import test from 'node:test';
import assert from 'node:assert/strict';
import { createRecognitionClient } from '../integration/client.mjs';

const options={baseUrl:'http://localhost',token:'a-demo-token-with-more-than-32-characters'};
test('backend adapter preserves request keys, sends credentials only to the configured origin and never auto-retries',async()=>{
  const calls=[];
  const client=createRecognitionClient({...options,request:async(url,request)=>{
    calls.push({url,request});
    return Response.json({request_id:'req-test',error:{code:'PROVIDER_TIMEOUT',message:'Timeout',retryable:true}},{status:504});
  }});
  await assert.rejects(client.recognize(new Blob(['jpeg'],{type:'image/jpeg'}),'stable-action-key'),error=>error.code==='PROVIDER_TIMEOUT' && error.requestId==='req-test');
  assert.equal(calls.length,1);
  assert.equal(calls[0].url,'http://localhost/api/v1/recognitions');
  assert.equal(calls[0].request.headers['Idempotency-Key'],'stable-action-key');
  assert.equal(calls[0].request.redirect,'error');
  assert.equal(calls[0].request.headers.Authorization,`Bearer ${options.token}`);
  assert.throws(()=>client.recognize(new Blob(),''),/stable key/);
  assert.throws(()=>client.result('../catalog'),/Invalid request/);
});

test('backend adapter refuses non-HTTPS remote endpoints and URL credentials',()=>{
  for(const baseUrl of ['http://example.com','https://user:password@example.com','https://example.com/other']) assert.throws(()=>createRecognitionClient({...options,baseUrl}));
});
