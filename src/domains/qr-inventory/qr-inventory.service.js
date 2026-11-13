const db = require('../../config/db');
const {
  generateIdentifierValue,
  buildPublicUrl,
} = require('../identifiers/identifier.service');
const { ensureProfileTx } = require('../identifiers/identifier.service');

const RESERVATION_TTL_MINUTES = parseInt(
  process.env.QR_RESERVATION_TTL_MINUTES || '30',
  10
);

const PACKAGE_STATUSES = [
  'available',
  'reserved',
  'assigned',
  'in_production',
  'printed',
  'dispatched',
  'delivered',
  'cancelled',
  'retired',
];

const MAX_IDENTIFIER_TRIES = 10;

const generateUniqueValue = async (conn) => {
  let value;
  let tries = 0;
  do {
    value = generateIdentifierValue();
    tries += 1;
    const [exists] = await conn.query(
      'SELECT id FROM qr_inventory_packages WHERE value = ? FOR UPDATE',
      [value]
    );
    if (exists.length === 0) break;
  } while (tries < MAX_IDENTIFIER_TRIES);
  if (tries >= MAX_IDENTIFIER_TRIES) return null;
  return value;
};

const generateUniqueIdentifierValue = async (conn) => {
  let value;
  let tries = 0;
  do {
    value = generateIdentifierValue();
    tries += 1;
    const [exists] = await conn.query(
      'SELECT id FROM identifiers WHERE value = ? FOR UPDATE',
      [value]
    );
    if (exists.length === 0) break;
  } while (tries < MAX_IDENTIFIER_TRIES);
  if (tries >= MAX_IDENTIFIER_TRIES) return null;
  return value;
};

const releaseExpiredReservations = async () => {
  const result = await db.query(
    `UPDATE qr_inventory_packages
     SET status = 'available', reserved_until = NULL, order_id = NULL
     WHERE status = 'reserved'
       AND reserved_until IS NOT NULL
       AND reserved_until < NOW()`
  );
  return result && result.affectedRows ? Number(result.affectedRows) : 0;
};

// Libera reservas vencidas de pedidos no pagados de un usuario, excepto el pedido actual.
// Evita que un mismo usuario acapare paquetes en reintentos de checkout.
const releaseUserUnpaidReservations = async (conn, userId, exceptOrderId) => {
  await conn.query(
    `UPDATE qr_inventory_packages
     SET status = 'available', reserved_until = NULL, order_id = NULL
     WHERE status = 'reserved'
       AND order_id IN (SELECT id FROM orders WHERE user_id = ? AND id <> ? AND payment_status = 'unpaid' AND commercial_status <> 'paid')`,
    [userId, exceptOrderId]
  );
};

// Un usuario no puede tener más de un QR físico activo entregado/activado.
// Devuelve true si existe un bloqueo (QR activo, impreso o entregado).
const hasBlockingQr = async (conn, userId) => {
  const [rows] = await conn.query(
    `SELECT id FROM identifiers
     WHERE user_id = ?
       AND (status = 'active' OR print_status IN ('printed', 'delivered'))
     LIMIT 1`,
    [userId]
  );
  return rows.length > 0;
};

// Retira un identificador pendiente nunca impreso ni entregado para dar paso
// a uno nuevo vinculado a una compra. Conserva el historial.
const retirePendingUnprintedIdentifier = async (conn, userId, ipAddress, reason) => {
  const [rows] = await conn.query(
    `SELECT id, value, print_status FROM identifiers
     WHERE user_id = ? AND status = 'pending_activation' AND print_status = 'pending_print'
     ORDER BY created_at ASC LIMIT 1`,
    [userId]
  );
  for (const row of rows) {
    await conn.query(
      'UPDATE identifiers SET status = ?, updated_at = NOW() WHERE id = ?',
      ['retired', row.id]
    );
    await conn.query(
      `INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, metadata, ip_address)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        userId,
        'identifier.retire.pending',
        'identifiers',
        String(row.id),
        JSON.stringify({
          value: row.value,
          reason,
          print_status: row.print_status,
        }),
        ipAddress,
      ]
    );
  }
};

const ensureProfile = async (conn, userId) => {
  return ensureProfileTx(conn, userId);
};

const createIdentifierRow = async (conn, userId, profileId, orderId, value, packageId, ipAddress) => {
  const qrUrl = buildPublicUrl(value);
  const [result] = await conn.query(
    `INSERT INTO identifiers (user_id, profile_id, order_id, package_id, value, status, activation_at)
     VALUES (?, ?, ?, ?, ?, 'active', NOW())`,
    [userId, profileId, orderId, packageId || null, value]
  );
  await conn.query(
    `INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, metadata, ip_address)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      userId,
      'identifier.create.active',
      'identifiers',
      String(result.insertId),
      JSON.stringify({ value, qr_url: qrUrl, order_id: orderId, package_id: packageId || null }),
      ipAddress,
    ]
  );
  return {
    id: result.insertId,
    user_id: userId,
    value,
    status: 'active',
    activation_at: new Date(),
    qr_url: qrUrl,
    package_id: packageId || null,
  };
};

