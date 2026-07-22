// 一次性构建脚本：合成真实考试词库（六级 / 考研 / 雅思 / 托福 / BEC 商务英语），写入 db/seed-data.js。
//
// 数据源（gaollard/english-vocabulary）：
//   · 官方完整 txt 词表（5651 / 9602 / 13477 词）—— 作单词底表，确保覆盖完整考试大纲
//   · json-sentence 富数据（含 uk/us 英美音标、translations 释义、phrases 短语、sentences 例句）
//     —— 按单词匹配，为单词底表补充音标 / 例句 / 短语；匹配不到的词保留中文释义（仍可 TTS 发音）
//   · 雅思无官方 txt，直接用 json-sentence 真实雅思词表（含音标例句）
//
// 用法：node scripts/build-word-data.js   （自动缓存原始文件到 .cache/，再次运行秒级完成）
const fs = require('fs');
const path = require('path');
const https = require('https');

const CACHE = path.join(__dirname, '..', '.cache');
fs.mkdirSync(CACHE, { recursive: true });

// 多镜像源：raw.githubusercontent 在国内常被重置(ECONNRESET)，依次尝试下列镜像，任一成功即可
const MIRRORS = [
  'https://raw.githubusercontent.com/gaollard/english-vocabulary/master/json_original/json-sentence',
  'https://cdn.jsdelivr.net/gh/gaollard/english-vocabulary@master/json_original/json-sentence',
  'https://ghproxy.com/https://raw.githubusercontent.com/gaollard/english-vocabulary/master/json_original/json-sentence',
  'https://raw.gitmirror.com/gaollard/english-vocabulary/master/json_original/json-sentence',
];

// cet6/kaoyan/toefl = 完整 txt 底表 + json-sentence 富数据补充；其余 = json-sentence 直出
// 新增词库只需在下方追加一项（mode: 'json' 即可，无需 txt 底表），重新运行 npm run db:build 即可联网拉取。
const LIBS = [
  { code: 'cet6',   name: '英语六级',   description: '大学英语六级核心词汇（真实词表）',
    mode: 'hybrid', txt: '.cache/cet6.txt',   json: ['CET6_1.json', 'CET6_2.json', 'CET6_3.json', 'CET6luan_1.json'] },
  { code: 'kaoyan', name: '考研英语',   description: '研究生入学考试高频词汇（真实词表）',
    mode: 'hybrid', txt: '.cache/kaoyan.txt', json: ['KaoYan_1.json', 'KaoYan_2.json', 'KaoYan_3.json', 'KaoYanluan_1.json'] },
  { code: 'toefl',  name: '托福 TOEFL', description: '托福考试学术场景核心词汇（真实词表）',
    mode: 'hybrid', txt: '.cache/toefl.txt',   json: ['TOEFL_2.json', 'TOEFL_3.json'] },
  { code: 'ielts',  name: '雅思 IELTS', description: '雅思学术类高频词汇（真实词表）',
    mode: 'json',   json: ['IELTS_2.json', 'IELTS_3.json', 'IELTSluan_2.json'] },
  { code: 'bec',    name: 'BEC 商务英语', description: '剑桥商务英语证书核心词汇（真实词表）',
    mode: 'json',   json: ['BEC_2.json', 'BEC_3.json'] },
];

const MAX_PER_LIB = 20000; // 安全阀，正常不会触发

// 单 URL 下载 + 失败重试（应对 ECONNRESET / 超时等瞬时网络错误）
function fetchWithRetry(url, dest, attempt = 1) {
  return new Promise((resolve, reject) => {
    if (fs.existsSync(dest) && fs.statSync(dest).size > 0) return resolve(dest);
    const f = fs.createWriteStream(dest);
    const req = https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        f.close();
        return fetchWithRetry(new URL(res.headers.location, url).href, dest, attempt)
          .then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        f.close();
        return reject(new Error('HTTP ' + res.statusCode));
      }
      res.pipe(f);
      f.on('finish', () => f.close(() => resolve(dest)));
      f.on('error', (e) => {
        f.close();
        reject(e);
      });
    });
    req.on('error', (e) => {
      try {
        f.close();
      } catch (_) {}
      reject(e);
    });
    req.setTimeout(120000, function () {
      this.destroy(new Error('timeout'));
    });
  }).catch((e) => {
    if (attempt < 4) {
      return new Promise((r) => setTimeout(r, 800 * attempt)).then(() =>
        fetchWithRetry(url, dest, attempt + 1)
      );
    }
    throw e;
  });
}

