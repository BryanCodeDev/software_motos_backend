const db = require('../../config/db');
const { hashPassword } = require('../../utils/crypto');
const { activateQr, buildPublicUrl } = require('../identifiers/identifier.service');

const isAdmin = async (userId) => {
  const rows = await db.query('SELECT role FROM users WHERE id = ?', [userId]);
  return rows[0] && rows[0].role === 'admin';
};

const adminExists = async () => {
  const rows = await db.query("SELECT id FROM users WHERE role = 'admin' LIMIT 1");
  return rows.length > 0;
};

const listUsers = async (req, res) => {
  const { q, role, page = '1', limit = '20', print_status } = req.query;
  const p = Math.max(1, parseInt(page, 10) || 1);
  const l = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const offset = (p - 1) * l;

  const run = async (usePrintFilter) => {
    const where = [];
    const params = [];
    if (q) {
      where.push('(u.email LIKE ? OR u.id = ?)');
      params.push('%' + q + '%', q);
    }
    if (role && ['user', 'admin'].includes(role)) {
      where.push('u.role = ?');
      params.push(role);
    }
    if (usePrintFilter && print_status && ['pending_print', 'sent_to_print', 'printed', 'delivered'].includes(print_status)) {
      where.push('i.print_status = ?');
      params.push(print_status);
    }
    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const printCol = usePrintFilter ? 'i.print_status AS qr_print_status,' : '';
    const rows = await db.query(
      `SELECT u.id, u.email, u.role, u.created_at, u.updated_at,
              i.id AS qr_id, i.value AS qr_value, i.status AS qr_status,
              i.activation_at AS qr_activation_at, i.created_at AS qr_created_at,
              ${printCol} NULL AS qr_print_status
       FROM users u
       LEFT JOIN identifiers i ON i.user_id = u.id AND i.status IN ('pending_activation', 'active')
       ${whereSql}
       ORDER BY u.created_at DESC LIMIT ? OFFSET ?`,
      params.concat([l, offset])
    );
    const countRows = await db.query(
      `SELECT COUNT(DISTINCT u.id) AS total FROM users u ${whereSql}`,
      params
    );
    return { users: rows, total: countRows[0].total };
  };

  let result;
  try {
    result = await run(true);
  } catch (err) {
    const isUnknownCol = err && (err.code === 'ER_BAD_FIELD_ERROR' || err.errno === 1054 || /Unknown column/.test(String(err.message || '')));
    if (!isUnknownCol || !print_status) {throw err;}
    // BD sin columna print_status: reintentar sin filtro ni columna de impresión
    result = await run(false);
  }

  const { users, total } = result;
  return res.json({ users, pagination: { page: p, limit: l, total, pages: Math.ceil(total / l) } });
};

const getUser = async (req, res) => {
  const { id } = req.params;
  const rows = await db.query('SELECT id, email, role, created_at, updated_at FROM users WHERE id = ?', [id]);
  if (rows.length === 0) {
    return res.status(404).json({ error: 'Usuario no encontrado' });
  }
  const u = rows[0];
  const orderCountRows = await db.query('SELECT COUNT(*) AS c FROM orders WHERE user_id = ?', [id]);
  const profileRows = await db.query('SELECT id, is_active FROM emergency_profiles WHERE user_id = ?', [id]);
  const qrRows = await db.query(
    'SELECT id, value, status, activation_at, print_status, created_at, updated_at FROM identifiers WHERE user_id = ? ORDER BY created_at DESC LIMIT 1',
    [id]
  );
  const qr = qrRows[0]
    ? { ...qrRows[0], qr_url: buildPublicUrl(qrRows[0].value) }
    : null;
  return res.json({ user: { ...u, orders_count: orderCountRows[0].c, has_profile: profileRows.length > 0, qr } });
};

const ADMIN_LEVEL_ROLES = ['admin', 'superadmin'];

