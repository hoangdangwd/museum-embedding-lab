const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

// Coordinates of object-fit: cover followed by a centered CSS scale.
// Capture uses the same rectangle, including in portrait/after rotation.
export function videoFrameRect(width, height, viewportWidth, viewportHeight, zoom = 1) {
  if (![width, height, viewportWidth, viewportHeight, zoom].every(n => Number.isFinite(n) && n > 0)) {
    throw new Error('Camera chưa sẵn sàng.');
  }
  const scale = Math.max(viewportWidth / width, viewportHeight / height) * Math.max(1, zoom);
  const w = viewportWidth / scale, h = viewportHeight / scale;
  return { x: (width - w) / 2, y: (height - h) / 2, w, h };
}

export function createCameraZoom(track, onChange) {
  const max = 4;
  let capabilities = {}, settings = {};
  try { capabilities = track?.getCapabilities?.() || {}; } catch { /* Digital fallback. */ }
  try { settings = track?.getSettings?.() || {}; } catch { /* Digital fallback. */ }
  const range = capabilities.zoom;
  const base = Number.isFinite(settings.zoom) && settings.zoom > 0 ? settings.zoom : 1;
  let native = Boolean(track?.applyConstraints && range && Number.isFinite(range.min) &&
    Number.isFinite(range.max) && range.min > 0 && range.max > range.min &&
    Number.isFinite(settings.zoom) && base >= range.min && base <= range.max);
  let actual = base, wanted = 1, processing = false, disposed = false;
  let state = { value: 1, digital: 1, min: 1, max, busy: false };
  function readZoom(fallback) {
    try { const value = track.getSettings?.().zoom; return Number.isFinite(value) && value > 0 ? value : fallback; }
    catch { return fallback; }
  }
  function emit(busy) {
    const ratio = actual / base;
    const min = native ? 1 : Math.max(1, ratio);
    wanted = clamp(wanted, min, max);
    state = { value: wanted, digital: Math.max(1, wanted / ratio), min, max, busy };
    if (!disposed) onChange(state);
  }
  async function drain() {
    if (processing || disposed) return;
    processing = true;
    try {
      let applied;
      do {
        applied = wanted;
        if (native) {
          const step = range.step > 0 ? range.step : .01;
          const target = clamp(range.min + Math.floor((Math.min(range.max, base * applied) - range.min) / step + 1e-7) * step, range.min, range.max);
          if (Math.abs(target - actual) > step / 2) {
            emit(true);
            try {
              await track.applyConstraints({ advanced: [{ zoom: target }] });
              if (disposed) return;
              actual = readZoom(actual);
              // Browsers may accept an unsupported constraint without applying it.
              if (Math.abs(actual - target) > step / 2 + .001) native = false;
            } catch {
              if (disposed) return;
              native = false;
              actual = readZoom(actual);
              // Try to restore the starting field of view before digital fallback.
              if (actual > base) {
                try { await track.applyConstraints({ advanced: [{ zoom: base }] }); } catch { /* Keep the measured view. */ }
                actual = readZoom(actual);
              }
            }
          }
        }
        if (disposed) return;
      } while (wanted !== applied);
    } finally {
      processing = false;
      emit(false);
    }
  }
  emit(false);
  return {
    set(value) {
      if (!Number.isFinite(value) || disposed) return;
      wanted = Math.round(clamp(value, state.min, max) * 100) / 100;
      if (processing) emit(true);
      // Digital-only updates are synchronous; hardware requests are serialized,
      // retaining only the most recent slider/pinch value while awaiting a track.
      void drain();
    },
    get state() { return state; },
    dispose() { disposed = true; },
  };
}
