// 数据库一键初始化：建库 → 建表 → 灌入种子词库
// 用法：node db/setup.js  (需先配置 .env 中的数据库连接)
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const env = require('../src/config/env');
const seedLibs = require('./seed-data');

const BATCH = 500;

async function seed(conn) {
  for (const lib of seedLibs) {
    const [rows] = await conn.query('SELECT id FROM word_libraries WHERE code = ?', [lib.code]);
    let libId;
    if (rows.length) {
      libId = rows[0].id;
    } else {
      const res = await conn.query(
        'INSERT INTO word_libraries (code, name, description) VALUES (?, ?, ?)',
        [lib.code, lib.name, lib.description]
      );
      libId = res[0].insertId;
      console.log(`  + 词库: ${lib.name}`);
    }
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
}

async function main() {
  console.log('→ 连接数据库服务器...');
  const conn = await mysql.createConnection({
    host: env.db.host,
    port: env.db.port,
    user: env.db.user,
    password: env.db.password,
    multipleStatements: true,
    charset: 'utf8mb4',
  });

  console.log(`→ 创建数据库 ${env.db.database} (若不存在)...`);
  await conn.query(`CREATE DATABASE IF NOT EXISTS \`${env.db.database}\` CHARACTER SET utf8mb4`);
  await conn.query(`USE \`${env.db.database}\``);

  console.log('→ 执行 schema.sql 建表...');
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await conn.query(schema);
  console.log('  ✓ 表结构就绪');

  console.log('→ 灌入种子词库...');
  await seed(conn);

  await conn.end();
  console.log('\n✅ 数据库初始化完成！运行 npm start 启动服务。');
}

main().catch((e) => {
  console.error('\n❌ 初始化失败:', e.message);
  console.error('请确认 MySQL 已启动且 .env 中账号密码正确。');
  process.exit(1);
});
