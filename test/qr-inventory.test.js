const { test } = require('node:test');
const assert = require('node:assert/strict');

// Puerto y base de datos aislados para este archivo (node --test ejecuta archivos en paralelo).
process.env.PORT = '4012';
process.env.TEST_BASE_URL = 'http://localhost:4012';
process.env.DB_NAME = 'emergency_id_test_inv';
process.env.DATABASE_URL = 'mysql://root:Santimajo101219%40@localhost:3307/emergency_id_test_inv';

const { start, server } = require('../test-harness');
const { request, dbq, dbone, resetDb } = require('../test-utils');
const db = require('../src/config/db');
const qrInventoryService = require('../src/domains/qr-inventory/qr-inventory.service');

let adminToken;
let counter = 0;
const nextEmail = () => `inv_${++counter}_${Date.now()}@example.com`;

test.before(async () => {
  await start();
  await resetDb();
  const alogin = await request('POST', '/api/auth/login', {
    body: { email: 'admin@example.com', password: 'Admin1012@' },
  });
  assert.strictEqual(alogin.status, 200);
  adminToken = 'Bearer ' + alogin.body.accessToken;
});

test.after(() => {
  try { server.close(); } catch {}
  process.exit(0);
});

const h = (token) => ({ Authorization: token });

const newBuyer = async () => {
  const email = nextEmail();
  await request('POST', '/api/auth/register', { body: { name: 'Comprador', email, password: 'Pass1234!' } });
  const lg = await request('POST', '/api/auth/login', { body: { email, password: 'Pass1234!' } });
  assert.strictEqual(lg.status, 200);
  return { token: 'Bearer ' + lg.body.accessToken, userId: lg.body.user.id };
};

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

const prepareAvailableBatch = async (designId, quantity = 1) => {
  const batch = await request('POST', '/api/admin/qr-inventory/batches', {
    headers: h(adminToken),
    body: { design_id: designId, quantity },
  });
  assert.strictEqual(batch.status, 201);
  const batchId = batch.body.batch.id;
  const printed = await request('POST', `/api/admin/qr-inventory/batches/${batchId}/print`, { headers: h(adminToken) });
  assert.strictEqual(printed.status, 200);
  const received = await request('POST', `/api/admin/qr-inventory/batches/${batchId}/receive`, {
    headers: h(adminToken),
    body: { quantity_confirmed: quantity },
  });
  assert.strictEqual(received.status, 200);
  return batchId;
};

const createOrder = async (buyerTok, productId, designId) => {
  const res = await request('POST', '/api/orders', {
    headers: h(buyerTok),
    body: {
      product_id: productId, design_id: designId,
      shipping_address: { fullName: 'Comprador Prueba', phone: '3001234567', address: 'Calle 1', city: 'Bogotá', department: 'Cundinamarca', postalCode: '110111' },
    },
  });
  assert.strictEqual(res.status, 201, JSON.stringify(res.body));
  return res.body.order;
};

const markOrderPaid = async (orderId) => {
  const res = await request('PATCH', `/api/admin/orders/${orderId}`, {
    headers: h(adminToken),
    body: { payment_status: 'approved' },
  });
  assert.strictEqual(res.status, 200);
};

test('administrador crea un lote de paquetes (generación digital, sin stock físico todavía)', { concurrent: false }, async () => {
  await resetDb();
  const productId = await getStickerProduct();
  const designId = await getDesign(productId, 0);
  const res = await request('POST', '/api/admin/qr-inventory/batches', {
    headers: h(adminToken),
    body: { design_id: designId, quantity: 5, notes: 'Lote de prueba diseño 1' },
  });
  assert.strictEqual(res.status, 201, JSON.stringify(res.body));
  assert.strictEqual(res.body.batch.quantity_requested, 5);
  assert.strictEqual(res.body.batch.status, 'pending_print');
  assert.strictEqual(res.body.batch.packages.length, 5);
  const values = res.body.batch.packages.map((p) => p.value);
  assert.strictEqual(new Set(values).size, 5, 'valores QR únicos en el lote');
  for (const pkg of res.body.batch.packages) {
    assert.strictEqual(pkg.public_url, `http://localhost:5173/e/${pkg.value}`);
    assert.ok(/^emg_[0-9a-f]+$/.test(pkg.value));
  }
  const batches = await dbq('SELECT status, quantity_confirmed FROM qr_inventory_batches WHERE id = ?', [res.body.batch.id]);
  assert.strictEqual(batches[0].status, 'pending_print');
  assert.strictEqual(batches[0].quantity_confirmed, 0);
  const pkgs = await dbq("SELECT status, user_id, order_id FROM qr_inventory_packages WHERE batch_id = ?", [res.body.batch.id]);
  assert.strictEqual(pkgs.length, 5);
  assert.ok(pkgs.every((p) => p.status === 'in_production' && p.user_id === null && p.order_id === null));
});

