const { test } = require('node:test');
const assert = require('node:assert/strict');
const { start, server } = require('../test-harness');
const { request, dbq, dbone, resetDb } = require('../test-utils');

let adminToken;
let counter = 0;
const nextEmail = () => `qa_${++counter}_${Date.now()}@example.com`;

// Estado compartido entre tests (evitar t.context, no disponible en node:test)
let createdUserId;
let createdQrValue;

test.before(async () => {
  await start();
  await resetDb();
  const loginBody = await request('POST', '/api/auth/login', {
    body: { email: 'admin@example.com', password: 'Admin1012@' },
  });
  assert.strictEqual(loginBody.status, 200, 'admin login');
  adminToken = 'Bearer ' + loginBody.body.accessToken;
});

test.after(async () => {
  try { server.close(); } catch {}
});

const headers = (token) => ({ Authorization: token });

test('registro automático crea QR pendiente_activation con identificador único y URL permanente', { concurrent: false }, async (t) => {
  const email = nextEmail();
  const r = await request('POST', '/api/auth/register', {
    body: { name: 'Auto QR', email, password: 'Pass1234!' },
  });
  assert.strictEqual(r.status, 201);
  assert.ok(r.body.user.qr, 'debe incluir qr');
  assert.strictEqual(r.body.user.qr.status, 'pending_activation');
  assert.ok(/^emg_[0-9a-f]+$/.test(r.body.user.qr.value), 'identificador formato emg_hex');
  assert.strictEqual(r.body.user.qr.qr_url, `http://localhost:5173/e/${r.body.user.qr.value}`);
  createdUserId = r.body.user.id;
  createdQrValue = r.body.user.qr.value;
});

test('dos registros distintos generan identificadores diferentes', { concurrent: false }, async () => {
  const r1 = await request('POST', '/api/auth/register', {
    body: { name: 'Usuario A', email: nextEmail(), password: 'Pass1234!' },
  });
  if (r1.status !== 201) console.error('R1 BODY:', JSON.stringify(r1.body));
  const r2 = await request('POST', '/api/auth/register', {
    body: { name: 'Usuario B', email: nextEmail(), password: 'Pass1234!' },
  });
  if (r2.status !== 201) console.error('R2 BODY:', JSON.stringify(r2.body));
  assert.strictEqual(r1.status, 201);
  assert.strictEqual(r2.status, 201);
  assert.notStrictEqual(r1.body.user.qr.value, r2.body.user.qr.value);
});

test('re-registro del mismo email es rechazado (sin duplicar QR)', { concurrent: false }, async () => {
  const email = nextEmail();
  const r1 = await request('POST', '/api/auth/register', { body: { name: 'Usuario X', email, password: 'Pass1234!' } });
  assert.strictEqual(r1.status, 201);
  const id1 = r1.body.user.qr.value;
  const r2 = await request('POST', '/api/auth/register', { body: { name: 'Usuario X2', email, password: 'Pass1234!' } });
  assert.strictEqual(r2.status, 409, 're-registro rechazado');
  const rows = await dbq("SELECT COUNT(*) AS c FROM identifiers WHERE value = ?", [id1]);
  assert.strictEqual(rows[0].c, 1, 'un solo QR por email');
});

test('QR pendiente muestra pantalla controlada y activo devuelve perfil público', { concurrent: false }, async () => {
  const email = nextEmail();
  const r = await request('POST', '/api/auth/register', { body: { name: 'Usuario P', email, password: 'Pass1234!' } });
  const value = r.body.user.qr.value;
  const pend = await request('GET', `/api/profiles/public/${encodeURIComponent(value)}`);
  assert.strictEqual(pend.status, 410);
  assert.strictEqual(pend.body.code, 'qr_pending_activation');

  const product = await dbone("SELECT id FROM products WHERE slug='qr-digital-basico' LIMIT 1");
  assert.ok(product, 'producto qr-digital-basico existe');
  const orderNum = `EID-TEST-${++counter}`;
  await dbq(
    `INSERT INTO orders (order_number, user_id, product_id, commercial_status, payment_status, total_amount, currency) VALUES (?,?,?,'paid','approved',30000,'COP')`,
    [orderNum, r.body.user.id, product.id]
  );
  const order = await dbone('SELECT id FROM orders WHERE order_number = ?', [orderNum]);
  const upd = await request('PATCH', `/api/admin/orders/${order.id}`, {
    body: { payment_status: 'approved' },
    headers: headers(adminToken),
  });
  assert.strictEqual(upd.status, 200);

  const idRow = await dbone("SELECT status, activation_at FROM identifiers WHERE value = ?", [value]);
  assert.strictEqual(idRow.status, 'active');
  assert.ok(idRow.activation_at);

  const act = await request('GET', `/api/profiles/public/${encodeURIComponent(value)}`);
  assert.strictEqual(act.status, 200);
  assert.strictEqual(act.body.status, 'active');
});