const PACKAGE_FIELDS = `
  p.id, p.package_code, p.batch_id, p.design_id, p.identifier_id, p.value,
  p.public_url, p.status, p.user_id, p.order_id, p.origin, p.quantity_stickers,
  p.reserved_until, p.printed_at, p.dispatched_at, p.delivered_at,
  p.created_at, p.updated_at,
  d.name AS design_name, d.slug AS design_slug, d.image_url AS design_image_url,
  u.email AS user_email,
  o.order_number AS order_number, o.commercial_status AS order_commercial_status,
  o.payment_status AS order_payment_status,
  b.batch_code AS batch_code, b.status AS batch_status
`;

const mapPackageRow = (row) => ({
  id: row.id,
  package_code: row.package_code,
  batch_id: row.batch_id,
  batch_code: row.batch_code,
  batch_status: row.batch_status,
  design_id: row.design_id,
  design: {
    id: row.design_id,
    name: row.design_name,
    slug: row.design_slug,
    image_url: row.design_image_url,
  },
  identifier_id: row.identifier_id,
  value: row.value,
  public_url: row.public_url,
  status: row.status,
  origin: row.origin,
  user_id: row.user_id,
  user_email: row.user_email,
  order_id: row.order_id,
  order_number: row.order_number,
  order_commercial_status: row.order_commercial_status,
  order_payment_status: row.order_payment_status,
  quantity_stickers: row.quantity_stickers,
  reserved_until: row.reserved_until,
  printed_at: row.printed_at,
  dispatched_at: row.dispatched_at,
  delivered_at: row.delivered_at,
  created_at: row.created_at,
  updated_at: row.updated_at,
});

const listPackages = async ({ design, status, batch, origin, from, to, page, limit }) => {
  const where = [];
  const params = [];
  if (design) { where.push('p.design_id = ?'); params.push(design); }
  if (status) { where.push('p.status = ?'); params.push(status); }
  if (batch) { where.push('p.batch_id = ?'); params.push(batch); }
  if (origin) { where.push('p.origin = ?'); params.push(origin); }
  if (from) { where.push('p.created_at >= ?'); params.push(from); }
  if (to) { where.push('p.created_at <= ?'); params.push(to); }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const p = Math.max(1, parseInt(page, 10) || 1);
  const l = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const offset = (p - 1) * l;
  const rows = await db.query(
    `SELECT ${PACKAGE_FIELDS}
     FROM qr_inventory_packages p
     LEFT JOIN product_designs d ON d.id = p.design_id
     LEFT JOIN users u ON u.id = p.user_id
     LEFT JOIN orders o ON o.id = p.order_id
     LEFT JOIN qr_inventory_batches b ON b.id = p.batch_id
     ${whereSql}
     ORDER BY p.created_at DESC, p.id DESC
     LIMIT ? OFFSET ?`,
    params.concat([l, offset])
  );
  const [countRow] = await db.query(
    `SELECT COUNT(*) AS total FROM qr_inventory_packages p ${whereSql}`,
    params
  );
  return {
    packages: rows.map(mapPackageRow),
    pagination: { page: p, limit: l, total: countRow.total, pages: Math.ceil(countRow.total / l) },
  };
};

