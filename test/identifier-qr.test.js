const { test } = require('node:test');
const assert = require('node:assert/strict');

// Puerto y base de datos aislados para este archivo (node --test ejecuta archivos en paralelo).
process.env.PORT = '4011';
process.env.TEST_BASE_URL = 'http://localhost:4011';
process.env.DB_NAME = 'emergency_id_test_qa';
process.env.DATABASE_URL = 'mysql://root:Santimajo101219%40@localhost:3307/emergency_id_test_qa';

const { start, server } = require('../test-harness');
const { request, dbq, dbone, resetDb } = require('../test-utils');

let adminToken;
let counter = 0;
const nextEmail = () => `qa_${++counter}_${Date.now()}@example.com`;

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
  try { await new Promise((res) => server.close(res)); } catch {}
  process.exit(0);
});

const headers = (token) => ({ Authorization: token });

test('registro crea cuenta Y perfil, pero NO genera un QR físico ni consume inventario', { concurrent: false }, async (t) => {
  const email = nextEmail();
  const r = await request('POST', '/api/auth/register', {
    body: { name: 'Sin QR', email, password: 'Pass1234!' },
  });
  assert.strictEqual(r.status, 201, 'registro exitoso');
  assert.strictEqual(r.body.user.qr, undefined, 'no debe incluir qr al registrar');
  assert.strictEqual(r.body.user.id, r.body.user.id);
  const profile = await dbone('SELECT id, is_active FROM emergency_profiles WHERE user_id = ?', [r.body.user.id]);
  assert.ok(profile, 'se crea el perfil de emergencia');
  assert.strictEqual(profile.is_active, 0);
  const ids = await dbq('SELECT COUNT(*) AS c FROM identifiers WHERE user_id = ?', [r.body.user.id]);
  assert.strictEqual(ids[0].c, 0, 'no se crea identificador en el registro');
});

test('dos registros distintos no generan identificadores', { concurrent: false }, async () => {
  const r1 = await request('POST', '/api/auth/register', {
    body: { name: 'Usuario A', email: nextEmail(), password: 'Pass1234!' },
  });
  const r2 = await request('POST', '/api/auth/register', {
    body: { name: 'Usuario B', email: nextEmail(), password: 'Pass1234!' },
  });
  assert.strictEqual(r1.status, 201);
  assert.strictEqual(r2.status, 201);
  assert.strictEqual(r1.body.user.qr, undefined);
  assert.strictEqual(r2.body.user.qr, undefined);
  const c1 = await dbq('SELECT COUNT(*) AS c FROM identifiers WHERE user_id = ?', [r1.body.user.id]);
  const c2 = await dbq('SELECT COUNT(*) AS c FROM identifiers WHERE user_id = ?', [r2.body.user.id]);
  assert.strictEqual(c1[0].c, 0);
  assert.strictEqual(c2[0].c, 0);
});

test('re-registro del mismo email es rechazado (sin crear identificador)', { concurrent: false }, async () => {
  const email = nextEmail();
  const r1 = await request('POST', '/api/auth/register', { body: { name: 'Usuario X', email, password: 'Pass1234!' } });
  assert.strictEqual(r1.status, 201);
  const r2 = await request('POST', '/api/auth/register', { body: { name: 'Usuario X2', email, password: 'Pass1234!' } });
  assert.strictEqual(r2.status, 409, 're-registro rechazado');
});

test('ruta pública /e/:identifier: inexistente 404, sin propietario controlado, activo devuelve perfil, deshabilitado controlado', { concurrent: false }, async () => {
  // Inexistente
  const nope = await request('GET', '/api/e/emg_noexistente1234567890');
  assert.strictEqual(nope.status, 404);
  assert.strictEqual(nope.body.code, 'qr_not_found');

  // Usuario sin QR: insertar identificador pendiente directamente.
  const reg = await request('POST', '/api/auth/register', { body: { name: 'Usuario P', email: nextEmail(), password: 'Pass1234!' } });
  const userId = reg.body.user.id;
  const profile = await dbone('SELECT id FROM emergency_profiles WHERE user_id = ?', [userId]);
  const value = `emg_${Buffer.from(cryptoRandom()).toString('hex')}`;
  await dbq(
    'INSERT INTO identifiers (user_id, profile_id, value, status, print_status) VALUES (?, ?, ?, ?, ?)',
    [userId, profile.id, value, 'pending_activation', 'pending_print']
  );

  const pend = await request('GET', `/api/e/${encodeURIComponent(value)}`);
  assert.strictEqual(pend.status, 410);
  assert.strictEqual(pend.body.code, 'qr_pending_activation');

  // Activar el identificador (pago confirmado) y perfil activo -> devuelve perfil público.
  await dbq('UPDATE identifiers SET status = ?, activation_at = NOW() WHERE value = ?', ['active', value]);
  await dbq('UPDATE emergency_profiles SET is_active = 1 WHERE id = ?', [profile.id]);
  const act = await request('GET', `/api/e/${encodeURIComponent(value)}`);
  assert.strictEqual(act.status, 200);
  assert.strictEqual(act.body.status, 'active');

  // Deshabilitado -> respuesta controlada.
  await dbq('UPDATE identifiers SET status = ? WHERE value = ?', ['disabled', value]);
  const dis = await request('GET', `/api/e/${encodeURIComponent(value)}`);
  assert.strictEqual(dis.status, 410);
  assert.strictEqual(dis.body.code, 'qr_disabled');
});

