const { test } = require('node:test');
const assert = require('node:assert/strict');

// Forzar la base de datos original de pruebas (evitar valores heredados del entorno).
process.env.DB_NAME = 'emergency_id_test';
process.env.DATABASE_URL = 'mysql://root:Santimajo101219%40@localhost:3307/emergency_id_test';

const { start, server } = require('../test-harness');
const { request, login, dbq, dbone, resetDb } = require('../test-utils');
const { activateQr } = require('../src/domains/identifiers/identifier.service');

let adminCookie;
let counter = 0;
const nextEmail = () => `qrs_${++counter}_${Date.now()}@example.com`;

test.before(async () => {
  await start();
  await resetDb();
  const admin = await login('admin@example.com', 'Admin1012@');
  adminCookie = admin.cookie;
});

test.after(async () => {
  try { await new Promise((res) => server.close(res)); } catch {}
  try { const db = require('./src/config/db'); await db.close(); } catch {}
});

const AC = { Cookie: adminCookie };

const getStickerProduct = async () => {
  const p = await dbone("SELECT id FROM products WHERE slug = 'sticker-qr-personalizado' LIMIT 1");
  assert.ok(p, 'producto sticker existe');
  return p.id;
};

const getDesign = async (productId, offset = 0) => {
  const rows = await dbq('SELECT id FROM product_designs WHERE product_id = ? ORDER BY sort_order LIMIT 1 OFFSET ?', [productId, offset]);
  assert.ok(rows[0], 'diseño disponible');
  return rows[0].id;
};

// Crea un usuario y le genera un QR activo vía servicio (simula pago aprobado).
const createUserWithQr = async () => {
  const email = nextEmail();
  await request('POST', '/api/auth/register', { body: { name: 'Usuario QRS', email, password: 'Pass1234!' } });
  const { user } = await login(email, 'Pass1234!');
  await activateQr(user.id, null, '127.0.0.1');
  const ident = await dbone('SELECT id, value, user_id, status FROM identifiers WHERE user_id = ?', [user.id]);
  assert.ok(ident, 'usuario tiene QR tras activación');
  assert.strictEqual(ident.status, 'active');
  return { email, userId: user.id, qrId: ident.id, value: ident.value };
};

// Crea un usuario SIN QR y un QR suelto (sin usuario) para probar link.
const createFreeQrAndUser = async () => {
  const email = nextEmail();
  await request('POST', '/api/auth/register', { body: { name: 'Usuario Libre', email, password: 'Pass1234!' } });
  const { user } = await login(email, 'Pass1234!');
  // QR sin usuario vinculado: insertar directamente.
  const value = `emg_${Buffer.alloc(12, 0).toString('hex')}${Date.now().toString(16)}`;
  await dbq('INSERT INTO identifiers (user_id, profile_id, value, status, print_status) VALUES (NULL, NULL, ?, ?, ?)', [value, 'pending_activation', 'pending_print']);
  const ident = await dbone('SELECT id, value FROM identifiers WHERE value = ?', [value]);
  return { userId: user.id, qrId: ident.id, value: ident.value };
};

test('listado de QR con paginación y estadísticas', { concurrent: false }, async () => {
  await createUserWithQr();

  const list = await request('GET', '/api/admin/qrs', { headers: AC });
  assert.strictEqual(list.status, 200);
  assert.ok(Array.isArray(list.body.qrs));
  assert.ok(list.body.pagination);
  assert.ok(list.body.pagination.total >= 1);

  const stats = await request('GET', '/api/admin/qrs/stats', { headers: AC });
  assert.strictEqual(stats.status, 200);
  assert.ok(stats.body.total >= 1);
  assert.ok(stats.body.by_status);
  assert.ok(stats.body.linked >= 1);
});

test('filtros de listado: por usuario, estado y sin vincular', { concurrent: false }, async () => {
  await createUserWithQr();

  const linked = await request('GET', '/api/admin/qrs?linked=true', { headers: AC });
  assert.strictEqual(linked.status, 200);
  assert.ok(linked.body.qrs.every((q) => q.user_id));

  const byStatus = await request('GET', '/api/admin/qrs?status=active', { headers: AC });
  assert.strictEqual(byStatus.status, 200);
  assert.ok(byStatus.body.qrs.every((q) => q.status === 'active'));

  const search = await request('GET', '/api/admin/qrs?q=qrs_', { headers: AC });
  assert.strictEqual(search.status, 200);
});

test('detalle y imagen de un QR', { concurrent: false }, async () => {
  const { qrId, value } = await createUserWithQr();

  const det = await request('GET', `/api/admin/qrs/${qrId}`, { headers: AC });
  assert.strictEqual(det.status, 200);
  assert.strictEqual(det.body.identifier.value, value);
  assert.ok(det.body.identifier.qr_url);
  assert.ok(det.body.user);

  const img = await request('GET', `/api/admin/qrs/${qrId}/qr`, { headers: AC });
  assert.strictEqual(img.status, 200);
  assert.ok(img.headers['content-type'].includes('image/png'));
});

