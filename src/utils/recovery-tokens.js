const { generateToken } = require('../utils/crypto');

const recoveryTokens = new Map();

const createRecoveryToken = (userId, ttlMs = 1000 * 60 * 60) => {
  const token = generateToken();
  recoveryTokens.set(token, {
    userId,
    createdAt: Date.now(),
    ttlMs,
    used: false,
  });
  return token;
};

const consumeRecoveryToken = (token) => {
  const record = recoveryTokens.get(token);
  if (!record || record.used) {return null;}
  if (Date.now() - record.createdAt > record.ttlMs) {
    recoveryTokens.delete(token);
    return null;
  }
  record.used = true;
  return record.userId;
};

const listRecoveryTokens = () => Array.from(recoveryTokens.entries());

module.exports = {
  createRecoveryToken,
  consumeRecoveryToken,
  listRecoveryTokens,
};