const updateUserRole = async (req, res) => {
  const { id } = req.params;
  const { role } = req.body;
  if (!['user', 'admin', 'operator', 'superadmin'].includes(role)) {
    return res.status(400).json({ error: 'Rol invalido' });
  }
  if (Number(id) === req.user.id) {
    return res.status(400).json({ error: 'No puedes cambiar tu propio rol' });
  }
  const rows = await db.query('SELECT id, email, role FROM users WHERE id = ?', [id]);
  if (rows.length === 0) {
    return res.status(404).json({ error: 'Usuario no encontrado' });
  }
  const target = rows[0];
  const from = target.role;
  if (from === role) {
    return res.json({ message: 'Rol actualizado', role });
  }
  // No degradar al último usuario con nivel de administración.
  if (ADMIN_LEVEL_ROLES.includes(from) && !ADMIN_LEVEL_ROLES.includes(role)) {
    const admins = await db.query(
      "SELECT COUNT(*) AS c FROM users WHERE role IN ('admin', 'superadmin')"
    );
    if (Number(admins[0].c) <= 1) {
      return res.status(400).json({ error: 'No se puede retirar el último administrador' });
    }
  }
  await db.query('UPDATE users SET role = ? WHERE id = ?', [role, id]);
  await db.query(
    'INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, metadata, ip_address) VALUES (?, ?, ?, ?, ?, ?)',
    [req.user.id, 'admin.user.role_change', 'users', String(id), JSON.stringify({ from, to: role }), req.ip]
  );
  return res.json({ message: 'Rol actualizado', role });
};

const suspendUser = async (req, res) => {
  const { id } = req.params;
  const { reason } = req.body || {};
  if (Number(id) === req.user.id) {
    return res.status(400).json({ error: 'No puedes suspender tu propia cuenta' });
  }
  const rows = await db.query('SELECT id, email, role, suspended_at FROM users WHERE id = ?', [id]);
  if (rows.length === 0) {
    return res.status(404).json({ error: 'Usuario no encontrado' });
  }
  const target = rows[0];
  if (target.suspended_at) {
    return res.status(400).json({ error: 'El usuario ya está suspendido' });
  }
  // No suspender al último administrador.
  if (ADMIN_LEVEL_ROLES.includes(target.role)) {
    const admins = await db.query(
      "SELECT COUNT(*) AS c FROM users WHERE role IN ('admin', 'superadmin') AND suspended_at IS NULL"
    );
    if (Number(admins[0].c) <= 1) {
      return res.status(400).json({ error: 'No se puede suspender al último administrador' });
    }
  }
  await db.query(
    'UPDATE users SET suspended_at = NOW(), suspended_by = ?, suspended_reason = ? WHERE id = ?',
    [req.user.id, reason || null, id]
  );
  await db.query(
    'INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, metadata, ip_address) VALUES (?, ?, ?, ?, ?, ?)',
    [req.user.id, 'admin.user.suspend', 'users', String(id), JSON.stringify({ reason }), req.ip]
  );
  return res.json({ message: 'Cuenta suspendida' });
};

const reactivateUser = async (req, res) => {
  const { id } = req.params;
  const rows = await db.query('SELECT id, suspended_at FROM users WHERE id = ?', [id]);
  if (rows.length === 0) {
    return res.status(404).json({ error: 'Usuario no encontrado' });
  }
  if (!rows[0].suspended_at) {
    return res.status(400).json({ error: 'El usuario no está suspendido' });
  }
  await db.query(
    'UPDATE users SET suspended_at = NULL, suspended_by = NULL, suspended_reason = NULL WHERE id = ?',
    [id]
  );
  await db.query(
    'INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, metadata, ip_address) VALUES (?, ?, ?, ?, ?, ?)',
    [req.user.id, 'admin.user.reactivate', 'users', String(id), JSON.stringify({}), req.ip]
  );
  return res.json({ message: 'Cuenta reactivada' });
};

const verifyUser = async (req, res) => {
  return res.status(404).json({ error: 'Endpoint no disponible' });
};

