// 轻量 API 封装：自动携带 token，统一错误处理
const API = (() => {
  const TOKEN_KEY = 'italk_token';
  const TOKEN_KEY_OLD = 'lumina_token';
  let token = localStorage.getItem(TOKEN_KEY) || localStorage.getItem(TOKEN_KEY_OLD) || null;

  function setToken(t) {
    token = t;
    if (t) {
      localStorage.setItem(TOKEN_KEY, t);
      localStorage.removeItem(TOKEN_KEY_OLD);
    } else {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(TOKEN_KEY_OLD);
    }
  }

  async function request(method, path, body) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = 'Bearer ' + token;
    const res = await fetch('/api' + path, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    let data = {};
    try { data = await res.json(); } catch (e) { /* ignore */ }
    if (!res.ok) throw new Error(data.error || `请求失败 (${res.status})`);
    return data;
  }

  return {
    setToken,
    getToken: () => token,
    get: (p) => request('GET', p),
    post: (p, b) => request('POST', p, b),
    patch: (p, b) => request('PATCH', p, b),
    del: (p) => request('DELETE', p),
  };
})();
