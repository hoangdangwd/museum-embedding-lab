import React, { useCallback, useRef, useState } from 'react';
import { api } from './api.js';
import { jpeg } from './media.js';
import { ImagePreview } from './ImagePreview.jsx';
import { CameraCapture, Icon } from './components.jsx';

export function Recognition({ artifacts = [], disabled = false, onBusyChange, onDone }) {
  const [file, setFile] = useState(null);
  const [cameraCropped, setCameraCropped] = useState(false);
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
    setFile(photo); setCameraCropped(false); setCamera(false); onBusyChange?.(false);
  };
  const backFromCamera = useCallback(message => {
    setCamera(false); onBusyChange?.(false);
    if (message) setNotice(message + ' Bạn có thể chọn ảnh từ thiết bị.');
  }, [onBusyChange]);
  // Camera capture is allowed while the parent locks reference editing.
  function capture(photo, framed = true) {
    setReady(false); setResult(null); setCamera(false); onBusyChange?.(false);
    if (!photo.type.startsWith('image/') || photo.size > 15 * 1024 * 1024) { setFile(null); setNotice('Chọn ảnh JPEG hoặc PNG dưới 15 MB.'); return; }
    setFile(photo); setCameraCropped(framed); setNotice('');
  }
  function clear() { setFile(null); setCameraCropped(false); setReady(false); setResult(null); setNotice(''); }
  async function check() {
    if (lock.current || blocked || !file || !ready || readyArtifacts < 2) return;
    lock.current = true; setBusy(true); onBusyChange?.(true); setNotice(''); setResult(null);
    const started = performance.now();
    try {
      // Camera output is already cropped + JPEG95/max1600. Send exactly the
      // previewed bytes; do not crop or re-encode that frame a second time.
      const form = new FormData(); form.set('file', cameraCropped ? file : await jpeg(file), 'recognition.jpg');
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
    <p className="small-note">Căn một hiện vật trong khung camera, chụp rồi kiểm tra ảnh đã cắt trước khi bấm nhận diện. Chỉ vùng trong khung chụp được gửi. Ảnh chọn từ thiết bị vẫn gửi toàn ảnh. AI tạo mô tả và đối chiếu cả ảnh lẫn mô tả. Ảnh nhiều hiện vật không có chủ thể rõ sẽ được yêu cầu chụp lại trước bước embedding. Ảnh truy vấn không thêm vào danh mục tham chiếu; điểm cosine không phải xác suất đúng.</p>
    <p className="small-note">Khi bấm nhận diện, ảnh được gửi qua OpenRouter đến Google và có thể đến TypeSafe để đối chiếu. Tránh đưa khuôn mặt, giấy tờ hoặc thông tin cá nhân vào khung. Xem <a href="https://openrouter.ai/privacy" target="_blank" rel="noopener noreferrer">chính sách OpenRouter</a> và <a href="https://typesafe.ai/legal/privacy-policy" target="_blank" rel="noopener noreferrer">TypeSafe</a>.</p>
    {readyArtifacts < 2 && <p className="hunt-notice" role="status">Cần ít nhất hai hiện vật có ảnh tham chiếu sẵn sàng để nhận diện.</p>}
    <input ref={picker} type="file" accept="image/*" className="sr-only" disabled={blocked && !camera} aria-label="Chọn ảnh nhận diện" onChange={event => {
      const photo = event.target.files[0]; event.target.value = '';
      if (camera && photo) capture(photo, false); else choose(photo);
    }} />
    {camera ? <CameraCapture onBack={backFromCamera} onCapture={capture} onUploadFallback={() => picker.current?.click()} /> : <>
      <div className="hunt-actions"><button className="btn-secondary" disabled={blocked} onClick={() => picker.current?.click()}><Icon name="upload" />Chọn ảnh nhận diện</button><button className="btn-secondary" disabled={blocked} onClick={() => { setNotice(''); setResult(null); setCamera(true); onBusyChange?.(true); }}><Icon name="camera" />Chụp ảnh nhận diện</button></div>
      {file && <div className="recognition-preview"><p className="reference-filename">{file.name || 'Ảnh vừa chụp'}</p>
        {cameraCropped && <p className="small-note" role="status">Ảnh đã cắt theo khung chụp. Kiểm tra đủ toàn bộ hiện vật trước khi nhận diện; phần ngoài khung không được gửi.</p>}
        <ImagePreview file={file} onReady={setReady} label={cameraCropped ? 'Ảnh nhận diện đã cắt theo khung chụp' : 'Ảnh nhận diện toàn khung'} />
        {cameraCropped && <button className="text-button" disabled={blocked} onClick={() => { setNotice(''); setResult(null); setCamera(true); onBusyChange?.(true); }}>Chụp lại</button>}
        <div className="hunt-actions"><button className="btn-primary" disabled={blocked || !ready || readyArtifacts < 2} onClick={check}>{busy ? 'Đang chuẩn hóa & đối chiếu…' : 'Nhận diện ảnh'}</button><button className="text-button" disabled={blocked} onClick={clear}>Hủy ảnh nhận diện</button></div>
      </div>}
    </>}
    {busy && <p role="status">Đang mô tả ảnh, kiểm tra cảnh và đối chiếu ảnh tham chiếu. Không cần gửi lại.</p>}
    {notice && <p role="alert" className="hunt-notice">{notice}</p>}
    {result && <div className="recognition-result"><h3>Kết quả nhận diện</h3><p role="status">{result.recognized ? `Khớp: ${result.artifact}` : 'Chưa đủ rõ để xác nhận'}</p>
      {result.hard_negative_triggered && <p className="hunt-notice" role="status">Ảnh khá giống một tượng ngoài danh mục có hình dáng tương tự Phật Bà Quan Âm. Hãy chụp gần hơn hoặc đổi góc chụp để xác nhận.</p>}
      {result.reason === 'multiple_artifacts' && <p className="hunt-notice" role="status">Ảnh có nhiều hiện vật và chưa rõ chủ thể cần nhận diện. Hãy chụp gần một hiện vật, để hiện vật đó chiếm phần lớn khung hình. Chưa tạo embedding hay tìm ứng viên cho ảnh này.</p>}
      {result.reason === 'no_clear_artifact' && <p className="hunt-notice" role="status">Chưa thấy rõ hiện vật trong ảnh. Hãy chụp lại gần hơn, đủ sáng và lấy nét vào một hiện vật.</p>}
      {result.reason === 'pairwise_identity_not_confirmed' && <p className="hunt-notice" role="status">Ảnh chưa đủ chi tiết để xác nhận chắc chắn đây là hiện vật đã khớp. Hãy chụp gần hơn, tránh lóa kính và giữ rõ phần đặc trưng của hiện vật.</p>}
      {result.reason === 'pairwise_verifier_unavailable' && <p className="hunt-notice" role="status">Chưa thể xác nhận ảnh ở bước kiểm tra an toàn. Hãy thử lại bằng một lượt nhận diện mới.</p>}
      <p className="small-note">Điểm cao nhất: {result.best_score ?? 'Không có ứng viên'} · Chênh lệch: {result.margin_score ?? 'Thiếu ứng viên thứ hai'} · Thời gian: {(result.elapsed / 1000).toFixed(2)} giây</p>
      {result.verifier?.status === 'confirmed' && <p className="small-note">Bước đối chiếu bổ sung đã xác nhận cùng hiện vật.</p>}
      <details><summary>Thông số đối chiếu</summary><p className="small-note">Ngưỡng: {result.threshold} · Chênh lệch yêu cầu: {result.margin} · Vector: {result.dimensions} chiều</p>{result.decision_version && <p className="small-note">Policy: {result.decision_version}</p>}</details>
      {result.description && <details><summary>Mô tả dùng để đối chiếu</summary><p className="small-note">{result.description}</p></details>}
      {result.candidates.length ? <table><caption>Ứng viên theo độ tương đồng</caption><thead><tr><th>Hạng</th><th>Hiện vật</th><th>Cosine</th></tr></thead><tbody>{result.candidates.map(candidate => <tr key={candidate.id}><td>{candidate.rank}</td><td>{candidate.name}</td><td>{candidate.score.toFixed(4)}</td></tr>)}</tbody></table> : <p>{result.semantic_guard?.reject ? 'Đã dừng trước bước tìm kiếm. Không có bảng ứng viên cho ảnh này.' : 'Chưa tìm được ứng viên. Nếu vừa nhập ảnh, Vectorize có thể cần thời gian cập nhật.'}</p>}
    </div>}
  </section>;
}