const dashboardStats = async (req, res) => {
  const usersRows = await db.query('SELECT COUNT(*) AS users FROM users');
  const users = usersRows[0].users;
  const profilesRows = await db.query('SELECT COUNT(*) AS profiles FROM emergency_profiles');
  const profiles = profilesRows[0].profiles;
  const activeProfilesRows = await db.query(
    'SELECT COUNT(*) AS activeProfiles FROM emergency_profiles WHERE is_active = 1'
  );
  const activeProfiles = activeProfilesRows[0].activeProfiles;
  const activeIdsRows = await db.query(
    "SELECT COUNT(*) AS activeIds FROM identifiers WHERE status = 'active'"
  );
  const activeIds = activeIdsRows[0].activeIds;
  const deactivatedIdsRows = await db.query(
    "SELECT COUNT(*) AS deactivatedIds FROM identifiers WHERE status = 'deactivated'"
  );
  const deactivatedIds = deactivatedIdsRows[0].deactivatedIds;
  const pendingOrdersRows = await db.query(
    "SELECT COUNT(*) AS pendingOrders FROM orders WHERE commercial_status IN ('pending_confirmation', 'pending_payment')"
  );
  const pendingOrders = pendingOrdersRows[0].pendingOrders;
  const paidOrdersRows = await db.query(
    "SELECT COUNT(*) AS paidOrders FROM orders WHERE commercial_status = 'paid'"
  );
  const paidOrders = paidOrdersRows[0].paidOrders;
  const deliveringOrdersRows = await db.query(
    "SELECT COUNT(*) AS deliveringOrders FROM orders WHERE commercial_status IN ('preparing', 'shipped')"
  );
  const deliveringOrders = deliveringOrdersRows[0].deliveringOrders;
  const recentOrdersRows = await db.query(
    'SELECT COUNT(*) AS recentOrders FROM orders WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)'
  );
  const recentOrders = recentOrdersRows[0].recentOrders;

  return res.json({
    users,
    profiles,
    activeProfiles,
    identifiers: { active: activeIds, deactivated: deactivatedIds },
    orders: {
      pending: pendingOrders,
      paid: paidOrders,
      delivering: deliveringOrders,
      recent: recentOrders,
    },
  });
};

/* ───────── Umbrales centralizados de alertas operativas ───────── */
const ALERT_THRESHOLDS = {
  daysUntilProduction: 3,   // pagado sin entrar a producción
  daysPendingPayment: 3,    // pago pendiente tiempo anormal
  daysStuckStatus: 5,       // detenido en un estado
};

