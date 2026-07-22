/**
 * 记忆牢固度算法（核心）
 * ------------------------------------------------------------
 * 设计目标：只用「用户主观选择的熟悉等级」这一信号，结合
 *   - 距上次复习的时间间隔（艾宾浩斯遗忘曲线）
 *   - 历史复习次数
 *   - 最近一次熟悉等级
 * 计算一个 0~100 的「记忆牢固度分数(strength)」，用于复习时的智能排序与抽取，
 * 确保越薄弱的单词越优先被复习。
 *
 * 模型说明：
 *  1) 可提取性 retrievability = exp(-elapsedHours / stability)
 *     这是经典的指数遗忘曲线：stability 越大，记忆衰减越慢。
 *  2) 稳定度 stability(单位:小时) 在每次反馈后更新：
 *       - 选「不认识」(f=0)：记忆崩塌，stability 衰减（×0.4，并记一次 lapse）
 *       - 选「模糊/熟悉/掌握」(f=1/2/3)：记忆巩固，stability 增长，
 *         增长率随熟悉等级与复习次数提升 → 越学越牢、复习间隔越长。
 *  3) 最终 strength = retrievability × (0.4 + 0.6 × mastery) × 100
 *     mastery = 最近熟悉等级 / 3，使得「刚学完但没掌握」的词也能被适当优先，
 *     同时随时间整体衰减。
 *
 * 复习排序：strength 升序（越小越薄弱）取前 N 个。
 */

// 用户主观熟悉等级定义（前端与此保持一致）
const FAMILIARITY = {
  unknown: { level: 0, label: '不认识', weight: 0 },
  fuzzy: { level: 1, label: '模糊', weight: 1 },
  familiar: { level: 2, label: '熟悉', weight: 2 },
  mastered: { level: 3, label: '掌握', weight: 3 },
};

// 算法常量
const DEFAULT_STABILITY = 12; // 小时：首次学习前的初始稳定度
const MIN_STABILITY = 6; // 小时：稳定度下限
const MAX_STABILITY = 24 * 365; // 小时：稳定度上限（约一年）
const STRENGTH_FLOOR_WEIGHT = 0.4; // strength 中 mastery 的基底权重
const STRENGTH_MASTERY_WEIGHT = 0.6; // strength 中 mastery 的加成权重

/** 新词初始记忆状态 */
function defaultState() {
  return {
    stability_hours: DEFAULT_STABILITY,
    review_count: 0,
    lapses: 0,
    last_familiarity: null,
    last_review_at: null,
  };
}

/**
 * 计算记忆牢固度分数 (0~100，保留 1 位小数)
 * @param {object} state 记忆状态
 * @param {number} [now] 时间戳(ms)
 */
function getStrengthScore(state, now = Date.now()) {
  // 从未学过：在「学习模式」中视为全新词（优先出现），不计入复习排序
  if (!state.last_review_at) return 100;

  const elapsedHours = (now - new Date(state.last_review_at).getTime()) / 3600000;
  const stability = Math.max(1, state.stability_hours);
  const retrievability = Math.exp(-elapsedHours / stability); // 0~1
  const mastery = Math.min(1, Math.max(0, (state.last_familiarity ?? 0) / 3));
  const strength = retrievability * (STRENGTH_FLOOR_WEIGHT + STRENGTH_MASTERY_WEIGHT * mastery) * 100;
  return Math.round(strength * 10) / 10;
}

/**
 * 应用一次熟悉度反馈，返回更新后的状态与本次前后指标（用于持久化与日志）
 * @param {object} state 旧状态（可来自 defaultState 或数据库）
 * @param {string} familiarityKey 'unknown'|'fuzzy'|'familiar'|'mastered'
 * @param {number} [now]
 */
function applyFeedback(state, familiarityKey, now = Date.now()) {
  const fam = FAMILIARITY[familiarityKey];
  if (!fam) throw new Error(`未知的熟悉等级: ${familiarityKey}`);
  const f = fam.level; // 0..3

  const before = {
    stability_hours: state.stability_hours,
    strength: getStrengthScore(state, now),
  };

  let newStability = state.stability_hours;

  if (f === 0) {
    // 完全不认识 → 记忆崩塌，稳定度大幅衰减
    newStability = Math.max(MIN_STABILITY, state.stability_hours * 0.3);
    state.lapses = (state.lapses || 0) + 1;
  } else {
    // 模糊/熟悉/掌握 → 巩固，增长率随等级和复习次数提升
    const growth = 1 + 0.9 * f + 0.15 * (state.review_count || 0);
    newStability = Math.min(MAX_STABILITY, state.stability_hours * growth);
    // 仅「模糊」时给一个合理的稳定度下限，避免过短
    if (f === 1) newStability = Math.max(newStability, MIN_STABILITY * 2);
  }

  state.stability_hours = Math.round(newStability * 100) / 100;
  state.review_count = (state.review_count || 0) + 1;
  state.last_familiarity = f;
  state.last_review_at = new Date(now);

  const after = {
    stability_hours: state.stability_hours,
    strength: getStrengthScore(state, now),
  };

  return {
    state,
    before,
    after,
    familiarity: f,
    elapsed_hours: state.last_review_at && state.last_review_at
      ? 0
      : 0, // 反馈时刻间隔为 0（用于日志语义，详见调用方）
  };
}

module.exports = {
  FAMILIARITY,
  DEFAULT_STABILITY,
  MIN_STABILITY,
  MAX_STABILITY,
  defaultState,
  getStrengthScore,
  applyFeedback,
};
