const express = require('express');
const auth = require('../middleware/auth');
const db = require('../config/db');
const { getStrengthScore } = require('../services/memoryAlgorithm');

const router = express.Router();
router.use(auth);

// 词库列表（含单词总数 + 当前用户已学数量）
// 「已学」定义：该用户对该单词有过至少一次熟悉度反馈（user_word_memory 存在对应记录）
router.get('/', async (req, res) => {
  try {
    const rows = await db.query(`
      SELECT l.id, l.code, l.name, l.description,
        (SELECT COUNT(*) FROM words w2 WHERE w2.library_id = l.id) AS word_count,
        (SELECT COUNT(DISTINCT uwm.word_id)
           FROM user_word_memory uwm
           JOIN words w2 ON w2.id = uwm.word_id
          WHERE w2.library_id = l.id AND uwm.user_id = ?) AS learned_count
      FROM word_libraries l
      ORDER BY l.id
    `, [req.userId]);
    res.json({ libraries: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 单个词库详情
router.get('/:id', async (req, res) => {
  try {
    const rows = await db.query('SELECT * FROM word_libraries WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: '词库不存在' });
    res.json({ library: rows[0] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 词库单词列表：分页 + 词库内模糊搜索 + 当前用户记忆状态（牢固度）
// 用于「浏览词库」页面：可翻页查看某词库全部单词、词库内搜索、实时评级（feedback）
router.get('/:id/words', async (req, res) => {
  try {
    const libraryId = req.params.id;
    const q = (req.query.q || '').trim();
    const limit = Math.max(1, Math.min(200, parseInt(req.query.limit, 10) || 50));
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);

    const whereParams = [libraryId];
    let where = 'w.library_id = ?';
    if (q) {
      where += ' AND (w.word LIKE ? OR w.definition LIKE ?)';
      whereParams.push(`%${q}%`, `%${q}%`);
    }

    const cnt = await db.query(`SELECT COUNT(*) AS c FROM words w WHERE ${where}`, whereParams);
    const total = cnt[0] ? cnt[0].c : 0;

    // 注意占位符顺序：JOIN 中的 m.user_id = ? 位于 WHERE 的 w.library_id = ? 之前，
    // 故参数数组须为 [req.userId, ...whereParams, limit, offset]
    const rows = await db.query(
      `SELECT w.id, w.word, w.phonetic, w.definition, w.example, w.phrase, w.audio_url,
              m.stability_hours, m.review_count, m.lapses, m.last_familiarity, m.last_review_at
       FROM words w
       LEFT JOIN user_word_memory m ON m.word_id = w.id AND m.user_id = ?
       WHERE ${where}
       ORDER BY w.word ASC
       LIMIT ? OFFSET ?`,
      [req.userId, ...whereParams, limit, offset]
    );

    const words = rows.map((r) => {
      const studied = !!r.last_review_at;
      const strength = studied
        ? getStrengthScore({
            stability_hours: r.stability_hours,
            review_count: r.review_count,
            lapses: r.lapses,
            last_familiarity: r.last_familiarity,
            last_review_at: r.last_review_at,
          })
        : null;
      return {
        id: r.id,
        word: r.word,
        phonetic: r.phonetic,
        definition: r.definition,
        example: r.example,
        phrase: r.phrase,
        audio_url: r.audio_url,
        memory: studied
          ? {
              studied: true,
              strength,
              last_familiarity: r.last_familiarity,
              review_count: r.review_count,
            }
          : { studied: false },
      };
    });

    res.json({ words, total, limit, offset });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