const getPackageDetail = async (packageId) => {
  const rows = await db.query(
    `SELECT ${PACKAGE_FIELDS}
     FROM qr_inventory_packages p
     LEFT JOIN product_designs d ON d.id = p.design_id
     LEFT JOIN users u ON u.id = p.user_id
     LEFT JOIN orders o ON o.id = p.order_id
     LEFT JOIN qr_inventory_batches b ON b.id = p.batch_id
     WHERE p.id = ?`,
    [packageId]
  );
  if (rows.length === 0) return null;
  const row = mapPackageRow(rows[0]);
  const logs = await db.query(
    `SELECT id, action, entity_type, entity_id, metadata, ip_address, created_at
     FROM audit_logs
     WHERE entity_type IN ('qr_inventory_packages', 'qr_inventory_batches', 'identifiers') AND entity_id = ?
     ORDER BY created_at DESC LIMIT 100`,
    [String(packageId)]
  );
  row.history = logs;
  return row;
};

const reservePackageForOrder = async (conn, designId, orderId, userId, ttlMinutes = RESERVATION_TTL_MINUTES) => {
  // Liberar reservas vencidas globalmente (ligero, fuera de bloqueo crítico largo).
  try { await releaseExpiredReservations(); } catch {}
  // Liberar reservas propias no pagadas de pedidos distintos al actual (evita acaparamiento en reintentos).
  await releaseUserUnpaidReservations(conn, userId, orderId);

  const [avail] = await conn.query(
    `SELECT id, value, public_url, design_id
     FROM qr_inventory_packages
     WHERE design_id = ?
       AND status = 'available'
       AND (reserved_until IS NULL OR reserved_until < NOW())
     ORDER BY id ASC
     LIMIT 1 FOR UPDATE SKIP LOCKED`,
    [designId]
  );
  if (avail.length === 0) return null;

  const pkg = avail[0];
  const [upd] = await conn.query(
    `UPDATE qr_inventory_packages
     SET status = 'reserved', reserved_until = DATE_ADD(NOW(), INTERVAL ? MINUTE), order_id = ?
     WHERE id = ? AND status = 'available'`,
    [ttlMinutes, orderId, pkg.id]
  );
  if (upd.affectedRows === 0) return null;

  await conn.query(
    `INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, metadata, ip_address)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      userId,
      'qr.package.reserve',
      'qr_inventory_packages',
      String(pkg.id),
      JSON.stringify({
        value: pkg.value,
        order_id: orderId,
        design_id: pkg.design_id,
        reserved_until: new Date(Date.now() + ttlMinutes * 60000).toISOString(),
      }),
      null,
    ]
  );

  return {
    id: pkg.id,
    package_code: null,
    value: pkg.value,
    public_url: pkg.public_url,
    design_id: pkg.design_id,
    status: 'reserved',
    order_id: orderId,
  };
};

const assignPackageToUser = async (userId, orderId, packageId, ipAddress = null) => {
  const conn = await db.getConnection();
  try {
    await conn.query('START TRANSACTION');

    const [pkgs] = await conn.query(
      'SELECT id, value, status, origin, order_id, user_id, design_id FROM qr_inventory_packages WHERE id = ? FOR UPDATE',
      [packageId]
    );
    if (pkgs.length === 0) {
      await conn.query('ROLLBACK');
      return { error: 'package_not_found', status: 404 };
    }
    const pkg = pkgs[0];
    if (pkg.origin !== 'inventory') {
      await conn.query('ROLLBACK');
      return { error: 'package_not_inventory', status: 400 };
    }
    if (!['available', 'reserved'].includes(pkg.status)) {
      await conn.query('ROLLBACK');
      return { error: 'package_not_available', status: 409 };
    }
    if (pkg.order_id && pkg.order_id !== orderId) {
      await conn.query('ROLLBACK');
      return { error: 'package_order_mismatch', status: 409 };
    }

    if (await hasBlockingQr(conn, userId)) {
      await conn.query('ROLLBACK');
      return { error: 'user_already_has_qr', status: 409 };
    }
    await retirePendingUnprintedIdentifier(conn, userId, ipAddress, 'asignacion_paquete_inventario_compra');

    const profile = await ensureProfile(conn, userId);
    const identifier = await createIdentifierRow(
      conn, userId, profile.id, orderId, pkg.value, pkg.id, ipAddress
    );

    await conn.query(
      `UPDATE qr_inventory_packages
       SET status = 'assigned', user_id = ?, order_id = ?, identifier_id = ?, updated_at = NOW()
       WHERE id = ?`,
      [userId, orderId, identifier.id, pkg.id]
    );

    await conn.query(
      `INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, metadata, ip_address)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        userId,
        'qr.package.assign',
        'qr_inventory_packages',
        String(pkg.id),
        JSON.stringify({
          value: pkg.value,
          user_id: userId,
          order_id: orderId,
          identifier_id: identifier.id,
          origin: 'inventory',
        }),
        ipAddress,
      ]
    );

    await conn.query('COMMIT');
    return { identifier, package: { ...pkg, status: 'assigned', user_id: userId, order_id: orderId, identifier_id: identifier.id } };
  } catch (error) {
    await conn.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    conn.release();
  }
};

