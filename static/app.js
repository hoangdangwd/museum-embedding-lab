const $ = id => document.getElementById(id);
const names = { bottle: 'Chai nước', 'case pc': 'Thùng máy tính', 'coca can': 'Lon Coca-Cola', figure: 'Mô hình', key: 'Chìa khóa', laptop: 'Laptop', mask: 'Khẩu trang', 'pepsi can': 'Lon Pepsi' };
let stream, photoUrl, busy = false, opening = false, ready = false, cameraGeneration = 0;

function notice(message = '') {
  $('notice').textContent = message;
  $('notice').hidden = !message;
}

async function api(path, options = {}) {
  const response = await fetch('/api/' + path, options);
  if (response.status === 401) { location.replace('/login'); throw new Error('Phiên đã hết hạn.'); }
  let data;
  try { data = await response.json(); } catch { throw new Error('Không kết nối được. Hãy thử lại.'); }
  if (!response.ok) throw new Error(data.detail || 'Không nhận diện được lúc này.');
  return data;
}

function stopCamera() {
  cameraGeneration++;
  stream?.getTracks().forEach(track => track.stop());
  stream = null;
  $('cameraVideo').srcObject = null;
  $('cameraVideo').hidden = true;
  $('captureControls').hidden = true;
  $('frame').hidden = true;
}

async function openCamera() {
  if (busy || opening) return;
  opening = true;
  notice();
  $('result').hidden = true;
  $('photo').hidden = true;
  $('cameraStart').hidden = false;
  $('openCamera').disabled = true;
  const generation = ++cameraGeneration;
  try {
    const status = await api('status');
    ready = status.ready;
    if (!ready) throw new Error('Nhận diện chưa sẵn sàng. Hãy thử lại sau.');
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Trình duyệt này chưa hỗ trợ camera.');
    const camera = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1600 }, height: { ideal: 1200 } }, audio: false });
    if (generation !== cameraGeneration || document.hidden) { camera.getTracks().forEach(track => track.stop()); return; }
    stream = camera;
    const video = $('cameraVideo');
    video.srcObject = stream;
    video.hidden = false;
    await video.play();
    if (generation !== cameraGeneration) return;
    $('cameraStart').hidden = true;
    $('photo').hidden = true;
    $('result').hidden = true;
    $('captureControls').hidden = false;
    $('frame').hidden = false;
    stream.getVideoTracks()[0].onended = () => { stopCamera(); $('cameraStart').hidden = false; };
  } catch (error) {
    stopCamera();
    $('cameraStart').hidden = false;
    const messages = { NotAllowedError: 'Cho phép camera để chụp ảnh.', NotFoundError: 'Không tìm thấy camera.', NotReadableError: 'Camera đang bận. Hãy thử lại.' };
    notice(messages[error.name] || error.message);
  } finally {
    opening = false;
    $('openCamera').disabled = false;
  }
}

$('openCamera').onclick = openCamera;
$('retake').onclick = openCamera;
$('capturePhoto').onclick = async () => {
  const video = $('cameraVideo');
  if (busy || !stream || !ready) return;
  if (!video.videoWidth || !video.videoHeight) { notice('Camera đang khởi động…'); return; }
  busy = true;
  notice();
  $('capturePhoto').disabled = true;
  try {
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, 1600 / Math.max(video.videoWidth, video.videoHeight));
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    canvas.getContext('2d', { alpha: false }).drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', .95));
    if (!blob) throw new Error('Không chụp được ảnh. Hãy thử lại.');
    if (photoUrl) URL.revokeObjectURL(photoUrl);
    photoUrl = URL.createObjectURL(blob);
    $('photo').src = photoUrl;
    $('photo').hidden = false;
    stopCamera();
    $('processing').hidden = false;
    const body = new FormData(); body.append('file', blob, 'capture.jpg');
    const result = await api('query', { method: 'POST', body, signal: AbortSignal.timeout(100_000) });
    $('resultName').textContent = result.recognized ? (names[result.artifact] || result.artifact) : 'Chưa nhận ra';
    $('result').hidden = false;
  } catch (error) {
    stopCamera();
    notice(error.name === 'TimeoutError' ? 'Nhận diện hơi lâu. Hãy thử lại.' : error.message);
    $('resultName').textContent = '';
    $('result').hidden = false;
  } finally {
    $('processing').hidden = true;
    $('capturePhoto').disabled = false;
    busy = false;
  }
};

$('logout').onclick = async () => {
  if (busy) return;
  stopCamera();
  try { await api('logout', { method: 'POST' }); location.replace('/login'); }
  catch (error) { notice(error.message); $('cameraStart').hidden = false; }
};
document.addEventListener('visibilitychange', () => {
  if (document.hidden && (stream || opening)) { stopCamera(); $('cameraStart').hidden = false; }
});
window.addEventListener('pagehide', () => { stopCamera(); if (photoUrl) URL.revokeObjectURL(photoUrl); });
