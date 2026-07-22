const { verify } = require('../utils/token');

// 鉴权中间件：校验 Bearer Token，把 userId 挂到 req 上
function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: '未登录或缺少 token' });
  try {
    const payload = verify(token);
    req.userId = payload.userId;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'token 无效或已过期' });
  }
}

module.exports = auth;