const createOnDemandPackage = async (userId, orderId, designId, ipAddress = null) => {
  const conn = await db.getConnection();
  try {
    await conn.query('START TRANSACTION');

    if (await hasBlockingQr(conn, userId)) {
      await conn.query('ROLLBACK');
      return { error: 'user_already_has_qr', status: 409 };
    }
    await retirePendingUnprintedIdentifier(conn, userId, ipAddress, 'produccion_bajo_pedido_compra');

    const profile = await ensureProfile(conn, userId);
    const value = await generateUniqueIdentifierValue(conn);
    if (!value) {
      await conn.query('ROLLBACK');
      return { error: 'identifier_generation_failed', status: 500 };
    }
    const publicUrl = buildPublicUrl(value);
    const packageCode = `OND_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}_${generateIdentifierValue().slice(0, 8)}`;

    const identifier = await createIdentifierRow(
      conn, userId, profile.id, orderId, value, null, ipAddress
    );

    const [pkgResult] = await conn.query(
      `INSERT INTO qr_inventory_packages
       (package_code, batch_id, design_id, identifier_id, value, public_url, status, user_id, order_id, origin, quantity_stickers)
       VALUES (?, NULL, ?, ?, ?, ?, 'in_production', ?, ?, 'on_demand', 2)`,
      [packageCode, designId, identifier.id, value, publicUrl, userId, orderId]
    );

    await conn.query(
      `UPDATE orders SET package_id = ?, inventory_origin = 'on_demand' WHERE id = ?`,
      [pkgResult.insertId, orderId]
    );

    await conn.query(
      `INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, metadata, ip_address)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        userId,
        'qr.package.create.on_demand',
        'qr_inventory_packages',
        String(pkgResult.insertId),
        JSON.stringify({ value, public_url: publicUrl, design_id: designId, order_id: orderId }),
        ipAddress,
      ]
    );

    await conn.query('COMMIT');
    return {
      identifier,
      package: {
        id: pkgResult.insertId,
        package_code: packageCode,
        design_id: designId,
        value,
        public_url: publicUrl,
        status: 'in_production',
        origin: 'on_demand',
        user_id: userId,
        order_id: orderId,
        identifier_id: identifier.id,
        quantity_stickers: 2,
      },
    };
  } catch (error) {
    await conn.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    conn.release();
  }
};

const assignOrCreateForOrder = async (orderId, ipAddress = null) => {
  const conn = await db.getConnection();
  try {
    await conn.query('START TRANSACTION');
    const [orders] = await conn.query(
      `SELECT id, user_id, design_id, inventory_origin, package_id, payment_status, commercial_status
       FROM orders WHERE id = ? FOR UPDATE`,
      [orderId]
    );
    if (orders.length === 0) {
      await conn.query('ROLLBACK');
      return { error: 'order_not_found', status: 404 };
    }
    const order = orders[0];
    if (order.payment_status !== 'approved') {
      await conn.query('ROLLBACK');
      return { error: 'order_not_paid', status: 409 };
    }
    let result;
    if (order.package_id) {
      result = await assignPackageToUserTx(conn, order.user_id, orderId, order.package_id, ipAddress);
    } else {
      result = await createOnDemandPackageTx(conn, order.user_id, orderId, order.design_id, ipAddress);
    }
    await conn.query('COMMIT');
    return result;
  } catch (error) {
    await conn.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    conn.release();
  }
};

const assignPackageToUserTx = async (conn, userId, orderId, packageId, ipAddress) => {
  const [pkgs] = await conn.query(
    'SELECT id, value, status, origin, order_id FROM qr_inventory_packages WHERE id = ? FOR UPDATE',
    [packageId]
  );
  if (pkgs.length === 0) return { error: 'package_not_found', status: 404 };
  const pkg = pkgs[0];
  if (pkg.origin !== 'inventory') return { error: 'package_not_inventory', status: 400 };
  if (!['available', 'reserved', 'assigned'].includes(pkg.status)) {
    return { error: 'package_not_available', status: 409 };
  }
  if (pkg.order_id && pkg.order_id !== orderId) return { error: 'package_order_mismatch', status: 409 };
  if (pkg.status === 'assigned') {
    // Ya asignado: devolver el identificador existente (idempotente).
    const [idents] = await conn.query(
      'SELECT id, value, status, activation_at FROM identifiers WHERE package_id = ? AND user_id = ? LIMIT 1',
      [packageId, userId]
    );
    if (idents.length > 0) {
      return { identifier: idents[0], package: pkg, already: true };
    }
    return { error: 'package_assigned_elsewhere', status: 409 };
  }

  if (await hasBlockingQr(conn, userId)) {
    return { error: 'user_already_has_qr', status: 409 };
  }
  await retirePendingUnprintedIdentifier(conn, userId, ipAddress, 'asignacion_paquete_inventario_compra');

  const profile = await ensureProfile(conn, userId);
  const identifier = await createIdentifierRow(
    conn, userId, profile.id, orderId, pkg.value, pkg.id, ipAddress
  );

  await conn.query(
    `UPDATE qr_inventory_packages
     SET status = 'assigned', user_id = ?, order_id = ?, identifier_id = ?, updated_at = NOW()
     WHERE id = ?`,
    [userId, orderId, identifier.id, pkg.id]
  );

  await conn.query(
    `INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, metadata, ip_address)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      userId,
      'qr.package.assign',
      'qr_inventory_packages',
      String(pkg.id),
      JSON.stringify({ value: pkg.value, user_id: userId, order_id: orderId, identifier_id: identifier.id, origin: 'inventory' }),
      ipAddress,
    ]
  );

  return { identifier, package: { ...pkg, status: 'assigned', user_id: userId, order_id: orderId, identifier_id: identifier.id } };
};

