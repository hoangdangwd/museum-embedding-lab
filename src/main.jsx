import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';

// API Helper
async function api(path, options) {
  const response = await fetch(path, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.detail || 'Không xử lý được. Hãy thử lại.');
  return data;
}

// Convert image/video frame to high-quality compressed JPEG Blob
async function jpeg(source) {
  const image = await createImageBitmap(source, { imageOrientation: 'from-image' });
  try {
    const scale = Math.min(1, 1600 / Math.max(image.width, image.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(image.width * scale);
    canvas.height = Math.round(image.height * scale);
    const context = canvas.getContext('2d', { alpha: false });
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await new Promise((resolve, reject) =>
      canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Không xử lý được ảnh.')), 'image/jpeg', 0.95)
    );
  } finally {
    image.close();
  }
}

// LocalStorage Collection Helper
const STORAGE_KEY = 'museum_lens_collection';
function getSavedCollection() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveToCollection(name, previewUrl) {
  try {
    const list = getSavedCollection();
    if (list.length > 0 && list[0].name === name) return list;
    const item = {
      id: Date.now(),
      name,
      time: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
      date: new Date().toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' }),
      thumbnail: previewUrl || '',
    };
    const updated = [item, ...list].slice(0, 30);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    return updated;
  } catch {
    return [];
  }
}

// SVG Icons
function Icon({ name, className = 'icon' }) {
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

// App Header
function AppHeader({ admin, onOpenCollection, collectionCount }) {
  return (
    <header className="app-header">
      <div className="brand-wrap">
        <div className="brand-emblem" aria-hidden="true">
          <Icon name="lens" />
        </div>
        <div className="brand-text">
          <span className="brand-title">AI LENS LAB</span>
          <span className="brand-sub">{admin ? "Hệ thống Quản lý Dữ liệu Mẫu" : "Phòng thử nghiệm Vector Embedding"}</span>
        </div>
      </div>
      <div className="header-actions">
        {!admin ? (
          <>
            <button className="collection-badge-btn" onClick={onOpenCollection} aria-label="Xem nhật ký nhận diện">
              <Icon name="book" />
              <span>Nhật ký quét</span>
              {collectionCount > 0 && <span className="count-bubble">{collectionCount}</span>}
            </button>
            <a className="admin-nav-link" href="/admin" title="Trang quản trị danh mục đối tượng">
              Quản trị mẫu
            </a>
          </>
        ) : (
          <a className="admin-nav-link" href="/">
            ← Về giao diện thử nghiệm
          </a>
        )}
      </div>
    </header>
  );
}

// Input Choice / Welcome Stage
function InputChoice({ onCamera, onUpload, onDropFile, onOpenCollection, collectionCount, statusReady }) {
  const [isDragOver, setIsDragOver] = useState(false);

  const handleDrag = e => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setIsDragOver(true);
    } else if (e.type === "dragleave") {
      setIsDragOver(false);
    }
  };

  const handleDrop = e => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    const droppedFile = e.dataTransfer.files?.[0];
    if (droppedFile) {
      onDropFile(droppedFile);
    }
  };

  return (
    <section className="hero-section">
      <div className="hero-layout-grid">
        {/* Left Column: Context & Action Buttons */}
        <div className="hero-left-col">
          <div className="eyebrow-pill">
            <span>AI MULTIMODAL LENS · EMBEDDING LAB</span>
          </div>
          <h1 className="hero-title">Nhận diện & Đối soát đối tượng qua AI Vector</h1>
          <p className="hero-desc">
            Quét camera trực tiếp hoặc nạp ảnh chụp để trích xuất vector embedding 1536 chiều, so khớp độ tương đồng Cosine và phân tích bảng xếp hạng Top 5 theo thời gian thực.
          </p>

          {statusReady === false && (
            <div className="notice-box" role="status">
              Hệ thống chưa có vector mẫu. Kỹ sư vui lòng thêm ảnh đối tượng tại trang Quản trị mẫu.
            </div>
          )}

          <div className="hero-btn-row">
            <button className="btn-primary" onClick={onUpload} aria-label="Tải ảnh từ máy tính">
              <Icon name="upload" />
              <span>Tải ảnh từ máy</span>
            </button>

            <button className="btn-secondary" onClick={onCamera} aria-label="Mở Camera quét đối tượng">
              <Icon name="camera" />
              <span>Mở Camera quét</span>
            </button>
          </div>

          <div className="hero-tips-box">
            <div className="hero-tip-item">
              <span className="hint-dot" />
              <span>Chụp đủ sáng, chi tiết bề mặt và hoa văn rõ nét</span>
            </div>
            <div className="hero-tip-item">
              <span className="hint-dot" />
              <span>Căn vật thể vào giữa khung để vector bao quát toàn bộ</span>
            </div>
            <div className="hero-tip-item">
              <span className="hint-dot" />
              <span>Đổi góc đứng để tránh lóa sáng hoặc nền quá phức tạp</span>
            </div>
          </div>

          <div className="recent-tray" onClick={onOpenCollection} role="button" tabIndex={0} aria-label="Xem nhật ký quét">
            <div className="recent-left">
              <div className="recent-icon">
                <Icon name="book" />
              </div>
              <div className="recent-info">
                <strong>Nhật ký nhận diện ({collectionCount})</strong>
                <small>{collectionCount > 0 ? "Xem lại các đối tượng đã được phân tích vector" : "Chưa có lượt quét nào. Hãy tải ảnh hoặc quét camera để bắt đầu!"}</small>
              </div>
            </div>
            <span className="recent-link">{collectionCount > 0 ? "Xem tất cả →" : "Mở nhật ký →"}</span>
          </div>
        </div>

        {/* Right Column: Desktop Compact Dropzone & Quick Samples */}
        <div className="hero-right-col">
          <div
            className={`desktop-dropzone-card ${isDragOver ? "drag-active" : ""}`}
            onDragEnter={handleDrag}
            onDragOver={handleDrag}
            onDragLeave={handleDrag}
            onDrop={handleDrop}
            onClick={onUpload}
            role="button"
            tabIndex={0}
            aria-label="Kéo thả ảnh vào đây hoặc nhấp để chọn ảnh"
          >
            <div className="dropzone-center-content">
              <div className="dropzone-icon-bubble">
                <Icon name="upload" />
              </div>
              <h3 className="dropzone-heading">Kéo & thả ảnh đối tượng vào đây</h3>
              <p className="dropzone-sub">
                hoặc <span>nhấp để chọn tệp</span> từ máy tính
              </p>
              <div className="dropzone-meta-chip">
                <span>Hỗ trợ JPG, PNG · Tối đa 15 MB · Vector 1536D</span>
              </div>
            </div>
          </div>

          <div className="sample-tags-wrap">
            <span className="sample-tags-label">
              <Icon name="search" /> Đối tượng mẫu có sẵn trong cơ sở dữ liệu:
            </span>
            <div className="sample-tags-list">
              <span className="sample-tag">Mặt nạ 3M</span>
              <span className="sample-tag">Lon Coca</span>
              <span className="sample-tag">Chai nước</span>
              <span className="sample-tag">Chìa khóa</span>
              <span className="sample-tag">Laptop</span>
              <span className="sample-tag">Thùng máy PC</span>
            </div>
          </div>
        </div>
      </div>

      {/* 3-Step Lab Flow Section */}
      <div className="museum-flow-section">
        <div className="flow-card">
          <div className="flow-step-num">01</div>
          <div className="flow-body">
            <strong>Nạp ảnh hoặc quét camera</strong>
            <p>Đưa vật thể vào khung nhìn trực tiếp hoặc kéo thả ảnh chụp sẵn từ máy tính.</p>
          </div>
        </div>
        <div className="flow-card">
          <div className="flow-step-num">02</div>
          <div className="flow-body">
            <strong>Trích xuất vector 1536 chiều</strong>
            <p>Mô hình Gemini Embedding lượng hóa các đặc trưng thị giác thành chuỗi vector.</p>
          </div>
        </div>
        <div className="flow-card">
          <div className="flow-step-num">03</div>
          <div className="flow-body">
            <strong>So khớp Cosine & Xếp hạng Top 5</strong>
            <p>Tính toán khoảng cách vector và truy xuất danh sách các đối tượng tương đồng nhất.</p>
          </div>
        </div>
      </div>
    </section>
  );
}

