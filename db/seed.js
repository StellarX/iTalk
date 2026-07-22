// 仅灌入/补充种子数据（假设库与表已存在）
// 用法：node db/seed.js
// 注意：采用批量 INSERT（每批 500 行），3 万+ 单词也能秒级完成。
const mysql = require('mysql2/promise');
const env = require('../src/config/env');
const seedLibs = require('./seed-data');

const BATCH = 500;

async function main() {
  const conn = await mysql.createConnection({
    host: env.db.host,
    port: env.db.port,
    user: env.db.user,
    password: env.db.password,
    database: env.db.database,
    charset: 'utf8mb4',
  });
  console.log('→ 灌入种子词库...');
  for (const lib of seedLibs) {
    const [rows] = await conn.query('SELECT id FROM word_libraries WHERE code = ?', [lib.code]);
    if (!rows.length) {
      console.error(`词库 ${lib.code} 不存在，请先运行 npm run db:setup`);
      continue;
    }
    const libId = rows[0].id;
    let inserted = 0;
    for (let i = 0; i < lib.words.length; i += BATCH) {
      const chunk = lib.words.slice(i, i + BATCH);
      const placeholders = chunk.map(() => '(?,?,?,?,?,?,?)').join(',');
      const params = [];
      for (const w of chunk) {
        params.push(libId, w.word, w.phonetic || null, w.definition || '', w.example || null, w.phrase || null, w.audio_url || null);
      }
      const [r] = await conn.query(
        `INSERT INTO words (library_id, word, phonetic, definition, example, phrase, audio_url)
         VALUES ${placeholders}
         ON DUPLICATE KEY UPDATE
           phonetic = VALUES(phonetic),
           definition = VALUES(definition),
           example = VALUES(example),
           phrase = VALUES(phrase),
           audio_url = VALUES(audio_url)`,
        params
      );
      inserted += r.affectedRows;
    }
    console.log(`  · ${lib.name}: 共 ${lib.words.length} 词，写入/更新 ${inserted} 行`);
  }
  await conn.end();
  console.log('✅ 种子数据已补充。');
}

main().catch((e) => {
  console.error('❌ 失败:', e.message);
  process.exit(1);
});
