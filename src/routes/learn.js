const express = require('express');
const auth = require('../middleware/auth');
const db = require('../config/db');
const memory = require('../services/memoryService');
const { getStrengthScore, FAMILIARITY } = require('../services/memoryAlgorithm');

const router = express.Router();
router.use(auth);

// 开始一次学习：选择词库 + 指定单词数量，返回卡片数据
// 优先未学过的词；不足则用该词库内最薄弱的已学词补足（兼顾复习）
router.post('/start', async (req, res) => {
  try {
    const { libraryId, count = 10 } = req.body || {};
    if (!libraryId) return res.status(400).json({ error: '请选择词库' });
    const limit = Math.max(1, Math.min(100, parseInt(count, 10) || 10));

    // 该词库全部单词
    const allWords = await db.query(
      'SELECT id FROM words WHERE library_id = ?',
      [libraryId]
    );
    if (!allWords.length) return res.status(404).json({ error: '该词库暂无单词' });

    const allIds = allWords.map((w) => w.id);
    const placeholders = allIds.map(() => '?').join(',');

    // 已学过的词
    const studiedRows = await db.query(
      `SELECT word_id FROM user_word_memory WHERE user_id = ? AND word_id IN (${placeholders})`,
      [req.userId, ...allIds]
    );
    const studiedSet = new Set(studiedRows.map((r) => r.word_id));

    const unstudied = allIds.filter((id) => !studiedSet.has(id));

    // 洗牌（Fisher-Yates）
    const shuffle = (arr) => {
      const a = arr.slice();
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    };

    let selected = shuffle(unstudied).slice(0, limit);
    if (selected.length < limit) {
      // 用该词库内最薄弱的已学词补足
      const ranked = await memory.getRankedMemories(req.userId, { libraryId });
      const fill = ranked
        .map((r) => r.wordId)
        .filter((id) => !selected.includes(id));
      selected = selected.concat(fill.slice(0, limit - selected.length));
    }

    if (!selected.length) return res.status(404).json({ error: '没有可学习的单词' });

    const wordPlaceholders = selected.map(() => '?').join(',');
    const words = await db.query(
      `SELECT id, word, phonetic, definition, example, phrase, audio_url
       FROM words WHERE id IN (${wordPlaceholders})`,
      selected
    );

    // 附带记忆状态
    const withMemory = await Promise.all(
      words.map(async (w) => {
        const mem = await memory.getMemoryState(req.userId, w.id);
        return {
          ...w,
          memory: {
            studied: mem.exists,
            strength: mem.exists ? mem.strength : null,
            review_count: mem.exists ? mem.state.review_count : 0,
            last_familiarity: mem.exists ? mem.state.last_familiarity : null,
          },
        };
      })
    );

    // 按 selected 顺序返回
    const orderMap = new Map(selected.map((id, i) => [id, i]));
    withMemory.sort((a, b) => orderMap.get(a.id) - orderMap.get(b.id));

    res.json({ words: withMemory, total: withMemory.length });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// 学习反馈：记录熟悉等级，更新记忆状态
router.post('/feedback', async (req, res) => {
  try {
    const { wordId, familiarity } = req.body || {};
    if (!wordId || !FAMILIARITY[familiarity]) {
      return res.status(400).json({ error: '参数错误：需要 wordId 与合法 familiarity' });
    }
    const result = await memory.recordFeedback(
      req.userId,
      wordId,
      familiarity,
      req.body.sessionType || 'learn'
    );
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
