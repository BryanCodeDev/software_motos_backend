const { test } = require('node:test');
const assert = require('node:assert/strict');

// Forzar la base de datos original de pruebas.
process.env.DB_NAME = 'emergency_id_test';
process.env.DATABASE_URL = 'mysql://root:Santimajo101219%40@localhost:3307/emergency_id_test';

const { start, server } = require('../test-harness');
const { request, resetDb, dbq, dbone } = require('../test-utils');

let adminToken;
let counter = 0;
const nextEmail = () => `ord_${++counter}_${Date.now()}@example.com`;

const loginToken = async (email, password) => {
  const r = await request('POST', '/api/auth/login', { body: { email, password } });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  return r.body.accessToken;
};

test.before(async () => {
  await start();
  await resetDb();
  adminToken = await loginToken('admin@example.com', 'Admin1012@');
});

test.after(async () => {
  try { await new Promise((res) => server.close(res)); } catch {}
  try { const db = require('./src/config/db'); await db.close(); } catch {}
});

const AC = { headers: { Authorization: `Bearer ${adminToken}` } };

const getStickerProduct = async () => {
  const p = await dbone("SELECT id FROM products WHERE slug = 'sticker-qr-personalizado' LIMIT 1");
  assert.ok(p, 'producto sticker existe');
  return p.id;
};

const getDesign = async (productId) => {
  const rows = await dbq('SELECT id FROM product_designs WHERE product_id = ? AND is_available = 1 ORDER BY sort_order LIMIT 1', [productId]);
  assert.ok(rows[0], 'diseño disponible');
  return rows[0].id;
};

// Crea un usuario y una orden pagada con QR vinculado.
const createPaidOrderWithQr = async () => {
  const email = nextEmail();
  await request('POST', '/api/auth/register', { body: { name: 'Comprador', email, password: 'Pass1234!' } });
  const { user } = await loginTokenAndUser(email, 'Pass1234!');
  const productId = await getStickerProduct();
  const designId = await getDesign(productId);

  const ts = Date.now();
  await dbq(
    `INSERT INTO orders (order_number, user_id, product_id, design_id, design_name, design_image_url,
       sticker_quantity, commercial_status, payment_status, total_amount, currency, shipping_address)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'paid', 'approved', 30000, 'COP', ?)`,
    ['EID-ORD-' + ts, user.id, productId, designId, 'Diseño 1', '/img/s1.png', 2,
     JSON.stringify({ fullName: 'Juan Pérez', phone: '3001234567', address: 'Calle 10 # 20-30', city: 'Bogotá', department: 'Cundinamarca', notes: 'Entrega en recepción' })]
  );
  const order = await dbone('SELECT id FROM orders WHERE order_number = ?', ['EID-ORD-' + ts]);
  await dbq(
    'INSERT INTO identifiers (user_id, order_id, value, status, print_status, activation_at) VALUES (?, ?, ?, ?, ?, NOW())',
    [user.id, order.id, 'emg_ordqr' + ts, 'active', 'pending_print']
  );
  return { email, userId: user.id, orderId: order.id };
};

const loginTokenAndUser = async (email, password) => {
  const r = await request('POST', '/api/auth/login', { body: { email, password } });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  return { token: r.body.accessToken, user: r.body.user };
};

test('listado de pedidos con paginación y filtros', { concurrent: false }, async () => {
  await createPaidOrderWithQr();
  await createPaidOrderWithQr();

  const r = await request('GET', '/api/admin/orders?page=1&limit=25', AC);
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.ok(Array.isArray(r.body.orders));
  assert.ok(r.body.pagination);
  assert.ok(r.body.pagination.total >= 2);
  assert.ok(r.body.pagination.pages >= 1);
  assert.strictEqual(r.body.pagination.limit, 25);
  assert.strictEqual(r.body.pagination.page, 1);

  const paid = await request('GET', '/api/admin/orders?status=paid', AC);
  assert.strictEqual(paid.status, 200);
  assert.ok(paid.body.orders.every((o) => o.commercial_status === 'paid'));

  const first = await dbone("SELECT order_number FROM orders ORDER BY id DESC LIMIT 1");
  const search = await request('GET', '/api/admin/orders?q=' + encodeURIComponent(first.order_number), AC);
  assert.strictEqual(search.status, 200);
  assert.ok(search.body.orders.length >= 1);
});

