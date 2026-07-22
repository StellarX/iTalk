require('dotenv').config();

module.exports = {
  port: parseInt(process.env.PORT, 10) || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: parseInt(process.env.DB_PORT, 10) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'english_learning',
    waitForConnections: true,
    connectionLimit: 10,
    charset: 'utf8mb4',
  },
  jwtSecret: process.env.JWT_SECRET || 'change-me-to-a-long-random-secret-string',
  tokenExpiresIn: process.env.TOKEN_EXPIRES_IN || '7d',
};
