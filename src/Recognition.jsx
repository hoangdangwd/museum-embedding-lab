import React, { useCallback, useRef, useState } from 'react';
import { api } from './api.js';
import { jpeg } from './media.js';
import { ImagePreview } from './ImagePreview.jsx';
import { CameraCapture, Icon } from './components.jsx';

export function Recognition({ artifacts = [], disabled = false, onBusyChange, onDone }) {
  const [file, setFile] = useState(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [camera, setCamera] = useState(false);
  const [result, setResult] = useState(null);
  const [notice, setNotice] = useState('');
  const picker = useRef(null), lock = useRef(false);
  const blocked = disabled || busy;
  const readyArtifacts = artifacts.filter(artifact => Number(artifact.ready_count) > 0).length;
  const choose = photo => {
    if (!photo || blocked) return;
    setNotice(''); setResult(null); setFile(null); setReady(false);
    if (!photo.type.startsWith('image/') || photo.size > 15 * 1024 * 1024) { setNotice('Chọn ảnh JPEG hoặc PNG dưới 15 MB.'); return; }
    setFile(photo); setCamera(false); onBusyChange?.(false);
  };
  const backFromCamera = useCallback(message => {
    setCamera(false); onBusyChange?.(false);
    if (message) setNotice(message + ' Bạn có thể chọn ảnh từ thiết bị.');
  }, [onBusyChange]);
  // Camera capture is allowed while the parent locks reference editing.
  function capture(photo) {
    setReady(false); setResult(null); setCamera(false); onBusyChange?.(false);
    if (!photo.type.startsWith('image/') || photo.size > 15 * 1024 * 1024) { setFile(null); setNotice('Chọn ảnh JPEG hoặc PNG dưới 15 MB.'); return; }
    setFile(photo); setNotice('');
  }
  function clear() { setFile(null); setReady(false); setResult(null); setNotice(''); }
  async function check() {
    if (lock.current || blocked || !file || !ready || readyArtifacts < 2) return;
    lock.current = true; setBusy(true); onBusyChange?.(true); setNotice(''); setResult(null);
    const started = performance.now();
    try {
      const form = new FormData(); form.set('file', await jpeg(file), 'recognition.jpg');
      const response = await api('/api/admin/query', { method: 'POST', body: form });
      setResult({ ...response, elapsed: Math.round(performance.now() - started) });
    } catch (error) { setNotice(error.message + ' Không tự gửi lại ảnh. Hãy xác nhận một lượt mới nếu muốn thử lại.'); }
    finally {
      try { await onDone?.(); } catch { /* Keep recognition result even if refreshing usage fails. */ }
      lock.current = false; setBusy(false); onBusyChange?.(false);
    }
  }
  return <section className="diagnostics" aria-label="Nhận diện ảnh">
    <h2><span className="step-num">3</span>Nhận diện ảnh</h2>
    <p className="small-note">Chụp hoặc chọn ảnh, xem trước rồi bấm nhận diện. Toàn bộ ảnh được gửi, không cắt khung. AI tạo mô tả và đối chiếu cả ảnh lẫn mô tả. Ảnh truy vấn không thêm vào danh mục tham chiếu; điểm cosine không phải xác suất đúng.</p>
    {readyArtifacts < 2 && <p className="hunt-notice" role="status">Cần ít nhất hai hiện vật có ảnh tham chiếu sẵn sàng để nhận diện.</p>}
    <input ref={picker} type="file" accept="image/*" className="sr-only" disabled={blocked && !camera} aria-label="Chọn ảnh nhận diện" onChange={event => {
      const photo = event.target.files[0]; event.target.value = '';
      if (camera && photo) capture(photo); else choose(photo);
    }} />
    {camera ? <CameraCapture onBack={backFromCamera} onCapture={capture} onUploadFallback={() => picker.current?.click()} /> : <>
      <div className="hunt-actions"><button className="btn-secondary" disabled={blocked} onClick={() => picker.current?.click()}><Icon name="upload" />Chọn ảnh nhận diện</button><button className="btn-secondary" disabled={blocked} onClick={() => { setNotice(''); setResult(null); setCamera(true); onBusyChange?.(true); }}><Icon name="camera" />Chụp ảnh nhận diện</button></div>
      {file && <div className="recognition-preview"><p className="reference-filename">{file.name || 'Ảnh vừa chụp'}</p>
        <ImagePreview file={file} onReady={setReady} />
        <div className="hunt-actions"><button className="btn-primary" disabled={blocked || !ready || readyArtifacts < 2} onClick={check}>{busy ? 'Đang chuẩn hóa & đối chiếu…' : 'Nhận diện ảnh'}</button><button className="text-button" disabled={blocked} onClick={clear}>Hủy ảnh nhận diện</button></div>
      </div>}
    </>}
    {busy && <p role="status">Đang mô tả ảnh, tạo embedding và đối chiếu ảnh tham chiếu. Không cần gửi lại.</p>}
    {notice && <p role="alert" className="hunt-notice">{notice}</p>}
    {result && <div className="recognition-result"><h3>Kết quả nhận diện</h3><p role="status">{result.recognized ? `Khớp: ${result.artifact}` : 'Chưa đủ rõ để xác nhận'}</p>
      <p className="small-note">Điểm cao nhất: {result.best_score ?? 'Không có ứng viên'} · Chênh lệch: {result.margin_score ?? 'Thiếu ứng viên thứ hai'} · Thời gian: {(result.elapsed / 1000).toFixed(2)} giây</p>
      <details><summary>Thông số đối chiếu</summary><p className="small-note">Ngưỡng: {result.threshold} · Chênh lệch yêu cầu: {result.margin} · Vector: {result.dimensions} chiều</p></details>
      {result.description && <details><summary>Mô tả dùng để đối chiếu</summary><p className="small-note">{result.description}</p></details>}
      {result.candidates.length ? <table><caption>Ứng viên theo độ tương đồng</caption><thead><tr><th>Hạng</th><th>Hiện vật</th><th>Cosine</th></tr></thead><tbody>{result.candidates.map(candidate => <tr key={candidate.id}><td>{candidate.rank}</td><td>{candidate.name}</td><td>{candidate.score.toFixed(4)}</td></tr>)}</tbody></table> : <p>Chưa tìm được ứng viên. Nếu vừa nhập ảnh, Vectorize có thể cần thời gian cập nhật.</p>}
    </div>}
  </section>;
}