test('identificador de inventario sin asignar (paquete sin usuario) responde controlado', { concurrent: false }, async () => {
  const product = await dbone("SELECT id FROM products WHERE slug='sticker-qr-personalizado' LIMIT 1");
  const design = await dbone('SELECT id FROM product_designs WHERE product_id = ? LIMIT 1', [product.id]);
  const value = `emg_${Buffer.from(cryptoRandom()).toString('hex')}`;
  await dbq(
    `INSERT INTO qr_inventory_packages (package_code, design_id, value, public_url, status, origin, quantity_stickers)
     VALUES (?, ?, ?, ?, 'available', 'inventory', 2)`,
    [`PKG_TEST_${counter}`, design.id, value, `http://localhost:5173/e/${value}`]
  );
  const res = await request('GET', `/api/e/${encodeURIComponent(value)}`);
  assert.strictEqual(res.status, 410);
  assert.strictEqual(res.body.code, 'qr_not_assigned');
  assert.ok(/no est[aá] asociado/.test(res.body.error));
});

test('administrador lista usuarios (usuarios sin QR no provocan errores)', { concurrent: false }, async () => {
  const r = await request('GET', '/api/admin/users', { headers: headers(adminToken) });
  assert.strictEqual(r.status, 200);
  assert.ok(Array.isArray(r.body.users));
  assert.ok(r.body.users.some((u) => !u.qr_id), 'hay usuarios sin identificador QR');
});

test('detalle de QR de administrador con imagen, URL, historial', { concurrent: false }, async () => {
  const reg = await request('POST', '/api/auth/register', { body: { name: 'Det', email: nextEmail(), password: 'Pass1234!' } });
  const userId = reg.body.user.id;
  const profile = await dbone('SELECT id FROM emergency_profiles WHERE user_id = ?', [userId]);
  const value = `emg_${Buffer.from(cryptoRandom()).toString('hex')}`;
  await dbq(
    'INSERT INTO identifiers (user_id, profile_id, value, status, print_status) VALUES (?, ?, ?, ?, ?)',
    [userId, profile.id, value, 'active', 'pending_print']
  );
  const idRow = await dbone("SELECT id FROM identifiers WHERE value = ?", [value]);
  assert.ok(idRow, 'identifier existe');

  const det = await request('GET', `/api/identifiers/${idRow.id}`, { headers: headers(adminToken) });
  assert.strictEqual(det.status, 200);
  assert.strictEqual(det.body.identifier.value, value);
  assert.strictEqual(det.body.identifier.qr_url, `http://localhost:5173/e/${value}`);
  assert.ok(det.body.user, 'incluye usuario asociado');
  assert.ok(Array.isArray(det.body.history), 'incluye historial');

  const img = await request('GET', `/api/identifiers/${idRow.id}/qr`, { headers: headers(adminToken) });
  assert.strictEqual(img.status, 200);
  assert.ok(img.headers['content-type'].includes('image/png'), 'devuelve imagen PNG');
});

test('identificador del usuario autenticado: null si no tiene QR', { concurrent: false }, async () => {
  const email = nextEmail();
  await request('POST', '/api/auth/register', { body: { name: 'Null', email, password: 'Pass1234!' } });
  const lg = await request('POST', '/api/auth/login', { body: { email, password: 'Pass1234!' } });
  assert.strictEqual(lg.status, 200);
  const token = 'Bearer ' + lg.body.accessToken;
  const my = await request('GET', '/api/identifiers/my', { headers: headers(token) });
  assert.strictEqual(my.status, 200);
  assert.strictEqual(my.body.identifier, null);
});

test('descarga individual del usuario autenticado (404 si no tiene identificador)', { concurrent: false }, async () => {
  const email = nextEmail();
  await request('POST', '/api/auth/register', { body: { name: 'Nodwn', email, password: 'Pass1234!' } });
  const lg = await request('POST', '/api/auth/login', { body: { email, password: 'Pass1234!' } });
  const token = 'Bearer ' + lg.body.accessToken;
  const my = await request('GET', '/api/identifiers/my/qr', { headers: headers(token) });
  assert.strictEqual(my.status, 404, 'sin identificador -> 404');
});