test('detalle completo del pedido con historial, envío y pago', { concurrent: false }, async () => {
  const { orderId } = await createPaidOrderWithQr();

  const r = await request('GET', `/api/admin/orders/${orderId}`, AC);
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  const o = r.body.order;
  assert.ok(o.order_number);
  assert.ok(o.customer_email);
  assert.ok(o.product_name);
  assert.ok(o.design_name);
  assert.ok(o.qr_value);
  assert.ok(o.shipping_address);
  assert.ok(o.shipping_address.city || o.shipping_address.address);
  assert.strictEqual(o.commercial_status, 'paid');
  assert.strictEqual(o.payment_status, 'approved');
  assert.ok(Array.isArray(o.status_history));
});

test('cambio de estado válido genera historial', { concurrent: false }, async () => {
  const { orderId } = await createPaidOrderWithQr();

  const r2 = await request('PATCH', `/api/admin/orders/${orderId}/status`, { ...AC, body: { commercial_status: 'preparing', reason: 'Producción' } });
  assert.strictEqual(r2.status, 200, JSON.stringify(r2.body));
  assert.strictEqual(r2.body.next.commercial_status, 'preparing');

  const det = await request('GET', `/api/admin/orders/${orderId}`, AC);
  const hist = det.body.order.status_history;
  assert.ok(hist.length >= 1);
  assert.ok(hist.some((h) => h.new_commercial_status === 'preparing'));
});

test('rechaza transición de estado inválida (salto)', { concurrent: false }, async () => {
  const { orderId } = await createPaidOrderWithQr();

  const r = await request('PATCH', `/api/admin/orders/${orderId}/status`, { ...AC, body: { commercial_status: 'delivered', reason: 'salto' } });
  assert.strictEqual(r.status, 400);
  assert.ok(r.body.error);
});

test('registra transportadora, guía y tracking', { concurrent: false }, async () => {
  const { orderId } = await createPaidOrderWithQr();

  const r = await request('PATCH', `/api/admin/orders/${orderId}/carrier`, {
    ...AC,
    body: { carrier: 'Servientrega', tracking_number: 'GUIA123456', tracking_url: 'https://track.example.com/GUIA123456' },
  });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.strictEqual(r.body.next.carrier, 'Servientrega');
  assert.strictEqual(r.body.next.tracking_number, 'GUIA123456');

  const det = await request('GET', `/api/admin/orders/${orderId}`, AC);
  assert.strictEqual(det.body.order.carrier, 'Servientrega');
  assert.strictEqual(det.body.order.tracking_number, 'GUIA123456');
});

test('no permite marcar pagado sin confirmación de pago', { concurrent: false }, async () => {
  const email = nextEmail();
  await request('POST', '/api/auth/register', { body: { name: 'NP', email, password: 'Pass1234!' } });
  const { user } = await loginTokenAndUser(email, 'Pass1234!');
  const productId = await getStickerProduct();
  const designId = await getDesign(productId);
  const ts = Date.now();
  await dbq(
    `INSERT INTO orders (order_number, user_id, product_id, design_id, design_name, design_image_url,
       sticker_quantity, commercial_status, payment_status, total_amount, currency)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending_payment', 'pending', 30000, 'COP')`,
    ['EID-NP-' + ts, user.id, productId, designId, 'Diseño', '/img/s.png', 1]
  );
  const order = await dbone('SELECT id FROM orders WHERE order_number = ?', ['EID-NP-' + ts]);

  const r = await request('PATCH', `/api/admin/orders/${order.id}/status`, { ...AC, body: { commercial_status: 'paid' } });
  assert.strictEqual(r.status, 400);
});

test('email_log evita duplicados', { concurrent: false }, async () => {
  const { orderId } = await createPaidOrderWithQr();

  const r1 = await request('POST', `/api/admin/orders/${orderId}/resend-email`, { ...AC, body: { type: 'preparing' } });
  const r2 = await request('POST', `/api/admin/orders/${orderId}/resend-email`, { ...AC, body: { type: 'preparing' } });
  assert.strictEqual(r1.status, 200);
  assert.strictEqual(r2.status, 200);

  const logs = await dbq("SELECT COUNT(*) AS c FROM email_log WHERE order_id = ? AND type = 'preparing' AND status = 'sent'", [orderId]);
  assert.strictEqual(logs[0].c, 1, 'no debe haber duplicados de correo enviado');
});

test('rutas de pedidos protegidas sin token -> 401', { concurrent: false }, async () => {
  const noAuth = await request('GET', '/api/admin/orders');
  assert.strictEqual(noAuth.status, 401);
});
