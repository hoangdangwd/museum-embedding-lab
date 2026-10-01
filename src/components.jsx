import React, { useEffect, useRef, useState } from 'react';
import { createCameraZoom } from './camera-zoom.js';
import { videoPhoto } from './media.js';
export function Icon({ name, className = 'icon' }) {
  const icons = {
        lens: (
      <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <circle cx="12" cy="12" r="4" />
        <line x1="4.93" y1="4.93" x2="9.17" y2="9.17" />
        <line x1="14.83" y1="14.83" x2="19.07" y2="19.07" />
        <line x1="14.83" y1="9.17" x2="19.07" y2="4.93" />
        <line x1="4.93" y1="19.07" x2="9.17" y2="14.83" />
      </svg>
    ),
    chart: (
      <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <line x1="18" y1="20" x2="18" y2="10" />
        <line x1="12" y1="20" x2="12" y2="4" />
        <line x1="6" y1="20" x2="6" y2="14" />
      </svg>
    ),
    museum: (
      <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <circle cx="12" cy="12" r="4" />
        <line x1="4.93" y1="4.93" x2="9.17" y2="9.17" />
        <line x1="14.83" y1="14.83" x2="19.07" y2="19.07" />
      </svg>
    ),
    camera: (
      <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" />
        <circle cx="12" cy="13" r="3.5" />
      </svg>
    ),
    upload: (
      <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="17 8 12 3 7 8" />
        <line x1="12" y1="3" x2="12" y2="15" />
      </svg>
    ),
    book: (
      <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
      </svg>
    ),
    torch: (
      <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
      </svg>
    ),
    flip: (
      <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 10c0-4.418-3.582-8-8-8s-8 3.582-8 8c0 1.956.702 3.75 1.874 5.144L4 17h5v-5L7.26 13.74A6.002 6.002 0 0 1 6 10c0-3.314 2.686-6 6-6s6 2.686 6 6c0 1.488-.543 2.85-1.442 3.896" />
        <path d="M4 14c0 4.418 3.582 8 8 8s8-3.582 8-8c0-1.956-.702-3.75-1.874-5.144L20 7h-5v5l1.74-1.74A6.002 6.002 0 0 1 18 14c0 3.314-2.686 6-6 6s-6-2.686-6-6" />
      </svg>
    ),
    check: (
      <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="20 6 9 17 4 12" />
      </svg>
    ),
    help: (
      <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
    ),
    trash: (
      <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="3 6 5 6 21 6" />
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      </svg>
    ),
    close: (
      <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="18" y1="6" x2="6" y2="18" />
        <line x1="6" y1="6" x2="18" y2="18" />
      </svg>
    ),
    arrowRight: (
      <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="5" y1="12" x2="19" y2="12" />
        <polyline points="12 5 19 12 12 19" />
      </svg>
    ),
    search: (
      <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
    ),
    retry: (
      <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M23 4v6h-6" />
        <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
      </svg>
    ),
  };
  return icons[name] || null;
}

