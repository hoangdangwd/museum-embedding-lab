document.getElementById('loginForm').onsubmit = async event => {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button');
  const error = document.getElementById('error');
  button.disabled = true; error.textContent = 'Đang đăng nhập…';
  try {
    const response = await fetch('/api/session', {method:'POST', body:new FormData(event.currentTarget)});
    const result = await response.json();
    if (!response.ok) throw new Error(result.detail || 'Không đăng nhập được.');
    location.replace('/');
  } catch (failure) { error.textContent = failure.message; }
  finally { button.disabled = false; }
};