const dashboardAlerts = async (_req, res) => {
  const threeDaysAgo = new Date(Date.now() - ALERT_THRESHOLDS.daysUntilProduction * 24 * 60 * 60 * 1000)
    .toISOString().slice(0, 19).replace('T', ' ');
  const pendingDaysAgo = new Date(Date.now() - ALERT_THRESHOLDS.daysPendingPayment * 24 * 60 * 60 * 1000)
    .toISOString().slice(0, 19).replace('T', ' ');
  const stuckDaysAgo = new Date(Date.now() - ALERT_THRESHOLDS.daysStuckStatus * 24 * 60 * 60 * 1000)
    .toISOString().slice(0, 19).replace('T', ' ');

  const terminal = "'delivered','cancelled','refunded'";

  // 1. Pagados hace más de N días que no entraron en producción.
  const paidNoProd = await db.query(
    `SELECT COUNT(*) AS total, MIN(created_at) AS oldest
     FROM orders
     WHERE payment_status = 'approved'
       AND commercial_status = 'paid'
       AND created_at <= ?`,
    [threeDaysAgo]
  );

  // 2. Pagos pendientes durante tiempo anormalmente largo.
  const pendingLong = await db.query(
    `SELECT COUNT(*) AS total, MIN(created_at) AS oldest
     FROM orders
     WHERE payment_status = 'pending'
       AND created_at <= ?`,
    [pendingDaysAgo]
  );

  // 3. Pagados sin QR asociado.
  const paidNoQr = await db.query(
    `SELECT COUNT(*) AS total, MIN(o.created_at) AS oldest
     FROM orders o
     LEFT JOIN identifiers i ON i.order_id = o.id
     WHERE o.payment_status = 'approved'
       AND o.commercial_status = 'paid'
       AND i.id IS NULL`,
    []
  );

  // 4. Enviados sin número de guía.
  const shippedNoGuide = await db.query(
    `SELECT COUNT(*) AS total, MIN(o.created_at) AS oldest
     FROM orders o
     WHERE o.commercial_status = 'shipped'
       AND (o.tracking_number IS NULL OR o.tracking_number = '')`,
    []
  );

  // 5. Detenidos en un estado no terminal durante demasiado tiempo.
  const stuck = await db.query(
    `SELECT COUNT(*) AS total, MIN(o.updated_at) AS oldest
     FROM orders o
     WHERE o.commercial_status NOT IN (${terminal})
       AND o.updated_at <= ?`,
    [stuckDaysAgo]
  );

  // 6. Errores de notificaciones recientes.
  const emailErrors = await db.query(
    `SELECT COUNT(*) AS total, MAX(created_at) AS latest
     FROM email_log
     WHERE status = 'failed'
       AND created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)`,
    []
  );

  const alerts = [
    {
      id: 'paid_no_production',
      title: 'Pedidos pagados sin entrar a producción',
      description: `Pagados hace más de ${ALERT_THRESHOLDS.daysUntilProduction} días que aún no pasaron a preparación.`,
      count: Number(paidNoProd[0].total),
      oldest: paidNoProd[0].oldest,
      thresholdDays: ALERT_THRESHOLDS.daysUntilProduction,
      link: '/admin/orders?status=paid',
      severity: paidNoProd[0].total > 0 ? 'high' : 'none',
    },
    {
      id: 'pending_payment_long',
      title: 'Pagos pendientes por tiempo prolongado',
      description: `Pagos con estado pendiente desde hace más de ${ALERT_THRESHOLDS.daysPendingPayment} días.`,
      count: Number(pendingLong[0].total),
      oldest: pendingLong[0].oldest,
      thresholdDays: ALERT_THRESHOLDS.daysPendingPayment,
      link: '/admin/orders?payment_status=pending',
      severity: pendingLong[0].total > 0 ? 'high' : 'none',
    },
    {
      id: 'paid_no_qr',
      title: 'Pedidos pagados sin QR asociado',
      description: 'Pagos aprobados que todavía no tienen un identificador QR vinculado.',
      count: Number(paidNoQr[0].total),
      oldest: paidNoQr[0].oldest,
      link: '/admin/orders?status=paid',
      severity: paidNoQr[0].total > 0 ? 'high' : 'none',
    },
    {
      id: 'shipped_no_guide',
      title: 'Pedidos enviados sin guía',
      description: 'Pedidos en estado enviado sin número de guía ni transportadora registrada.',
      count: Number(shippedNoGuide[0].total),
      oldest: shippedNoGuide[0].oldest,
      link: '/admin/orders?status=shipped',
      severity: shippedNoGuide[0].total > 0 ? 'high' : 'none',
    },
    {
      id: 'stuck_status',
      title: 'Pedidos detenidos en un estado',
      description: `Pedidos sin moverse desde hace más de ${ALERT_THRESHOLDS.daysStuckStatus} días.`,
      count: Number(stuck[0].total),
      oldest: stuck[0].oldest,
      thresholdDays: ALERT_THRESHOLDS.daysStuckStatus,
      link: '/admin/orders',
      severity: stuck[0].total > 0 ? 'medium' : 'none',
    },
    {
      id: 'email_errors',
      title: 'Errores de notificaciones por correo',
      description: 'Correos transaccionales que fallaron al enviarse en los últimos 7 días.',
      count: Number(emailErrors[0].total),
      latest: emailErrors[0].latest,
      link: '/admin/audit',
      severity: emailErrors[0].total > 0 ? 'medium' : 'none',
    },
  ];

  return res.json({ alerts, thresholds: ALERT_THRESHOLDS });
};

const PAYMENT_STATUSES = ['approved', 'pending', 'rejected', 'refunded'];