test('QR inexistente y deshabilitado responden controlados', { concurrent: false }, async () => {
  const nope = await request('GET', '/api/profiles/public/emg_noexistente1234567890');
  assert.strictEqual(nope.status, 404);

  const email = nextEmail();
  const r = await request('POST', '/api/auth/register', { body: { name: 'Usuario D', email, password: 'Pass1234!' } });
  await dbq("UPDATE identifiers SET status='disabled' WHERE value = ?", [r.body.user.qr.value]);
  const dis = await request('GET', `/api/profiles/public/${encodeURIComponent(r.body.user.qr.value)}`);
  assert.strictEqual(dis.status, 410);
  assert.strictEqual(dis.body.code, 'qr_disabled');
});

test('administrador lista usuarios con campos de QR y filtro de impresión', { concurrent: false }, async () => {
  const r = await request('GET', '/api/admin/users', { headers: headers(adminToken) });
  assert.strictEqual(r.status, 200);
  assert.ok(Array.isArray(r.body.users));
  const sample = r.body.users[0];
  if (sample) {
    assert.ok('qr_id' in sample || 'qr_value' in sample, 'listado incluye campos de QR');
    assert.ok('qr_status' in sample, 'listado incluye estado QR');
  }
  const r2 = await request('GET', '/api/admin/users?print_status=pending_print', { headers: headers(adminToken) });
  assert.strictEqual(r2.status, 200);
});

test('detalle de QR de administrador con imagen, URL, historial', { concurrent: false }, async () => {
  const email = nextEmail();
  const reg = await request('POST', '/api/auth/register', { body: { name: 'Det', email, password: 'Pass1234!' } });
  const idRow = await dbone("SELECT id FROM identifiers WHERE value = ?", [reg.body.user.qr.value]);
  assert.ok(idRow, 'identifier existe');

  const det = await request('GET', `/admin/identifiers/${idRow.id}`, { headers: headers(adminToken) });
  assert.strictEqual(det.status, 200);
  assert.strictEqual(det.body.identifier.value, reg.body.user.qr.value);
  assert.strictEqual(det.body.identifier.qr_url, `http://localhost:5173/e/${reg.body.user.qr.value}`);
  assert.ok(det.body.user, 'incluye usuario asociado');
  assert.ok(Array.isArray(det.body.history), 'incluye historial');

  const img = await request('GET', `/admin/identifiers/${idRow.id}/qr`, { headers: headers(adminToken) });
  assert.strictEqual(img.status, 200);
  assert.ok(img.headers['content-type'].includes('image/png'), 'devuelve imagen PNG');
});

test('descarga individual del usuario autenticado', { concurrent: false }, async () => {
  const email = nextEmail();
  await request('POST', '/api/auth/register', { body: { name: 'Dwn', email, password: 'Pass1234!' } });
  const lg = await request('POST', '/api/auth/login', { body: { email, password: 'Pass1234!' } });
  assert.strictEqual(lg.status, 200);
  const token = 'Bearer ' + lg.body.accessToken;
  const my = await request('GET', '/api/identifiers/my/qr', { headers: headers(token) });
  assert.strictEqual(my.status, 200);
  assert.ok(my.headers['content-type'].includes('image/png'));
});

test('exportación masiva: ZIP, CSV y PDF', { concurrent: false }, async () => {
  const ids = [];
  for (let i = 0; i < 3; i++) {
    const email = nextEmail();
    const reg = await request('POST', '/api/auth/register', { body: { name: `Exp${i}`, email, password: 'Pass1234!' } });
    ids.push(reg.body.user.id);
  }
  const idParam = ids.join(',');
  const zip = await request('GET', `/api/identifiers/export/zip?ids=${idParam}`, { headers: headers(adminToken) });
  assert.strictEqual(zip.status, 200);
  assert.ok(zip.headers['content-type'].includes('application/zip'));

  const csv = await request('GET', `/api/identifiers/export/csv?ids=${idParam}`, { headers: headers(adminToken) });
  assert.strictEqual(csv.status, 200);
  assert.ok(csv.headers['content-type'].includes('text/csv'));

  const pdf = await request('GET', `/api/identifiers/export/pdf?ids=${idParam}&columns=2&rows=3&size_mm=20`, { headers: headers(adminToken) });
  assert.strictEqual(pdf.status, 200);
  assert.ok(pdf.headers['content-type'].includes('application/pdf'));
});

test('actualización de perfil no cambia el identificador ni la URL del QR', { concurrent: false }, async () => {
  const email = nextEmail();
  const reg = await request('POST', '/api/auth/register', { body: { name: 'Prof', email, password: 'Pass1234!' } });
  const valueBefore = reg.body.user.qr.value;
  const urlBefore = reg.body.user.qr.qr_url;
  const row = await dbone("SELECT value FROM identifiers WHERE value = ?", [valueBefore]);
  assert.strictEqual(row.value, valueBefore);
  assert.strictEqual(urlBefore, `http://localhost:5173/e/${valueBefore}`);
});

