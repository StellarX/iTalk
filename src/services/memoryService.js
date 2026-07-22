const db = require('../config/db');
const { applyFeedback, defaultState, getStrengthScore, FAMILIARITY } = require('./memoryAlgorithm');

/**
 * 获取某用户-单词的记忆状态；不存在则返回默认初始状态
 */
async function getMemoryState(userId, wordId) {
  const rows = await db.query(
    'SELECT * FROM user_word_memory WHERE user_id = ? AND word_id = ?',
    [userId, wordId]
  );
  if (rows.length === 0) return { exists: false, state: defaultState() };
  const r = rows[0];
  const state = {
    stability_hours: Number(r.stability_hours),
    review_count: r.review_count,
    lapses: r.lapses,
    last_familiarity: r.last_familiarity,
    last_review_at: r.last_review_at,
    first_seen_at: r.first_seen_at,
  };
  return { exists: true, state, strength: getStrengthScore(state) };
}

/**
 * 记录一次熟悉度反馈，更新记忆状态并写入历史日志
 * @returns {Promise<{memory:object, before:object, after:object, familiarity:number}>}
 */
async function recordFeedback(userId, wordId, familiarityKey, sessionType = 'learn') {
  const now = new Date();
  // 防止传入不在枚举内的 session_type 导致写入 user_memory_log 失败（已有库枚举仅含 learn/review）
  const ALLOWED_SESSION = ['learn', 'review', 'browse'];
  const sess = ALLOWED_SESSION.includes(sessionType) ? sessionType : 'learn';
  const nowMs = now.getTime();

  const existing = await db.query(
    'SELECT * FROM user_word_memory WHERE user_id = ? AND word_id = ?',
    [userId, wordId]
  );

  let state;
  let memoryId = null;
  if (existing.length) {
    const r = existing[0];
    memoryId = r.id;
    state = {
      stability_hours: Number(r.stability_hours),
      review_count: r.review_count,
      lapses: r.lapses,
      last_familiarity: r.last_familiarity,
      last_review_at: r.last_review_at,
    };
  } else {
    state = defaultState();
    state.first_seen_at = now;
  }

  const beforeStrength = getStrengthScore(state, nowMs);
  const beforeStability = state.stability_hours;
  const elapsedHours = state.last_review_at
    ? Math.round(((nowMs - new Date(state.last_review_at).getTime()) / 3600000) * 100) / 100
    : 0;

  const result = applyFeedback(state, familiarityKey, nowMs);
  const after = result.after;

  if (memoryId) {
    await db.query(
      `UPDATE user_word_memory
         SET stability_hours = ?, review_count = ?, lapses = ?, last_familiarity = ?, last_review_at = ?, first_seen_at = ?
       WHERE id = ?`,
      [
        state.stability_hours,
        state.review_count,
        state.lapses,
        state.last_familiarity,
        state.last_review_at,
        state.first_seen_at || now,
        memoryId,
      ]
    );
  } else {
    await db.query(
      `INSERT INTO user_word_memory
         (user_id, word_id, stability_hours, review_count, lapses, last_familiarity, last_review_at, first_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        userId,
        wordId,
        state.stability_hours,
        state.review_count,
        state.lapses,
        state.last_familiarity,
        state.last_review_at,
        state.first_seen_at || now,
      ]
    );
  }

  // 写入历史记忆日志
  await db.query(
    `INSERT INTO user_memory_log
       (user_id, word_id, familiarity, elapsed_hours, stability_before, stability_after, strength_before, strength_after, session_type)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      userId,
      wordId,
      result.familiarity,
      elapsedHours,
      beforeStability,
      after.stability_hours,
      beforeStrength,
      after.strength,
      sess,
    ]
  );

  return {
    memory: state,
    before: { stability_hours: beforeStability, strength: beforeStrength },
    after,
    familiarity: result.familiarity,
  };
}

/**
 * 批量计算某用户已学习单词的 strength 并排序（升序=最薄弱在前）
 * @param {number} userId
 * @param {{libraryId?:number, wordbookId?:number}} filters
 * @returns {Promise<Array<{wordId:number, strength:number, state:object, word:object}>>}
 */
async function getRankedMemories(userId, filters = {}) {
  let sql = `
    SELECT m.*, w.word, w.phonetic, w.definition, w.example, w.phrase, w.audio_url, w.library_id
    FROM user_word_memory m
    JOIN words w ON w.id = m.word_id
    WHERE m.user_id = ? AND m.last_review_at IS NOT NULL
  `;
  const params = [userId];
  if (filters.libraryId) {
    sql += ' AND w.library_id = ?';
    params.push(filters.libraryId);
  }
  if (filters.wordbookId) {
    sql += ' AND m.word_id IN (SELECT word_id FROM user_wordbook_words WHERE wordbook_id = ?)';
    params.push(filters.wordbookId);
  }

  const rows = await db.query(sql, params);
  const ranked = rows.map((r) => {
    const state = {
      stability_hours: Number(r.stability_hours),
      review_count: r.review_count,
      lapses: r.lapses,
      last_familiarity: r.last_familiarity,
      last_review_at: r.last_review_at,
    };
    return {
      wordId: r.word_id,
      strength: getStrengthScore(state),
      state,
      word: {
        id: r.word_id,
        word: r.word,
        phonetic: r.phonetic,
        definition: r.definition,
        example: r.example,
        phrase: r.phrase,
        audio_url: r.audio_url,
      },
    };
  });
  ranked.sort((a, b) => a.strength - b.strength);
  return ranked;
}

module.exports = { getMemoryState, recordFeedback, getRankedMemories, FAMILIARITY };
