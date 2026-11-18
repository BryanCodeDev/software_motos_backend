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

const updateUserRole = async (req, res) => {
  const { id } = req.params;
  const { role } = req.body;
  if (!['user', 'admin'].includes(role)) {
    return res.status(400).json({ error: 'Rol invalido' });
  }
  if (Number(id) === req.user.id) {
    return res.status(400).json({ error: 'No puedes cambiar tu propio rol' });
  }
  const rows = await db.query('SELECT id, role FROM users WHERE id = ?', [id]);
  if (rows.length === 0) {
    return res.status(404).json({ error: 'Usuario no encontrado' });
  }
  if (rows[0].role === 'admin' && role === 'user') {
    const admins = await db.query("SELECT COUNT(*) AS c FROM users WHERE role = 'admin'");
    if (admins[0].c <= 1) {
      return res.status(400).json({ error: 'No se puede retirar el ultimo administrador' });
    }
  }
  await db.query('UPDATE users SET role = ? WHERE id = ?', [role, id]);
  await db.query(
    'INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, metadata, ip_address) VALUES (?, ?, ?, ?, ?, ?)',
    [req.user.id, 'admin.user.role_change', 'users', String(id), JSON.stringify({ from: rows[0].role, to: role }), req.ip]
  );
  return res.json({ message: 'Rol actualizado' });
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
  verifyUser,
  dashboardStats,
  listOrders,
  updateOrderStatus,
  auditLogs,
  bootstrapAdmin,
};