test('administrador marca lote como impreso y luego como recibido (pasa a disponible)', { concurrent: false }, async () => {
  await resetDb();
  const productId = await getStickerProduct();
  const designId = await getDesign(productId, 1);
  const batchId = await prepareAvailableBatch(designId, 3);
  const pkgs = await dbq("SELECT status FROM qr_inventory_packages WHERE batch_id = ?", [batchId]);
  assert.ok(pkgs.every((p) => p.status === 'available'), 'los paquetes recibidos quedan disponibles para venta');
});

test('compra de sticker con stock físico reserva un paquete del diseño', { concurrent: false }, async () => {
  await resetDb();
  const productId = await getStickerProduct();
  const designId = await getDesign(productId, 2);
  await prepareAvailableBatch(designId, 2);

  const buyer = await newBuyer();
  const order = await createOrder(buyer.token, productId, designId);
  assert.strictEqual(order.inventory_origin, 'inventory');
  assert.ok(order.package_id, 'se reserva un paquete');
  assert.strictEqual(order.production_required, false);
  assert.strictEqual(order.sticker_quantity, 2);

  const pkg = await dbone('SELECT status, order_id, user_id FROM qr_inventory_packages WHERE id = ?', [order.package_id]);
  assert.strictEqual(pkg.status, 'reserved');
  assert.strictEqual(pkg.order_id, order.id);
  assert.strictEqual(pkg.user_id, null, 'sin usuario hasta que se pague');
});

test('compra de sticker sin stock físico genera producción bajo pedido', { concurrent: false }, async () => {
  await resetDb();
  const productId = await getStickerProduct();
  const designId = await getDesign(productId, 3);
  await dbq("UPDATE qr_inventory_packages SET status = 'delivered' WHERE design_id = ?", [designId]);

  const buyer = await newBuyer();
  const order = await createOrder(buyer.token, productId, designId);
  assert.strictEqual(order.inventory_origin, 'on_demand');
  assert.strictEqual(order.package_id, null);
  assert.strictEqual(order.production_required, true);
});

test('dos compras del último paquete: solo una lo reserva', { concurrent: false }, async () => {
  await resetDb();
  const productId = await getStickerProduct();
  const designId = await getDesign(productId, 4);
  await prepareAvailableBatch(designId, 1);

  const buyerA = await newBuyer();
  const orderA = await createOrder(buyerA.token, productId, designId);
  assert.strictEqual(orderA.inventory_origin, 'inventory');

  const buyerB = await newBuyer();
  const orderB = await createOrder(buyerB.token, productId, designId);
  assert.strictEqual(orderB.inventory_origin, 'on_demand');
  assert.strictEqual(orderB.package_id, null);

  const pkg = await dbone('SELECT status, order_id FROM qr_inventory_packages WHERE design_id = ? AND status <> ?', [designId, 'available']);
  assert.strictEqual(pkg.order_id, orderA.id);
});