const createOnDemandPackageTx = async (conn, userId, orderId, designId, ipAddress) => {
  if (await hasBlockingQr(conn, userId)) {
    return { error: 'user_already_has_qr', status: 409 };
  }
  await retirePendingUnprintedIdentifier(conn, userId, ipAddress, 'produccion_bajo_pedido_compra');

  const profile = await ensureProfile(conn, userId);
  const value = await generateUniqueIdentifierValue(conn);
  if (!value) {
    return { error: 'identifier_generation_failed', status: 500 };
  }
  const publicUrl = buildPublicUrl(value);
  const packageCode = `OND_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}_${generateIdentifierValue().slice(0, 8)}`;

  const identifier = await createIdentifierRow(
    conn, userId, profile.id, orderId, value, null, ipAddress
  );

  const [pkgResult] = await conn.query(
    `INSERT INTO qr_inventory_packages
     (package_code, batch_id, design_id, identifier_id, value, public_url, status, user_id, order_id, origin, quantity_stickers)
     VALUES (?, NULL, ?, ?, ?, ?, 'in_production', ?, ?, 'on_demand', 2)`,
    [packageCode, designId, identifier.id, value, publicUrl, userId, orderId]
  );

  await conn.query(
    `UPDATE orders SET package_id = ?, inventory_origin = 'on_demand' WHERE id = ?`,
    [pkgResult.insertId, orderId]
  );

  await conn.query(
    `INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, metadata, ip_address)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      userId,
      'qr.package.create.on_demand',
      'qr_inventory_packages',
      String(pkgResult.insertId),
      JSON.stringify({ value, public_url: publicUrl, design_id: designId, order_id: orderId }),
      ipAddress,
    ]
  );

  return {
    identifier,
    package: {
      id: pkgResult.insertId,
      package_code: packageCode,
      design_id: designId,
      value,
      public_url: publicUrl,
      status: 'in_production',
      origin: 'on_demand',
      user_id: userId,
      order_id: orderId,
      identifier_id: identifier.id,
      quantity_stickers: 2,
    },
  };
};

const createBatch = async ({ designId, quantity, createdBy, notes, ipAddress = null }) => {
  const conn = await db.getConnection();
  try {
    await conn.query('START TRANSACTION');

    const [designs] = await conn.query(
      'SELECT id, name, is_available FROM product_designs WHERE id = ? LIMIT 1',
      [designId]
    );
    if (designs.length === 0) {
      await conn.query('ROLLBACK');
      return { error: 'design_not_found', status: 404 };
    }
    if (designs[0].is_available !== 1) {
      await conn.query('ROLLBACK');
      return { error: 'design_not_available', status: 400 };
    }

    const qty = Math.max(1, parseInt(quantity, 10) || 1);
    const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const batchCode = `LOTE_${datePart}_${generateIdentifierValue().slice(0, 6)}`;

    const [batchResult] = await conn.query(
      `INSERT INTO qr_inventory_batches
       (batch_code, design_id, quantity_requested, quantity_confirmed, status, created_by, notes)
       VALUES (?, ?, ?, 0, 'pending_print', ?, ?)`,
      [batchCode, designId, qty, createdBy, notes || null]
    );

    const packages = [];
    for (let i = 1; i <= qty; i++) {
      const value = await generateUniqueValue(conn);
      if (!value) {
        await conn.query('ROLLBACK');
        return { error: 'identifier_generation_failed', status: 500 };
      }
      const publicUrl = buildPublicUrl(value);
      const packageCode = `PKG_${batchCode}_${String(i).padStart(4, '0')}`;
      await conn.query(
        `INSERT INTO qr_inventory_packages
         (package_code, batch_id, design_id, value, public_url, status, origin, quantity_stickers)
         VALUES (?, ?, ?, ?, ?, 'in_production', 'inventory', 2)`,
        [packageCode, batchResult.insertId, designId, value, publicUrl]
      );
      packages.push({ package_code: packageCode, value, public_url: publicUrl });
    }

    await conn.query(
      `INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, metadata, ip_address)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        createdBy,
        'qr.batch.create',
        'qr_inventory_batches',
        String(batchResult.insertId),
        JSON.stringify({ batch_code: batchCode, design_id: designId, quantity: qty, notes }),
        ipAddress,
      ]
    );

    await conn.query('COMMIT');
    return {
      batch: {
        id: batchResult.insertId,
        batch_code: batchCode,
        design_id: designId,
        design: { id: designs[0].id, name: designs[0].name },
        quantity_requested: qty,
        quantity_confirmed: 0,
        status: 'pending_print',
        origin: 'inventory',
        packages,
      },
    };
  } catch (error) {
    await conn.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    conn.release();
  }
};

