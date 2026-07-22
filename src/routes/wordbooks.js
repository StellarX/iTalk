const express = require('express');
const auth = require('../middleware/auth');
const db = require('../config/db');

const router = express.Router();
router.use(auth);

// 列表（含单词数、分类）
router.get('/', async (req, res) => {
  try {
    const rows = await db.query(
      `SELECT wb.id, wb.name, wb.category, wb.created_at,
              COUNT(wbw.id) AS word_count
       FROM user_wordbooks wb
       LEFT JOIN user_wordbook_words wbw ON wbw.wordbook_id = wb.id
       WHERE wb.user_id = ?
       GROUP BY wb.id, wb.name, wb.category, wb.created_at
       ORDER BY wb.created_at DESC`,
      [req.userId]
    );
    res.json({ wordbooks: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 创建
router.post('/', async (req, res) => {
  try {
    const { name, category = '默认' } = req.body || {};
    if (!name) return res.status(400).json({ error: '单词本名称必填' });
    const result = await db.query(
      'INSERT INTO user_wordbooks (user_id, name, category) VALUES (?, ?, ?)',
      [req.userId, name, category]
    );
    res.status(201).json({ id: result.insertId, name, category });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 重命名 / 改分类
router.patch('/:id', async (req, res) => {
  try {
    const { name, category } = req.body || {};
    const existing = await db.query(
      'SELECT id FROM user_wordbooks WHERE id = ? AND user_id = ?',
      [req.params.id, req.userId]
    );
    if (!existing.length) return res.status(404).json({ error: '单词本不存在' });

    const sets = [];
    const params = [];
    if (name) { sets.push('name = ?'); params.push(name); }
    if (category) { sets.push('category = ?'); params.push(category); }
    if (!sets.length) return res.status(400).json({ error: '无可更新字段' });

    params.push(req.params.id, req.userId);
    await db.query(
      `UPDATE user_wordbooks SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`,
      params
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 删除
router.delete('/:id', async (req, res) => {
  try {
    const existing = await db.query(
      'SELECT id FROM user_wordbooks WHERE id = ? AND user_id = ?',
      [req.params.id, req.userId]
    );
    if (!existing.length) return res.status(404).json({ error: '单词本不存在' });
    await db.query('DELETE FROM user_wordbooks WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 单词本内的单词列表
router.get('/:id/words', async (req, res) => {
  try {
    const existing = await db.query(
      'SELECT id FROM user_wordbooks WHERE id = ? AND user_id = ?',
      [req.params.id, req.userId]
    );
    if (!existing.length) return res.status(404).json({ error: '单词本不存在' });

    const rows = await db.query(
      `SELECT w.id, w.word, w.phonetic, w.definition, w.example, w.phrase, w.audio_url,
              l.name AS library_name, l.code AS library_code
       FROM user_wordbook_words wbw
       JOIN words w ON w.id = wbw.word_id
       JOIN word_libraries l ON l.id = w.library_id
       WHERE wbw.wordbook_id = ?
       ORDER BY wbw.created_at DESC`,
      [req.params.id]
    );
    res.json({ words: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 添加单词到单词本
router.post('/:id/words', async (req, res) => {
  try {
    const { wordId } = req.body || {};
    if (!wordId) return res.status(400).json({ error: 'wordId 必填' });
    const book = await db.query(
      'SELECT id FROM user_wordbooks WHERE id = ? AND user_id = ?',
      [req.params.id, req.userId]
    );
    if (!book.length) return res.status(404).json({ error: '单词本不存在' });
    const word = await db.query('SELECT id FROM words WHERE id = ?', [wordId]);
    if (!word.length) return res.status(404).json({ error: '单词不存在' });

    await db.query(
      'INSERT IGNORE INTO user_wordbook_words (wordbook_id, word_id) VALUES (?, ?)',
      [req.params.id, wordId]
    );
    res.status(201).json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 从单词本移除单词
router.delete('/:id/words/:wordId', async (req, res) => {
  try {
    await db.query(
      'DELETE FROM user_wordbook_words WHERE wordbook_id = ? AND word_id = ?',
      [req.params.id, req.params.wordId]
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
