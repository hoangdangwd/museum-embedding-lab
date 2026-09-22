const $ = id => document.getElementById(id);
let queryResult, pairResult, busy = false, cameraStream;
const states = {
  match: 'Phù hợp với ngưỡng thử nghiệm',
  low_similarity: 'Chưa đủ tương đồng — thử chụp rõ hơn hoặc vật chưa có trong danh mục',
  ambiguous: 'Hai hiện vật quá gần nhau — chưa thể xác nhận',
  wrong_target: 'Ảnh gần với một hiện vật khác mục tiêu',
  insufficient_catalog: 'Cần ít nhất 2 hiện vật để kiểm tra độ phân biệt',
};
function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function notify(message, type = '') {
  $('notice').textContent = message;
  $('notice').className = type;
  $('notice').hidden = false;
}
async function api(path, options = {}) {
  const response = await fetch('/api/' + path, options);
  let data;
  try { data = await response.json(); } catch { throw new Error(`Server trả lỗi HTTP ${response.status}.`); }
  if (response.status === 401) location.replace('/login');
  if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'Dữ liệu gửi lên không hợp lệ.');
  return data;
}
async function task(message, fn) {
  if (busy) return;
  busy = true;
  document.querySelectorAll('button').forEach(b => b.disabled = true);
  notify(message, 'busy');
  try { await fn(); } catch (error) { notify(error.message, 'error'); }
  finally {
    try { await refresh(); } catch { /* Keep the original error visible. */ }
    busy = false;
    document.querySelectorAll('button').forEach(b => b.disabled = false);
  }
}
function image(url, alt, className) {
  const node = el('img', undefined, className);
  node.src = url; node.alt = alt; node.loading = 'lazy'; return node;
}
async function refresh() {
  const status = await api('status');
  $('currentUser').textContent = status.username ? `Xin chào, ${status.username}` : '';
  $('currentUser').hidden = !status.username;
  $('logout').hidden = !status.access_required;
  $('modelName').textContent = status.model.model;
  $('modelDetail').textContent = `${status.model.provider === 'local' ? 'Chạy trên máy · ' + status.model.device : 'Ảnh được gửi đến OpenRouter'} · ${status.model.loaded ? 'Đã nạp / kiểm tra model' : status.model.configured ? 'Sẵn sàng cấu hình' : 'Chưa có API key trong Cloudflare secret'}`;
  $('counts').textContent = `${status.artifact_count} hiện vật · ${status.indexed_count}/${status.reference_count} ảnh có vector`;
  const selected = $('target').value;
  $('target').replaceChildren(new Option('Tìm trong toàn bộ danh mục', ''));
  const groups = new Map();
  status.references.forEach(ref => {
    if (!groups.has(ref.artifact)) groups.set(ref.artifact, []);
    groups.get(ref.artifact).push(ref);
  });
  $('referenceList').replaceChildren();
  if (!groups.size) $('referenceList').append(el('p', 'Thêm bộ ảnh đầu tiên để bắt đầu.', 'empty'));
  groups.forEach((refs, artifact) => {
    $('target').add(new Option(artifact, artifact));
    const group = el('div', undefined, 'ref-group');
    group.append(el('h3', `${artifact} · ${refs.length} ảnh`));
    const thumbs = el('div', undefined, 'thumbs');
    refs.forEach(ref => {
      const thumb = el('div', undefined, 'thumb');
      thumb.append(image(`/api/references/${ref.id}/image`, ref.filename));
      const remove = el('button', '×'); remove.title = `Xóa ${ref.filename}`;
      remove.disabled = busy;
      remove.onclick = () => {
        if (confirm(`Xóa ảnh tham chiếu "${ref.filename}"?`)) task('Đang xóa ảnh…', async () => {
          await api(`references/${ref.id}`, {method:'DELETE'}); notify('Đã xóa ảnh và vector tương ứng.');
        });
      };
      thumb.append(remove, el('small', `${ref.indexed ? '✓' : '○'} ${ref.filename}`)); thumbs.append(thumb);
    });
    group.append(thumbs); $('referenceList').append(group);
  });
  if (groups.has(selected)) $('target').value = selected;
}
function selectedFile(id) {
  const selected = $(id).files[0];
  if (!selected) throw new Error('Hãy chọn ảnh trước.');
  if (selected.size > 15 * 1024 * 1024) throw new Error('Mỗi ảnh phải nhỏ hơn hoặc bằng 15 MB.');
  return selected;
}
async function imageSource(file) {
  if ('createImageBitmap' in window) {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { /* Use the img fallback. */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally { URL.revokeObjectURL(url); }
}
async function normalizeImage(file) {
  const source = await imageSource(file);
  const width = source.width, height = source.height;
  if (!width || !height || width * height > 30_000_000) {
    if (source.close) source.close();
    throw new Error('Ảnh vượt quá 30 megapixel hoặc không đọc được.');
  }
  if (Math.min(width, height) < 32) {
    if (source.close) source.close();
    throw new Error('Ảnh quá nhỏ; mỗi chiều cần ít nhất 32 pixel.');
  }
  const scale = Math.min(1, 1600 / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext('2d', { alpha: false });
  context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  if (source.close) source.close();
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', .95));
  if (!blob || blob.size > 15 * 1024 * 1024) throw new Error('Không thể chuẩn hóa ảnh thành JPEG dưới 15 MB.');
  return new File([blob], (file.name || 'image').replace(/\.[^.]+$/, '') + '.jpg', {type: 'image/jpeg', lastModified: Date.now()});
}
function preview(input, output) {
  let previous;
  $(input).onchange = () => {
    if (previous) URL.revokeObjectURL(previous);
    const selected = $(input).files[0];
    $(output).hidden = !selected;
    if (selected) $(output).src = previous = URL.createObjectURL(selected);
  };
}
preview('queryFile', 'queryPreview'); preview('leftFile', 'leftPreview'); preview('rightFile', 'rightPreview');
document.querySelectorAll('.tab').forEach(button => button.onclick = () => {
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b === button));
  document.querySelectorAll('.pane').forEach(p => p.hidden = p.id !== button.dataset.pane);
});
$('loadModel').onclick = () => task('Đang kiểm tra model trên OpenRouter…', async () => {
  await api('model/load', {method:'POST'}); notify('Đã kiểm tra model. Dùng ảnh để tạo embedding thực tế.');
});
$('referenceForm').onsubmit = event => {
  event.preventDefault();
  const files = Array.from($('referenceFiles').files), artifact = $('artifact').value.trim();
  task('Đang chuẩn hóa và lưu ảnh tham chiếu…', async () => {
    let added = 0, duplicates = 0;
    for (let i = 0; i < files.length; i++) {
      notify(`Đang xử lý ảnh ${i + 1}/${files.length}: ${files[i].name}`, 'busy');
      const normalized = await normalizeImage(files[i]);
      const form = new FormData(); form.append('artifact', artifact); form.append('file', normalized);
      try {
        const result = await api('references', {method:'POST', body:form});
        result.duplicate ? duplicates++ : added++;
      } catch (error) { throw new Error(`${files[i].name}: ${error.message} Đã lưu ${added} ảnh trước đó; có thể chọn lại cả bộ để tiếp tục.`); }
    }
    $('referenceFiles').value = '';
    notify(`Đã thêm ${added} ảnh${duplicates ? `, bỏ qua ${duplicates} ảnh trùng` : ''}. Bấm “Tạo embedding” để lập chỉ mục.`);
  });
};
$('build').onclick = () => task('Đang tạo embedding cho tối đa 10 ảnh… Bấm lại để tiếp tục nếu còn ảnh.', async () => {
  const result = await api('index', {method:'POST'});
  notify(`Đã tạo ${result.completed} vector · Có sẵn ${result.cached} · Còn ${result.remaining} · ${result.errors.length ? '\n' + result.errors.map(e => `${e.filename}: ${e.error}`).join('\n') : 'Có thể truy vấn.'}`, result.errors.length ? 'error' : '');
});
function metric(label, value) {
  const node = el('div', undefined, 'metric'); node.append(el('small', label), el('strong', value)); return node;
}
function renderQuery(result) {
  const root = $('result'); root.replaceChildren();
  root.append(el('div', states[result.decision], 'decision' + (result.decision === 'match' ? '' : ' warn')));
  if (result.same_as_reference) root.append(el('p', 'Ảnh này trùng ảnh tham chiếu. Kết quả không dùng để đánh giá khả năng nhận diện ảnh mới.', 'decision warn'));
  const metrics = el('div', undefined, 'metrics');
  metrics.append(metric('Cosine cao nhất', result.best_score.toFixed(4)), metric('Chênh lệch top 1–2', result.margin === null ? '—' : result.margin.toFixed(4)), metric('Chiều vector', result.dimensions), metric('Embedding / tìm kiếm', `${result.timing_ms.embedding.toFixed(0)} / ${result.timing_ms.search.toFixed(0)} ms`));
  root.append(metrics);
  const cards = el('div', undefined, 'candidates');
  result.candidates.forEach((candidate, index) => {
    const card = el('article', undefined, 'candidate');
    card.append(image(candidate.matches[0].image_url, candidate.artifact));
    const body = el('div', undefined, 'candidate-body');
    body.append(el('h3', `${index+1}. ${candidate.artifact}`), el('div', candidate.score.toFixed(4), 'score'), el('p', `${candidate.reference_count} ảnh tham chiếu · lấy điểm cao nhất`));
    const angles = el('div', undefined, 'other-angles');
    candidate.matches.forEach(m => { const node = image(m.image_url, m.filename); node.title = `${m.filename}: ${m.score.toFixed(4)}`; angles.append(node); });
    body.append(angles); card.append(body); cards.append(card);
  });
  root.append(cards);
  const details = el('details'); details.append(el('summary', 'Xem vector (32 giá trị đầu) và thông tin model'), el('pre', JSON.stringify({signature:result.signature, usage:result.usage, embedding:result.embedding.slice(0,32)}, null, 2)));
  root.append(details, el('p', result.note, 'hint'));
  $('resultPanel').hidden = false;
}
$('queryForm').onsubmit = event => {
  event.preventDefault(); $('resultPanel').hidden = true;
  task('Đang chuẩn hóa ảnh, tạo embedding và tìm hiện vật…', async () => {
    const normalized = await normalizeImage(selectedFile('queryFile'));
    const form = new FormData(); form.append('file', normalized); form.append('threshold', $('threshold').value); form.append('min_margin', $('margin').value); form.append('target', $('target').value);
    queryResult = await api('query', {method:'POST', body:form}); renderQuery(queryResult); notify('Đã so sánh xong. Kết quả ở phía dưới.');
  });
};
$('compareForm').onsubmit = event => {
  event.preventDefault(); $('compareResult').hidden = true; $('downloadCompare').hidden = true;
  task('Đang chuẩn hóa hai ảnh, tạo vector và tính cosine…', async () => {
    const [left, right] = await Promise.all([normalizeImage(selectedFile('leftFile')), normalizeImage(selectedFile('rightFile'))]);
    const form = new FormData(); form.append('left', left); form.append('right', right);
    pairResult = await api('compare', {method:'POST', body:form});
    const root = $('compareResult'); root.replaceChildren();
    const metrics = el('div', undefined, 'metrics'); metrics.append(metric('Cosine similarity', pairResult.score.toFixed(4)), metric('Chiều vector', pairResult.dimensions), metric('Thời gian xử lý', pairResult.seconds.toFixed(2) + ' s'));
    root.append(metrics, el('p', pairResult.note, 'hint'));
    if (pairResult.same_image) root.append(el('p', 'Hai ảnh có cùng nội dung pixel sau chuẩn hóa.', 'decision warn'));
    root.hidden = false; $('downloadCompare').hidden = false; notify('Đã so sánh xong hai ảnh.');
  });
};
function download(data, name) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], {type:'application/json'}));
  const link = el('a'); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$('downloadQuery').onclick = () => download(queryResult, 'query-result.json');
