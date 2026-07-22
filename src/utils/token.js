const jwt = require('jsonwebtoken');
const env = require('../config/env');

function sign(payload) {
  return jwt.sign(payload, env.jwtSecret, { expiresIn: env.tokenExpiresIn });
}

function verify(token) {
  return jwt.verify(token, env.jwtSecret);
}

module.exports = { sign, verify };
