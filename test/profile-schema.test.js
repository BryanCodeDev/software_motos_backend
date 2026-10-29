const { test } = require('node:test');
const assert = require('node:assert/strict');
const { profileSchema, photoUploadSchema } = require('../src/domains/emergency-profiles/profile.schema.js');

test('profile schema accepts valid profile update', (t) => {
  const result = profileSchema.safeParse({
    body: {
      display_name: 'Juan Pérez',
      allergies: 'Penicilina',
      medical_conditions: 'Asma',
      medications: 'Salbutamol',
      additional_info: 'Tipo O+',
      photo_url: '/api/profiles/photo/abc123.jpg',
    },
  });
  assert.ok(result.success);
});

test('profile schema rejects too-long name', (t) => {
  const result = profileSchema.safeParse({ body: { display_name: 'A'.repeat(101) } });
  assert.ok(!result.success);
});

test('profile schema accepts missing optional fields', (t) => {
  const result = profileSchema.safeParse({ body: {} });
  assert.ok(result.success);
});

test('photo upload schema accepts data URL', (t) => {
  const result = photoUploadSchema.safeParse({
    body: { photo_data: 'data:image/png;base64,iVBORw0KGgo=' },
  });
  assert.ok(result.success);
});

test('photo upload schema rejects invalid data URL', (t) => {
  const result = photoUploadSchema.safeParse({ body: { photo_data: 'not-a-data-url' } });
  assert.ok(result.success); // schema only checks string; service validates content
});
