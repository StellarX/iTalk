const express = require('express');
const auth = require('../middleware/auth');
const db = require('../config/db');
const memory = require('../services/memoryService');
const { FAMILIARITY, getStrengthScore } = require('../services/memoryAlgorithm');

const router = express.Router();
router.use(auth);

// 复习统计概览
router.get('/stats', async (req, res) => {
  try {
    const total = await db.query(
      'SELECT COUNT(*) AS c FROM user_word_memory WHERE user_id = ? AND last_review_at IS NOT NULL',
      [req.userId]
    );
    const rows = await db.query(
      'SELECT stability_hours, review_count, lapses, last_familiarity, last_review_at FROM user_word_memory WHERE user_id = ? AND last_review_at IS NOT NULL',
      [req.userId]
    );
    let sum = 0;
    let due = 0;
    const DUE_THRESHOLD = 60; // strength 低于该值视为需要复习
    rows.forEach((r) => {
      const state = {
        stability_hours: Number(r.stability_hours),
        review_count: r.review_count,
        lapses: r.lapses,
        last_familiarity: r.last_familiarity,
        last_review_at: r.last_review_at,
      };
      const s = getStrengthScore(state);
      sum += s;
      if (s < DUE_THRESHOLD) due++;
    });
    const avg = rows.length ? Math.round((sum / rows.length) * 10) / 10 : 0;
    res.json({
      total_studied: total[0].c,
      average_strength: avg,
      due_count: due,
      due_threshold: DUE_THRESHOLD,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 已学习单词列表（用户已记录记忆的单词，含所属词库与牢固度）
// 支持分页：limit（每页数量，默认 20，上限 100）、offset（偏移量）
router.get('/learned', async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(100, parseInt(req.query.limit, 10) || 20));
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
    const countRows = await db.query(
      'SELECT COUNT(*) AS c FROM user_word_memory WHERE user_id = ? AND last_review_at IS NOT NULL',
      [req.userId]
    );
    const total = Number(countRows[0].c);
    const rows = await db.query(
      `SELECT w.id, w.word, w.phonetic, w.definition, w.example, w.phrase, w.audio_url,
              l.name AS library_name, l.code AS library_code,
              m.stability_hours, m.review_count, m.lapses, m.last_familiarity, m.last_review_at
       FROM user_word_memory m
       JOIN words w ON w.id = m.word_id
       JOIN word_libraries l ON l.id = w.library_id
       WHERE m.user_id = ? AND m.last_review_at IS NOT NULL
       ORDER BY m.last_review_at DESC
       LIMIT ? OFFSET ?`,
      [req.userId, limit, offset]
    );
    const words = rows.map((r) => {
      const strength = getStrengthScore({
        stability_hours: Number(r.stability_hours),
        review_count: r.review_count,
        lapses: r.lapses,
        last_familiarity: r.last_familiarity,
        last_review_at: r.last_review_at,
      });
      return {
        id: r.id, word: r.word, phonetic: r.phonetic, definition: r.definition,
        example: r.example, phrase: r.phrase, audio_url: r.audio_url,
        library_name: r.library_name, library_code: r.library_code,
        strength,
      };
    });
    res.json({ words, total });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 智能抽取最薄弱的 N 个单词（复习核心）
// 支持可选过滤：libraryId（按词库）、wordbookId（按单词本）
router.get('/weak', async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(200, parseInt(req.query.limit, 10) || 20));
    const filters = {};
    if (req.query.libraryId) filters.libraryId = parseInt(req.query.libraryId, 10);
    if (req.query.wordbookId) filters.wordbookId = parseInt(req.query.wordbookId, 10);

    const ranked = await memory.getRankedMemories(req.userId, filters);
    const weak = ranked.slice(0, limit);
    res.json({
      words: weak.map((r) => ({
        ...r.word,
        strength: r.strength,
        review_count: r.state.review_count,
        lapses: r.state.lapses,
        last_familiarity: r.state.last_familiarity,
        last_review_at: r.state.last_review_at,
      })),
      total: ranked.length,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 复习反馈
router.post('/feedback', async (req, res) => {
  try {
    const { wordId, familiarity } = req.body || {};
    if (!wordId || !FAMILIARITY[familiarity]) {
      return res.status(400).json({ error: '参数错误：需要 wordId 与合法 familiarity' });
    }
    const result = await memory.recordFeedback(req.userId, wordId, familiarity, 'review');
    res.json({
      wordId,
      familiarity: result.familiarity,
      strength: result.after.strength,
      stability_hours: result.after.stability_hours,
      review_count: result.memory.review_count,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