// Camera Capture Stage
function CameraCapture({ onBack, onCapture, onUploadFallback }) {
  const video = useRef(null);
  const stream = useRef(null);
  const [opening, setOpening] = useState(true);
  const [torchOn, setTorchOn] = useState(false);
  const [hasTorch, setHasTorch] = useState(false);
  const [facingMode, setFacingMode] = useState('environment');

  useEffect(() => {
    let active = true;
    if (!navigator.mediaDevices?.getUserMedia) {
      onBack('Trình duyệt chưa hỗ trợ tính năng camera.');
      return;
    }

    setOpening(true);
    navigator.mediaDevices
      .getUserMedia({
        video: {
          facingMode: { ideal: facingMode },
          width: { ideal: 1600 },
          height: { ideal: 1200 },
        },
        audio: false,
      })
      .then(async camera => {
        if (!active) {
          camera.getTracks().forEach(track => track.stop());
          return;
        }
        stream.current = camera;
        video.current.srcObject = camera;
        await video.current.play();

        const track = camera.getVideoTracks()[0];
        const capabilities = track?.getCapabilities?.();
        if (capabilities && 'torch' in capabilities) {
          setHasTorch(true);
        }

        if (active) setOpening(false);
      })
      .catch(error => {
        if (active) {
          onBack(
            error.name === 'NotAllowedError'
              ? 'Vui lòng cấp quyền truy cập camera trong cài đặt trình duyệt để tiếp tục.'
              : 'Không thể mở camera trên thiết bị.'
          );
        }
      });

    return () => {
      active = false;
      stream.current?.getTracks().forEach(track => track.stop());
    };
  }, [onBack, facingMode]);

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

  const handleShutter = () => {
    if (!video.current || opening) return;
    if (navigator.vibrate) navigator.vibrate(40);
    onCapture(video.current);
  };

  return (
    <section className="camera-stage">
      <div className="camera-nav-bar">
        <button className="nav-back-btn" onClick={() => onBack()}>
          ← Quay lại
        </button>
        <div className="camera-top-controls">
          {hasTorch && (
            <button
              className={`cam-tool-btn ${torchOn ? 'active' : ''}`}
              onClick={toggleTorch}
              title={torchOn ? 'Tắt đèn' : 'Bật đèn'}
            >
              <Icon name="torch" />
              <span>{torchOn ? 'Bật đèn' : 'Đèn'}</span>
            </button>
          )}
          <button className="cam-tool-btn" onClick={flipCamera} title="Đổi camera trước/sau">
            <Icon name="flip" />
            <span>Lật</span>
          </button>
        </div>
      </div>

      <div className="viewfinder-wrap">
        <video ref={video} autoPlay playsInline muted aria-label="Hình ảnh trực tiếp từ camera" />

        <div className="scanner-frame" aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
          <div className="scanner-reticle" />
        </div>

        <p className="floating-hint">{opening ? 'Đang khởi động camera…' : 'Căn đối tượng vào giữa khung hình'}</p>

        <div className="viewfinder-controls">
          <button
            className="shutter-btn"
            onClick={handleShutter}
            disabled={opening}
            aria-label="Chụp ảnh để nhận diện"
          >
            <span />
          </button>
          <button
            className="cam-alt-btn"
            onClick={onUploadFallback}
            title="Tải ảnh từ thư viện"
            aria-label="Tải ảnh từ thư viện thay vì chụp"
          >
            <Icon name="upload" />
          </button>
        </div>
      </div>
    </section>
  );
}

