export async function api(path, options = {}) {
  // AbortController also works in browsers without AbortSignal.timeout.
  const controller=options.signal ? null : new AbortController();
  const timer=controller ? setTimeout(()=>controller.abort(),45000) : null;
  try {
    let response;
    try {
      response = await fetch(path, { ...options, signal: options.signal || controller.signal });
    } catch {
      throw new Error('Chưa nhận được phản hồi. Hãy kiểm tra kết nối. Yêu cầu có thể đã được xử lý; kiểm tra trạng thái trước khi gửi lại.');
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.detail || 'Không xử lý được yêu cầu. Hãy thử lại.');
      error.status = response.status;
      throw error;
    }
    return data;
  } finally {if(timer!==null) clearTimeout(timer);}
}