// 依次尝试所有镜像源，任一成功即返回；全部失败则抛出（由调用方按文件跳过，不中断整体构建）
async function download(relName, dest) {
  let lastErr;
  for (const base of MIRRORS) {
    try {
      await fetchWithRetry(`${base}/${relName}`, dest);
      // 校验 json 完整性：下载到半截（ECONNRESET）会解析失败，删掉残缺文件并视为失败，触发下一镜像/重试
      if (relName.endsWith('.json')) {
        try {
          JSON.parse(fs.readFileSync(dest, 'utf8'));
        } catch (e) {
          fs.unlinkSync(dest);
          throw new Error('JSON 损坏已丢弃: ' + e.message);
        }
      }
      return dest;
    } catch (e) {
      lastErr = e;
      const host = base.split('/')[2];
      console.log(`    ⚠ 镜像 ${host} 失败：${e.message}`);
    }
  }
  throw lastErr || new Error('所有镜像均下载失败: ' + relName);
}

function buildDefinition(translations) {
  if (!Array.isArray(translations) || !translations.length) return '';
  return translations
    .map((t) => {
      const type = (t.type || '').trim();
      const tr = (t.translation || '').trim();
      return type ? `${type}. ${tr}` : tr;
    })
    .filter(Boolean)
    .join('；');
}

function buildPhonetic(o) {
  const uk = (o.uk || '').trim();
  const us = (o.us || '').trim();
  const fmt = (s) => (s.startsWith('/') ? s : '/' + s + '/');
  const u = fmt(uk);
  const a = fmt(us);
  if (uk && us && uk !== us) return `英 ${u}　美 ${a}`;
  if (uk) return `英 ${u}`;
  if (us) return `美 ${a}`;
  return '';
}

// 从例句中截取短语（目标词前后各 1 个词，词边界匹配）
function derivePhrase(en, word) {
  if (!en || !word) return '';
  const lowEn = en.toLowerCase();
  const lowW = word.toLowerCase();
  let idx = -1;
  while ((idx = lowEn.indexOf(lowW, idx + 1)) !== -1) {
    const before = idx === 0 ? ' ' : lowEn[idx - 1];
    const after = idx + lowW.length >= lowEn.length ? ' ' : lowEn[idx + lowW.length];
    if (!/[a-z]/.test(before) && !/[a-z]/.test(after)) break;
  }
  if (idx === -1) return '';
  const end = idx + word.length;
  const prev = en.slice(0, idx).trim().split(/\s+/).pop() || '';
  const nxt = en.slice(end).trim().split(/\s+/)[0] || '';
  return [prev, word, nxt].filter(Boolean).join(' ').replace(/[.,;:!?]+$/, '');
}

function toWord(o) {
  const word = (o.word || '').trim();
  if (!word) return null;
  const phonetic = buildPhonetic(o);
  const definition = buildDefinition(o.translations);
  let example = '';
  if (Array.isArray(o.sentences) && o.sentences.length) {
    const s = o.sentences[0];
    example = [s.sentence, s.translation].filter(Boolean).join('\n');
  }
  let phrase = '';
  if (Array.isArray(o.phrases) && o.phrases.length) {
    const p = o.phrases[0];
    phrase = typeof p === 'string' ? p : p.phrase || p.en || '';
  }
  if (!phrase) phrase = derivePhrase(example.split('\n')[0], word);
  return {
    word,
    phonetic,
    definition,
    example,
    phrase: phrase || '',
    audio_url: `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(word)}&type=2`,
  };
}

