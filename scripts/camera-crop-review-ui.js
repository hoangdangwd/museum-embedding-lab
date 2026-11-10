/* Local-only proposal editor; no fetch/provider/production mutation. */
(() => {
  'use strict';
  const data = JSON.parse(document.getElementById('queue').textContent);
  const $ = id => document.getElementById(id);
  const key = 'museum-crop-proposal:' + data.queue_sha256;
  let edits = {}, position = 0, drag = null;
  try { edits = JSON.parse(localStorage.getItem(key) || '{}'); } catch { /* Private mode/storage may be disabled. */ }
  const ids = ['stamp-bac-ho-viet-bac','stamp-binh-phong','stamp-canh-cua-cham-rong','stamp-em-thuy','stamp-giong','stamp-hai-thieu-nu-em-be','stamp-hoang-hau-ngoc-truc','stamp-ket-nap-dang-dien-bien','stamp-phat-ba-quan-am'];
  for (const id of ids) { const o = document.createElement('option'); o.value = id; o.textContent = id; $('artifact').append(o); }
  const current = () => data.entries[position];
  const annotation = () => edits[current().review_id] || structuredClone(current().annotation);
  const fieldMap = { role:'proposed_role', scenario:'post_crop_scenario', artifact:'post_crop_artifact_id', view:'view_or_side', capture:'capture_group', duplicate:'duplicate_group', quality:'quality', reason:'reason' };
  const save = a => { edits[current().review_id] = a; try { localStorage.setItem(key, JSON.stringify(edits)); } catch { $('notice').textContent = 'Không lưu được trong trình duyệt; hãy xuất JSON trước khi đóng.'; } };
  function draw() {
    const c = annotation().crop;
    $('box').hidden = !c;
    if(c) Object.assign($('box').style,{left:c.x*100+'%',top:c.y*100+'%',width:c.w*100+'%',height:c.h*100+'%'});
    for(const name of ['x','y','w','h']) $('crop-'+name).value = c ? Math.round(c[name]*100000)/1000 : '';
  }
  function show() {
    const e=current(),a=annotation();
    $('status').textContent = `${position+1}/${data.entries.length} — ${e.review_id} — ${Object.keys(edits).length} ảnh có đề xuất`;
    $('metadata').textContent=JSON.stringify({source:e.source_file,sha256:e.source_sha256,partition:e.current_partition,artifact:e.current_artifact_id,scenario:e.current_scenario,folder_hint_NOT_LABEL:e.folder_hint,holdout:e.holdout_device_reserved,candidate_hold:e.candidate_hold},null,2);
    $('photo').src=e.preview; $('goto').value=e.review_id;
    for(const [id,field] of Object.entries(fieldMap)) $(id).value=a[field]||'';
    $('approved').checked=a.owner_approved===true;
    const referenceOption=$('role').querySelector('[value=references]');
    referenceOption.disabled=!e.reference_selection_allowed_without_resplit;
    draw();
  }
  function matches(e) { const f=$('filter').value;return f==='all'||f==='pending'&&!edits[e.review_id]?.crop||f==='unassigned'&&!e.current_partition||e.current_partition===f; }
  function move(step) { for(let i=position+step;i>=0&&i<data.entries.length;i+=step) if(matches(data.entries[i])) {position=i;show();return;} }
  $('previous').onclick=()=>move(-1); $('next').onclick=()=>move(1);
  $('filter').onchange=()=>{const i=data.entries.findIndex(matches);if(i>=0){position=i;show();}};
  $('jump').onclick=()=>{const i=data.entries.findIndex(e=>e.review_id===$('goto').value.trim().toUpperCase());if(i>=0){position=i;show();}else $('notice').textContent='Không có ID này.';};
  const point=e=>{const r=$('stage').getBoundingClientRect();return{x:Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)),y:Math.max(0,Math.min(1,(e.clientY-r.top)/r.height))};};
  $('stage').onpointerdown=e=>{if(!$('photo').complete||!$('photo').naturalWidth)return;drag=point(e);$('stage').setPointerCapture(e.pointerId);};
  $('stage').onpointermove=e=>{if(!drag)return;const end=point(e),a=annotation();a.crop={x:Math.min(drag.x,end.x),y:Math.min(drag.y,end.y),w:Math.abs(end.x-drag.x),h:Math.abs(end.y-drag.y)};a.owner_approved=false;save(a);$('approved').checked=false;draw();};
  $('stage').onpointerup=()=>{drag=null;};$('stage').onpointercancel=()=>{drag=null;};
  for(const name of ['x','y','w','h']) $('crop-'+name).onchange=()=>{
    const c=Object.fromEntries(['x','y','w','h'].map(n=>[n,Number($('crop-'+n).value)/100]));
    if(!Object.values(c).every(Number.isFinite)||c.x<0||c.y<0||c.w<=0||c.h<=0||c.x+c.w>1.000001||c.y+c.h>1.000001){$('notice').textContent='Khung ngoài ảnh hoặc quá nhỏ.';return;}
    const a=annotation();a.crop=c;a.owner_approved=false;save(a);$('approved').checked=false;draw();
  };
  $('whole').onclick=()=>{const a=annotation();a.crop={x:0,y:0,w:1,h:1};a.owner_approved=false;save(a);show();};
  $('clear').onclick=()=>{const a=annotation();a.crop=null;a.owner_approved=false;save(a);show();};
  for(const [id,field] of Object.entries(fieldMap)) $(id).onchange=()=>{const a=annotation();a[field]=$(id).value||null;a.owner_approved=false;save(a);$('approved').checked=false;};
  $('approved').onchange=()=>{const a=annotation();a.owner_approved=$('approved').checked;save(a);};
  $('export').onclick=()=>{
    const entries=data.entries.filter(e=>edits[e.review_id]).map(e=>({review_id:e.review_id,source_sha256:e.source_sha256,annotation:edits[e.review_id]}));
    const blob=new Blob([JSON.stringify({version:'camera-crop-annotations-v1',queue_sha256:data.queue_sha256,coordinate_space:'exif-oriented-normalized',entries},null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='crop-annotations.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  $('import').onchange=async e=>{try{const f=e.target.files[0];if(!f)return;const p=JSON.parse(await f.text());if(p.version!=='camera-crop-annotations-v1'||p.queue_sha256!==data.queue_sha256||!Array.isArray(p.entries))throw Error('JSON không thuộc queue này.');for(const r of p.entries){const src=data.entries.find(x=>x.review_id===r.review_id);if(!src||r.source_sha256!==src.source_sha256||!r.annotation)throw Error('ID/hash không khớp.');}for(const r of p.entries)edits[r.review_id]=r.annotation;try{localStorage.setItem(key,JSON.stringify(edits));}catch{}show();$('notice').textContent='Đã nạp đề xuất cục bộ; chưa thay đổi dataset.';}catch(error){$('notice').textContent=error.message;}finally{e.target.value='';}};
  show();
})();
