const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  createAccessToken,
  createRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
} = require('../src/utils/jwt.js');

test('create and verify access token', (t) => {
  const token = createAccessToken({ sub: 1, email: 'a@b.co', role: 'user' });
  const payload = verifyAccessToken(token);
  assert.strictEqual(payload.sub, 1);
  assert.strictEqual(payload.email, 'a@b.co');
  assert.strictEqual(payload.role, 'user');
});

test('create and verify refresh token', (t) => {
  const token = createRefreshToken({ sub: 2, email: 'c@d.co', role: 'admin' });
  const payload = verifyRefreshToken(token);
  assert.strictEqual(payload.sub, 2);
  assert.strictEqual(payload.role, 'admin');
});

test('rejects tampered access token', (t) => {
  const token = createAccessToken({ sub: 1, email: 'a@b.co', role: 'user' });
  const bad = token.slice(0, -5) + 'XXXXX';
  assert.throws(() => verifyAccessToken(bad));
});

test('rejects malformed token', (t) => {
  assert.throws(() => verifyAccessToken('no-es-un-token-valido'));
});
