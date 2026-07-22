const express = require('express');
const auth = require('../middleware/auth');
const db = require('../config/db');

const router = express.Router();
router.use(auth);

// 模糊搜索单词：匹配单词本身或释义，返回所属词库
router.get('/search', async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (!q) return res.json({ words: [], total: 0 });
    const like = `%${q}%`;
    const prefix = `${q}%`;
    const limit = Math.max(1, Math.min(100, parseInt(req.query.limit, 10) || 50));
    const rows = await db.query(
      `SELECT w.id, w.word, w.phonetic, w.definition, w.example, w.phrase, w.audio_url,
              w.library_id, l.name AS library_name, l.code AS library_code
       FROM words w
       JOIN word_libraries l ON l.id = w.library_id
       WHERE w.word LIKE ? OR w.definition LIKE ?
       ORDER BY
         CASE WHEN w.word LIKE ? THEN 0 ELSE 1 END,
         CHAR_LENGTH(w.word) ASC,
         w.word ASC
       LIMIT ?`,
      [like, like, prefix, limit]
    );
    res.json({ words: rows, total: rows.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