async function main() {
  const libs = [];
  let grandTotal = 0;
  for (const lib of LIBS) {
    // 1) 富数据 Map（来自 json-sentence）
    const rich = new Map();
    for (const f of lib.json) {
      const dest = path.join(CACHE, f);
      process.stdout.write(`· ${lib.code}: 读取 ${f} ... `);
      try {
        await download(f, dest);
      } catch (e) {
        console.error(`\n  ⚠ 跳过 ${f}（${e.message}）`);
        continue;
      }
      let arr;
      try {
        arr = JSON.parse(fs.readFileSync(dest, 'utf8'));
      } catch (e) {
        console.error(`解析失败: ${e.message}`);
        continue;
      }
      if (!Array.isArray(arr)) {
        console.error('非数组，跳过');
        continue;
      }
      let added = 0;
      for (const o of arr) {
        const rec = toWord(o);
        if (!rec) continue;
        const k = rec.word.toLowerCase();
        if (!rich.has(k)) {
          rich.set(k, rec);
          added++;
        }
      }
      console.log(`+${added}`);
    }

    // 2) 组装单词
    let words = [];
    if (lib.mode === 'hybrid') {
      const txtPath = path.join(__dirname, '..', lib.txt);
      // 取「txt 底表 ∪ json 富数据」的并集，确保不遗漏任何来源的词（尽量补齐）
      const merged = new Map(); // key(lower) -> word 记录
      for (const [k, rec] of rich) merged.set(k, { ...rec });
      if (fs.existsSync(txtPath)) {
        const lines = fs.readFileSync(txtPath, 'utf8').split('\n');
        for (const line of lines) {
          const t = line.trim();
          if (!t) continue;
          const tab = t.indexOf('\t');
          const word = (tab >= 0 ? t.slice(0, tab) : t).trim();
          const def = tab >= 0 ? t.slice(tab + 1).trim() : '';
          if (!word) continue;
          const k = word.toLowerCase();
          const existing = merged.get(k);
          if (existing) {
            if (!existing.definition && def) existing.definition = def; // 用 txt 释义补全缺失项
          } else {
            merged.set(k, {
              word,
              phonetic: null,
              definition: def || '',
              example: null,
              phrase: null,
              audio_url: `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(word)}&type=2`,
            });
          }
        }
      } else {
        console.log(`  ⚠ 缺少底表 ${lib.txt}，仅用 json 富数据构建 ${lib.name}`);
      }
      words = [...merged.values()];
    } else {
      words = [...rich.values()];
    }
    if (words.length > MAX_PER_LIB) words = words.slice(0, MAX_PER_LIB);
    libs.push({ code: lib.code, name: lib.name, description: lib.description, words });
    grandTotal += words.length;
    const enriched = words.filter((w) => w.phonetic || w.example).length;
    console.log(`  ✓ ${lib.name}: ${words.length} 词（其中 ${enriched} 含音标/例句）`);
  }

  // 丢弃下载失败导致为空（0 词）的词库，避免写入空库
  const dropped = libs.filter((l) => l.words.length === 0);
  if (dropped.length) {
    console.log(`\n⚠ 以下词库因数据获取失败被跳过（未写入）：${dropped.map((l) => l.name).join(', ')}`);
    console.log('   可手动将对应 json 放入 .cache/ 后重跑 npm run db:build。');
  }
  const finalLibs = libs.filter((l) => l.words.length > 0);
  const finalTotal = finalLibs.reduce((s, l) => s + l.words.length, 0);

  const out = path.join(__dirname, '..', 'db', 'seed-data.js');
  fs.writeFileSync(
    out,
    '// 自动生成：真实考试词库（来源 gaollard/english-vocabulary · txt + json-sentence）\n' +
      'module.exports = ' +
      JSON.stringify(finalLibs) +
      ';\n',
    'utf8'
  );
  console.log(`\n✅ 已生成 ${out}（总计 ${finalTotal} 词，共 ${finalLibs.length} 个词库）`);
  console.log('   ' + finalLibs.map((l) => `${l.name}=${l.words.length}`).join(', '));
}

main().catch((e) => {
  console.error('❌ 构建失败:', e.message);
  process.exit(1);
});
