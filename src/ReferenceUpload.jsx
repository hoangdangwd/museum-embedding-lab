import React, { useEffect, useRef, useState } from 'react';
import { CropEditor } from './CropEditor.jsx';
import { jpeg } from './media.js';
import { api } from './api.js';

export function ReferenceUpload({ files, artifact, onClose, onImported }) {
  const [entries,setEntries]=useState(()=>files.map(file=>({file,crop:null,status:'pending',error:''})));
  const [index,setIndex]=useState(0);
  const [ready,setReady]=useState(false);
  const [sending,setSending]=useState(false);
  const [notice,setNotice]=useState('');
  const lock=useRef(false);
  const heading=useRef(null);
  useEffect(()=>{heading.current?.focus({preventScroll:true});heading.current?.scrollIntoView({block:'start'});},[]);
  const entry=entries[index];
  const done=entries.filter(e=>e.status==='done').length;
  const update=(at,patch)=>setEntries(previous=>previous.map((e,i)=>i===at?{...e,...patch}:e));
  const changeIndex=value=>{setIndex(value);setNotice('');setReady(false);};
  async function upload() {
    if(lock.current || !ready || entry.status==='done') return;
    lock.current=true;setSending(true);setNotice('');
    let sent=false;
    try {
      const blob=await jpeg(entry.file,entry.crop);
      const form=new FormData();form.set('file',blob,entry.file.name.replace(/\.[^.]+$/,'')+'.jpg');
      sent=true;
      await api(`/api/admin/artifacts/${artifact.id}/images`,{method:'POST',body:form});
      update(index,{status:'done',error:''});
      // Refresh errors must not turn a successful import into another paid call.
      try { await onImported(); } catch { setNotice('Ảnh đã nhập. Danh sách sẽ cập nhật khi tải lại trang.'); }
      const next=entries.findIndex((e,i)=>i>index && e.status==='pending');
      if(next>=0) changeIndex(next);
    } catch(error) {
      update(index,{error:error.message});
      setNotice(error.message+(sent?' Nếu server đã nhận ảnh, hãy đóng bước này và dùng mục Thử lại trong danh sách ảnh lỗi.':''));
      if(sent) {try {await onImported();} catch { /* The error remains visible; no automatic paid retry. */ }}
    } finally {lock.current=false;setSending(false);}
  }
  return <section className="reference-upload" aria-label="Chuẩn bị ảnh tham chiếu">
    <div className="reference-upload-heading"><div><h3 ref={heading} tabIndex="-1">Chuẩn bị ảnh tham chiếu</h3><p>{artifact.name} · Ảnh {index+1}/{entries.length} · Đã nhập {done}/{entries.length}</p></div>
      <button className="text-button" disabled={sending} onClick={()=>onClose(done)}>{done ? 'Đóng' : 'Hủy nhập ảnh'}</button></div>
    <p className="small-note">Điều chỉnh từng ảnh, rồi xác nhận nhập. Chỉ ảnh đã xác nhận mới được gửi và tạo embedding.</p>
    <nav className="reference-upload-tabs" aria-label="Ảnh chờ nhập">{entries.map((e,i)=><button type="button" key={i} disabled={sending} aria-pressed={i===index}
      onClick={()=>i!==index && changeIndex(i)}>{i+1}{e.status==='done'?' ✓':''}</button>)}</nav>
    <p className="reference-filename">{entry.file.name}</p>
    <CropEditor key={index} file={entry.file} crop={entry.crop} onChange={crop=>update(index,{crop})} disabled={sending || entry.status==='done'} onReady={setReady} />
    {notice && <p role="alert" className="hunt-notice">{notice}</p>}
    {entry.error && !notice && <p role="alert" className="hunt-notice">{entry.error}</p>}
    {entry.status==='done' ? <p role="status">Đã nhập ảnh này. Không cần gửi lại.</p> : <div className="hunt-actions">
      <button className="btn-primary" disabled={sending || !ready} onClick={upload}>{sending?'Đang nhập ảnh…':entry.crop?'Nhập ảnh đã cắt':'Nhập toàn ảnh'}</button>
      {index<entries.length-1 && <button className="btn-secondary" disabled={sending} onClick={()=>changeIndex(index+1)}>Để sau, xem ảnh tiếp</button>}
    </div>}
    {done===entries.length && <div className="hint-box" role="status">Đã nhập đủ {done} ảnh tham chiếu. <button className="text-button" onClick={()=>onClose(done)}>Hoàn tất</button></div>}
  </section>;
}
