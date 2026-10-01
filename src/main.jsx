import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { api } from './api.js';
import { ReferenceUpload } from './ReferenceUpload.jsx';
import { Recognition } from './Recognition.jsx';
import { Icon } from './components.jsx';
import './style.css';
import './media.css';

function ReferenceGrid({ images, busy, onRetry, onDelete, onPreview }) {
  if (!images.length) return <div className="empty-guide">Chưa có ảnh tham chiếu. Hãy thêm ảnh rõ nét từ các góc chụp khác nhau.</div>;
  return <div className="admin-images-grid">{images.map(image => <article className="admin-img-card" key={image.id}>
    <button className="reference-preview-button" onClick={() => onPreview(image.thumbnail_url)} aria-label={`Xem ảnh ${image.filename}`}><img src={image.thumbnail_url} alt={image.filename} /></button>
    <span className={`status-chip ${image.status}`}>{image.needs_reprocess ? 'Cần cập nhật pipeline' : image.status === 'ready' ? 'Sẵn sàng' : image.status === 'failed' ? 'Lỗi' : 'Đang xử lý'}</span>
    {image.description && <details><summary>Mô tả từ ảnh</summary><p className="small-note">{image.description}</p></details>}
    {image.error && <p className="reference-error" role="note">{image.error}</p>}
    <div className="admin-img-actions">{image.needs_reprocess ? <button onClick={() => onRetry(image.id, true)} disabled={busy}>Cập nhật mô tả và vector</button> : image.status === 'failed' ? <button onClick={() => onRetry(image.id)} disabled={busy}>Thử lại</button> : <span />}<button onClick={() => onDelete(image.id)} disabled={busy}>Xóa ảnh</button></div>
  </article>)}</div>;
}

