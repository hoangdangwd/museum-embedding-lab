import test from 'node:test';
import assert from 'node:assert/strict';
import { jpegFrame, fitPixels, NORMALIZATION } from '../worker/jev-images.js';
import { payload, parse, CUTOFF, VERSION } from '../worker/jev-protocol.js';
import { database } from './fixtures.mjs';
import { jevConfig, reserveJev, settleJev, RESERVATION_MICROUSD } from '../worker/jev-budget.js';

test('Jev production image gate is bounded and deterministic',()=>{
  assert.equal(NORMALIZATION,'rgb-oriented-bilinear-jpeg95-fit1568-pad280-v1');
  assert.throws(()=>jpegFrame(new Uint8Array([255,216,255,224,0,2,255,217])));
  const p=fitPixels({width:64,height:64,data:new Uint8ClampedArray(64*64*4).fill(100)});
  assert.deepEqual([p.width,p.height], [280,280]);assert.equal(p.data.length,280*280*4);assert.deepEqual([...p.data.slice(0,4)],[255,255,255,255]);
});

test('Jev payload and response parser remain fixed to decisions model',()=>{
  const body=payload(new Uint8Array([255,216,255,217]),new Uint8Array([255,216,255,217]));
  assert.equal(body.model,'typesafe/jev-1.14');assert.equal(body.questions.same_physical_artwork.type,'noul');
  assert.equal(parse({model:'typesafe/jev-1.14-20261014',provider:'TypeSafe',answers:{same_physical_artwork:{type:'noul',noul:.51}}}),.51);
  assert.throws(()=>parse({model:'typesafe/jev-1.14',provider:'TypeSafe',answers:{same_physical_artwork:{type:'noul',noul:.51}}}));assert.equal(CUTOFF,.5);assert.equal(VERSION,'jev-symmetric-identity-v2');
});

test('Jev budget reserves atomically, caps concurrency, and settles fail-closed',async()=>{
 const db=database(),env={DB:db,JEV_DAILY_LIMIT:'1',JEV_DAILY_BUDGET_MICROUSD:String(RESERVATION_MICROUSD),JEV_MAX_CONCURRENCY:'1',JEV_MODE:'enforce'};
 assert.equal(jevConfig(env).mode,'enforce');const a=await reserveJev(env,jevConfig(env));assert.ok(a);assert.equal(await reserveJev(env,jevConfig(env)),null);
 await settleJev(env,a,{ok:false,code:'TIMEOUT',cost:null,state:'TIMEOUT'},12);const row=db.sqlite.prepare('SELECT state,charged_microusd,cost_known FROM jev_attempts WHERE id=?').get(a);assert.deepEqual({...row},{state:'TIMEOUT',charged_microusd:RESERVATION_MICROUSD,cost_known:0});db.sqlite.close();
});
