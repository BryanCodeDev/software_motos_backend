const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  generateIdentifier,
  generateToken,
  hashPassword,
  comparePassword,
} = require('../src/utils/crypto.js');

test('generateIdentifier produces unique, non-sequential values', (t) => {
  const a = generateIdentifier();
  const b = generateIdentifier();
  assert.ok(a.startsWith('emg_'));
  assert.ok(b.startsWith('emg_'));
  assert.notStrictEqual(a, b);
  assert.ok(a.length > 20);
});

test('generateToken produces unique values', (t) => {
  const a = generateToken();
  const b = generateToken();
  assert.notStrictEqual(a, b);
  assert.ok(a.length >= 64);
});

test('hashPassword and comparePassword work', (t) => {
  const hash = hashPassword('ClaveSegura123!');
  assert.ok(hash.startsWith('$2a$') || hash.startsWith('$2b$') || hash.startsWith('$2y$'));
  assert.ok(comparePassword('ClaveSegura123!', hash));
  assert.ok(!comparePassword('ClaveIncorrecta!', hash));
});

test('hashPassword produces different hashes for same password (salt)', (t) => {
  const a = hashPassword('MismaClave123!');
  const b = hashPassword('MismaClave123!');
  assert.notStrictEqual(a, b);
});