const markBatchPrinted = async (batchId, actorId, ipAddress = null) => {
  const conn = await db.getConnection();
  try {
    await conn.query('START TRANSACTION');
    const [batches] = await conn.query(
      'SELECT id, status FROM qr_inventory_batches WHERE id = ? FOR UPDATE',
      [batchId]
    );
    if (batches.length === 0) {
      await conn.query('ROLLBACK');
      return { error: 'batch_not_found', status: 404 };
    }
    if (batches[0].status !== 'pending_print') {
      await conn.query('ROLLBACK');
      return { error: 'batch_not_pending_print', status: 409 };
    }
    await conn.query(
      'UPDATE qr_inventory_batches SET status = ?, updated_at = NOW() WHERE id = ?',
      ['printed', batchId]
    );
    await conn.query(
      `UPDATE qr_inventory_packages
       SET status = 'printed', printed_at = NOW(), updated_at = NOW()
       WHERE batch_id = ? AND status IN ('in_production', 'available')`,
      [batchId]
    );
    await conn.query(
      `INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, metadata, ip_address)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [actorId, 'qr.batch.printed', 'qr_inventory_batches', String(batchId), JSON.stringify({}), ipAddress]
    );
    await conn.query('COMMIT');
    return { batch_id: batchId, status: 'printed' };
  } catch (error) {
    await conn.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    conn.release();
  }
};

const markBatchReceived = async (batchId, quantityConfirmed, actorId, ipAddress = null) => {
  const conn = await db.getConnection();
  try {
    await conn.query('START TRANSACTION');
    const [batches] = await conn.query(
      'SELECT id, status, quantity_requested FROM qr_inventory_batches WHERE id = ? FOR UPDATE',
      [batchId]
    );
    if (batches.length === 0) {
      await conn.query('ROLLBACK');
      return { error: 'batch_not_found', status: 404 };
    }
    if (batches[0].status !== 'printed') {
      await conn.query('ROLLBACK');
      return { error: 'batch_not_printed', status: 409 };
    }
    const qty = Math.max(0, parseInt(quantityConfirmed, 10) || 0);
    await conn.query(
      'UPDATE qr_inventory_batches SET status = ?, quantity_confirmed = ?, confirmed_at = NOW(), updated_at = NOW() WHERE id = ?',
      ['confirmed_received', qty, batchId]
    );
    await conn.query(
      `UPDATE qr_inventory_packages
       SET status = 'available', updated_at = NOW()
       WHERE batch_id = ? AND status = 'printed'`,
      [batchId]
    );
    await conn.query(
      `INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, metadata, ip_address)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        actorId, 'qr.batch.received', 'qr_inventory_batches', String(batchId),
        JSON.stringify({ quantity_confirmed: qty }), ipAddress
      ]
    );
    await conn.query('COMMIT');
    return { batch_id: batchId, status: 'confirmed_received', quantity_confirmed: qty };
  } catch (error) {
    await conn.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    conn.release();
  }
};

