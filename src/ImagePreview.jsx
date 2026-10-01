import React, { useEffect, useState } from 'react';

// Preview and validate the whole image without editing or calling a provider.
export function ImagePreview({ file, onReady }) {
  const [preview, setPreview] = useState(null);
  useEffect(() => {
    let active = true;
    const url = URL.createObjectURL(file);
    const image = new Image();
    setPreview(null); onReady(false);
    image.onload = () => {
      if (!active) return;
      const valid = Math.min(image.naturalWidth, image.naturalHeight) >= 64;
      setPreview({ url, error: valid ? '' : 'Ảnh quá nhỏ. Hãy chọn ảnh có cả hai chiều từ 64 px.' });
      onReady(valid);
    };
    image.onerror = () => {
      if (!active) return;
      setPreview({ error: 'Không đọc được ảnh. Hãy chọn JPEG hoặc PNG khác.' });
      onReady(false);
    };
    image.src = url;
    return () => {
      active = false;
      image.onload = null; image.onerror = null;
      URL.revokeObjectURL(url);
    };
  }, [file, onReady]);
  return <div className="recognition-image-preview">
    {preview?.url && <img src={preview.url} alt="Ảnh nhận diện toàn khung" />}
    {preview?.error && <p className="hunt-notice" role="alert">{preview.error}</p>}
  </div>;
}