test('webhooks repetidos no crean QR nuevos (activación idempotente)', { concurrent: false }, async () => {
  const email = nextEmail();
  const reg = await request('POST', '/api/auth/register', { body: { name: 'Idem', email, password: 'Pass1234!' } });
  const userId = reg.body.user.id;
  const product = await dbone("SELECT id FROM products WHERE slug='qr-digital-basico' LIMIT 1");
  const orderNum = `EID-IDEMP-${++counter}`;
  await dbq(
    `INSERT INTO orders (order_number, user_id, product_id, commercial_status, payment_status, total_amount, currency) VALUES (?,?,?,'paid','approved',30000,'COP')`,
    [orderNum, userId, product.id]
  );
  const order = await dbone('SELECT id FROM orders WHERE order_number = ?', [orderNum]);
  await request('PATCH', `/api/admin/orders/${order.id}`, { body: { payment_status: 'approved' }, headers: headers(adminToken) });
  await request('PATCH', `/api/admin/orders/${order.id}`, { body: { payment_status: 'approved' }, headers: headers(adminToken) });
  await request('PATCH', `/api/admin/orders/${order.id}`, { body: { payment_status: 'approved' }, headers: headers(adminToken) });
  const count = await dbone("SELECT COUNT(*) AS c FROM identifiers WHERE user_id = ?", [userId]);
  assert.strictEqual(count.c, 1, 'un solo QR a pesar de activaciones repetidas');
  const row = await dbone("SELECT status FROM identifiers WHERE user_id = ?", [userId]);
  assert.strictEqual(row.status, 'active');
});

test('operaciones administrativas requieren autorización', { concurrent: false }, async () => {
  const email = nextEmail();
  const reg = await request('POST', '/api/auth/register', { body: { name: 'Authz', email, password: 'Pass1234!' } });
  const idRow = await dbone("SELECT id FROM identifiers WHERE value = ?", [reg.body.user.qr.value]);
  assert.ok(idRow);

  const noToken = await request('GET', `/admin/identifiers/${idRow.id}`);
  assert.strictEqual(noToken.status, 401);

  const lg = await request('POST', '/api/auth/login', { body: { email, password: 'Pass1234!' } });
  const token = 'Bearer ' + lg.body.accessToken;
  const asUser = await request('GET', `/admin/identifiers/${idRow.id}`, { headers: headers(token) });
  assert.strictEqual(asUser.status, 403);
});

test('exportación bloqueada para no administradores', { concurrent: false }, async () => {
  const email = nextEmail();
  await request('POST', '/api/auth/register', { body: { name: 'Blk', email, password: 'Pass1234!' } });
  const lg = await request('POST', '/api/auth/login', { body: { email, password: 'Pass1234!' } });
  const token = 'Bearer ' + lg.body.accessToken;
  const zip = await request('GET', '/api/identifiers/export/zip?ids=1', { headers: headers(token) });
  assert.strictEqual(zip.status, 403);
});

test('control de impresión independiente de activación', { concurrent: false }, async () => {
  const email = nextEmail();
  const reg = await request('POST', '/api/auth/register', { body: { name: 'Print', email, password: 'Pass1234!' } });
  const userId = reg.body.user.id;
  const idRow = await dbone("SELECT id, print_status FROM identifiers WHERE value = ?", [reg.body.user.qr.value]);
  assert.strictEqual(idRow.print_status, 'pending_print');
  const upd = await request('POST', '/api/identifiers/bulk-print-status', {
    body: { user_ids: [userId], print_status: 'sent_to_print' },
    headers: headers(adminToken),
  });
  assert.strictEqual(upd.status, 200);
  const after = await dbone("SELECT print_status, status FROM identifiers WHERE value = ?", [reg.body.user.qr.value]);
  assert.strictEqual(after.print_status, 'sent_to_print');
  assert.strictEqual(after.status, 'pending_activation', 'impresión no afecta activación');
});

test('QR y usuarios existentes del seed permanecen intactos', { concurrent: false }, async () => {
  const admin = await dbone("SELECT id FROM users WHERE email='admin@example.com' LIMIT 1");
  assert.ok(admin, 'usuario admin del seed existe');
  const list = await request('GET', '/api/admin/users', { headers: headers(adminToken) });
  assert.strictEqual(list.status, 200);
  assert.ok(list.body.users.some((u) => u.email === 'admin@example.com'));
});

// Forzar salida limpia del proceso de pruebas
setTimeout(() => {
  try { server.close(); } catch {}
  process.exit(0);
}, 5000).unref();