$('downloadCompare').onclick = () => download(pairResult, 'comparison-result.json');
$('logout').onclick = async () => { await api('logout', {method:'POST'}); location.replace('/login'); };
$('openCamera').onclick = async () => {
  if (!navigator.mediaDevices?.getUserMedia) { $('nativeCamera').click(); return; }
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({video: {facingMode: {ideal: 'environment'}}, audio: false});
    $('cameraVideo').srcObject = cameraStream; $('cameraBox').hidden = false; $('openCamera').hidden = true;
  } catch { $('nativeCamera').click(); }
};
$('closeCamera').onclick = () => { cameraStream?.getTracks().forEach(track => track.stop()); cameraStream = null; $('cameraVideo').srcObject = null; $('cameraBox').hidden = true; $('openCamera').hidden = false; };
$('capturePhoto').onclick = async () => {
  const video = $('cameraVideo');
  if (!video.videoWidth) return notify('Camera chưa sẵn sàng; hãy chờ một chút.', 'error');
  const canvas = document.createElement('canvas'); canvas.width = video.videoWidth; canvas.height = video.videoHeight;
  canvas.getContext('2d').drawImage(video, 0, 0);
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', .95));
  if (!blob) return notify('Không chụp được ảnh từ camera.', 'error');
  const transfer = new DataTransfer(); transfer.items.add(new File([blob], 'camera.jpg', {type:'image/jpeg'})); $('queryFile').files = transfer.files; $('queryFile').dispatchEvent(new Event('change')); $('closeCamera').click();
};
$('nativeCamera').onchange = () => { if ($('nativeCamera').files[0]) { const transfer = new DataTransfer(); transfer.items.add($('nativeCamera').files[0]); $('queryFile').files = transfer.files; $('queryFile').dispatchEvent(new Event('change')); } };
window.addEventListener('beforeunload', () => cameraStream?.getTracks().forEach(track => track.stop()));
refresh().catch(error => notify('Không kết nối được server: ' + error.message, 'error'));
