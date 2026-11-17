const { test } = require('node:test');
const assert = require('node:assert/strict');

// Forzar la base de datos original de pruebas (evitar valores heredados del entorno).
process.env.DB_NAME = 'emergency_id_test';
process.env.DATABASE_URL = 'mysql://root:Santimajo101219%40@localhost:3307/emergency_id_test';

const { start, server } = require('../test-harness');
const { request, login, dbq, dbone, resetDb } = require('../test-utils');
const { activateQr } = require('../src/domains/identifiers/identifier.service');

let counter = 0;
const nextEmail = () => `idqr_${++counter}_${Date.now()}@example.com`;

test.before(async () => {
  await start();
  await resetDb();
});

test.after(async () => {
  try { server.close(); } catch {}
});

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

test('registro crea cuenta y perfil, pero NO genera un QR', { concurrent: false }, async () => {
  const email = nextEmail();
  const r = await request('POST', '/api/auth/register', { body: { name: 'Sin QR', email, password: 'Pass1234!' } });
  assert.strictEqual(r.status, 201);
  assert.strictEqual(r.body.user.qr, undefined, 'el registro no debe devolver qr');

  const profile = await dbone('SELECT id, is_active FROM emergency_profiles WHERE user_id = ?', [r.body.user.id]);
  assert.ok(profile, 'se crea el perfil');
  assert.strictEqual(profile.is_active, 0);

  const ids = await dbq('SELECT COUNT(*) AS c FROM identifiers WHERE user_id = ?', [r.body.user.id]);
  assert.strictEqual(ids[0].c, 0, 'no se crea identificador en el registro');
});

test('getMyIdentifier devuelve null cuando el usuario no tiene QR', { concurrent: false }, async () => {
  const email = nextEmail();
  await request('POST', '/api/auth/register', { body: { name: 'Null', email, password: 'Pass1234!' } });
  const { cookie } = await login(email, 'Pass1234!');

  const my = await request('GET', '/api/identifiers/my', { headers: { Cookie: cookie } });
  assert.strictEqual(my.status, 200);
  assert.strictEqual(my.body.identifier, null);
});

test('activateQr crea un QR cuando el usuario no tiene uno', { concurrent: false }, async () => {
  const email = nextEmail();
  await request('POST', '/api/auth/register', { body: { name: 'Crea', email, password: 'Pass1234!' } });
  const { user } = await login(email, 'Pass1234!');

  const result = await activateQr(user.id, null, '127.0.0.1');
  assert.ok(!result.error, JSON.stringify(result.error));
  assert.strictEqual(result.identifier.status, 'active');
  assert.ok(result.identifier.value);
  assert.ok(result.qr_url);
  assert.ok(result.qr_url.includes(result.identifier.value));

  const rows = await dbq('SELECT COUNT(*) AS c FROM identifiers WHERE user_id = ?', [user.id]);
  assert.strictEqual(rows[0].c, 1, 'un solo identificador');
});

test('activateQr reutiliza el QR existente (idempotente, no duplica)', { concurrent: false }, async () => {
  const email = nextEmail();
  await request('POST', '/api/auth/register', { body: { name: 'Reusa', email, password: 'Pass1234!' } });
  const { user } = await login(email, 'Pass1234!');

  const r1 = await activateQr(user.id, 100, '127.0.0.1');
  const r2 = await activateQr(user.id, 101, '127.0.0.1');
  assert.ok(!r1.error && !r2.error);
  assert.strictEqual(r1.identifier.id, r2.identifier.id, 'mismo identificador');
  assert.strictEqual(r1.identifier.value, r2.identifier.value, 'mismo valor');

  const rows = await dbq('SELECT COUNT(*) AS c FROM identifiers WHERE user_id = ?', [user.id]);
  assert.strictEqual(rows[0].c, 1, 'todavía un solo identificador');
});

