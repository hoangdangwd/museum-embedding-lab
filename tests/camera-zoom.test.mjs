import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cameraGuideRect, createCameraZoom, videoCropRect, videoFrameRect } from '../src/camera-zoom.js';

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

test('guide crop maps only the displayed rectangle to original video pixels', () => {
  assert.deepEqual(videoCropRect(1600,1200,300,400,2,{x:30,y:40,w:240,h:320}),{x:620,y:360,w:360,h:480});
  assert.deepEqual(videoCropRect(1600,1200,300,400),videoFrameRect(1600,1200,300,400));
  for (const frame of [{x:-1,y:0,w:100,h:100},{x:0,y:0,w:0,h:10},{x:10,y:10,w:300,h:100},{x:0,y:0,w:NaN,h:10}]) {
    assert.throws(()=>videoCropRect(1600,1200,300,400,1,frame));
  }
});

test('guide preserves its aspect and margins across landscape and portrait viewports', () => {
  for (const [w,h] of [[300,400],[844,180],[600,480]]) for (const orientation of ['portrait','landscape']) {
    const g=cameraGuideRect(w,h,orientation);
    assert.ok(Math.abs(g.w/g.h-(orientation==='portrait'?.75:4/3))<1e-10);
    assert.ok(g.x>0&&g.y>0&&g.x+g.w<w&&g.y+g.h<h);
    assert.ok(Math.abs(g.x*2+g.w-w)<1e-9);
    const crop=videoCropRect(1600,1200,w,h,2,g);
    assert.ok(crop.w<videoFrameRect(1600,1200,w,h,2).w);
  }
  assert.throws(()=>cameraGuideRect(0,400));
  assert.throws(()=>cameraGuideRect(300,400,'square'));
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