function App() {
  const [artifacts, setArtifacts] = useState([]);
  const [selected, setSelected] = useState('');
  const [images, setImages] = useState([]);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [uploadQueue, setUploadQueue] = useState(null);
  const [search, setSearch] = useState('');
  const [lightboxUrl, setLightboxUrl] = useState('');
  const [usage, setUsage] = useState(null);
  const picker = useRef(null);
  const cameraPicker = useRef(null);
  const current = artifacts.find(item => item.id === selected);

  async function refresh() {
    const [data, stats] = await Promise.all([api('/api/admin/artifacts'), api('/api/admin/usage')]);
    const rows = data.artifacts || [];
    setArtifacts(rows); setUsage(stats);
    setSelected(previous => rows.some(item => item.id === previous) ? previous : (rows.find(item => item.ready_count > 0)?.id || rows[0]?.id || ''));
  }
  async function loadImages(id) {
    if (!id) return [];
    return (await api(`/api/admin/artifacts/${id}/images`)).images || [];
  }
  async function load() {
    setLoading(true); setNotice('');
    try { await refresh(); } catch (error) { setNotice(error.message); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);
  useEffect(() => {
    let active = true; setImages([]);
    if (selected) loadImages(selected).then(rows => { if (active) setImages(rows); }).catch(error => { if (active) setNotice(error.message); });
    return () => { active = false; };
  }, [selected]);
  useEffect(() => {
    if (!lightboxUrl) return;
    const close = event => { if (event.key === 'Escape') setLightboxUrl(''); };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [lightboxUrl]);

  async function createArtifact(event) {
    event.preventDefault(); if (busy) return;
    const input = event.currentTarget.elements.name;
    setBusy(true); setNotice('');
    try {
      const data = await api('/api/admin/artifacts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: input.value.trim() }) });
      input.value = ''; await refresh(); setSelected(data.id); setNotice('Đã tạo hiện vật. Hãy nhập ảnh tham chiếu.');
    } catch (error) { setNotice(error.message); }
    finally { setBusy(false); }
  }
  function prepareImages(event) {
    const files = [...event.target.files]; event.target.value = '';
    if (!selected || !files.length || busy) return;
    if (files.length > 8) { setNotice('Vui lòng chọn tối đa 8 ảnh mỗi lượt.'); return; }
    if (files.some(file => !file.type.startsWith('image/') || file.size > 15 * 1024 * 1024)) { setNotice('Chọn ảnh JPEG hoặc PNG dưới 15 MB.'); return; }
    setNotice(''); setBusy(true); setUploadQueue(files);
  }
  async function refreshImages() { await refresh(); setImages(await loadImages(selected)); }
  function closeUpload(done) {
    setUploadQueue(null); setBusy(false);
    setNotice(done ? `Đã nhập ${done} ảnh tham chiếu.` : 'Đã hủy nhập ảnh. Các ảnh chưa xác nhận không được gửi.');
  }
  async function retryImage(id, reprocess = false) {
    setBusy(true); setNotice('');
    try { await api(`/api/admin/images/${id}/${reprocess ? 'reprocess' : 'retry'}`, { method: 'POST' }); await refreshImages(); }
    catch (error) { setNotice(error.message); }
    finally { setBusy(false); }
  }
  async function removeImage(id) {
    if (!window.confirm('Xóa ảnh tham chiếu này?')) return;
    setBusy(true); setNotice('');
    try { await api(`/api/admin/images/${id}`, { method: 'DELETE' }); await refreshImages(); }
    catch (error) { setNotice(error.message); }
    finally { setBusy(false); }
  }
  async function removeArtifact(id, name) {
    if (!window.confirm(`Xóa hiện vật "${name}" và toàn bộ ảnh tham chiếu của hiện vật này?`)) return;
    setBusy(true); setNotice('');
    try {
      await api(`/api/admin/artifacts/${id}`, { method: 'DELETE' });
      if (selected === id) { setSelected(''); setImages([]); }
      await refresh();
    } catch (error) { setNotice(error.message); }
    finally { setBusy(false); }
  }
  const filtered = artifacts.filter(item => item.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  return <main className="app app-admin recognition-app">
    <header className="app-header"><div className="brand-wrap"><span className="brand-emblem"><Icon name="lens" /></span><div className="brand-text"><span className="brand-title">NHẬN DIỆN HIỆN VẬT</span><span className="brand-sub">Ảnh tham chiếu & nhận diện ảnh</span></div></div></header>
    <section className="admin-header"><div><h1>Nhập ảnh tham chiếu & nhận diện</h1><p>Chọn hiện vật để xem ảnh tham chiếu có sẵn, rồi chụp hoặc chọn ảnh mới để nhận diện. Có thể thêm hiện vật và ảnh khi cần.</p></div><button className="btn-secondary" disabled={busy || loading} onClick={load}>Làm mới danh mục</button></section>
    {usage?.demo && <p className="hunt-notice" role="note">Bản demo: nhận diện được mô phỏng, không gọi Cloudflare/OpenRouter và không phát sinh phí.</p>}
    {usage && <div className="admin-usage"><strong>{usage.api_today}/{usage.daily_limit}</strong> lượt gọi model đã đặt chỗ hôm nay (UTC), gồm cả lượt lỗi. Ảnh mới dùng một lượt mô tả và một lượt embedding. Xem trước không gọi model.</div>}
    {notice && <div className="notice-box" role="status">{notice}</div>}
    {loading && <p role="status">Đang tải danh mục…</p>}
    <div className="admin-grid">
      <section className="admin-card" aria-label="Danh mục hiện vật"><div className="admin-card-head"><h2><span className="step-num">1</span>Hiện vật ({artifacts.length})</h2></div>
        <form onSubmit={createArtifact} className="artifact-create-box"><input name="name" aria-label="Tên hiện vật mới" maxLength="120" required placeholder="Tên hiện vật…" disabled={busy || loading} /><button className="btn-primary" disabled={busy || loading}>Tạo</button></form>
        <input className="admin-search-input" type="search" aria-label="Tìm hiện vật" placeholder="Tìm hiện vật…" value={search} onChange={event => setSearch(event.target.value)} />
        <div className="artifact-admin-list">{filtered.map(item => <article key={item.id} className={`artifact-admin-item ${selected === item.id ? 'selected' : ''}`}><button className="artifact-admin-btn" disabled={busy} onClick={() => setSelected(item.id)}><strong>{item.name}</strong><small>{item.ready_count || 0}/{item.image_count || 0} ảnh sẵn sàng{item.failed_count ? ` · ${item.failed_count} lỗi` : ''}</small></button><button className="delete-icon-btn" aria-label={`Xóa hiện vật ${item.name}`} title="Xóa hiện vật" disabled={busy} onClick={() => removeArtifact(item.id, item.name)}><Icon name="trash" /></button></article>)}</div>
        {!artifacts.length && !loading && <p className="small-note">Tạo ít nhất hai hiện vật khác nhau và nhập ảnh tham chiếu để nhận diện có đối chiếu.</p>}
      </section>
      <section className="admin-card" aria-label="Ảnh tham chiếu"><div className="admin-card-head"><h2><span className="step-num">2</span>Ảnh tham chiếu</h2>{current && <span className="status-chip ready">{current.name}</span>}</div>
        {current ? <>
          <button className="dropzone-box" disabled={busy} onClick={() => picker.current?.click()}><span className="dropzone-icon"><Icon name="upload" /></span><strong>Thêm ảnh tham chiếu</strong><small>Tối đa 8 ảnh/lượt · Xem trước và crop trước khi nhập</small></button>
          <button className="admin-cam-btn" disabled={busy} onClick={() => cameraPicker.current?.click()}><Icon name="camera" />Chụp ảnh tham chiếu</button>
          <input ref={picker} className="sr-only" type="file" accept="image/*" multiple disabled={busy} aria-label="Chọn ảnh tham chiếu" onChange={prepareImages} /><input ref={cameraPicker} className="sr-only" type="file" accept="image/*" capture="environment" disabled={busy} aria-label="Chụp ảnh tham chiếu" onChange={prepareImages} />
          {uploadQueue && <ReferenceUpload files={uploadQueue} artifact={current} onClose={closeUpload} onImported={refreshImages} />}
          <ReferenceGrid images={images} busy={busy} onRetry={retryImage} onDelete={removeImage} onPreview={setLightboxUrl} />
        </> : <div className="empty-guide">Chọn hiện vật để xem ảnh tham chiếu có sẵn, hoặc tạo hiện vật mới.</div>}
      </section>
    </div>
    <div className="admin-card recognition-card"><Recognition artifacts={artifacts} disabled={busy || loading} onBusyChange={setBusy} onDone={() => refresh().catch(error => setNotice(error.message))} /></div>
    {lightboxUrl && <div className="lightbox-modal" onClick={() => setLightboxUrl('')} role="dialog" aria-modal="true" aria-label="Ảnh tham chiếu phóng to"><div className="lightbox-content" onClick={event => event.stopPropagation()}><button autoFocus className="lightbox-close" onClick={() => setLightboxUrl('')} aria-label="Đóng ảnh phóng to"><Icon name="close" /></button><img src={lightboxUrl} alt="Ảnh tham chiếu phóng to" /></div></div>}
  </main>;
}
createRoot(document.getElementById('root')).render(<App />);
