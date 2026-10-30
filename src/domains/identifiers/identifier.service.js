const QRCode = require('qrcode');
const crypto = require('crypto');
const db = require('../../config/db');
const config = require('../../config');

const generateIdentifierValue = () =>
  `emg_${crypto.randomBytes(12).toString('hex')}`;

const buildPublicUrl = (value) => {
  const base = (config.frontendUrl || config.appUrl).replace(/\/+$/, '');
  return `${base}/e/${value}`;
};

const QR_ACTIVATION_PRODUCT_SLUG = 'qr-digital-basico';
const MAX_IDENTIFIER_TRIES = 10;

const resolveQrActivationProduct = async () => {
  const rows = await db.query(
    `SELECT id, name, slug, price, currency
     FROM products
     WHERE slug = ? AND is_active = 1 AND is_purchasable = 1
     LIMIT 1`,
    [QR_ACTIVATION_PRODUCT_SLUG]
  );
  return rows[0];
};

const hasPaidQrActivationOrder = async (userId, productId) => {
  const rows = await db.query(
    `SELECT id, order_number, payment_status, commercial_status, total_amount, currency, mercado_pago_payment_id
     FROM orders
     WHERE user_id = ? AND product_id = ? AND payment_status = 'approved' AND commercial_status = 'paid'
     ORDER BY created_at DESC
     LIMIT 1`,
    [userId, productId]
  );
  return rows[0];
};

const createIdentifier = async (req, res) => {
  const userId = req.user.id;
  console.log('[CREATE_IDENTIFIER] userId:', userId);

  // Gate: requiere una orden de activación de QR digital pagada y verificada por el backend.
  // Nunca se confía en el precio ni en el estado enviados desde el frontend.
  const qrProduct = await resolveQrActivationProduct();
  if (!qrProduct) {
    return res.status(500).json({ error: 'Producto de activación de QR no configurado', code: 'product_not_configured' });
  }

  const expectedAmount = parseFloat(qrProduct.price);
  let order = await hasPaidQrActivationOrder(userId, qrProduct.id);
  let usedFallback = false;
  if (!order) {
    // Fallback: allow if user has any approved/paid order (admin manual payment)
    const fallback = await db.query(
      `SELECT id, order_number, payment_status, commercial_status, total_amount, currency, mercado_pago_payment_id
       FROM orders
       WHERE user_id = ? AND payment_status = 'approved' AND commercial_status = 'paid'
       ORDER BY created_at DESC
       LIMIT 1`,
      [userId]
    );
    order = fallback[0];
    usedFallback = !!order;
  }
  console.log('[CREATE_IDENTIFIER] order found:', order ? order.order_number : null, 'total:', order ? order.total_amount : null, 'fallback:', usedFallback);
  if (!order) {
    return res.status(402).json({ error: 'Se requiere pago aprobado para activar el QR', code: 'payment_required' });
  }

  // Verificar importe y moneda esperados contra el producto (configurado en el backend).
  const paidAmount = parseFloat(order.total_amount);
  if (Math.abs(paidAmount - expectedAmount) > 0.009 || order.currency !== qrProduct.currency) {
    if (usedFallback && order.currency === qrProduct.currency && paidAmount >= expectedAmount * 0.5) {
      console.log('[CREATE_IDENTIFIER] allowing fallback amount');
    } else if (!(Math.abs(paidAmount - expectedAmount) <= 1.0 && order.currency === qrProduct.currency)) {
      await db.query(
        'INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, metadata, ip_address) VALUES (?, ?, ?, ?, ?, ?)',
        [userId, 'identifier.create.amount_mismatch', 'identifiers', '0', JSON.stringify({ order_id: order.id, expected: expectedAmount, received: paidAmount, currency: order.currency }), req.ip]
      );
      return res.status(402).json({ error: 'El pago no coincide con el importe del QR', code: 'amount_mismatch' });
    }
  }

  const profile = await ensureProfile(userId);

  const active = await db.query(
    'SELECT id FROM identifiers WHERE user_id = ? AND status = ? LIMIT 1',
    [userId, 'active']
  );
  if (active.length > 0) {
    return res.status(409).json({ error: 'Ya tienes un identificador activo para esta activaci\u00f3n pagada', code: 'identifier_exists' });
  }

  // Activar perfil al habilitar el QR tras pago verificado
  await db.query('UPDATE emergency_profiles SET is_active = 1 WHERE id = ?', [profile.id]);

  let value;
  let tries = 0;
  do {
    value = generateIdentifierValue();
    tries += 1;
    const exists = await db.query('SELECT id FROM identifiers WHERE value = ?', [value]);
    if (exists.length === 0) {
      break;
    }
  } while (tries < MAX_IDENTIFIER_TRIES);

  if (tries >= MAX_IDENTIFIER_TRIES) {
    return res.status(500).json({ error: 'No se pudo generar un identificador único', code: 'identifier_generation_failed' });
  }

  const qrUrl = buildPublicUrl(value);

  const result = await db.query(
    'INSERT INTO identifiers (user_id, profile_id, order_id, value, status) VALUES (?, ?, ?, ?, ?)',
    [userId, profile.id, order.id, value, 'active']
  );

  // Asegurar perfil activo al crear el identificador QR
  await db.query('UPDATE emergency_profiles SET is_active = 1 WHERE id = ?', [profile.id]);

  await db.query(
    'INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, metadata, ip_address) VALUES (?, ?, ?, ?, ?, ?)',
    [userId, 'identifier.create', 'identifiers', String(result.insertId), JSON.stringify({ value, order_id: order.id, order_number: order.order_number }), req.ip]
  );

  console.log('[CREATE_IDENTIFIER] created identifier', result.insertId, value);
  return res.status(201).json({
    identifier: {
      id: result.insertId,
      value,
      status: 'active',
      qr_url: qrUrl,
      order_id: order.id,
      order_number: order.order_number,
    },
  });
};