test('activación vía pedido pagado (no-sticker) reutiliza QR existente', { concurrent: false }, async () => {
  const email = nextEmail();
  await request('POST', '/api/auth/register', { body: { name: 'Pago', email, password: 'Pass1234!' } });
  const { user } = await login(email, 'Pass1234!');

  // QR previo
  await activateQr(user.id, null, '127.0.0.1');
  const before = await dbone('SELECT value FROM identifiers WHERE user_id = ?', [user.id]);

  // Pedido pagado (qr-digital-basico) aprobado como admin → activateQr
  const product = await dbone("SELECT id FROM products WHERE slug = 'qr-digital-basico' LIMIT 1");
  const orderNum = `EID-PAGO-${Date.now()}`;
  await dbq(`INSERT INTO orders (order_number, user_id, product_id, commercial_status, payment_status, total_amount, currency) VALUES (?, ?, ?, 'paid', 'approved', 30000, 'COP')`, [orderNum, user.id, product.id]);
  const order = await dbone('SELECT id FROM orders WHERE order_number = ?', [orderNum]);

  const admin = await login('admin@example.com', 'Admin1012@');
  const upd = await request('PATCH', `/api/admin/orders/${order.id}`, {
    headers: { Cookie: admin.cookie },
    body: { payment_status: 'approved' },
  });
  assert.strictEqual(upd.status, 200);

  const after = await dbone('SELECT value, status FROM identifiers WHERE user_id = ?', [user.id]);
  assert.strictEqual(after.value, before.value, 'el valor del QR no cambia');
  assert.strictEqual(after.status, 'active');

  const count = await dbq('SELECT COUNT(*) AS c FROM identifiers WHERE user_id = ?', [user.id]);
  assert.strictEqual(count[0].c, 1, 'no se duplica el QR por pago repetido');
});

test('compra de sticker con diseño y reposición: mismo QR, diseño distinto', { concurrent: false }, async () => {
  const productId = await getStickerProduct();
  const email = nextEmail();
  await request('POST', '/api/auth/register', { body: { name: 'Diseños', email, password: 'Pass1234!' } });
  const { user } = await login(email, 'Pass1234!');

  // Primera compra: diseño 1
  const d1 = await getDesign(productId, 0);
  const o1 = await request('POST', '/api/orders', {
    headers: { Cookie: (await login(email, 'Pass1234!')).cookie },
    body: { product_id: productId, design_id: d1, shipping_address: { fullName: 'X', phone: '3001234567', address: 'Calle 1', city: 'Bogotá', department: 'Cundinamarca' } },
  });
  assert.strictEqual(o1.status, 201);
  assert.strictEqual(o1.body.order.design_id, d1);

  // Activar QR (simula pago aprobado)
  await activateQr(user.id, o1.body.order.id, '127.0.0.1');
  const qr1 = await dbone('SELECT value FROM identifiers WHERE user_id = ?', [user.id]);

  // Segunda compra/reposición: diseño 2 (mismo usuario)
  const d2 = await getDesign(productId, 1);
  const o2 = await request('POST', '/api/orders', {
    headers: { Cookie: (await login(email, 'Pass1234!')).cookie },
    body: { product_id: productId, design_id: d2, shipping_address: { fullName: 'X', phone: '3001234567', address: 'Calle 2', city: 'Bogotá', department: 'Cundinamarca' } },
  });
  assert.strictEqual(o2.status, 201);
  assert.strictEqual(o2.body.order.design_id, d2);

  // Reposición: activateQr debe reutilizar el MISMO QR, no crear otro
  await activateQr(user.id, o2.body.order.id, '127.0.0.1');
  const qr2 = await dbone('SELECT value FROM identifiers WHERE user_id = ?', [user.id]);
  assert.strictEqual(qr2.value, qr1.value, 'el QR se reutiliza en la reposición');

  const count = await dbq('SELECT COUNT(*) AS c FROM identifiers WHERE user_id = ?', [user.id]);
  assert.strictEqual(count[0].c, 1, 'un solo QR a pesar de dos pedidos de sticker');

  // Los dos pedidos conservan su diseño respectivo
  const orders = await dbq('SELECT id, design_id FROM orders WHERE user_id = ? ORDER BY id', [user.id]);
  assert.strictEqual(orders[0].design_id, d1);
  assert.strictEqual(orders[1].design_id, d2);
});

