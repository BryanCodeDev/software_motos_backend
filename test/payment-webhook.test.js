const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const {
  parseSignatureHeader,
  buildWebhookManifest,
  verifyWebhookSignature,
} = require('../src/domains/payments/payment.service.js');

const secret = 'test_webhook_secret_12345';

const makeSignedRequest = (ts, requestId, dataId, bodyDataId) => {
  const manifest = buildWebhookManifest(dataId, requestId, ts);
  const v1 = crypto.createHmac('sha256', secret).update(manifest).digest('hex');
  return {
    headers: {
      'x-signature': `ts=${ts},v1=${v1}`,
      'x-request-id': requestId,
    },
    query: dataId ? { 'data.id': dataId } : {},
    body: { data: bodyDataId ? { id: bodyDataId } : {} },
  };
};

test('parseSignatureHeader splits ts and v1', (t) => {
  const parsed = parseSignatureHeader('ts=1704908010,v1=618c85345248dd820d5fd456117c2ab2ef8eda45a0282ff693eac24131a5e839');
  assert.strictEqual(parsed.ts, '1704908010');
  assert.strictEqual(parsed.v1, '618c85345248dd820d5fd456117c2ab2ef8eda45a0282ff693eac24131a5e839');
});

test('buildWebhookManifest follows Mercado Pago template', (t) => {
  assert.strictEqual(buildWebhookManifest('999', 'req1', '12345'), 'id:999;request-id:req1;ts:12345;');
  assert.strictEqual(buildWebhookManifest(null, null, '12345'), 'ts:12345;');
  assert.strictEqual(buildWebhookManifest(null, null, null), '');
});

test('verifyWebhookSignature accepts a valid signature', (t) => {
  const ts = String(Date.now());
  const req = makeSignedRequest(ts, 'req-1', '999', '999');
  assert.ok(verifyWebhookSignature(req, secret));
});

test('verifyWebhookSignature rejects a tampered signature', (t) => {
  const ts = String(Date.now());
  const req = makeSignedRequest(ts, 'req-1', '999', '999');
  req.headers['x-signature'] = `ts=${ts},v1=tampered_signature`;
  assert.ok(!verifyWebhookSignature(req, secret));
});

test('verifyWebhookSignature rejects missing header', (t) => {
  const req = { headers: {}, query: {}, body: {} };
  assert.ok(!verifyWebhookSignature(req, secret));
});

test('verifyWebhookSignature rejects wrong secret', (t) => {
  const ts = String(Date.now());
  const req = makeSignedRequest(ts, 'req-1', '999', '999');
  assert.ok(!verifyWebhookSignature(req, 'otro_secreto'));
});