test('exportación masiva: ZIP, CSV y PDF', { concurrent: false }, async () => {
  const ids = [];
  for (let i = 0; i < 3; i++) {
    const email = nextEmail();
    const reg = await request('POST', '/api/auth/register', { body: { name: `Exp${i}`, email, password: 'Pass1234!' } });
    const profile = await dbone('SELECT id FROM emergency_profiles WHERE user_id = ?', [reg.body.user.id]);
    const value = `emg_${Buffer.from(cryptoRandom()).toString('hex')}`;
    await dbq(
      'INSERT INTO identifiers (user_id, profile_id, value, status, print_status) VALUES (?, ?, ?, ?, ?)',
      [reg.body.user.id, profile.id, value, 'active', 'pending_print']
    );
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
  const userId = reg.body.user.id;
  const profile = await dbone('SELECT id FROM emergency_profiles WHERE user_id = ?', [userId]);
  const value = `emg_${Buffer.from(cryptoRandom()).toString('hex')}`;
  await dbq(
    'INSERT INTO identifiers (user_id, profile_id, value, status, print_status) VALUES (?, ?, ?, ?, ?)',
    [userId, profile.id, value, 'pending_activation', 'pending_print']
  );
  const urlBefore = `http://localhost:5173/e/${value}`;

  // Obtener token del usuario recién creado para el patch autenticado
  const lg = await request('POST', '/api/auth/login', { body: { email, password: 'Pass1234!' } });
  const token = 'Bearer ' + lg.body.accessToken;
  const upd = await request('PATCH', '/api/profiles/me', {
    headers: { Authorization: token },
    body: { display_name: 'Nombre Actualizado' },
  });
  assert.strictEqual(upd.status, 200, 'perfil actualizable sin QR');
  const row = await dbone("SELECT value FROM identifiers WHERE value = ?", [value]);
  assert.strictEqual(row.value, value, 'identificador no cambia');
  assert.strictEqual(urlBefore, `http://localhost:5173/e/${value}`);
});

test('activación idempotente del QR digital (pago aprobado repetido)', { concurrent: false }, async () => {
  const email = nextEmail();
  const reg = await request('POST', '/api/auth/register', { body: { name: 'Idem', email, password: 'Pass1234!' } });
  const userId = reg.body.user.id;
  const product = await dbone("SELECT id FROM products WHERE slug='qr-digital-basico' LIMIT 1");
  const orderNum = `EID-IDEMP-${++counter}`;
  await dbq(
    `INSERT INTO orders (order_number, user_id, product_id, commercial_status, payment_status, total_amount, currency) VALUES (?,?,?,'paid','unpaid',30000,'COP')`,
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
  await request('POST', '/api/auth/register', { body: { name: 'Authz', email, password: 'Pass1234!' } });
  const idRow = await dbone("SELECT id FROM identifiers WHERE value = ?", ['nope']);
  // sin token
  const noToken = await request('GET', '/api/admin/users');
  assert.strictEqual(noToken.status, 401);
  // como usuario
  const lg = await request('POST', '/api/auth/login', { body: { email, password: 'Pass1234!' } });
  const token = 'Bearer ' + lg.body.accessToken;
  const asUser = await request('GET', '/api/admin/users', { headers: headers(token) });
  assert.strictEqual(asUser.status, 403);
});

test('exportación bloqueada para no administradores', { concurrent: false }, async () => {
  const email = nextEmail();
  await request('POST', '/api/auth/register', { body: { name: 'Blk', email, password: 'Pass1234!' } });
  const lg = await request('POST', '/api/auth/login', { body: { email, password: 'Pass1234!' } });
  assert.strictEqual(lg.status, 200, 'login');
  const token = 'Bearer ' + lg.body.accessToken;
  const zip = await request('GET', '/api/identifiers/export/zip?ids=1', { headers: headers(token) });
  assert.strictEqual(zip.status, 403, 'no admin -> 403');
});

test('control de impresión independiente de activación', { concurrent: false }, async () => {
  const email = nextEmail();
  const reg = await request('POST', '/api/auth/register', { body: { name: 'Print', email, password: 'Pass1234!' } });
  const userId = reg.body.user.id;
  const profile = await dbone('SELECT id FROM emergency_profiles WHERE user_id = ?', [userId]);
  const value = `emg_${Buffer.from(cryptoRandom()).toString('hex')}`;
  await dbq(
    'INSERT INTO identifiers (user_id, profile_id, value, status, print_status) VALUES (?, ?, ?, ?, ?)',
    [userId, profile.id, value, 'pending_activation', 'pending_print']
  );
  const idRow = await dbone("SELECT id, print_status FROM identifiers WHERE value = ?", [value]);
  assert.strictEqual(idRow.print_status, 'pending_print');
  const upd = await request('POST', '/api/identifiers/bulk-print-status', {
    body: { user_ids: [userId], print_status: 'sent_to_print' },
    headers: headers(adminToken),
  });
  assert.strictEqual(upd.status, 200);
  const after = await dbone("SELECT print_status, status FROM identifiers WHERE value = ?", [value]);
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

// crypto ligero para valores de prueba
function cryptoRandom() {
  const buf = Buffer.alloc(12);
  for (let i = 0; i < buf.length; i++) buf[i] = Math.floor(Math.random() * 256);
  return buf;
}
