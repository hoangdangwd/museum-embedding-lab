import React, { useEffect, useRef, useState } from 'react';

// Coordinates are fractions of the oriented original image, never of a
// thumbnail. Crop stays lossless until the caller confirms JPEG export.
export function CropEditor({ file, crop, onChange, disabled = false, onReady }) {
  const [url,setUrl] = useState('');
  const [selecting,setSelecting] = useState(Boolean(crop));
  const [error,setError] = useState('');
  const [loaded,setLoaded] = useState(false);
  const [aspect,setAspect] = useState(4/3);
  const start = useRef(null);
  const readyCallback = useRef(onReady);
  readyCallback.current = onReady;
  useEffect(() => {
    const next=URL.createObjectURL(file);
    setUrl(next); setError(''); setLoaded(false); setSelecting(Boolean(crop));
    start.current=null; readyCallback.current?.(false);
    return () => URL.revokeObjectURL(next);
  },[file]);
  const blocked=disabled || !loaded;
  function point(e) {
    const box=e.currentTarget.getBoundingClientRect();
    return {x:Math.max(0,Math.min(1,(e.clientX-box.left)/box.width)),y:Math.max(0,Math.min(1,(e.clientY-box.top)/box.height))};
  }
  function begin(e) {
    if (blocked || !selecting || !e.isPrimary || (e.pointerType==='mouse' && e.button!==0)) return;
    e.preventDefault(); e.currentTarget.setPointerCapture?.(e.pointerId);
    start.current={...point(e),id:e.pointerId};
  }
  function move(e) {
    const s=start.current;
    if (!s || e.pointerId!==s.id || blocked) return;
    const p=point(e);
    const next={x:Math.min(s.x,p.x),y:Math.min(s.y,p.y),w:Math.abs(s.x-p.x),h:Math.abs(s.y-p.y)};
    if (next.w>=.02 && next.h>=.02) onChange(next);
  }
  function finish(e) {if (e.pointerId===start.current?.id) start.current=null;}
  const area=crop || {x:0,y:0,w:1,h:1};
  return <div className="crop-editor">
    <div style={{'--image-aspect':aspect}} className={`crop-stage ${selecting && !blocked ? 'selecting' : ''}`} onPointerDown={begin} onPointerMove={move}
      onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish}>
      <img src={url || undefined} alt="Ảnh trước khi gửi. Có thể khoanh vùng quanh hiện vật." draggable="false"
        onLoad={e=>{
          const valid=Math.min(e.currentTarget.naturalWidth,e.currentTarget.naturalHeight)>=64;
          setAspect(e.currentTarget.naturalWidth/e.currentTarget.naturalHeight);
          setLoaded(valid);readyCallback.current?.(valid);
          if(!valid) setError('Ảnh quá nhỏ. Hãy chọn ảnh có cả hai chiều từ 64 px.');
        }} onError={()=>{setLoaded(false);setError('Không đọc được ảnh. Hãy chọn JPEG hoặc PNG khác.');readyCallback.current?.(false);}} />
      {crop && <div className="crop-box" style={{left:`${crop.x*100}%`,top:`${crop.y*100}%`,width:`${crop.w*100}%`,height:`${crop.h*100}%`}} />}
    </div>
    <button type="button" className="btn-secondary" disabled={blocked} aria-pressed={selecting}
      onClick={()=>{setSelecting(!selecting);onChange(null);start.current=null;}}>{selecting ? 'Dùng toàn ảnh' : 'Khoanh vùng vật'}</button>
    {selecting && <>
      <p className="small-note">Kéo trên ảnh hoặc dùng các thanh điều chỉnh. Giữ trọn vật và một ít khoảng trống xung quanh.</p>
      <div className="crop-sliders">
        <label>Thu gọn khung<input disabled={blocked} type="range" min="10" max="100" step="1" value={Math.round(area.w*100)}
          onChange={e=>{const size=Number(e.target.value)/100;onChange({x:(1-size)/2,y:(1-size)/2,w:size,h:size});}} /></label>
        <label>Chiều cao khung<input disabled={blocked} type="range" min="10" max="100" step="1" value={Math.round(area.h*100)}
          onChange={e=>{const h=Number(e.target.value)/100;onChange({...area,h,y:Math.min(area.y,1-h)});}} /></label>
        <label>Dịch ngang<input disabled={blocked} type="range" min="0" max="100" step="1" value={area.w<1 ? Math.round(area.x/(1-area.w)*100) : 0}
          onChange={e=>onChange({...area,x:Number(e.target.value)/100*(1-area.w)})} /></label>
        <label>Dịch dọc<input disabled={blocked} type="range" min="0" max="100" step="1" value={area.h<1 ? Math.round(area.y/(1-area.h)*100) : 0}
          onChange={e=>onChange({...area,y:Number(e.target.value)/100*(1-area.h)})} /></label>
      </div>
    </>}
    {error && <p className="hunt-notice" role="alert">{error}</p>}
  </div>;
}
