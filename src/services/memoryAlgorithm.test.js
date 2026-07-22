// 纯逻辑测试，无需数据库：node src/services/memoryAlgorithm.test.js
const { defaultState, applyFeedback, getStrengthScore, FAMILIARITY } = require('./memoryAlgorithm');

let pass = 0, fail = 0;
function assert(name, cond) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name); }
}

console.log('— 记忆算法测试 —');

// 1) 全新词 strength=100
let s = defaultState();
assert('全新词 strength=100', getStrengthScore(s) === 100);

// 2) 连续「掌握」会让稳定度增长、复习越久不被抽中
let t = Date.now();
let st = defaultState();
for (let i = 0; i < 3; i++) st = applyFeedback(st, 'mastered', t).state;
assert('掌握后稳定度明显增长', st.stability_hours > 50);
// 7 天后 strength 仍较高（因为很牢）
const strength7d = getStrengthScore(st, t + 7 * 864e5);
assert('掌握词7天后仍较牢(>60)', strength7d > 60);

// 3) 「不认识」会让稳定度骤降并记录 lapse
let st2 = defaultState();
const afterMastered = applyFeedback(st2, 'mastered', t).state;
st2 = applyFeedback(afterMastered, 'unknown', t).state;
assert('不认识后稳定度明显崩塌(<18)', st2.stability_hours < 18);
assert('不认识后 lapse+1', st2.lapses === 1);
assert('不认识后 strength 较低(<60)', getStrengthScore(st2, t) < 60);

// 4) 排序语义：strength 越小越薄弱
const a = applyFeedback(defaultState(), 'fuzzy', t).state;     // 模糊
const b = applyFeedback(defaultState(), 'mastered', t).state;  // 掌握
const sa = getStrengthScore(a, t + 3 * 864e5);
const sb = getStrengthScore(b, t + 3 * 864e5);
assert('模糊词比掌握词更薄弱(升序优先)', sa < sb);

// 5) 时间衰减：同一状态，时间越久 strength 越低
const base = applyFeedback(defaultState(), 'familiar', t).state;
const soon = getStrengthScore(base, t + 1 * 864e5);
const later = getStrengthScore(base, t + 10 * 864e5);
assert('时间越久 strength 越低', later < soon);

// 6) 复习越多，相同时间后 strength 越高（复习次数巩固）
let few = defaultState(); few = applyFeedback(few, 'familiar', t).state;
let many = defaultState();
for (let i = 0; i < 4; i++) many = applyFeedback(many, 'familiar', t).state;
assert('复习更多→更牢', getStrengthScore(many, t + 5 * 864e5) > getStrengthScore(few, t + 5 * 864e5));

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
