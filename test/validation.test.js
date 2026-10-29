const { test } = require('node:test');
const assert = require('node:assert/strict');
const { registerSchema, loginSchema } = require('../src/domains/auth/auth.schema.js');

test('register schema accepts valid input', (t) => {
  const result = registerSchema.safeParse({
    body: { name: 'Juan Pérez', email: 'juan@example.com', password: 'ClaveSegura123!' },
  });
  assert.ok(result.success);
});

test('register schema rejects short password', (t) => {
  const result = registerSchema.safeParse({
    body: { name: 'Juan', email: 'juan@example.com', password: 'corto' },
  });
  assert.ok(!result.success);
  assert.ok(result.error.issues.some((i) => i.path.join('.') === 'body.password'));
});

test('register schema rejects invalid email', (t) => {
  const result = registerSchema.safeParse({
    body: { name: 'Juan', email: 'no-es-un-email', password: 'ClaveSegura123!' },
  });
  assert.ok(!result.success);
});

test('login schema accepts valid input', (t) => {
  const result = loginSchema.safeParse({
    body: { email: 'juan@example.com', password: 'ClaveSegura123!' },
  });
  assert.ok(result.success);
});

test('login schema rejects missing password', (t) => {
  const result = loginSchema.safeParse({
    body: { email: 'juan@example.com', password: '' },
  });
  assert.ok(!result.success);
});
