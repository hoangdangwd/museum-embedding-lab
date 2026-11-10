import { videoCropRect } from './camera-zoom.js';

async function decodeImage(blob) {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
      return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
    } catch { /* Safari/older browsers may decode more formats through HTMLImageElement. */ }
  }
  const url = URL.createObjectURL(blob);
  const image = new Image();
  try {
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error('Không đọc được ảnh. Hãy chọn ảnh JPEG hoặc PNG khác.'));
      image.src = url;
    });
    return { source: image, width: image.naturalWidth, height: image.naturalHeight, close: () => URL.revokeObjectURL(url) };
  } catch (error) { URL.revokeObjectURL(url); throw error; }
}

export async function jpeg(source, crop = null) {
  if (source.size > 15 * 1024 * 1024) throw new Error('Ảnh quá lớn. Hãy chọn ảnh dưới 15 MB.');
  const image = await decodeImage(source);
  try {
    const area = crop || { x: 0, y: 0, w: 1, h: 1 };
    if (![area.x,area.y,area.w,area.h].every(Number.isFinite) || area.x<0 || area.y<0 || area.w<=0 || area.h<=0 || area.x+area.w>1.000001 || area.y+area.h>1.000001) throw new Error('Khung cắt không hợp lệ. Hãy chọn lại vùng ảnh.');
    const width = image.width * area.w, height = image.height * area.h;
    if (Math.min(width, height) < 64) throw new Error('Vùng chọn quá nhỏ. Hãy giữ trọn hiện vật trong ảnh.');
    const scale = Math.min(1, 1600 / Math.max(width,height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width*scale);
    canvas.height = Math.round(height*scale);
    const context = canvas.getContext('2d', { alpha: false });
    context.fillStyle = '#fff';
    context.fillRect(0,0,canvas.width,canvas.height);
    context.drawImage(image.source,image.width*area.x,image.height*area.y,width,height,0,0,canvas.width,canvas.height);
    return await new Promise((resolve,reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Không xử lý được ảnh.')), 'image/jpeg',0.95));
  } finally { image.close(); }
}

export function videoPhoto(video, { viewportWidth = video.videoWidth, viewportHeight = video.videoHeight, zoom = 1, frame = null } = {}) {
  if (!video.videoWidth || !video.videoHeight) return Promise.reject(new Error('Camera chưa sẵn sàng.'));
  const canvas = document.createElement('canvas');
  const area = videoCropRect(video.videoWidth,video.videoHeight,viewportWidth,viewportHeight,zoom,frame);
  if (Math.min(area.w, area.h) < 64) return Promise.reject(new Error('Vùng chụp có độ phân giải quá nhỏ. Hãy giảm zoom và đưa camera gần hiện vật hơn.'));
  const scale = Math.min(1,1600/Math.max(area.w,area.h));
  canvas.width = Math.max(1,Math.round(area.w*scale));
  canvas.height = Math.max(1,Math.round(area.h*scale));
  canvas.getContext('2d').drawImage(video,area.x,area.y,area.w,area.h,0,0,canvas.width,canvas.height);
  return new Promise((resolve,reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Không chụp được ảnh.')), 'image/jpeg',0.95));
}