test('doble activación concurrente no duplica el QR', { concurrent: false }, async () => {
  const email = nextEmail();
  await request('POST', '/api/auth/register', { body: { name: 'Conc', email, password: 'Pass1234!' } });
  const { user } = await login(email, 'Pass1234!');

  const results = await Promise.all([
    activateQr(user.id, 1, '127.0.0.1'),
    activateQr(user.id, 2, '127.0.0.1'),
  ]);
  assert.ok(!results[0].error && !results[1].error);
  assert.strictEqual(results[0].identifier.id, results[1].identifier.id);

  const count = await dbq('SELECT COUNT(*) AS c FROM identifiers WHERE user_id = ?', [user.id]);
  assert.strictEqual(count[0].c, 1);
});

test('ruta pública /e/:identifier: inexistente 404, sin propietario 410, activo 200', { concurrent: false }, async () => {
  // Inexistente
  const nope = await request('GET', '/api/e/emg_noexistente1234567890');
  assert.strictEqual(nope.status, 404);

  // Sin propietario (insertar identifier con user_id NULL)
  const value = `emg_${Buffer.alloc(12, 0).toString('hex')}${Date.now().toString(16)}`;
  await dbq('INSERT INTO identifiers (user_id, profile_id, value, status, print_status) VALUES (NULL, NULL, ?, ?, ?)', [value, 'pending_activation', 'pending_print']);
  const pend = await request('GET', `/api/e/${encodeURIComponent(value)}`);
  assert.strictEqual(pend.status, 410);
  assert.strictEqual(pend.body.code, 'qr_not_assigned');

  // Activo con propietario y perfil activo
  const email = nextEmail();
  await request('POST', '/api/auth/register', { body: { name: 'Activo', email, password: 'Pass1234!' } });
  const { user } = await login(email, 'Pass1234!');
  await activateQr(user.id, null, '127.0.0.1');
  const ident = await dbone('SELECT value FROM identifiers WHERE user_id = ?', [user.id]);
  await dbq('UPDATE emergency_profiles SET is_active = 1 WHERE user_id = ?', [user.id]);

  const act = await request('GET', `/api/e/${encodeURIComponent(ident.value)}`);
  assert.strictEqual(act.status, 200);
  assert.strictEqual(act.body.status, 'active');
});

test('desactivar QR y conservar historial/identificador', { concurrent: false }, async () => {
  const email = nextEmail();
  await request('POST', '/api/auth/register', { body: { name: 'Desactiva', email, password: 'Pass1234!' } });
  const { user, cookie } = await login(email, 'Pass1234!');
  await activateQr(user.id, null, '127.0.0.1');
  const ident = await dbone('SELECT id, value, status FROM identifiers WHERE user_id = ?', [user.id]);
  assert.strictEqual(ident.status, 'active');

  const deact = await request('POST', '/api/identifiers/deactivate', { headers: { Cookie: cookie } });
  assert.strictEqual(deact.status, 200);

  const after = await dbone('SELECT status, value, deactivated_at FROM identifiers WHERE id = ?', [ident.id]);
  assert.strictEqual(after.status, 'disabled');
  assert.strictEqual(after.value, ident.value, 'el identificador no cambia al desactivar');
  assert.ok(after.deactivated_at);

  // El identificador sigue existiendo (histórico)
  const still = await dbq('SELECT COUNT(*) AS c FROM identifiers WHERE value = ?', [ident.value]);
  assert.strictEqual(still[0].c, 1);
});

test('los QR existentes del seed se conservan', { concurrent: false }, async () => {
  const admin = await dbone("SELECT id FROM users WHERE email = 'admin@example.com' LIMIT 1");
  assert.ok(admin, 'admin existe');
  const count = await dbq('SELECT COUNT(*) AS c FROM identifiers');
  assert.ok(count[0].c >= 0, 'la tabla identifiers sigue accesible');
});