test('usuario con QR activo no puede comprar otro sticker (compra ordinaria bloqueada)', { concurrent: false }, async () => {
  await resetDb();
  const buyer = await newBuyer();
  const uid = buyer.userId;
  const profile = await dbone('SELECT id FROM emergency_profiles WHERE user_id = ?', [uid]);
  const value = `emg_${Buffer.alloc(12, 0).toString('hex')}${Date.now().toString(16)}`;
  await dbq('INSERT INTO identifiers (user_id, profile_id, value, status, print_status) VALUES (?, ?, ?, ?, ?)', [uid, profile.id, value, 'active', 'pending_print']);

  const productId = await getStickerProduct();
  const designId = await getDesign(productId, 5);
  const res = await request('POST', '/api/orders', {
    headers: h(buyer.token),
    body: {
      product_id: productId, design_id: designId,
      shipping_address: { fullName: 'Dup', phone: '3001234567', address: 'Calle 1', city: 'Bogotá', department: 'Cundinamarca', postalCode: '110111' },
    },
  });
  assert.strictEqual(res.status, 409);
  assert.strictEqual(res.body.code, 'user_already_has_qr');
});

test('pago aprobado asigna el paquete reservado al usuario (crea identificador activo)', { concurrent: false }, async () => {
  await resetDb();
  const productId = await getStickerProduct();
  const designId = await getDesign(productId, 6);
  await prepareAvailableBatch(designId, 1);

  const buyer = await newBuyer();
  const order = await createOrder(buyer.token, productId, designId);
  const orderId = order.id;
  const packageId = order.package_id;
  await markOrderPaid(orderId);

  const conn = await db.getConnection();
  try {
    const result = await qrInventoryService.assignOrCreateForOrder(orderId, '127.0.0.1');
    assert.ok(!result.error, 'asignación exitosa: ' + JSON.stringify(result.error));
    assert.strictEqual(result.identifier.status, 'active');
    assert.ok(result.identifier.activation_at);
    assert.strictEqual(result.identifier.package_id, packageId);

    const pkg = await dbone('SELECT status, user_id, identifier_id FROM qr_inventory_packages WHERE id = ?', [packageId]);
    assert.strictEqual(pkg.status, 'assigned');
    assert.strictEqual(pkg.user_id, buyer.userId);
    assert.strictEqual(pkg.identifier_id, result.identifier.id);

    const ident = await dbone('SELECT value, status, order_id, user_id FROM identifiers WHERE id = ?', [result.identifier.id]);
    assert.strictEqual(ident.user_id, buyer.userId);
    assert.strictEqual(ident.order_id, orderId);
    assert.ok(/^emg_[0-9a-f]+$/.test(ident.value));

    const result2 = await qrInventoryService.assignOrCreateForOrder(orderId, '127.0.0.1');
    assert.strictEqual(result2.already, true);
    const count = await dbone('SELECT COUNT(*) AS c FROM identifiers WHERE package_id = ?', [packageId]);
    assert.strictEqual(count.c, 1);
  } finally {
    conn.release();
  }
});

test('pago aprobado sin stock crea paquete bajo producción vinculado al usuario', { concurrent: false }, async () => {
  await resetDb();
  const productId = await getStickerProduct();
  const designId = await getDesign(productId, 7);
  await dbq("UPDATE qr_inventory_packages SET status = 'delivered' WHERE design_id = ?", [designId]);

  const buyer = await newBuyer();
  const order = await createOrder(buyer.token, productId, designId);
  const orderId = order.id;
  assert.strictEqual(order.inventory_origin, 'on_demand');
  await markOrderPaid(orderId);

  const conn = await db.getConnection();
  try {
    const result = await qrInventoryService.assignOrCreateForOrder(orderId, '127.0.0.1');
    assert.ok(!result.error, JSON.stringify(result.error));
    assert.strictEqual(result.package.status, 'in_production');
    assert.strictEqual(result.package.origin, 'on_demand');
    assert.strictEqual(result.package.quantity_stickers, 2);
    assert.strictEqual(result.identifier.status, 'active');
    const pkg = await dbone('SELECT order_id, user_id FROM qr_inventory_packages WHERE id = ?', [result.package.id]);
    assert.strictEqual(pkg.order_id, orderId);
    assert.strictEqual(pkg.user_id, buyer.userId);
  } finally {
    conn.release();
  }
});