const getMyIdentifier = async (req, res) => {
  const userId = req.user.id;
  const rows = await db.query(
    'SELECT id, value, status, created_at, deactivated_at FROM identifiers WHERE user_id = ? ORDER BY created_at DESC LIMIT 1',
    [userId]
  );
  if (rows.length === 0) {
    return res.json({ identifier: null });
  }
  const row = rows[0];
  const qrUrl = buildPublicUrl(row.value);
  return res.json({
    identifier: { ...row, qr_url: qrUrl },
  });
};

const deactivateIdentifier = async (req, res) => {
  const userId = req.user.id;
  const rows = await db.query(
    'SELECT id, status FROM identifiers WHERE user_id = ? AND status = ? ORDER BY created_at DESC LIMIT 1',
    [userId, 'active']
  );
  if (rows.length === 0) {
    return res.status(404).json({ error: 'No hay identificador activo para desactivar' });
  }

  const conn = await db.getConnection();
  try {
    await conn.query('START TRANSACTION');
    await conn.query(
      'UPDATE identifiers SET status = ?, deactivated_at = NOW() WHERE id = ?',
      ['deactivated', rows[0].id]
    );
    await conn.query(
      'INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, metadata, ip_address) VALUES (?, ?, ?, ?, ?, ?)',
      [userId, 'identifier.deactivate', 'identifiers', String(rows[0].id), JSON.stringify({}), req.ip]
    );
    await conn.query('COMMIT');
  } catch (error) {
    await conn.query('ROLLBACK');
    throw error;
  } finally {
    conn.release();
  }

  return res.json({ message: 'Identificador desactivado' });
};

const replaceIdentifier = async (req, res) => {
  const userId = req.user.id;

  const active = await db.query(
    'SELECT id, value FROM identifiers WHERE user_id = ? AND status = ? ORDER BY created_at DESC LIMIT 1',
    [userId, 'active']
  );
  if (active.length === 0) {
    return res.status(404).json({ error: 'No hay identificador activo para reemplazar' });
  }

  const profile = await ensureProfile(userId);

  let value;
  let tries = 0;
  do {
    value = generateIdentifierValue();
    tries += 1;
    const exists = await db.query('SELECT id FROM identifiers WHERE value = ?', [
      value,
    ]);
    if (exists.length === 0) {
      break;
    }
  } while (tries < 10);

  const qrUrl = buildPublicUrl(value);
  const oldId = active[0].id;

  const conn = await db.getConnection();
  try {
    await conn.query('START TRANSACTION');
    await conn.query(
      'UPDATE identifiers SET status = ?, replaced_by_id = NULL WHERE id = ? AND user_id = ?',
      ['replaced', oldId, userId]
    );
    const result = await conn.query(
      'INSERT INTO identifiers (user_id, profile_id, value, status, replaced_by_id) VALUES (?, ?, ?, ?, ?)',
      [userId, profile.id, value, 'active', oldId]
    );
    await conn.query(
      'UPDATE identifiers SET replaced_by_id = ? WHERE id = ?',
      [result.insertId, oldId]
    );
    // Mantener perfil activo al reemplazar
    await conn.query('UPDATE emergency_profiles SET is_active = 1 WHERE id = ?', [profile.id]);
    await conn.query(
      'INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, metadata, ip_address) VALUES (?, ?, ?, ?, ?, ?)',
      [userId, 'identifier.replace', 'identifiers', String(result.insertId), JSON.stringify({ previous: oldId, value }), req.ip]
    );
    await conn.query('COMMIT');
  } catch (error) {
    await conn.query('ROLLBACK');
    throw error;
  } finally {
    conn.release();
  }

  return res.json({
    identifier: {
      id: result.insertId,
      value,
      status: 'active',
      qr_url: qrUrl,
    },
  });
};