const listPayments = async (req, res) => {
  const { q, status, dateFrom, dateTo, page = '1', limit = '25' } = req.query;
  const p = Math.max(1, parseInt(page, 10) || 1);
  const l = Math.min(100, Math.max(1, parseInt(limit, 10) || 25));
  const offset = (p - 1) * l;

  const where = [];
  const params = [];
  if (q) {
    where.push('(o.order_number LIKE ? OR u.email LIKE ? OR o.mercado_pago_payment_id LIKE ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (status && PAYMENT_STATUSES.includes(status)) {
    where.push('AND o.payment_status = ?');
    params.push(status);
  }
  if (dateFrom) {
    where.push('AND o.created_at >= ?');
    params.push(dateFrom);
  }
  if (dateTo) {
    where.push('AND o.created_at <= ?');
    params.push(dateTo);
  }
  const whereSql = where.length ? 'WHERE ' + where.join(' ') : '';

  const rows = await db.query(
    `SELECT o.id, o.order_number, o.total_amount, o.currency, o.payment_status, o.commercial_status,
            o.mercado_pago_preference_id, o.mercado_pago_payment_id, o.created_at,
            u.id AS user_id, u.email AS customer_email,
            pe.type AS last_event_type, pe.status AS last_event_status, pe.mp_payment_id AS last_event_mp_id,
            pe.created_at AS last_event_at
     FROM orders o
     JOIN users u ON o.user_id = u.id
     LEFT JOIN (
       SELECT pe1.* FROM payment_events pe1
       JOIN (
         SELECT order_id, MAX(created_at) AS max_created FROM payment_events GROUP BY order_id
       ) pe2 ON pe1.order_id = pe2.order_id AND pe1.created_at = pe2.max_created
     ) pe ON pe.order_id = o.id
     ${whereSql}
     ORDER BY o.created_at DESC
     LIMIT ? OFFSET ?`,
    params.concat([l, offset])
  );
  const [countRow] = await db.query(
    `SELECT COUNT(*) AS total FROM orders o JOIN users u ON o.user_id = u.id ${whereSql}`,
    params
  );

  // Indicadores de conciliación.
  const reconciliationRows = await db.query(
    `SELECT
       SUM(CASE WHEN o.payment_status = 'approved' THEN 1 ELSE 0 END) AS approved,
       SUM(CASE WHEN o.payment_status = 'pending' THEN 1 ELSE 0 END) AS pending,
       SUM(CASE WHEN o.payment_status = 'rejected' THEN 1 ELSE 0 END) AS rejected,
       SUM(CASE WHEN o.commercial_status = 'paid' AND o.payment_status != 'approved' THEN 1 ELSE 0 END) AS unreconciled_paid,
       SUM(CASE WHEN o.payment_status = 'approved' AND o.mercado_pago_payment_id IS NULL THEN 1 ELSE 0 END) AS approved_no_external_ref
     FROM orders o`
  );
  const reconciliation = reconciliationRows[0];

  return res.json({
    payments: rows,
    pagination: { page, limit: l, total: countRow.total, pages: Math.ceil(countRow.total / l) },
    reconciliation: {
      approved: Number(reconciliation.approved || 0),
      pending: Number(reconciliation.pending || 0),
      rejected: Number(reconciliation.rejected || 0),
      unreconciled_paid: Number(reconciliation.unreconciled_paid || 0),
      approved_no_external_ref: Number(reconciliation.approved_no_external_ref || 0),
    },
  });
};

const scanMetrics = async (req, res) => {
  const { dateFrom, dateTo } = req.query;
  const where = [];
  const params = [];
  if (dateFrom) { where.push('scanned_at >= ?'); params.push(dateFrom); }
  if (dateTo) { where.push('scanned_at <= ?'); params.push(dateTo); }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';

  const totalRow = await db.query(`SELECT COUNT(*) AS total FROM qr_scans ${whereSql}`, params);
  const lastRow = await db.query(`SELECT MAX(scanned_at) AS last_scan FROM qr_scans ${whereSql}`, params);
  const byResult = await db.query(`SELECT result, COUNT(*) AS total FROM qr_scans ${whereSql} GROUP BY result`, params);
  const byQr = await db.query(
    `SELECT identifier_value, COUNT(*) AS total, MAX(scanned_at) AS last_scan
     FROM qr_scans ${whereSql}
     GROUP BY identifier_value
     ORDER BY total DESC, last_scan DESC
     LIMIT 10`,
    params
  );

  return res.json({
    total: Number((totalRow[0] && totalRow[0].total) || 0),
    last_scan: (lastRow[0] && lastRow[0].last_scan) || null,
    by_result: byResult.reduce((acc, r) => { acc[r.result] = Number(r.total); return acc; }, {}),
    top_qrs: byQr.map((r) => ({ identifier: r.identifier_value, scans: Number(r.total), last_scan: r.last_scan })),
  });
};

/*
 * Listado administrativo de todos los perfiles (todas las cuentas).
 * Incluye conteo de QR asociados y pedidos.
 */
const listAllProfiles = async (req, res) => {
  const { q, profile_type, is_active, page = '1', limit = '50' } = req.query;
  const p = Math.max(1, parseInt(page, 10) || 1);
  const l = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
  const offset = (p - 1) * l;

  const where = [];
  const params = [];
  if (q) {
    where.push('(ep.display_name LIKE ? OR u.email LIKE ?)');
    params.push(`%${q}%`, `%${q}%`);
  }
  if (profile_type && ['person', 'pet', 'managed_person'].includes(profile_type)) {
    where.push('ep.profile_type = ?');
    params.push(profile_type);
  }
  if (is_active !== undefined) {
    where.push('ep.is_active = ?');
    params.push(is_active === 'true' || is_active === true ? 1 : 0);
  }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';

  const rows = await db.query(
    `SELECT ep.id, ep.user_id, ep.profile_type, ep.relationship, ep.display_name, ep.photo_url,
            ep.is_active, ep.pet_species, ep.pet_breed, ep.pet_lost, ep.created_at,
            u.email AS owner_email, u.role AS owner_role,
            (SELECT COUNT(*) FROM identifiers i WHERE i.profile_id = ep.id AND i.status IN ('pending_activation','active')) AS qr_count,
            (SELECT COUNT(*) FROM order_profiles op WHERE op.profile_id = ep.id) AS order_count
     FROM emergency_profiles ep
     JOIN users u ON u.id = ep.user_id
     ${whereSql}
     ORDER BY ep.created_at DESC
     LIMIT ? OFFSET ?`,
    params.concat([l, offset])
  );
  const [countRow] = await db.query(
    `SELECT COUNT(*) AS total FROM emergency_profiles ep JOIN users u ON u.id = ep.user_id ${whereSql}`,
    params
  );
  return res.json({
    profiles: rows,
    pagination: { page: p, limit: l, total: countRow.total, pages: Math.ceil(countRow.total / l) },
  });
};

const listOrders = async (req, res) => {
  const rows = await db.query(
    `SELECT o.id, o.order_number, o.design_id, o.design_name, o.design_image_url, o.sticker_quantity,
            o.commercial_status, o.payment_status, o.total_amount, o.currency, o.shipping_address, o.created_at,
            u.email AS customer_email, p.name AS product_name,
            (SELECT i2.value FROM identifiers i2 WHERE i2.user_id = u.id AND i2.status IN ('pending_activation', 'active') ORDER BY i2.created_at DESC LIMIT 1) AS qr_value
     FROM orders o
     JOIN users u ON o.user_id = u.id
     JOIN products p ON o.product_id = p.id
     ORDER BY o.created_at DESC
     LIMIT 100`
  );
  return res.json({ orders: rows });
};

const updateOrderStatus = async (req, res) => {
  const { id } = req.params;
  const { commercial_status, payment_status } = req.body;
  const allowed = [
    'draft',
    'pending_confirmation',
    'pending_payment',
    'paid',
    'preparing',
    'shipped',
    'delivered',
    'cancelled',
    'refund_requested',
    'refunded',
  ];
  // El estado de pago 'approved' solo puede ser establecido por la verificación del
  // webhook de la pasarela (servidor), nunca por edición manual del administrador.
  const paymentAllowed = ['unpaid', 'pending', 'approved', 'rejected', 'cancelled', 'refunded'];

  if (commercial_status !== undefined && !allowed.includes(commercial_status)) {
    return res.status(400).json({ error: 'Estado comercial inválido' });
  }
  if (payment_status !== undefined && !paymentAllowed.includes(payment_status)) {
    return res.status(400).json({ error: 'Estado de pago inválido' });
  }

  const existing = await db.query('SELECT id, user_id, design_id FROM orders WHERE id = ?', [id]);
  if (!existing || existing.length === 0) {
    return res.status(404).json({ error: 'Pedido no encontrado' });
  }
  const orderUserId = existing[0].user_id;
  const orderDesignId = existing[0].design_id;

  // Para pedidos de stickers físicos (tienen design_id), el QR físico se asigna/genera
  // desde el webhook de pago (assignOrCreateForOrder), no desde la edición manual del
  // pedido. activateQr se reserva para el flujo del QR digital básico.
  const isStickerOrder = orderDesignId !== null;

  const fields = [];
  const values = [];
  if (commercial_status !== undefined) {
    fields.push('commercial_status = ?');
    values.push(commercial_status);
  }
  if (payment_status !== undefined) {
    fields.push('payment_status = ?');
    values.push(payment_status);
  }
  // Pago por WhatsApp: al marcar pagado, sincronizar estado de pago.
  if (commercial_status === 'paid' && payment_status === undefined) {
    fields.push('payment_status = ?');
    values.push('approved');
  }
  if (payment_status === 'approved' && commercial_status === undefined) {
    fields.push('commercial_status = ?');
    values.push('paid');
  }
  values.push(id);
  await db.query(`UPDATE orders SET ${fields.join(', ')} WHERE id = ?`, values);

  // Activar el QR permanente del usuario cuando el pago queda aprobado (idempotente).
  // Se omite para pedidos de stickers físicos: su QR físico se gestiona por compra/inventario.
  const becamePaid = payment_status === 'approved' || commercial_status === 'paid';
  if (becamePaid && !isStickerOrder) {
    try {
      await activateQr(orderUserId, id, req.ip);
    } catch {
      // No bloquear la actualización del pedido si la activación del QR falla.
    }
  }

  await db.query(
    'INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, metadata, ip_address) VALUES (?, ?, ?, ?, ?, ?)',
    [req.user.id, 'admin.order.update', 'orders', String(id), JSON.stringify({ commercial_status, payment_status }), req.ip]
  );

  return res.json({ message: 'Pedido actualizado' });
};

const auditLogs = async (req, res) => {
  const rows = await db.query(
    `SELECT a.id, a.action, a.entity_type, a.entity_id, a.metadata, a.ip_address, a.created_at, u.email AS actor_email
     FROM audit_logs a
     LEFT JOIN users u ON a.actor_user_id = u.id
     ORDER BY a.created_at DESC
     LIMIT 200`
  );
  return res.json({ logs: rows });
};

const bootstrapAdmin = async (req, res) => {
  const { email, password, token } = req.validated.body;

  if (!process.env.ADMIN_BOOTSTRAP_TOKEN || token !== process.env.ADMIN_BOOTSTRAP_TOKEN) {
    return res.status(403).json({ error: 'Token de bootstrapping inválido' });
  }

  const exists = await adminExists();
  if (exists) {
    return res.status(409).json({ error: 'Ya existe un administrador' });
  }

  const existing = await db.query('SELECT id FROM users WHERE email = ?', [email]);
  if (existing.length > 0) {
    return res.status(409).json({ error: 'El correo ya está registrado' });
  }

  const passwordHash = hashPassword(password);
  const result = await db.query(
    'INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?)',
    [email, passwordHash, 'admin']
  );
  const adminId = result.insertId;

  await db.query(
    'INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, metadata, ip_address) VALUES (?, ?, ?, ?, ?, ?)',
    [adminId, 'admin.bootstrap', 'users', String(adminId), JSON.stringify({ email }), req.ip]
  );

  return res.status(201).json({
    admin: { id: adminId, email, role: 'admin' },
    message: 'Primer administrador creado. Guarde las credenciales.',
  });
};

module.exports = {
  isAdmin,
  listUsers,
  getUser,
  updateUserRole,
  suspendUser,
  reactivateUser,
  verifyUser,
  dashboardStats,
  dashboardAlerts,
  listPayments,
  scanMetrics,
  listAllProfiles,
  listOrders,
  updateOrderStatus,
  auditLogs,
  bootstrapAdmin,
};