test('administrador cambia estado físico de paquete (impreso, despachado, entregado) sin afectar activación', { concurrent: false }, async () => {
  await resetDb();
  const productId = await getStickerProduct();
  const designId = await getDesign(productId, 8);
  await prepareAvailableBatch(designId, 1);

  const buyer = await newBuyer();
  const order = await createOrder(buyer.token, productId, designId);
  const packageId = order.package_id;
  await markOrderPaid(order.id);
  const conn = await db.getConnection();
  try {
    const result = await qrInventoryService.assignOrCreateForOrder(order.id, '127.0.0.1');
    assert.ok(!result.error, JSON.stringify(result.error));
    assert.strictEqual(result.identifier.status, 'active');
  } finally {
    conn.release();
  }

  const printed = await request('POST', `/api/admin/qr-inventory/packages/${packageId}/status`, {
    headers: h(adminToken),
    body: { status: 'printed' },
  });
  assert.strictEqual(printed.status, 200);
  const dispatched = await request('POST', `/api/admin/qr-inventory/packages/${packageId}/status`, {
    headers: h(adminToken),
    body: { status: 'dispatched' },
  });
  assert.strictEqual(dispatched.status, 200);
  const delivered = await request('POST', `/api/admin/qr-inventory/packages/${packageId}/status`, {
    headers: h(adminToken),
    body: { status: 'delivered' },
  });
  assert.strictEqual(delivered.status, 200);

  const pkg = await dbone('SELECT status, printed_at, dispatched_at, delivered_at FROM qr_inventory_packages WHERE id = ?', [packageId]);
  assert.strictEqual(pkg.status, 'delivered');
  assert.ok(pkg.delivered_at);

  // El identificador sigue activo (impresión/despacho/entrega no desactivan el QR).
  const ident = await dbone('SELECT status FROM identifiers WHERE package_id = ?', [packageId]);
  assert.strictEqual(ident.status, 'active');
});

test('exportación de inventario para el proveedor (CSV, sin datos personales)', { concurrent: false }, async () => {
  await resetDb();
  const productId = await getStickerProduct();
  const designId = await getDesign(productId, 0);
  await prepareAvailableBatch(designId, 2);
  const res = await request('GET', '/api/admin/qr-inventory/export?format=csv', { headers: h(adminToken) });
  assert.strictEqual(res.status, 200);
  assert.ok(res.headers['content-type'].includes('text/csv'));
  const lines = res.raw.split('\n').filter(Boolean);
  assert.ok(lines.length > 1, 'CSV tiene encabezado y al menos un paquete');
  const header = lines[0];
  assert.ok(header.includes('identificador_qr'));
  assert.ok(header.includes('url_publica'));
  assert.ok(header.includes('diseno_nombre'));
  assert.ok(header.includes('cantidad_stickers'));
  assert.ok(!header.toLowerCase().includes('correo'));
  assert.ok(!header.toLowerCase().includes('nombre_usuario'));
  assert.ok(!header.toLowerCase().includes('telefono'));
  // Cada fila de datos trae un identificador y su URL pública.
  const dataRows = lines.slice(1);
  assert.ok(dataRows.length >= 2, 'se exportan los paquetes generados');
  for (const row of dataRows) {
    assert.ok(row.includes('emg_'), 'cada fila tiene un identificador QR');
    assert.ok(row.includes('http://localhost:5173/e/'), 'cada fila tiene su URL pública');
  }
});

test('liberación de reservas vencidas', { concurrent: false }, async () => {
  await resetDb();
  const before = await qrInventoryService.releaseExpiredReservations();
  assert.ok(Number.isInteger(before));
});

test('detalle y listado de paquetes con filtros', { concurrent: false }, async () => {
  await resetDb();
  const list = await request('GET', '/api/admin/qr-inventory/packages', { headers: h(adminToken) });
  assert.strictEqual(list.status, 200);
  assert.ok(Array.isArray(list.body.packages));
  assert.ok(list.body.pagination);

  const stats = await request('GET', '/api/admin/qr-inventory/stats', { headers: h(adminToken) });
  assert.strictEqual(stats.status, 200);
  assert.ok(stats.stats.packages);
  assert.ok(stats.stats.identifiers);
});
