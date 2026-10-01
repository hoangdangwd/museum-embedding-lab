import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCameraZoom, videoFrameRect } from '../src/camera-zoom.js';

const settle = () => new Promise(resolve => setImmediate(resolve));
function camera({ max = 3, base = 1, step = .1 } = {}) {
  let zoom = base;
  const calls = [];
  return {
    calls,
    getCapabilities: () => ({ zoom: { min: 1, max, step } }),
    getSettings: () => ({ zoom }),
    applyConstraints: async constraints => { zoom = constraints.advanced[0].zoom; calls.push(zoom); },
  };
}

test('capture rectangle matches object-fit cover, digital zoom and orientation changes', () => {
  assert.deepEqual(videoFrameRect(1600,1200,300,400), {x:350,y:0,w:900,h:1200});
  assert.deepEqual(videoFrameRect(1600,1200,300,400,2), {x:575,y:300,w:450,h:600});
  assert.deepEqual(videoFrameRect(1200,1600,400,300,2), {x:300,y:575,w:600,h:450});
  assert.throws(() => videoFrameRect(0,1200,300,400));
  assert.throws(() => videoFrameRect(1600,1200,300,400,NaN));
});

test('missing or throwing capability APIs retain immediate digital zoom', () => {
  for (const track of [{}, {getCapabilities() {throw Error('unsupported');},getSettings() {throw Error('unsupported');}}]) {
    const zoom=createCameraZoom(track,()=>{});
    zoom.set(2.5);
    assert.equal(zoom.state.digital,2.5);
    assert.equal(zoom.state.busy,false);
    zoom.set(100);assert.equal(zoom.state.value,4);
    zoom.set(0);assert.equal(zoom.state.value,1);
    zoom.set(NaN);assert.equal(zoom.state.value,1);
  }
});

test('hardware zoom is relative to the starting lens and digital fills the remainder',async()=>{
  const track=camera({base:2,max:6});
  const zoom=createCameraZoom(track,()=>{});
  zoom.set(2);await settle();
  assert.deepEqual(track.calls,[4]);
  assert.equal(zoom.state.digital,1);
  zoom.set(4);await settle();
  assert.deepEqual(track.calls,[4,6]);
  assert.equal(zoom.state.digital,4/3);
  zoom.set(1);await settle();
  assert.equal(track.getSettings().zoom,2);
  assert.equal(zoom.state.digital,1);
});

test('snaps native zoom down to supported steps and retains exact requested magnification',async()=>{
  const track=camera({step:.5});
  const zoom=createCameraZoom(track,()=>{});
  zoom.set(2.25);await settle();
  assert.equal(track.getSettings().zoom,2);
  assert.equal(zoom.state.digital,1.125);
});

test('rejected and silently ignored native constraints fall back without blocking capture',async()=>{
  for(const applyConstraints of [async()=>{throw Error('unsupported');},async()=>{}]) {
    const track=camera();track.applyConstraints=applyConstraints;
    const zoom=createCameraZoom(track,()=>{});
    zoom.set(2);await settle();
    assert.equal(zoom.state.digital,2);
    assert.equal(zoom.state.busy,false);
    zoom.set(3);assert.equal(zoom.state.digital,3);
  }
});

test('failed native reset preserves the measured crop and exposes its minimum',async()=>{
  const track=camera();const apply=track.applyConstraints;
  const zoom=createCameraZoom(track,()=>{});
  zoom.set(2);await settle();
  track.applyConstraints=async()=>{throw Error('camera changed');};
  zoom.set(1);await settle();
  assert.equal(zoom.state.min,2);
  assert.equal(zoom.state.value,2);
  assert.equal(zoom.state.digital,1);
  zoom.set(4);assert.equal(zoom.state.digital,2);
  track.applyConstraints=apply;
});

test('rapid gestures serialize hardware requests and coalesce to the latest value',async()=>{
  const track=camera();const apply=track.applyConstraints;
  const pending=[];
  track.applyConstraints=constraints=>new Promise(resolve=>pending.push(async()=>{await apply(constraints);resolve();}));
  const zoom=createCameraZoom(track,()=>{});
  zoom.set(2);zoom.set(2.5);zoom.set(3);
  assert.equal(zoom.state.value,3);
  assert.equal(pending.length,1);
  assert.equal(zoom.state.busy,true);
  await pending.shift()();await settle();
  assert.equal(pending.length,1);
  await pending.shift()();await settle();
  assert.deepEqual(track.calls,[2,3]);
  assert.equal(zoom.state.value,3);
  assert.equal(zoom.state.digital,1);
  assert.equal(zoom.state.busy,false);
});

test('disposing while a native request is pending suppresses late UI updates',async()=>{
  const track=camera();let release;const updates=[];
  track.applyConstraints=()=>new Promise(resolve=>{release=resolve;});
  const zoom=createCameraZoom(track,state=>updates.push(state));
  zoom.set(2);zoom.dispose();const count=updates.length;
  release();await settle();zoom.set(3);
  assert.equal(updates.length,count);
});
