const mysql = require('mysql2/promise');
const env = require('./env');

// 连接池（懒连接：仅在执行查询时才真正建立连接，因此即使数据库暂未就绪，服务也能先启动）
const pool = mysql.createPool({
  host: env.db.host,
  port: env.db.port,
  user: env.db.user,
  password: env.db.password,
  database: env.db.database,
  waitForConnections: true,
  connectionLimit: env.db.connectionLimit,
  charset: env.db.charset,
  // MySQL 5.7 不支持 foundRows 之类高级特性，这里保持默认即可
});

/** 执行查询，返回 [rows, fields] */
async function query(sql, params = []) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}

/** 执行多条语句（用于初始化 schema），返回原生连接 */
async function rawQuery(sql, params = []) {
  const [rows] = await pool.query(sql, params);
  return rows;
}

/** 测试数据库连接是否可用 */
async function testConnection() {
  const conn = await pool.getConnection();
  try {
    await conn.query('SELECT 1');
    return true;
  } finally {
    conn.release();
  }
}

module.exports = { pool, query, rawQuery, testConnection };