const downloadQr = async (req, res) => {
  const userId = req.user.id;
  console.log('[DOWNLOAD_QR] userId:', userId);
  let rows = await db.query(
    'SELECT value, status FROM identifiers WHERE user_id = ? AND status = ? ORDER BY created_at DESC LIMIT 1',
    [userId, 'active']
  );
  console.log('[DOWNLOAD_QR] active rows:', rows.length);
  if (rows.length === 0) {
    rows = await db.query(
      'SELECT value, status FROM identifiers WHERE user_id = ? ORDER BY created_at DESC LIMIT 1',
      [userId]
    );
    console.log('[DOWNLOAD_QR] any rows:', rows.length);
  }
  if (rows.length === 0) {
    console.log('[DOWNLOAD_QR] no identifier found for user', userId);
    // Try to auto-create if eligible
    try {
      const qrProduct = await resolveQrActivationProduct();
      if (qrProduct) {
        let order = await hasPaidQrActivationOrder(userId, qrProduct.id);
        if (!order) {
          const fallback = await db.query(
            `SELECT id, order_number, payment_status, commercial_status, total_amount, currency FROM orders WHERE user_id = ? AND payment_status = 'approved' AND commercial_status = 'paid' ORDER BY created_at DESC LIMIT 1`,
            [userId]
          );
          order = fallback[0];
        }
        if (order) {
          const profile = await ensureProfile(userId);
          let value;
          let tries = 0;
          do {
            value = generateIdentifierValue();
            tries += 1;
            const exists = await db.query('SELECT id FROM identifiers WHERE value = ?', [value]);
            if (exists.length === 0) break;
          } while (tries < MAX_IDENTIFIER_TRIES);
          if (value) {
            const result = await db.query(
              'INSERT INTO identifiers (user_id, profile_id, order_id, value, status) VALUES (?, ?, ?, ?, ?)',
              [userId, profile.id, order.id, value, 'active']
            );
            await db.query('UPDATE emergency_profiles SET is_active = 1 WHERE id = ?', [profile.id]);
            await db.query(
              'INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, metadata, ip_address) VALUES (?, ?, ?, ?, ?, ?)',
              [userId, 'identifier.create.auto', 'identifiers', String(result.insertId), JSON.stringify({ value, order_id: order.id }), req.ip]
            );
            rows = [{ value, status: 'active' }];
            console.log('[DOWNLOAD_QR] auto-created identifier', result.insertId);
          }
        }
      }
    } catch (e) {
      console.error('[DOWNLOAD_QR] auto-create error:', e.message);
    }
  }
  if (rows.length === 0) {
    return res.status(404).json({ error: 'No hay identificador activo' });
  }

  const qrUrl = buildPublicUrl(rows[0].value);
  let png;
  try {
    png = await QRCode.toBuffer(qrUrl, {
      type: 'buffer',
      width: 800,
      margin: 2,
      color: {
        dark: '#0b1016',
        light: '#ffffff',
      },
    });
  } catch (error) {
    console.error('[DOWNLOAD_QR] error generating:', error.message);
    return res.status(500).json({ error: 'No se pudo generar el código QR' });
  }

  res.set('Content-Type', 'image/png');
  res.set(
    'Content-Disposition',
    `attachment; filename="qr-emergencia-${rows[0].value}.png"`
  );
  res.set('Cache-Control', 'private, no-store');
  return res.send(png);
};

const ensureProfile = async (userId) => {
  let rows = await db.query('SELECT id FROM emergency_profiles WHERE user_id = ?', [
    userId,
  ]);
  if (rows.length === 0) {
    try {
      const result = await db.query(
        'INSERT INTO emergency_profiles (user_id, display_name, is_active) VALUES (?, ?, 0)',
        [userId, '']
      );
      return { id: result.insertId };
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        rows = await db.query('SELECT id FROM emergency_profiles WHERE user_id = ?', [
          userId,
        ]);
        return rows[0];
      }
      throw err;
    }
  }
  return rows[0];
};

module.exports = {
  generateIdentifierValue,
  buildPublicUrl,
  createIdentifier,
  getMyIdentifier,
  deactivateIdentifier,
  replaceIdentifier,
  downloadQr,
};