export function CameraCapture({ onBack, onCapture, onUploadFallback }) {
  const video = useRef(null);
  const viewport = useRef(null);
  const cameraSection = useRef(null);
  useEffect(() => { cameraSection.current?.scrollIntoView({ block: 'start', behavior: 'instant' }); }, []);
  const stream = useRef(null);
  const zoomController = useRef(null);
  const points = useRef(new Map());
  const pinch = useRef(null);
  const callback = useRef(onBack);
  callback.current = onBack;
  const [opening, setOpening] = useState(true);
  const [capturing, setCapturing] = useState(false);
  const [captureError, setCaptureError] = useState('');
  const [torchOn, setTorchOn] = useState(false);
  const [hasTorch, setHasTorch] = useState(false);
  const [facingMode, setFacingMode] = useState('environment');
  const [restart, setRestart] = useState(0);
  const [zoom, setZoom] = useState({ value: 1, digital: 1, min: 1, max: 4, busy: false });

  useEffect(() => {
    let active = true;
    let camera;
    let ended;
    if (!navigator.mediaDevices?.getUserMedia) {
      callback.current('Trình duyệt chưa hỗ trợ tính năng camera.');
      return;
    }

    setOpening(true);
    setCaptureError('');
    setHasTorch(false);
    setTorchOn(false);
    setZoom({ value: 1, digital: 1, min: 1, max: 4, busy: false });
    if (video.current) video.current.style.transform = 'scale(1)';
    points.current.clear(); pinch.current = null;
    navigator.mediaDevices
      .getUserMedia({
        video: {
          facingMode: { ideal: facingMode },
          width: { ideal: 1600 },
          height: { ideal: 1200 },
        },
        audio: false,
      })
      .then(async opened => {
        camera = opened;
        if (!active) {
          camera.getTracks().forEach(track => track.stop());
          return;
        }
        stream.current = camera;
        video.current.srcObject = camera;
        await video.current.play();
        if (!active) return;

        const track = camera.getVideoTracks()[0];
        try { setHasTorch(Boolean(track?.getCapabilities?.().torch)); } catch { /* Optional capability. */ }
        zoomController.current = createCameraZoom(track, next => {
          if (!active) return;
          if (video.current) video.current.style.transform = `scale(${next.digital})`;
          setZoom(next);
        });
        ended = () => { if (active) callback.current('Camera đã bị ngắt. Hãy mở lại camera.'); };
        track?.addEventListener('ended', ended);
        setOpening(false);
      })
      .catch(error => {
        if (active) {
          callback.current(
            error.name === 'NotAllowedError'
              ? 'Vui lòng cấp quyền truy cập camera trong cài đặt trình duyệt để tiếp tục.'
              : 'Không thể mở camera trên thiết bị.'
          );
        }
      });

    return () => {
      active = false;
      zoomController.current?.dispose();
      zoomController.current = null;
      camera?.getVideoTracks()[0]?.removeEventListener('ended', ended);
      camera?.getTracks().forEach(track => track.stop());
      stream.current = null;
    };
  }, [facingMode, restart]);

  const toggleTorch = async () => {
    const track = stream.current?.getVideoTracks()[0];
    if (!track) return;
    try {
      const nextState = !torchOn;
      await track.applyConstraints({
        advanced: [{ torch: nextState }],
      });
      setTorchOn(nextState);
    } catch {
      // Torch fallback
    }
  };

  const flipCamera = () => {
    setFacingMode(prev => (prev === 'environment' ? 'user' : 'environment'));
  };

  const handleShutter = async () => {
    if (!video.current || opening || capturing || zoomController.current?.state.busy) return;
    setCapturing(true); setCaptureError('');
    try {
      const box = viewport.current;
      const blob = await videoPhoto(video.current, { viewportWidth: box.clientWidth, viewportHeight: box.clientHeight, zoom: zoomController.current?.state.digital || 1 });
      navigator.vibrate?.(40);
      await onCapture(blob);
    } catch (error) { setCaptureError(error.message); }
    finally { setCapturing(false); }
  };

  function setMagnification(value) { if (!opening && !capturing) zoomController.current?.set(value); }
  function updatePinch(values) {
    if (values.length !== 2) { pinch.current = null; return; }
    const distance = Math.hypot(values[0].x-values[1].x, values[0].y-values[1].y);
    if (!pinch.current) pinch.current = { distance, value: zoomController.current?.state.value || 1 };
    else if (pinch.current.distance > 0) setMagnification(pinch.current.value * distance / pinch.current.distance);
  }
  function pointerDown(event) {
    if (opening || capturing) return;
    points.current.set(event.pointerId,{ x:event.clientX, y:event.clientY });
    event.currentTarget.setPointerCapture?.(event.pointerId);
    updatePinch([...points.current.values()]);
  }
  function pointerMove(event) {
    if (!points.current.has(event.pointerId)) return;
    points.current.set(event.pointerId,{ x:event.clientX, y:event.clientY });
    updatePinch([...points.current.values()]);
  }
  function pointerEnd(event) { points.current.delete(event.pointerId); pinch.current=null; }
  function touchChange(event) {
    if (window.PointerEvent) return;
    updatePinch([...event.touches].map(t=>({x:t.clientX,y:t.clientY})));
  }

  return (
    <section ref={cameraSection} className="camera-stage">
      <div className="camera-nav-bar">
        <button className="nav-back-btn" disabled={capturing} onClick={() => onBack()}>
          ← Quay lại
        </button>
        <div className="camera-top-controls">
          {hasTorch && (
            <button
              className={`cam-tool-btn ${torchOn ? 'active' : ''}`}
              onClick={toggleTorch}
              disabled={opening || capturing || zoom.busy}
              title={torchOn ? 'Tắt đèn' : 'Bật đèn'}
            >
              <Icon name="torch" />
              <span>{torchOn ? 'Bật đèn' : 'Đèn'}</span>
            </button>
          )}
          <button className="cam-tool-btn" disabled={opening || capturing} onClick={flipCamera} title="Đổi camera trước/sau">
            <Icon name="flip" />
            <span>Lật</span>
          </button>
        </div>
      </div>

      <div ref={viewport} className="viewfinder-wrap zoom-viewfinder" onPointerDown={pointerDown} onPointerMove={pointerMove}
        onPointerUp={pointerEnd} onPointerCancel={pointerEnd} onLostPointerCapture={pointerEnd}
        onTouchStart={touchChange} onTouchMove={touchChange} onTouchEnd={touchChange} onTouchCancel={() => { pinch.current=null; }}>
        <video ref={video} autoPlay playsInline muted aria-label="Hình ảnh trực tiếp từ camera" />

        <div className="scanner-frame" aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
          <div className="scanner-reticle" />
        </div>

      </div>
      <p className="camera-guidance" role="status">{opening ? 'Đang khởi động camera…' : 'Giữ trọn hiện vật. Chụm hai ngón tay hoặc dùng thanh zoom.'}</p>
      <div className="camera-zoom-controls">
        <button type="button" aria-label="Giảm zoom" disabled={opening || capturing || zoom.value<=zoom.min} onClick={() => setMagnification(zoom.value-.25)}>−</button>
        <input aria-label="Zoom camera" type="range" min={zoom.min} max={zoom.max} step="0.01" value={zoom.value} disabled={opening || capturing}
          onChange={e=>setMagnification(Number(e.target.value))} />
        <button type="button" aria-label="Tăng zoom" disabled={opening || capturing || zoom.value>=zoom.max} onClick={() => setMagnification(zoom.value+.25)}>+</button>
        <output aria-label="Mức zoom">{zoom.value.toFixed(2).replace(/0$/, '')}×</output>
        <button type="button" disabled={opening || capturing} onClick={() => zoom.min>1 ? setRestart(n=>n+1) : setMagnification(1)}>1×</button>
      </div>
      <div className="viewfinder-controls camera-capture-controls">
          <button
            className="shutter-btn"
            onClick={handleShutter}
            disabled={opening || capturing || zoom.busy}
            aria-label="Chụp ảnh để nhận diện"
          >
            <span />
          </button>
          <button
            className="cam-alt-btn"
            onClick={onUploadFallback}
            disabled={capturing}
            title="Tải ảnh từ thư viện"
            aria-label="Tải ảnh từ thư viện thay vì chụp"
          >
            <Icon name="upload" />
          </button>
      </div>
      {captureError && <p role="alert" className="hunt-notice">{captureError}</p>}
    </section>
  );
}
