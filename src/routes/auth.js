const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../config/db');
const { sign } = require('../utils/token');
const auth = require('../middleware/auth');

const router = express.Router();

// 注册
router.post('/register', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: '用户名和密码必填' });
    if (String(password).length < 6) return res.status(400).json({ error: '密码至少 6 位' });

    const exists = await db.query('SELECT id FROM users WHERE username = ?', [username]);
    if (exists.length) return res.status(409).json({ error: '用户名已存在' });

    const hash = await bcrypt.hash(password, 10);
    const result = await db.query(
      'INSERT INTO users (username, password_hash) VALUES (?, ?)',
      [username, hash]
    );
    const token = sign({ userId: result.insertId, username });
    res.status(201).json({ token, user: { id: result.insertId, username } });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: '注册失败：' + e.message });
  }
});

// 登录
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: '用户名和密码必填' });

    const rows = await db.query('SELECT * FROM users WHERE username = ?', [username]);
    if (!rows.length) return res.status(401).json({ error: '用户不存在' });

    const user = rows[0];
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: '密码错误' });

    const token = sign({ userId: user.id, username: user.username });
    res.json({ token, user: { id: user.id, username: user.username } });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: '登录失败：' + e.message });
  }
});

// 当前用户
router.get('/me', auth, async (req, res) => {
  try {
    const rows = await db.query('SELECT id, username, created_at FROM users WHERE id = ?', [req.userId]);
    if (!rows.length) return res.status(404).json({ error: '用户不存在' });
    res.json({ user: rows[0] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 修改账号信息（用户名 / 密码）
router.patch('/me', auth, async (req, res) => {
  try {
    const { username, currentPassword, newPassword } = req.body || {};
    const rows = await db.query('SELECT * FROM users WHERE id = ?', [req.userId]);
    if (!rows.length) return res.status(404).json({ error: '用户不存在' });
    const user = rows[0];
    let changed = false;

    if (newPassword) {
      if (!currentPassword) return res.status(400).json({ error: '修改密码需先输入当前密码' });
      const ok = await bcrypt.compare(currentPassword, user.password_hash);
      if (!ok) return res.status(401).json({ error: '当前密码不正确' });
      if (String(newPassword).length < 6) return res.status(400).json({ error: '新密码至少 6 位' });
      await db.query('UPDATE users SET password_hash = ? WHERE id = ?', [await bcrypt.hash(newPassword, 10), req.userId]);
      changed = true;
    }
    if (username && username !== user.username) {
      const ex = await db.query('SELECT id FROM users WHERE username = ? AND id <> ?', [username, req.userId]);
      if (ex.length) return res.status(409).json({ error: '用户名已存在' });
      await db.query('UPDATE users SET username = ? WHERE id = ?', [username, req.userId]);
      changed = true;
    }
    if (!changed) return res.status(400).json({ error: '没有可更新的内容' });

    const u = (await db.query('SELECT id, username, created_at FROM users WHERE id = ?', [req.userId]))[0];
    const token = sign({ userId: u.id, username: u.username });
    res.json({ token, user: u });
  } catch (e) {
    res.status(500).json({ error: '更新失败：' + e.message });
  }
});

module.exports = router;
