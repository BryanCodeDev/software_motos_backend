const { sign, verify } = require('jsonwebtoken');
const config = require('../config');

const createAccessToken = (payload) =>
  sign(payload, config.jwt.accessSecret, {
    expiresIn: config.jwt.accessExpiresIn,
    issuer: config.appName,
  });

const createRefreshToken = (payload) =>
  sign(payload, config.jwt.refreshSecret, {
    expiresIn: config.jwt.refreshExpiresIn,
    issuer: config.appName,
  });

const verifyAccessToken = (token) => {
  return verify(token, config.jwt.accessSecret, {
    issuer: config.appName,
  });
};

const verifyRefreshToken = (token) => {
  return verify(token, config.jwt.refreshSecret, {
    issuer: config.appName,
  });
};

module.exports = {
  createAccessToken,
  createRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
};