test('vincular QR a usuario sin QR (exitoso)', { concurrent: false }, async () => {
  const { userId, qrId } = await createFreeQrAndUser();

  const res = await request('POST', '/api/admin/qrs/link', {
    headers: AC,
    body: { qr_id: qrId, user_id: userId },
  });
  assert.strictEqual(res.status, 200, JSON.stringify(res.body));
  assert.strictEqual(res.body.user_id, userId);

  const ident = await dbone('SELECT user_id, status FROM identifiers WHERE id = ?', [qrId]);
  assert.strictEqual(ident.user_id, userId);
});

test('no se puede vincular un QR a un usuario que ya tiene uno vigente', { concurrent: false }, async () => {
  const { userId } = await createUserWithQr(); // ya tiene QR activo
  const { qrId } = await createFreeQrAndUser();

  const res = await request('POST', '/api/admin/qrs/link', {
    headers: AC,
    body: { qr_id: qrId, user_id: userId },
  });
  assert.strictEqual(res.status, 409);
  assert.strictEqual(res.body.code, 'user_already_has_qr');
});

test('no se puede vincular un QR ya impreso/entregado', { concurrent: false }, async () => {
  const email = nextEmail();
  await request('POST', '/api/auth/register', { body: { name: 'D', email, password: 'Pass1234!' } });
  const { user } = await login(email, 'Pass1234!');
  await dbq('INSERT INTO identifiers (user_id, profile_id, value, status, print_status) VALUES (NULL, NULL, ?, ?, ?)', [`emg_${Date.now().toString(16)}`, 'active', 'delivered']);
  const printedQr = await dbone('SELECT id FROM identifiers WHERE print_status = ? AND user_id IS NULL ORDER BY id DESC LIMIT 1', ['delivered']);

  const res = await request('POST', '/api/admin/qrs/link', {
    headers: AC,
    body: { qr_id: printedQr.id, user_id: user.id },
  });
  assert.strictEqual(res.status, 409);
  assert.strictEqual(res.body.code, 'qr_not_eligible');
});

test('desvincular QR de usuario (exitoso)', { concurrent: false }, async () => {
  const { userId, qrId } = await createUserWithQr();

  const res = await request('POST', '/api/admin/qrs/unlink', {
    headers: AC,
    body: { qr_id: qrId },
  });
  assert.strictEqual(res.status, 200, JSON.stringify(res.body));
  assert.strictEqual(res.body.user_id, null);

  const ident = await dbone('SELECT user_id, status FROM identifiers WHERE id = ?', [qrId]);
  assert.strictEqual(ident.user_id, null);
  assert.strictEqual(ident.status, 'deactivated');
});

test('no se puede desvincular un QR entregado', { concurrent: false }, async () => {
  const email = nextEmail();
  await request('POST', '/api/auth/register', { body: { name: 'D', email, password: 'Pass1234!' } });
  const { user } = await login(email, 'Pass1234!');
  await activateQr(user.id, null, '127.0.0.1');
  const ident = await dbone('SELECT id FROM identifiers WHERE user_id = ?', [user.id]);
  await dbq('UPDATE identifiers SET print_status = ? WHERE id = ?', ['delivered', ident.id]);

  const res = await request('POST', '/api/admin/qrs/unlink', {
    headers: AC,
    body: { qr_id: ident.id },
  });
  assert.strictEqual(res.status, 409);
  assert.strictEqual(res.body.code, 'qr_delivered_cannot_unlink');
});

test('cambiar estado de producción (independiente de activación)', { concurrent: false }, async () => {
  const { userId, qrId } = await createUserWithQr();

  const res = await request('POST', `/api/admin/qrs/${qrId}/print-status`, {
    headers: AC,
    body: { print_status: 'printed' },
  });
  assert.strictEqual(res.status, 200, JSON.stringify(res.body));
  assert.strictEqual(res.body.print_status, 'printed');

  // La activación del QR no se altera.
  const ident = await dbone('SELECT status, print_status FROM identifiers WHERE id = ?', [qrId]);
  assert.strictEqual(ident.status, 'active');
  assert.strictEqual(ident.print_status, 'printed');
});

test('exportación CSV de producción por IDs de QR', { concurrent: false }, async () => {
  const { qrId } = await createUserWithQr();

  const res = await request('GET', `/api/admin/qrs/export/csv?ids=${qrId}`, { headers: AC });
  assert.strictEqual(res.status, 200);
  assert.ok(res.headers['content-type'].includes('text/csv'));
  const lines = res.raw.split('\n').filter(Boolean);
  assert.ok(lines.length > 1, 'CSV tiene encabezado y datos');
  assert.ok(lines[0].includes('identificador_qr'));
  assert.ok(lines[0].includes('url_publica'));
  assert.ok(lines[0].includes('diseno_seleccionado'));
  // sin datos médicos
  assert.ok(!lines[0].toLowerCase().includes('alergia'));
  assert.ok(!lines[0].toLowerCase().includes('medicamento'));
});

test('rutas administrativas protegidas (sin token → 401)', { concurrent: false }, async () => {
  const noAuth = await request('GET', '/api/admin/qrs');
  assert.strictEqual(noAuth.status, 401);
});