const markBatchCancelled = async (batchId, actorId, ipAddress = null) => {
  const conn = await db.getConnection();
  try {
    await conn.query('START TRANSACTION');
    const [batches] = await conn.query(
      'SELECT id, status FROM qr_inventory_batches WHERE id = ? FOR UPDATE',
      [batchId]
    );
    if (batches.length === 0) {
      await conn.query('ROLLBACK');
      return { error: 'batch_not_found', status: 404 };
    }
    if (!['pending_generation', 'generated', 'pending_print'].includes(batches[0].status)) {
      await conn.query('ROLLBACK');
      return { error: 'batch_not_cancellable', status: 409 };
    }
    await conn.query(
      'UPDATE qr_inventory_batches SET status = ?, updated_at = NOW() WHERE id = ?',
      ['cancelled', batchId]
    );
    await conn.query(
      `UPDATE qr_inventory_packages
       SET status = 'cancelled', updated_at = NOW()
       WHERE batch_id = ? AND status IN ('in_production', 'available', 'reserved') AND user_id IS NULL`,
      [batchId]
    );
    await conn.query(
      `INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, metadata, ip_address)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [actorId, 'qr.batch.cancelled', 'qr_inventory_batches', String(batchId), JSON.stringify({}), ipAddress]
    );
    await conn.query('COMMIT');
    return { batch_id: batchId, status: 'cancelled' };
  } catch (error) {
    await conn.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    conn.release();
  }
};

const setPackageStatus = async (packageId, status, actorId, ipAddress = null) => {
  if (!PACKAGE_STATUSES.includes(status)) {
    return { error: 'invalid_package_status', status: 400 };
  }
  const conn = await db.getConnection();
  try {
    await conn.query('START TRANSACTION');
    const [pkgs] = await conn.query(
      'SELECT id, status, user_id, order_id, origin FROM qr_inventory_packages WHERE id = ? FOR UPDATE',
      [packageId]
    );
    if (pkgs.length === 0) {
      await conn.query('ROLLBACK');
      return { error: 'package_not_found', status: 404 };
    }
    const pkg = pkgs[0];
    const now = new Date();
    const updates = { status, updated_at: now };
    if (status === 'printed') updates.printed_at = now;
    if (status === 'dispatched') updates.dispatched_at = now;
    if (status === 'delivered') updates.delivered_at = now;

    const fields = Object.keys(updates).map((k) => `${k} = ?`).join(', ');
    const values = Object.values(updates);
    await conn.query(`UPDATE qr_inventory_packages SET ${fields} WHERE id = ?`, [...values, packageId]);

    await conn.query(
      `INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, metadata, ip_address)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        actorId, `qr.package.status_${status}`, 'qr_inventory_packages', String(packageId),
        JSON.stringify({ previous_status: pkg.status, new_status: status }), ipAddress
      ]
    );
    await conn.query('COMMIT');
    return { package_id: packageId, status, previous_status: pkg.status };
  } catch (error) {
    await conn.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    conn.release();
  }
};