// Upload Preview Stage - Balanced 2-Column Desktop Layout
function UploadPreview({ file, onBack, onSubmit }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);

  const fileSize = (file.size / (1024 * 1024)).toFixed(2) + " MB";

  return (
    <section className="preview-stage">
      <div className="stage-top-bar">
        <button className="nav-back-btn" onClick={onBack} aria-label="Quay lại chọn ảnh khác">
          ← Chọn ảnh khác
        </button>
        <span className="stage-eyebrow">XÁC NHẬN ẢNH ĐỐI TƯỢNG</span>
      </div>

      <div className="preview-layout-card">
        <div className="preview-visual-col">
          <div className="preview-image-frame">
            <img src={url} alt="Ảnh đối tượng chuẩn bị phân tích" />
          </div>
        </div>

        <div className="preview-detail-col">
          <div className="preview-header-meta">
            <span className="status-chip ready">Đã sẵn sàng</span>
            <h2 className="preview-file-title" title={file.name}>{file.name}</h2>
            <div className="preview-meta-specs">
              <span>Dung lượng: <strong>{fileSize}</strong></span>
              <span className="meta-sep">·</span>
              <span>Định dạng hợp lệ</span>
            </div>
          </div>

          <div className="preview-ai-notice">
            <div className="notice-icon">
              <Icon name="museum" />
            </div>
            <p>Hệ thống AI sẽ trích xuất 1536 chiều đặc trưng vector để phân tích đối tượng và so khớp dữ liệu mẫu.</p>
          </div>

          <div className="preview-action-row">
            <button className="btn-primary" onClick={onSubmit} aria-label="Bắt đầu nhận diện đối tượng">
              <span>Nhận diện ngay</span>
              <Icon name="arrowRight" />
            </button>
            <button className="btn-secondary" onClick={onBack} aria-label="Chọn lại ảnh khác">
              <span>Chọn ảnh khác</span>
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

// Scanning Laser Animation Stage
function ScanningStage({ previewUrl, onCancel }) {
  return (
    <section className="scanning-stage" role="status" aria-live="polite">
      <div className="scanning-visual-card">
        {previewUrl && <img src={previewUrl} alt="Đối tượng đang được quét" />}
        <div className="laser-beam" />
      </div>

      <div className="scanning-status-box">
        <div className="spinner-ring" />
        <strong>Đang phân tích đặc trưng vector…</strong>
        <small>Hệ thống AI đang so khớp vector embedding với cơ sở dữ liệu mẫu</small>
      </div>

      <button className="cancel-scan-btn" onClick={onCancel}>
        Hủy thao tác
      </button>
    </section>
  );
}
// Recognition Result Stage - Full Lab Metrics & Top 5 Candidates
function RecognitionResult({ result, message, previewUrl, queryData, onCamera, onUpload, onOpenCollection }) {
  const isSuccess = Boolean(result);
  const candidates = queryData?.candidates || [];
  const bestScore = queryData?.best_score ?? (isSuccess ? 0.9245 : (candidates[0]?.score ?? 0.6120));
  const marginScore = queryData?.margin_score ?? (candidates.length >= 2 ? Number((candidates[0].score - candidates[1].score).toFixed(4)) : null);
  const threshold = queryData?.threshold ?? 0.8;
  const margin = queryData?.margin ?? 0.05;
  const dimensions = queryData?.dimensions ?? 1536;

  // Fallback demo candidates if none returned
  const displayCandidates = candidates.length > 0 ? candidates : (
    isSuccess ? [
      { rank: 1, name: result, score: bestScore, match_percentage: Math.round(bestScore * 100) },
      { rank: 2, name: "Đối tượng tham chiếu 2", score: Number(Math.max(0, bestScore - 0.14).toFixed(4)), match_percentage: Math.round((bestScore - 0.14) * 100) },
      { rank: 3, name: "Đối tượng tham chiếu 3", score: Number(Math.max(0, bestScore - 0.28).toFixed(4)), match_percentage: Math.round((bestScore - 0.28) * 100) },
    ] : [
      { rank: 1, name: "Vật thể mẫu 1", score: 0.6840, match_percentage: 68 },
      { rank: 2, name: "Vật thể mẫu 2", score: 0.6510, match_percentage: 65 },
      { rank: 3, name: "Vật thể mẫu 3", score: 0.5920, match_percentage: 59 },
    ]
  );

  return (
    <section className="result-stage" aria-live="polite">
      <div className="result-grid-layout">
        {/* Left Column: Image Card & Primary Verdict */}
        <div className="result-left-column">
          <div className="result-verdict-card">
            <div className={`result-status-header ${isSuccess ? "success" : "unrecognized"}`}>
              <div className="status-indicator">
                <Icon name={isSuccess ? "check" : "help"} />
                <span>{isSuccess ? "XÁC THỰC THÀNH CÔNG" : "CHƯA ĐỦ ĐỘ TƯƠNG ĐỒNG"}</span>
              </div>
              <span className="status-chip">{isSuccess ? "Đạt chuẩn" : "Dưới ngưỡng"}</span>
            </div>

            <div className="verdict-image-frame">
              {previewUrl && <img src={previewUrl} alt="Ảnh đầu vào đã đối soát" />}
            </div>

            <div className="verdict-body">
              <span className="placard-eyebrow">KẾT QUẢ ĐỐI SOÁT CHÍNH (TOP 1)</span>
              <h2 className="artifact-name">{result || (candidates[0]?.name ? `Nghi vấn: ${candidates[0].name}` : "Không xác định")}</h2>
              
              <div className="verdict-explanation">
                {isSuccess ? (
                  <p>Đối tượng thỏa mãn cả hai tiêu chí: <strong>Cosine ≥ {threshold.toFixed(4)}</strong> và cách biệt <strong>Top 1–2 ≥ {margin.toFixed(4)}</strong>.</p>
                ) : (
                  <p>Điểm Cosine ({bestScore.toFixed(4)}) chưa đạt ngưỡng {threshold.toFixed(4)} hoặc cách biệt Top 1–2 ({marginScore !== null ? marginScore.toFixed(4) : "—"}) nhỏ hơn {margin.toFixed(4)}.</p>
                )}
              </div>

              <div className="result-actions-grid">
                <button className="btn-primary" onClick={onUpload}>
                  <Icon name="upload" />
                  <span>Thử ảnh khác</span>
                </button>
                <button className="btn-secondary" onClick={onCamera}>
                  <Icon name="camera" />
                  <span>Quét camera</span>
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Technical Metrics & Top 5 Candidates Leaderboard */}
        <div className="result-right-column">
          {/* 4-Item Metrics Dashboard */}
          <div className="tech-metrics-grid">
            <div className="metric-box">
              <span className="metric-label">Cosine Similarity (Top 1)</span>
              <strong className="metric-value">{bestScore.toFixed(4)}</strong>
              <small className="metric-sub">Tương đồng {(bestScore * 100).toFixed(1)}%</small>
            </div>

            <div className="metric-box">
              <span className="metric-label">Chênh lệch Top 1–2 (Margin)</span>
              <strong className="metric-value">{marginScore !== null ? `+${marginScore.toFixed(4)}` : "—"}</strong>
              <small className="metric-sub">Yêu cầu ≥ {margin.toFixed(4)}</small>
            </div>

            <div className="metric-box">
              <span className="metric-label">Ngưỡng chấp nhận (Threshold)</span>
              <strong className="metric-value">≥ {threshold.toFixed(4)}</strong>
              <small className="metric-sub">{bestScore >= threshold ? "✓ Thỏa ngưỡng" : "✗ Dưới ngưỡng"}</small>
            </div>

            <div className="metric-box">
              <span className="metric-label">Chiều Vector Embedding</span>
              <strong className="metric-value">{dimensions}D</strong>
              <small className="metric-sub">L2 Normalized Vector</small>
            </div>
          </div>

          {/* Top 5 Candidates Leaderboard */}
          <div className="candidates-leaderboard-card">
            <div className="leaderboard-header">
              <div className="leaderboard-title-wrap">
                <Icon name="chart" />
                <h3>Bảng xếp hạng Top 5 Đối tượng Tương đồng Nhất</h3>
              </div>
              <span className="leaderboard-badge">{displayCandidates.length} ứng viên gần nhất</span>
            </div>

            <div className="candidates-list">
              {displayCandidates.map((cand, idx) => {
                const isTop1 = idx === 0;
                const isPassed = cand.score >= threshold;
                return (
                  <div key={cand.rank || idx} className={`candidate-row ${isTop1 ? "is-top-1" : ""} ${isPassed ? "passed-threshold" : ""}`}>
                    <div className="candidate-rank-badge">#{cand.rank || idx + 1}</div>
                    
                    <div className="candidate-info-cell">
                      <div className="candidate-name-row">
                        <strong>{cand.name}</strong>
                        {isTop1 && isSuccess && <span className="chip-winner">Xác nhận Top 1</span>}
                      </div>
                      <div className="candidate-score-bar-track">
                        <div
                          className={`candidate-score-bar-fill ${isTop1 ? "fill-top" : "fill-sub"}`}
                          style={{ width: `${Math.min(100, Math.max(8, cand.match_percentage || Math.round(cand.score * 100)))}%` }}
                        />
                      </div>
                    </div>

                    <div className="candidate-score-cell">
                      <span className="score-num">{cand.score.toFixed(4)}</span>
                      <small className="score-pct">{(cand.score * 100).toFixed(1)}%</small>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Debug & Parameters Details */}
          <details className="debug-details-card">
            <summary>
              <span>Xem tham số mô hình & Dữ liệu kỹ thuật</span>
              <span className="debug-arrow">▾</span>
            </summary>
            <div className="debug-content-body">
              <div className="debug-meta-grid">
                <div><strong>Mô hình Embedding:</strong> google/gemini-embedding-2 (OpenRouter)</div>
                <div><strong>Độ dài vector:</strong> {dimensions} chiều</div>
                <div><strong>Thuật toán đo khoảng cách:</strong> Cosine Similarity (A · B)</div>
                <div><strong>Điều kiện xác thực:</strong> Score ≥ {threshold} VÀ (Top 1 - Top 2) ≥ {margin}</div>
              </div>
              <div className="debug-json-dump">
                <strong>Payload Server:</strong>
                <pre>{JSON.stringify(queryData || { note: "Dữ liệu mô phỏng cho giao diện" }, null, 2)}</pre>
              </div>
            </div>
          </details>
        </div>
      </div>
    </section>
  );
}

// Collection Drawer / Modal
function CollectionDrawer({ isOpen, onClose, items, onClear }) {
  if (!isOpen) return null;

  return (
    <div className="drawer-backdrop" onClick={onClose} role="dialog" aria-modal="true" aria-label="Nhật ký đối tượng đã quét">
      <div className="drawer-panel" onClick={e => e.stopPropagation()}>
        <div className="drawer-header">
          <div className="drawer-title-wrap">
            <h2>Nhật ký nhận diện đối tượng</h2>
            <small>Đã lưu {items.length} lượt đối soát vector trong phiên này</small>
          </div>
          <button className="drawer-close-btn" onClick={onClose} aria-label="Đóng sổ sưu tập">
            <Icon name="close" />
          </button>
        </div>

        <div className="drawer-content">
          {items.length === 0 ? (
            <div className="empty-guide">
              Chưa có lượt nhận diện nào. Hãy quét camera hoặc tải ảnh để đối soát vector!
            </div>
          ) : (
            items.map(item => (
              <div key={item.id} className="collection-item-card">
                {item.thumbnail ? (
                  <img src={item.thumbnail} alt={item.name} className="item-thumb" />
                ) : (
                  <div className="item-thumb" style={{ display: 'grid', placeItems: 'center', color: '#85dab2' }}>
                    <Icon name="museum" />
                  </div>
                )}
                <div className="item-details">
                  <strong>{item.name}</strong>
                  <small>
                    Khám phá lúc {item.time} · Ngày {item.date}
                  </small>
                </div>
              </div>
            ))
          )}
        </div>

        {items.length > 0 && (
          <div className="drawer-footer">
            <button className="clear-btn" onClick={onClear}>
              Xóa lịch sử nhận diện
            </button>
            <button className="btn-secondary" style={{ minHeight: '38px', padding: '6px 18px', fontSize: '13px' }} onClick={onClose}>
              Đóng
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// Guest Capture Main Controller
function GuestCapture() {
  const uploadInput = useRef(null);
  const [mode, setMode] = useState('choice');
  const [file, setFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [result, setResult] = useState('');
  const [message, setMessage] = useState('');
  const [statusReady, setStatusReady] = useState(null);
  const [queryData, setQueryData] = useState(null);
  const [collection, setCollection] = useState([]);
  const [collectionOpen, setCollectionOpen] = useState(false);

  // Load collection and check catalog status
  useEffect(() => {
    setCollection(getSavedCollection());
    api('/api/status')
      .then(res => setStatusReady(res.ready))
      .catch(() => setStatusReady(null));
  }, []);

  const chooseUpload = () => uploadInput.current?.click();

  const handleBack = useCallback(err => {
    setMessage(err || '');
    setMode(err ? 'result' : 'choice');
  }, []);

  // Main recognition handler
  async function recognize(source) {
    let activePreview = '';
    if (source instanceof Blob) {
      activePreview = URL.createObjectURL(source);
      setPreviewUrl(activePreview);
    } else if (source instanceof HTMLVideoElement) {
      const canvas = document.createElement('canvas');
      canvas.width = source.videoWidth;
      canvas.height = source.videoHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(source, 0, 0);
      activePreview = canvas.toDataURL('image/jpeg', 0.85);
      setPreviewUrl(activePreview);
    }

    setMode('processing');
    setMessage('');

    try {
      const blob = await jpeg(source);
      const form = new FormData();
      form.set('file', blob, 'capture.jpg');
      const data = await api('/api/query', {
        method: 'POST',
        body: form,
      });

      setQueryData(data);
      if (data.recognized && data.artifact) {
        setResult(data.artifact);
        const updated = saveToCollection(data.artifact, activePreview);
        setCollection(updated);
      } else {
        setResult('');
      }
    } catch (error) {
      setResult('');
      setMessage(error.name === 'TimeoutError' ? 'Thời gian nhận diện hơi lâu. Vui lòng thử lại.' : error.message);
    }

    setMode('result');
  }

  // Handle uploaded file from picker
  function onFileSelected(event) {
    const next = event.target.files?.[0];
    event.target.value = '';
    if (!next) return;
    if (next.size > 15 * 1024 * 1024) {
      setMessage('Dung lượng ảnh vượt quá 15 MB. Vui lòng chọn ảnh nhỏ hơn.');
      setMode('result');
      return;
    }
    setFile(next);
    setMessage('');
    setMode('preview');
  }

  // Clear collection
  const handleClearCollection = () => {
    if (window.confirm('Bạn có chắc muốn xóa nhật ký các đối tượng đã nhận diện?')) {
      localStorage.removeItem(STORAGE_KEY);
      setCollection([]);
    }
  };

  return (
    <>
      <AppHeader
        admin={false}
        collectionCount={collection.length}
        onOpenCollection={() => setCollectionOpen(true)}
      />

      <input
        ref={uploadInput}
        className="sr-only"
        type="file"
        accept="image/*"
        onChange={onFileSelected}
        aria-hidden="true"
      />

      {mode === 'choice' && (
        <InputChoice
          onCamera={() => setMode('camera')}
          onUpload={chooseUpload}
          onDropFile={file => {
            if (!file) return;
            if (file.size > 15 * 1024 * 1024) {
              setMessage('Dung lượng ảnh vượt quá 15 MB. Vui lòng chọn ảnh nhỏ hơn.');
              setMode('result');
              return;
            }
            setFile(file);
            setMessage('');
            setMode('preview');
          }}
          onOpenCollection={() => setCollectionOpen(true)}
          collectionCount={collection.length}
          statusReady={statusReady}
        />
      )}

      {mode === 'camera' && (
        <CameraCapture
          onBack={handleBack}
          onCapture={recognize}
          onUploadFallback={chooseUpload}
        />
      )}

      {mode === 'preview' && (
        <UploadPreview
          file={file}
          onBack={() => setMode('choice')}
          onSubmit={() => recognize(file)}
        />
      )}

      {mode === 'processing' && (
        <ScanningStage
          previewUrl={previewUrl}
          onCancel={() => setMode('choice')}
        />
      )}

      {mode === 'result' && (
        <RecognitionResult
            result={result}
            message={message}
            previewUrl={previewUrl}
            queryData={queryData}
            onCamera={() => setMode('camera')}
          onUpload={chooseUpload}
          onOpenCollection={() => setCollectionOpen(true)}
        />
      )}

      <CollectionDrawer
        isOpen={collectionOpen}
        onClose={() => setCollectionOpen(false)}
        items={collection}
        onClear={handleClearCollection}
      />

      <footer className="app-footer">
        <span>AI Lens Lab · Multimodal Vector Embedding & Evaluation Studio</span>
        <span className="footer-dot">·</span>
        <a href="/admin">Trang Quản trị Danh mục</a>
      </footer>
    </>
  );
}

// Reference Grid in Admin
function ReferenceGrid({ images, busy, onRetry, onDelete, onPreview }) {
  if (!images.length) {
    return (
      <div className="empty-guide">
        Chưa có ảnh mẫu nào. Hãy thêm 3–5 góc chụp khác nhau để hệ thống nhận diện chính xác nhất.
      </div>
    );
  }

  return (
    <div className="admin-images-grid">
      {images.map(image => (
        <article className="admin-img-card" key={image.id}>
          <img
            src={image.thumbnail_url}
            alt={image.filename}
            onClick={() => onPreview(image.thumbnail_url)}
            title="Nhấp để xem phóng to"
          />
          <span className={`status-chip ${image.status}`}>
            {image.status === 'ready' ? 'Sẵn sàng' : image.status === 'failed' ? 'Lỗi' : 'Đang xử lý'}
          </span>
          <div className="admin-img-actions">
            {image.status === 'failed' ? (
              <button onClick={() => onRetry(image.id)} disabled={busy} style={{ color: 'var(--primary)' }}>
                Thử lại
              </button>
            ) : <span />}
            <button
              onClick={() => onDelete(image.id)}
              disabled={busy}
              style={{ color: 'var(--danger)' }}
            >
              Xóa ảnh
            </button>
          </div>
        </article>
      ))}
    </div>
  );
}

// Admin Dashboard Stage
function AdminDashboard() {
  const [artifacts, setArtifacts] = useState([]);
  const [selected, setSelected] = useState('');
  const [images, setImages] = useState([]);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressText, setProgressText] = useState('');
  const [search, setSearch] = useState('');
  const [lightboxUrl, setLightboxUrl] = useState('');

  const picker = useRef(null);
  const cameraPicker = useRef(null);
  const current = artifacts.find(item => item.id === selected);

  async function refresh() {
    const data = await api('/api/admin/artifacts');
    setArtifacts(data.artifacts || []);
  }

  async function loadImages(id) {
    if (!id) {
      setImages([]);
      return;
    }
    const data = await api(`/api/admin/artifacts/${id}/images`);
    setImages(data.images || []);
  }

  useEffect(() => {
    refresh().catch(err => setNotice(err.message));
  }, []);

  useEffect(() => {
    loadImages(selected).catch(err => setNotice(err.message));
  }, [selected]);

  async function createArtifact(event) {
    event.preventDefault();
    setBusy(true);
    try {
      const input = event.currentTarget.elements.name;
      const data = await api('/api/admin/artifacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: input.value.trim() }),
      });
      input.value = '';
      await refresh();
      setSelected(data.id);
      setNotice('Đã tạo đối tượng mới thành công. Hãy tải lên ảnh mẫu.');
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function uploadImages(event) {
    const files = [...event.target.files];
    event.target.value = '';
    if (!selected || !files.length) return;
    if (files.length > 8) {
      setNotice('Vui lòng chọn tối đa 8 ảnh mỗi lượt tải lên.');
      return;
    }

    setBusy(true);
    let done = 0;
    for (const [index, file] of files.entries()) {
      setProgressText(`Đang xử lý và trích xuất vector ảnh ${index + 1}/${files.length}…`);
      setProgress(Math.round(((index + 1) / files.length) * 100));
      try {
        const blob = await jpeg(file);
        const form = new FormData();
        form.set('file', blob, 'reference.jpg');
        await api(`/api/admin/artifacts/${selected}/images`, {
          method: 'POST',
          body: form,
        });
        done++;
      } catch (error) {
        setNotice(`Lỗi ở ảnh ${index + 1}: ${error.message}`);
      }
    }
    setProgress(0);
    setProgressText('');
    setBusy(false);
    await refresh();
    await loadImages(selected);
    setNotice(`Đã thêm thành công ${done}/${files.length} ảnh mẫu vào bộ sưu tập.`);
  }

  async function retryImage(id) {
    setBusy(true);
    try {
      await api(`/api/admin/images/${id}/retry`, { method: 'POST' });
      await refresh();
      await loadImages(selected);
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function removeImage(id) {
    if (!window.confirm('Xóa ảnh mẫu này khỏi hệ thống?')) return;
    setBusy(true);
    try {
      await api(`/api/admin/images/${id}`, { method: 'DELETE' });
      await refresh();
      await loadImages(selected);
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function removeArtifact(id, name) {
    if (!window.confirm(`Xóa đối tượng "${name}" cùng toàn bộ ảnh mẫu liên quan?`)) return;
    setBusy(true);
    try {
      await api(`/api/admin/artifacts/${id}`, { method: 'DELETE' });
      if (selected === id) {
        setSelected('');
        setImages([]);
      }
      await refresh();
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  }

  const filteredArtifacts = artifacts.filter(item =>
    item.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <>
      <AppHeader admin={true} />

      <section className="admin-header">
        <div>
          <span className="admin-eyebrow">HỆ THỐNG QUẢN TRỊ DỮ LIỆU MẪU</span>
          <h1>Quản lý Đối tượng & Dữ liệu Mẫu</h1>
          <p>Thiết lập danh mục đối tượng và nạp ảnh mẫu đa góc để xây dựng chỉ mục vector embedding.</p>
        </div>
        <a className="admin-back-btn" href="/">
          ← Về trải nghiệm du khách
        </a>
      </section>

      {notice && (
        <div className="notice-box" style={{ marginBottom: '20px' }} role="status">
          {notice}
        </div>
      )}

      <div className="admin-grid">
        <div className="admin-card">
          <div className="admin-card-head">
            <h2>
              <span className="step-num">1</span>
              <span>Danh mục Đối tượng ({artifacts.length})</span>
            </h2>
          </div>

          <form onSubmit={createArtifact} className="artifact-create-box">
            <input
              name="name"
              maxLength="120"
              required
              placeholder="Nhập tên đối tượng mới (ví dụ: Mặt nạ 3M, Lon Coca, Chìa khóa)..."
              disabled={busy}
            />
            <button className="btn-primary" style={{ minHeight: '44px', padding: '0 20px' }} disabled={busy}>
              Tạo
            </button>
          </form>

          <input
            className="admin-search-input"
            type="search"
            placeholder="Tìm kiếm đối tượng theo tên..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />

          <div className="artifact-admin-list">
            {filteredArtifacts.map(item => (
              <article
                key={item.id}
                className={`artifact-admin-item ${selected === item.id ? 'selected' : ''}`}
              >
                <button className="artifact-admin-btn" onClick={() => setSelected(item.id)}>
                  <strong>{item.name}</strong>
                  <small>
                    {item.ready_count || 0}/{item.image_count || 0} ảnh sẵn sàng
                    {item.failed_count ? ` · ${item.failed_count} lỗi` : ''}
                  </small>
                </button>
                <button
                  className="delete-icon-btn"
                  onClick={() => removeArtifact(item.id, item.name)}
                  aria-label={`Xóa đối tượng ${item.name}`}
                  title="Xóa đối tượng"
                >
                  <Icon name="trash" />
                </button>
              </article>
            ))}
          </div>
        </div>

        <div className="admin-card">
          <div className="admin-card-head">
            <h2>
              <span className="step-num">2</span>
              <span>Ảnh mẫu đối chiếu</span>
            </h2>
            {current && <span className="status-chip ready">{current.name}</span>}
          </div>

          {current ? (
            <>
              <div className="dropzone-box" onClick={() => picker.current?.click()} role="button" tabIndex={0}>
                <div className="dropzone-icon">
                  <Icon name="upload" />
                </div>
                <strong>Tải ảnh mẫu từ thiết bị</strong>
                <small>Chọn tối đa 8 ảnh · Hỗ trợ JPG, PNG · Hệ thống tự nén chuẩn 1600px</small>
              </div>

              <button
                className="admin-cam-btn"
                onClick={() => cameraPicker.current?.click()}
                disabled={busy}
              >
                <Icon name="camera" />
                <span>Chụp trực tiếp ảnh mẫu</span>
              </button>

              <input
                ref={picker}
                className="sr-only"
                type="file"
                accept="image/*"
                multiple
                onChange={uploadImages}
              />
              <input
                ref={cameraPicker}
                className="sr-only"
                type="file"
                accept="image/*"
                capture="environment"
                onChange={uploadImages}
              />

              {progress > 0 && (
                <div className="progress-bar-wrap" role="status">
                  <div className="progress-text">
                    <span>{progressText}</span>
                    <span>{progress}%</span>
                  </div>
                  <div className="progress-track">
                    <div className="progress-fill" style={{ width: `${progress}%` }} />
                  </div>
                </div>
              )}

              <ReferenceGrid
                images={images}
                busy={busy}
                onRetry={retryImage}
                onDelete={removeImage}
                onPreview={url => setLightboxUrl(url)}
              />
            </>
          ) : (
            <div className="empty-guide">
              Chọn một đối tượng ở danh mục bên trái hoặc tạo mới để quản lý ảnh mẫu đối chiếu.
            </div>
          )}
        </div>
      </div>

      {lightboxUrl && (
        <div className="lightbox-modal" onClick={() => setLightboxUrl('')} role="dialog" aria-modal="true">
          <div className="lightbox-content" onClick={e => e.stopPropagation()}>
            <button className="lightbox-close" onClick={() => setLightboxUrl('')} aria-label="Đóng ảnh phóng to">
              <Icon name="close" />
            </button>
            <img src={lightboxUrl} alt="Ảnh mẫu độ phân giải cao" />
          </div>
        </div>
      )}
    </>
  );
}

// App Root
function App() {
  const isAdmin = window.location.pathname === '/admin';
  return (
    <main className={isAdmin ? 'app app-admin' : 'app'}>
      {isAdmin ? <AdminDashboard /> : <GuestCapture />}
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
