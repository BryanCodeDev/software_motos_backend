process.env.DATABASE_URL='mysql://root:Santimajo101219%40@localhost:3307/emergency_id_test';
process.env.DB_NAME='emergency_id_test';
process.env.SESSION_SECRET='x';
process.env.JWT_ACCESS_SECRET='x';
process.env.JWT_REFRESH_SECRET='x';
(async () => {
  const th = require('./test-harness');
  await th.start();
  const db = require('./src/config/db');
  const { request, dbq, dbone, resetDb } = require('./test-utils');
  const qrInventoryService = require('./src/domains/qr-inventory/qr-inventory.service');
  const token = 'Bearer ' + (await request('POST', '/api/auth/login', { body: { email: 'admin@example.com', password: 'Admin1012@' } })).body.accessToken;
  await resetDb();
  const email = 't16' + Date.now() + '@example.com';
  await request('POST', '/api/auth/register', { body: { name: 'T16', email, password: 'Pass1234!' } });
  const btok = 'Bearer ' + (await request('POST', '/api/auth/login', { body: { email, password: 'Pass1234!' } })).body.accessToken;
  const buyer = (await request('POST', '/api/auth/login', { body: { email, password: 'Pass1234!' } })).body.user;
  const prod = await dbone("SELECT id FROM products WHERE slug='sticker-qr-personalizado' LIMIT 1");
  const des = await dbone('SELECT id FROM product_designs WHERE product_id=? ORDER BY sort_order LIMIT 1 OFFSET 8', [prod.id]);
  const batch = await request('POST', '/api/admin/qr-inventory/batches', { headers: { Authorization: token }, body: { design_id: des.id, quantity: 1 } });
  const bid = batch.body.batch.id;
  await request('POST', '/api/admin/qr-inventory/batches/' + bid + '/print', { headers: { Authorization: token } });
  await request('POST', '/api/admin/qr-inventory/batches/' + bid + '/receive', { headers: { Authorization: token }, body: { quantity_confirmed: 1 } });
  const ord = await request('POST', '/api/orders', { headers: { Authorization: btok }, body: { product_id: prod.id, design_id: des.id, shipping_address: { fullName: 'Comprador Prueba', phone: '3001234567', address: 'Calle 1', city: 'Bogotá', department: 'Cundinamarca', postalCode: '110111' } } });
  console.log('order:', ord.status, JSON.stringify(ord.body.order));
  const packageId = ord.body.order.package_id;
  await request('PATCH', '/api/admin/orders/' + ord.body.order.id, { headers: { Authorization: token }, body: { payment_status: 'approved' } });
  try {
    const result = await qrInventoryService.assignOrCreateForOrder(ord.body.order.id, '127.0.0.1');
    console.log('assign error:', result.error, 'identifier:', result.identifier ? result.identifier.id : null);
  } catch (e) { console.log('assign threw:', e.message); }
  const pkg = await dbone('SELECT status, printed_at, dispatched_at, delivered_at FROM qr_inventory_packages WHERE id = ?', [packageId]);
  console.log('pkg:', JSON.stringify(pkg));
  const ident = await dbone('SELECT status FROM identifiers WHERE package_id = ?', [packageId]);
  console.log('ident:', JSON.stringify(ident));
  await (th.server ? th.server.close() : Promise.resolve());
  await (db.close ? db.close() : Promise.resolve());
  process.exit(0);
})();