const getUserQr = async (userId) => {
  const rows = await db.query(
    `SELECT i.id, i.value, i.status, i.activation_at, i.print_status, i.package_id, i.order_id, i.created_at,
            p.package_code, p.public_url, p.origin, p.status AS package_status, d.name AS design_name
     FROM identifiers i
     LEFT JOIN qr_inventory_packages p ON p.id = i.package_id
     LEFT JOIN product_designs d ON d.id = p.design_id
     WHERE i.user_id = ?
     ORDER BY i.created_at DESC LIMIT 1`,
    [userId]
  );
  return rows[0] || null;
};

const listPackagesForExport = async (filters = {}) => {
  const { design, origin, batch, status, order_id } = filters;
  const where = [];
  const params = [];
  if (design) { where.push('p.design_id = ?'); params.push(design); }
  if (origin) { where.push('p.origin = ?'); params.push(origin); }
  if (batch) { where.push('p.batch_id = ?'); params.push(batch); }
  if (status) { where.push('p.status = ?'); params.push(status); }
  if (order_id) { where.push('p.order_id = ?'); params.push(order_id); }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const rows = await db.query(
    `SELECT p.id, p.package_code, p.value, p.public_url, p.status, p.origin, p.quantity_stickers,
            p.batch_id, b.batch_code AS batch_code, p.order_id, o.order_number,
            d.id AS design_id, d.name AS design_name, d.slug AS design_slug
     FROM qr_inventory_packages p
     LEFT JOIN qr_inventory_batches b ON b.id = p.batch_id
     LEFT JOIN orders o ON o.id = p.order_id
     LEFT JOIN product_designs d ON d.id = p.design_id
     ${whereSql}
     ORDER BY p.created_at DESC, p.id ASC`,
    params
  );
  return rows;
};

const getDashboardStats = async () => {
  const packageStats = await db.query(
    `SELECT status AS status, COUNT(*) AS total FROM qr_inventory_packages GROUP BY status`
  );
  const originStats = await db.query(
    `SELECT origin AS origin, COUNT(*) AS total FROM qr_inventory_packages GROUP BY origin`
  );
  const batchStats = await db.query(
    `SELECT status AS status, COUNT(*) AS batches FROM qr_inventory_batches GROUP BY status`
  );
  const activeIds = await db.query("SELECT COUNT(*) AS total FROM identifiers WHERE status = 'active'");
  const pendingIds = await db.query("SELECT COUNT(*) AS total FROM identifiers WHERE status = 'pending_activation'");
  const byDesign = await db.query(
    `SELECT d.id AS design_id, d.name AS design_name, p.status, COUNT(*) AS total
     FROM qr_inventory_packages p
     JOIN product_designs d ON d.id = p.design_id
     GROUP BY d.id, d.name, p.status
     ORDER BY d.sort_order, d.id`
  );
  return {
    packages: packageStats.reduce((acc, r) => { acc[r.status] = Number(r.total); return acc; }, {}),
    origins: originStats.reduce((acc, r) => { acc[r.origin] = Number(r.total); return acc; }, {}),
    batches: batchStats.reduce((acc, r) => { acc[r.status] = Number(r.batches); return acc; }, {}),
    identifiers: { active: Number(activeIds[0].total), pending_activation: Number(pendingIds[0].total) },
    by_design: byDesign,
  };
};

module.exports = {
  RESERVATION_TTL_MINUTES,
  releaseExpiredReservations,
  releaseUserUnpaidReservations,
  listPackages,
  getPackageDetail,
  reservePackageForOrder,
  assignPackageToUser,
  createOnDemandPackage,
  assignOrCreateForOrder,
  createBatch,
  markBatchPrinted,
  markBatchReceived,
  markBatchCancelled,
  setPackageStatus,
  getUserQr,
  listPackagesForExport,
  getDashboardStats,
  hasBlockingQr,
  generateIdentifierValue,
  buildPublicUrl,
};
