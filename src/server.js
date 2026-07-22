const path = require('path');
const express = require('express');
const env = require('./config/env');
const db = require('./config/db');

const app = express();
app.use(express.json());

// 路由
app.use('/api/auth', require('./routes/auth'));
app.use('/api/libraries', require('./routes/libraries'));
app.use('/api/learn', require('./routes/learn'));
app.use('/api/review', require('./routes/review'));
app.use('/api/wordbooks', require('./routes/wordbooks'));
app.use('/api/words', require('./routes/words'));

// 健康检查（即使数据库未就绪也返回，方便确认服务已启动）
app.get('/api/health', async (req, res) => {
  let dbOk = false;
  try {
    dbOk = await db.testConnection();
  } catch (e) {
    dbOk = false;
  }
  res.json({ status: 'ok', db: dbOk ? 'connected' : 'unavailable', time: new Date().toISOString() });
});

// 静态资源（前端）
app.use(express.static(path.join(__dirname, '..', 'public')));

// 兜底错误
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: '服务器内部错误' });
});

app.listen(env.port, () => {
  console.log(`✅ 英语学习网站已启动: http://localhost:${env.port}`);
  console.log(`   数据库: ${env.db.host}:${env.db.port}/${env.db.database}`);
});

module.exports = app;
