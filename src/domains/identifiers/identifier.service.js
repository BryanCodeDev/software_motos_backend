const QRCode = require('qrcode');
const crypto = require('crypto');
const db = require('../../config/db');
const config = require('../../config');
const archiver = require('archiver');
const PDFDocument = require('pdfkit');

const generateIdentifierValue = () =>
  `emg_${crypto.randomBytes(12).toString('hex')}`;

const buildPublicUrl = (value) => {
  const base = (config.frontendUrl || config.appUrl).replace(/\/+$/, '');
  return `${base}/e/${value}`;
};

const QR_ACTIVATION_PRODUCT_SLUG = 'qr-digital-basico';
const MAX_IDENTIFIER_TRIES = 10;

// Imagen QR: fondo blanco, alto contraste, margen de seguridad (quiet zone).
const QR_IMAGE_OPTIONS = {
  type: 'buffer',
  width: 1200,
  margin: 4,
  color: { dark: '#0b1016', light: '#ffffff' },
};

const generateQrBuffer = async (value) => {
  const qrUrl = buildPublicUrl(value);
  return QRCode.toBuffer(qrUrl, QR_IMAGE_OPTIONS);
};

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

const ensureProfileTx = async (conn, userId) => {
  let [rows] = await conn.query(
    'SELECT id FROM emergency_profiles WHERE user_id = ?',
    [userId]
  );
  if (rows.length === 0) {
    const [result] = await conn.query(
      'INSERT INTO emergency_profiles (user_id, display_name, is_active) VALUES (?, ?, 0)',
      [userId, '']
    );
    return { id: result.insertId };
  }
  return rows[0];
};

// ---------------------------------------------------------------------------
// Registro automático: crea (o reutiliza) un QR pendiente de activación.
// ---------------------------------------------------------------------------
const ensureOrCreatePendingQr = async (userId, ipAddress = null) => {
  const conn = await db.getConnection();
  try {
    await conn.query('START TRANSACTION');
    // Bloquea los identificadores existentes del usuario para evitar duplicados por reintento.
    const [rows] = await conn.query(
      'SELECT id, value, status, print_status, activation_at FROM identifiers WHERE user_id = ? FOR UPDATE',
      [userId]
    );

    let identifier;
    let created = false;

    if (rows.length > 0) {
      // Conservar el QR existente (el más reciente), nunca crear uno nuevo.
      identifier = rows[0];
    } else {
      let value;
      let tries = 0;
      do {
        value = generateIdentifierValue();
        tries += 1;
        const [exists] = await conn.query(
          'SELECT id FROM identifiers WHERE value = ? FOR UPDATE',
          [value]
        );
        if (exists.length === 0) { break; }
      } while (tries < MAX_IDENTIFIER_TRIES);

      if (tries >= MAX_IDENTIFIER_TRIES) {
        await conn.query('ROLLBACK');
        return { error: 'identifier_generation_failed', status: 500 };
      }

      const qrUrl = buildPublicUrl(value);
      const profile = await ensureProfileTx(conn, userId);
      const [result] = await conn.query(
        'INSERT INTO identifiers (user_id, profile_id, value, status) VALUES (?, ?, ?, ?)',
        [userId, profile.id, value, 'pending_activation']
      );

      await conn.query(
        'INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, metadata, ip_address) VALUES (?, ?, ?, ?, ?, ?)',
        [
          userId,
          'identifier.create.auto',
          'identifiers',
          String(result.insertId),
          JSON.stringify({ value, qr_url: qrUrl }),
          ipAddress,
        ]
      );

      identifier = {
        id: result.insertId,
        user_id: userId,
        value,
        status: 'pending_activation',
        print_status: 'pending_print',
        activation_at: null,
      };
      created = true;
    }

    await conn.query('COMMIT');
    return { identifier, created, qr_url: buildPublicUrl(identifier.value) };
  } catch (error) {
    await conn.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    conn.release();
  }
};

// ---------------------------------------------------------------------------
// Activación del QR tras pago (idempotente: reutiliza el existente).
// ---------------------------------------------------------------------------
const activateQr = async (userId, orderId, ipAddress = null) => {
  const conn = await db.getConnection();
  try {
    await conn.query('START TRANSACTION');

    // Bloquea TODOS los identificadores del usuario para evitar doble creación
    // por webhooks o solicitudes simultáneas. La restricción de unicidad
    // uq_identifiers_one_active_per_user refuerza esto en MySQL.
    const [rows] = await conn.query(
      'SELECT id, value, status, activation_at, order_id FROM identifiers WHERE user_id = ? FOR UPDATE',
      [userId]
    );

    // Reutiliza el vigente (active o pending_activation). Nunca crea uno nuevo si ya existe.
    const existing = rows.find((r) => r.status === 'active' || r.status === 'pending_activation');

    let identifier;
    if (existing) {
      await conn.query(
        'UPDATE identifiers SET status = ?, activation_at = COALESCE(activation_at, NOW()), order_id = COALESCE(order_id, ?) WHERE id = ?',
        ['active', orderId, existing.id]
      );
      await conn.query(
        'INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, metadata, ip_address) VALUES (?, ?, ?, ?, ?, ?)',
        [
          userId,
          'identifier.activate',
          'identifiers',
          String(existing.id),
          JSON.stringify({ value: existing.value, order_id: orderId, previous_status: existing.status }),
          ipAddress,
        ]
      );
      identifier = {
        id: existing.id,
        value: existing.value,
        status: 'active',
        activation_at: existing.activation_at || new Date(),
      };
    } else {
      // No hay QR previo: crear uno activo directamente vinculado al pedido.
      const profile = await ensureProfileTx(conn, userId);
      let value;
      let tries = 0;
      do {
        value = generateIdentifierValue();
        tries += 1;
        const [exists] = await conn.query(
          'SELECT id FROM identifiers WHERE value = ? FOR UPDATE',
          [value]
        );
        if (exists.length === 0) { break; }
      } while (tries < MAX_IDENTIFIER_TRIES);

      if (tries >= MAX_IDENTIFIER_TRIES) {
        await conn.query('ROLLBACK');
        return { error: 'identifier_generation_failed', status: 500 };
      }

      const [result] = await conn.query(
        'INSERT INTO identifiers (user_id, profile_id, order_id, value, status, activation_at) VALUES (?, ?, ?, ?, ?, NOW())',
        [userId, profile.id, orderId, value, 'active']
      );
      identifier = {
        id: result.insertId,
        value,
        status: 'active',
        activation_at: new Date(),
      };
      await conn.query(
        'INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, metadata, ip_address) VALUES (?, ?, ?, ?, ?, ?)',
        [
          userId,
          'identifier.create.active',
          'identifiers',
          String(result.insertId),
          JSON.stringify({ value, order_id: orderId }),
          ipAddress,
        ]
      );
    }

    // Activar el perfil de emergencia asociado al QR activo.
    await conn.query('UPDATE emergency_profiles SET is_active = 1 WHERE user_id = ?', [userId]);

    await conn.query('COMMIT');
    return { identifier, qr_url: buildPublicUrl(identifier.value) };
  } catch (error) {
    await conn.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    conn.release();
  }
};

// ---------------------------------------------------------------------------
// Endpoints existentes del usuario (adaptados a nuevos estados).
// ---------------------------------------------------------------------------
const createIdentifier = async (req, res) => {
  const userId = req.user.id;

  const qrProduct = await resolveQrActivationProduct();
  if (!qrProduct) {
    return res.status(500).json({ error: 'Producto de activación de QR no configurado', code: 'product_not_configured' });
  }

  const expectedAmount = parseFloat(qrProduct.price);
  let order = await hasPaidQrActivationOrder(userId, qrProduct.id);
  let usedFallback = false;
  if (!order) {
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
  if (!order) {
    return res.status(402).json({ error: 'Se requiere pago aprobado para activar el QR', code: 'payment_required' });
  }

  const paidAmount = parseFloat(order.total_amount);
  if (Math.abs(paidAmount - expectedAmount) > 0.009 || order.currency !== qrProduct.currency) {
    if (!(usedFallback && order.currency === qrProduct.currency && paidAmount >= expectedAmount * 0.5) &&
        !(Math.abs(paidAmount - expectedAmount) <= 1.0 && order.currency === qrProduct.currency)) {
      await db.query(
        'INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, metadata, ip_address) VALUES (?, ?, ?, ?, ?, ?)',
        [userId, 'identifier.create.amount_mismatch', 'identifiers', '0', JSON.stringify({ order_id: order.id, expected: expectedAmount, received: paidAmount, currency: order.currency }), req.ip]
      );
      return res.status(402).json({ error: 'El pago no coincide con el importe del QR', code: 'amount_mismatch' });
    }
  }

  const profile = await ensureProfile(userId);

  // Reutilizar el QR existente del usuario en lugar de crear uno nuevo.
  const existing = await db.query(
    'SELECT id, value, status, activation_at FROM identifiers WHERE user_id = ? ORDER BY created_at DESC LIMIT 1',
    [userId]
  );
  if (existing.length > 0) {
    const ident = existing[0];
    if (ident.status !== 'active') {
      await db.query(
        'UPDATE identifiers SET status = ?, activation_at = NOW(), order_id = COALESCE(order_id, ?) WHERE id = ?',
        ['active', order.id, ident.id]
      );
      await db.query(
        'INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, metadata, ip_address) VALUES (?, ?, ?, ?, ?, ?)',
        [userId, 'identifier.activate', 'identifiers', String(ident.id), JSON.stringify({ value: ident.value, order_id: order.id, previous_status: ident.status }), req.ip]
      );
    }
    const qrUrl = buildPublicUrl(ident.value);
    return res.status(200).json({
      identifier: {
        id: ident.id,
        value: ident.value,
        status: 'active',
        qr_url: qrUrl,
        order_id: order.id,
        order_number: order.order_number,
      },
    });
  }

  await db.query('UPDATE emergency_profiles SET is_active = 1 WHERE id = ?', [profile.id]);

  let value;
  let tries = 0;
  do {
    value = generateIdentifierValue();
    tries += 1;
    const exists = await db.query('SELECT id FROM identifiers WHERE value = ?', [value]);
    if (exists.length === 0) { break; }
  } while (tries < MAX_IDENTIFIER_TRIES);

  if (tries >= MAX_IDENTIFIER_TRIES) {
    return res.status(500).json({ error: 'No se pudo generar un identificador único', code: 'identifier_generation_failed' });
  }

  const qrUrl = buildPublicUrl(value);

  const result = await db.query(
    'INSERT INTO identifiers (user_id, profile_id, order_id, value, status, activation_at) VALUES (?, ?, ?, ?, ?, NOW())',
    [userId, profile.id, order.id, value, 'active']
  );

  await db.query(
    'INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, metadata, ip_address) VALUES (?, ?, ?, ?, ?, ?)',
    [userId, 'identifier.create', 'identifiers', String(result.insertId), JSON.stringify({ value, order_id: order.id, order_number: order.order_number }), req.ip]
  );
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
    'SELECT id, value, status, activation_at, created_at, updated_at, print_status FROM identifiers WHERE user_id = ? ORDER BY created_at DESC LIMIT 1',
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
    'SELECT id, status FROM identifiers WHERE user_id = ? AND status IN (?, ?) ORDER BY created_at DESC LIMIT 1',
    [userId, 'active', 'pending_activation']
  );
  if (rows.length === 0) {
    return res.status(404).json({ error: 'No hay identificador activo o pendiente para desactivar' });
  }

  const conn = await db.getConnection();
  try {
    await conn.query('START TRANSACTION');
    await conn.query(
      'UPDATE identifiers SET status = ?, deactivated_at = NOW() WHERE id = ?',
      ['disabled', rows[0].id]
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
    const exists = await db.query('SELECT id FROM identifiers WHERE value = ?', [value]);
    if (exists.length === 0) { break; }
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

// ---------------------------------------------------------------------------
// Descarga / regeneración de imagen QR (fondo blanco, alto contraste).
// ---------------------------------------------------------------------------
const downloadQr = async (req, res) => {
  const userId = req.user.id;
  const rows = await db.query(
    'SELECT value, status FROM identifiers WHERE user_id = ? ORDER BY created_at DESC LIMIT 1',
    [userId]
  );
  if (rows.length === 0) {
    return res.status(404).json({ error: 'No hay identificador asociado' });
  }

  return sendQrImage(res, rows[0].value, `qr-emergencia-${rows[0].value}.png`);
};

// Descarga/regenera la imagen de un identificador concreto (admin).
const getQrImage = async (req, res) => {
  const { id } = req.params;
  const rows = await db.query(
    'SELECT value, status FROM identifiers WHERE id = ? LIMIT 1',
    [id]
  );
  if (rows.length === 0) {
    return res.status(404).json({ error: 'Identificador no encontrado' });
  }
  return sendQrImage(res, rows[0].value, `QR_${rows[0].value}.png`);
};

const sendQrImage = async (res, value, fileName) => {
  let png;
  try {
    png = await generateQrBuffer(value);
  } catch {
    return res.status(500).json({ error: 'No se pudo generar el código QR' });
  }

  res.set('Content-Type', 'image/png');
  res.set('Content-Disposition', `attachment; filename="${fileName}"`);
  res.set('Cache-Control', 'private, no-store');
  return res.send(png);
};

// ---------------------------------------------------------------------------
// Detalle administrativo de un QR + historial de auditoría.
// ---------------------------------------------------------------------------
const getIdentifierDetail = async (req, res) => {
  const { id } = req.params;
  const rows = await db.query(
    `SELECT i.id, i.user_id, i.value, i.status, i.activation_at, i.print_status,
            i.created_at, i.updated_at, i.deactivated_at,
            u.email, u.role, u.created_at AS user_created_at
     FROM identifiers i
     JOIN users u ON u.id = i.user_id
     WHERE i.id = ?`,
    [id]
  );
  if (rows.length === 0) {
    return res.status(404).json({ error: 'Identificador no encontrado' });
  }
  const row = rows[0];
  const qrUrl = buildPublicUrl(row.value);

  const logs = await db.query(
    `SELECT id, action, entity_id, metadata, ip_address, created_at
     FROM audit_logs
     WHERE entity_type = 'identifiers' AND entity_id = ?
     ORDER BY created_at DESC LIMIT 50`,
    [id]
  );

  return res.json({
    identifier: { ...row, qr_url: qrUrl },
    user: { id: row.user_id, email: row.email, role: row.role, created_at: row.user_created_at },
    history: logs,
  });
};

// ---------------------------------------------------------------------------
// Exportación: CSV
// ---------------------------------------------------------------------------
const buildQrCsv = (records) => {
  const esc = (v) => {
    const s = String(v === null || v === undefined ? '' : v);
    if (/[",\n\r]/.test(s)) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  const header = ['registro','identificador_qr','url_publica','estado_qr','usuario_id','correo_usuario','fecha_generacion','estado_impresion','pedido_referencia','diseno_seleccionado','diseno_nombre','cantidad_stickers'];
  const lines = [header.join(',')];
  records.forEach((r, i) => {
    lines.push([
      i + 1,
      esc(r.value),
      esc(buildPublicUrl(r.value)),
      esc(r.status),
      esc(r.user_id),
      esc(r.email),
      esc(r.created_at),
      esc(r.print_status),
      esc(r.order_number),
      esc(r.design_id),
      esc(r.design_name),
      esc(r.sticker_quantity),
    ].join(','));
  });
  return lines.join('\n') + '\n';
};

const exportQrsCsv = async (req, res) => {
  const { ids } = req.query;
  if (!ids) {
    return res.status(400).json({ error: 'Faltan identificadores de usuario', code: 'missing_ids' });
  }
  const idList = ids.split(',').map((x) => parseInt(x, 10)).filter((x) => !Number.isNaN(x));
  if (idList.length === 0) {
    return res.status(400).json({ error: 'Identificadores inválidos', code: 'invalid_ids' });
  }

  const placeholders = idList.map(() => '?').join(',');
  const rows = await db.query(
    `SELECT i.id, i.user_id, i.value, i.status, i.created_at, i.print_status, i.order_id,
            o.order_number, o.design_id, o.design_name, o.sticker_quantity,
            u.email
     FROM identifiers i
     JOIN users u ON u.id = i.user_id
     LEFT JOIN orders o ON o.id = i.order_id
     WHERE i.user_id IN (${placeholders})
     ORDER BY i.created_at DESC`,
    idList
  );

  const csv = buildQrCsv(rows);
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', 'attachment; filename="qr-export.csv"');
  res.set('Cache-Control', 'private, no-store');
  return res.send(csv);
};

// ---------------------------------------------------------------------------
// Exportación: ZIP de imágenes QR
// ---------------------------------------------------------------------------
const exportQrsZip = async (req, res) => {
  const { ids } = req.query;
  if (!ids) {
    return res.status(400).json({ error: 'Faltan identificadores de usuario', code: 'missing_ids' });
  }
  const idList = ids.split(',').map((x) => parseInt(x, 10)).filter((x) => !Number.isNaN(x));
  if (idList.length === 0) {
    return res.status(400).json({ error: 'Identificadores inválidos', code: 'invalid_ids' });
  }

  const placeholders = idList.map(() => '?').join(',');
  const rows = await db.query(
    `SELECT i.id, i.user_id, i.value, i.status, i.print_status, i.order_id,
            o.order_number, o.design_id, o.design_name, o.sticker_quantity,
            u.email
     FROM identifiers i
     JOIN users u ON u.id = i.user_id
     LEFT JOIN orders o ON o.id = i.order_id
     WHERE i.user_id IN (${placeholders})`,
    idList
  );

  if (rows.length === 0) {
    return res.status(404).json({ error: 'No se encontraron QR para exportar', code: 'not_found' });
  }

  const archive = archiver('zip', { zlib: { level: 6 } });

  res.set('Content-Type', 'application/zip');
  res.set('Content-Disposition', 'attachment; filename="qrs-export.zip"');
  res.set('Cache-Control', 'private, no-store');

  archive.pipe(res);

  archive.on('error', () => {
    if (!res.headersSent) {
      return res.status(500).json({ error: 'Error generando el ZIP', code: 'zip_error' });
    }
    res.end();
  });

  for (const row of rows) {
    try {
      const png = await generateQrBuffer(row.value);
      archive.append(png, { name: `QR_${row.value}.png` });
    } catch {
      // Si falla una imagen, se omite del ZIP pero continúa el resto.
    }
  }

  // Añadir archivo de identificación (CSV embebido) dentro del ZIP.
  const csv = buildQrCsv(rows);
  archive.append(csv, { name: 'identificacion_qrs.csv' });

  await archive.finalize();
};

// ---------------------------------------------------------------------------
// Exportación: PDF para impresión (cuadrícula configurable).
// ---------------------------------------------------------------------------
const exportQrsPdf = async (req, res) => {
  const { ids, columns = '3', rowsPerPage = '5', size_mm = '25', gap_mm = '8', margin_mm = '12' } = req.query;
  if (!ids) {
    return res.status(400).json({ error: 'Faltan identificadores de usuario', code: 'missing_ids' });
  }
  const idList = ids.split(',').map((x) => parseInt(x, 10)).filter((x) => !Number.isNaN(x));
  if (idList.length === 0) {
    return res.status(400).json({ error: 'Identificadores inválidos', code: 'invalid_ids' });
  }

  const columnsNum = Math.max(1, Math.min(10, parseInt(columns, 10) || 3));
  const rowsNum = Math.max(1, Math.min(20, parseInt(rowsPerPage, 10) || 5));
  const size = Math.max(15, Math.min(100, parseFloat(size_mm) || 25)); // mm
  const gap = Math.max(0, Math.min(30, parseFloat(gap_mm) || 8)); // mm
  const margin = Math.max(0, Math.min(40, parseFloat(margin_mm) || 12)); // mm

  const placeholders = idList.map(() => '?').join(',');
  const qrRows = await db.query(
    `SELECT i.value, i.status, i.print_status, u.email
     FROM identifiers i
     JOIN users u ON u.id = i.user_id
     WHERE i.user_id IN (${placeholders})
     ORDER BY i.created_at DESC`,
    idList
  );

  if (qrRows.length === 0) {
    return res.status(404).json({ error: 'No se encontraron QR para imprimir', code: 'not_found' });
  }

  // A4 en puntos (1 mm = 2.83465 pt)
  const MM_TO_PT = 2.834645669;
  const pageW = 210 * MM_TO_PT;
  const pageH = 297 * MM_TO_PT;
  const gapPt = gap * MM_TO_PT;
  const marginPt = margin * MM_TO_PT;
  const usableW = pageW - 2 * marginPt;
  const usableH = pageH - 2 * marginPt;

  // Respeta columnas/filas solicitadas y ajusta el tamaño de celda para que quepa en la página sin recortes.
  const cellW = size * MM_TO_PT;
  const cellH = size * MM_TO_PT;
  const maxCellW = (usableW - (columnsNum - 1) * gapPt) / columnsNum;
  const maxCellH = (usableH - (rowsNum - 1) * gapPt) / rowsNum;
  const cellPt = Math.min(cellW, cellH, maxCellW, maxCellH);


  const doc = new PDFDocument({ size: 'A4', layout: 'portrait', margin: 0 });
  const buffers = [];
  doc.on('data', (b) => buffers.push(b));
  const end = new Promise((resolve) => doc.on('end', resolve));

  res.set('Content-Type', 'application/pdf');
  res.set('Content-Disposition', 'attachment; filename="qrs-impresion.pdf"');
  res.set('Cache-Control', 'private, no-store');

  doc.pipe(res);

  let index = 0;
  const total = qrRows.length;
  while (index < total) {
    if (index > 0) {
      doc.addPage();
    }
    for (let r = 0; r < rowsNum && index < total; r++) {
      for (let c = 0; c < columnsNum && index < total; c++) {
        const row = qrRows[index];
        const x = marginPt + c * (cellPt + gapPt);
        const y = marginPt + r * (cellPt + gapPt);
        const qrUrl = buildPublicUrl(row.value);
        const png = await QRCode.toBuffer(qrUrl, {
          type: 'buffer', width: 900, margin: 3,
          color: { dark: '#0b1016', light: '#ffffff' },
        });
        const img = doc.openImage(png);
        const imgW = cellPt * 0.82;
        const imgH = cellPt * 0.82;
        doc.image(img, x + (cellPt - imgW) / 2, y + (cellPt - imgH) / 2 - cellPt * 0.06, {
          width: imgW,
          height: imgH,
        });
        doc.fontSize(7).fillColor('#111').text(`QR_${row.value}`, x, y + cellH - 9, {
          width: cellW,
          align: 'center',
        });
        index += 1;
      }
    }
  }

  doc.end();
  await end;
};

// ---------------------------------------------------------------------------
// Control de impresión: actualizar estado en lote.
// ---------------------------------------------------------------------------
const bulkUpdatePrintStatus = async (req, res) => {
  const { user_ids, print_status } = req.body;
  if (!Array.isArray(user_ids) || user_ids.length === 0) {
    return res.status(400).json({ error: 'Faltan usuarios', code: 'missing_user_ids' });
  }
  const allowed = ['pending_print', 'sent_to_print', 'printed', 'delivered'];
  if (!allowed.includes(print_status)) {
    return res.status(400).json({ error: 'Estado de impresión inválido', code: 'invalid_print_status' });
  }

  const idList = user_ids.map((x) => parseInt(x, 10)).filter((x) => !Number.isNaN(x));
  if (idList.length === 0) {
    return res.status(400).json({ error: 'Usuarios inválidos', code: 'invalid_user_ids' });
  }

  const placeholders = idList.map(() => '?').join(',');
  const conn = await db.getConnection();
  try {
    await conn.query('START TRANSACTION');

    await conn.query(
      `UPDATE identifiers i
       JOIN users u ON u.id = i.user_id
       SET i.print_status = ?
       WHERE u.id IN (${placeholders})`,
      [print_status, ...idList]
    );

    await conn.query(
      'INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, metadata, ip_address) VALUES (?, ?, ?, ?, ?, ?)',
      [
        req.user.id,
        'admin.qr.bulk_print_status',
        'identifiers',
        String(idList.length),
        JSON.stringify({ print_status, user_count: idList.length, user_ids: idList }),
        req.ip,
      ]
    );

    await conn.query('COMMIT');
  } catch (error) {
    await conn.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    conn.release();
  }

  return res.json({ message: `Estado de impresión actualizado a ${print_status}`, count: idList.length });
};

// ---------------------------------------------------------------------------
// Administración centralizada de QR (módulo /admin/qrs)
// ---------------------------------------------------------------------------

const listQrsAdmin = async (filters = {}) => {
  const {
    q, user_id, status, print_status, design_id, from, to,
    linked, page = 1, limit = 25,
  } = filters;

  const where = [];
  const params = [];
  if (q) { where.push('(i.value LIKE ? OR u.email LIKE ?)'); params.push(`%${q}%`, `%${q}%`); }
  if (user_id) { where.push('i.user_id = ?'); params.push(user_id); }
  if (status) { where.push('i.status = ?'); params.push(status); }
  if (print_status) { where.push('i.print_status = ?'); params.push(print_status); }
  if (linked === 'true') { where.push('i.user_id IS NOT NULL'); }
  else if (linked === 'false') { where.push('i.user_id IS NULL'); }
  if (from) { where.push('i.created_at >= ?'); params.push(from); }
  if (to) { where.push('i.created_at <= ?'); params.push(to); }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const p = Math.max(1, parseInt(page, 10) || 1);
  const l = Math.min(100, Math.max(1, parseInt(limit, 10) || 25));
  const offset = (p - 1) * l;

  // design filter requiere join con orders (el diseño se guarda en la orden).
  const designJoin = design_id ? 'LEFT JOIN orders o ON o.id = i.order_id' : 'LEFT JOIN orders o ON o.id = i.order_id';
  const whereDesign = design_id ? (where.length ? 'AND ' : 'WHERE ') + 'o.design_id = ?' : '';
  const allParams = design_id ? params.concat([design_id]) : params;

  const rows = await db.query(
    `SELECT i.id, i.user_id, i.value, i.status, i.activation_at, i.print_status,
            i.created_at, i.updated_at, i.deactivated_at, i.order_id, i.replaced_by_id,
            u.email, u.role, u.created_at AS user_created_at,
            o.order_number, o.design_id, o.design_name, o.sticker_quantity
     FROM identifiers i
     LEFT JOIN users u ON u.id = i.user_id
     ${designJoin}
     ${whereSql} ${whereDesign}
     ORDER BY i.created_at DESC, i.id DESC
     LIMIT ? OFFSET ?`,
    allParams.concat([l, offset])
  );

  const [countRow] = await db.query(
    `SELECT COUNT(*) AS total FROM identifiers i
     LEFT JOIN users u ON u.id = i.user_id
     ${designJoin}
     ${whereSql} ${whereDesign}`,
    allParams
  );

  return {
    qrs: rows.map((r) => ({
      id: r.id,
      user_id: r.user_id,
      value: r.value,
      status: r.status,
      activation_at: r.activation_at,
      print_status: r.print_status,
      created_at: r.created_at,
      updated_at: r.updated_at,
      deactivated_at: r.deactivated_at,
      order_id: r.order_id,
      replaced_by_id: r.replaced_by_id,
      user: { id: r.user_id, email: r.email, role: r.role, created_at: r.user_created_at },
      order: r.order_id ? { id: r.order_id, order_number: r.order_number, design_id: r.design_id, design_name: r.design_name, sticker_quantity: r.sticker_quantity } : null,
    })),
    pagination: { page: p, limit: l, total: countRow.total, pages: Math.ceil(countRow.total / l) },
  };
};

const qrStats = async () => {
  const byStatus = await db.query(
    `SELECT status, COUNT(*) AS total FROM identifiers GROUP BY status`
  );
  const byPrint = await db.query(
    `SELECT print_status, COUNT(*) AS total FROM identifiers GROUP BY print_status`
  );
  const linked = await db.query(
    `SELECT COUNT(*) AS total FROM identifiers WHERE user_id IS NOT NULL`
  );
  const unlinked = await db.query(
    `SELECT COUNT(*) AS total FROM identifiers WHERE user_id IS NULL`
  );
  const totalRow = await db.query('SELECT COUNT(*) AS total FROM identifiers');
  return {
    total: totalRow[0].total,
    by_status: byStatus.reduce((acc, r) => { acc[r.status] = Number(r.total); return acc; }, {}),
    by_print_status: byPrint.reduce((acc, r) => { acc[r.print_status] = Number(r.total); return acc; }, {}),
    linked: Number(linked[0].total),
    unlinked: Number(unlinked[0].total),
  };
};

// Vincula un QR disponible a un usuario (transaccional, auditable, restringido).
const linkQrToUser = async ({ qrId, userId, actorId, ipAddress = null }) => {
  const conn = await db.getConnection();
  try {
    await conn.query('START TRANSACTION');

    const [qrRows] = await conn.query(
      'SELECT id, value, user_id, status, print_status FROM identifiers WHERE id = ? FOR UPDATE',
      [qrId]
    );
    if (qrRows.length === 0) {
      await conn.query('ROLLBACK');
      return { error: 'qr_not_found', status: 404 };
    }
    const qr = qrRows[0];

    // Nunca reasignar un QR ya impreso, entregado o vinculado a otro usuario.
    if (qr.user_id && qr.user_id !== userId) {
      await conn.query('ROLLBACK');
      return { error: 'qr_already_linked', status: 409 };
    }
    if (qr.print_status === 'printed' || qr.print_status === 'delivered' || qr.status === 'replaced') {
      await conn.query('ROLLBACK');
      return { error: 'qr_not_eligible', status: 409 };
    }

    // El usuario destino no puede tener otro QR vigente.
    const [userRows] = await conn.query(
      'SELECT id, value, status FROM identifiers WHERE user_id = ? AND status IN (?, ?) FOR UPDATE',
      [userId, 'active', 'pending_activation']
    );
    if (userRows.length > 0) {
      await conn.query('ROLLBACK');
      return { error: 'user_already_has_qr', status: 409 };
    }

    await conn.query(
      'UPDATE identifiers SET user_id = ?, status = COALESCE(NULLIF(status, ?), ?) WHERE id = ?',
      [userId, 'pending_activation', 'pending_activation', qrId]
    );
    await conn.query('UPDATE emergency_profiles SET is_active = 1 WHERE user_id = ?', [userId]);
    await conn.query(
      'INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, metadata, ip_address) VALUES (?, ?, ?, ?, ?, ?)',
      [
        actorId,
        'qr.link_to_user',
        'identifiers',
        String(qrId),
        JSON.stringify({ value: qr.value, user_id: userId, previous_user_id: qr.user_id }),
        ipAddress,
      ]
    );

    await conn.query('COMMIT');
    return { qr_id: qrId, value: qr.value, user_id: userId, status: 'pending_activation' };
  } catch (error) {
    await conn.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    conn.release();
  }
};

// Desvincula un QR de su usuario (transaccional, auditable). No borra historial.
const unlinkQrFromUser = async ({ qrId, actorId, ipAddress = null }) => {
  const conn = await db.getConnection();
  try {
    await conn.query('START TRANSACTION');

    const [qrRows] = await conn.query(
      'SELECT id, value, user_id, status, print_status FROM identifiers WHERE id = ? FOR UPDATE',
      [qrId]
    );
    if (qrRows.length === 0) {
      await conn.query('ROLLBACK');
      return { error: 'qr_not_found', status: 404 };
    }
    const qr = qrRows[0];
    if (!qr.user_id) {
      await conn.query('ROLLBACK');
      return { error: 'qr_not_linked', status: 409 };
    }
    // Nunca desvincular automáticamente un QR impreso/entregado: requiere acción explícita de admin y queda auditado.
    if (qr.print_status === 'delivered') {
      await conn.query('ROLLBACK');
      return { error: 'qr_delivered_cannot_unlink', status: 409 };
    }

    const previousUserId = qr.user_id;
    await conn.query(
      'UPDATE identifiers SET user_id = NULL, status = ? WHERE id = ?',
      ['deactivated', qrId]
    );
    await conn.query(
      'INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, metadata, ip_address) VALUES (?, ?, ?, ?, ?, ?)',
      [
        actorId,
        'qr.unlink_from_user',
        'identifiers',
        String(qrId),
        JSON.stringify({ value: qr.value, previous_user_id: previousUserId }),
        ipAddress,
      ]
    );

    await conn.query('COMMIT');
    return { qr_id: qrId, value: qr.value, user_id: null, status: 'deactivated' };
  } catch (error) {
    await conn.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    conn.release();
  }
};

// Cambia el estado de producción/impresión de un QR (independiente de activación).
const setQrPrintStatus = async ({ qrId, printStatus, actorId, ipAddress = null }) => {
  const valid = ['pending_print', 'sent_to_print', 'printed', 'delivered', 'cancelled'];
  if (!valid.includes(printStatus)) {
    return { error: 'invalid_print_status', status: 400 };
  }
  const conn = await db.getConnection();
  try {
    await conn.query('START TRANSACTION');

    const [qrRows] = await conn.query(
      'SELECT id, value, user_id, print_status, status FROM identifiers WHERE id = ? FOR UPDATE',
      [qrId]
    );
    if (qrRows.length === 0) {
      await conn.query('ROLLBACK');
      return { error: 'qr_not_found', status: 404 };
    }
    const qr = qrRows[0];
    const previous = qr.print_status;

    await conn.query(
      'UPDATE identifiers SET print_status = ? WHERE id = ?',
      [printStatus, qrId]
    );
    await conn.query(
      'INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, metadata, ip_address) VALUES (?, ?, ?, ?, ?, ?)',
      [
        actorId,
        'qr.print_status_change',
        'identifiers',
        String(qrId),
        JSON.stringify({ value: qr.value, previous_print_status: previous, new_print_status: printStatus }),
        ipAddress,
      ]
    );

    await conn.query('COMMIT');
    return { qr_id: qrId, value: qr.value, previous_print_status: previous, print_status: printStatus };
  } catch (error) {
    await conn.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    conn.release();
  }
};

// Obtiene identificadores por sus IDs (para exportación de producción), con usuario, pedido y diseño.
const fetchQrsByIds = async (qrIds) => {
  if (!qrIds || qrIds.length === 0) {return [];}
  const placeholders = qrIds.map(() => '?').join(',');
  return db.query(
    `SELECT i.id, i.user_id, i.value, i.status, i.activation_at, i.print_status, i.created_at, i.order_id,
            u.email, u.role,
            o.order_number, o.design_id, o.design_name, o.sticker_quantity
     FROM identifiers i
     LEFT JOIN users u ON u.id = i.user_id
     LEFT JOIN orders o ON o.id = i.order_id
     WHERE i.id IN (${placeholders})
     ORDER BY i.created_at DESC`,
    qrIds
  );
};

// Exportación CSV de producción por IDs de QR.
const exportQrsByIdsCsv = async (qrIds) => {
  const rows = await fetchQrsByIds(qrIds);
  if (rows.length === 0) {
    return { error: 'no_qrs', status: 404 };
  }
  const csv = buildQrCsv(rows);
  return { csv };
};

// Exportación ZIP de producción por IDs de QR (imágenes individuales + CSV embebido).
const exportQrsByIdsZip = async (qrIds, res) => {
  const rows = await fetchQrsByIds(qrIds);
  if (rows.length === 0) {
    return { error: 'no_qrs', status: 404 };
  }

  const archiver = require('archiver');
  const archive = archiver('zip', { zlib: { level: 6 } });

  res.set('Content-Type', 'application/zip');
  res.set('Content-Disposition', 'attachment; filename="qrs-produccion.zip"');
  res.set('Cache-Control', 'private, no-store');

  archive.pipe(res);

  archive.on('error', () => {
    if (!res.headersSent) {
      return res.status(500).json({ error: 'Error generando el ZIP', code: 'zip_error' });
    }
    res.end();
  });

  for (const row of rows) {
    try {
      const png = await generateQrBuffer(row.value);
      archive.append(png, { name: `QR_${row.value}.png` });
    } catch {
      // Si falla una imagen, se omite del ZIP pero continúa el resto.
    }
  }

  const csv = buildQrCsv(rows);
  archive.append(csv, { name: 'identificacion_qrs.csv' });

  await archive.finalize();
  return { sent: true };
};

// Exportación PDF de producción por IDs de QR (cuadrícula para impresión de stickers).
const exportQrsByIdsPdf = async (qrIds, res, query = {}) => {
  const rows = await fetchQrsByIds(qrIds);
  if (rows.length === 0) {
    return { error: 'no_qrs', status: 404 };
  }

  const PDFDocument = require('pdfkit');
  const { columns = '3', rowsPerPage = '5', size_mm = '25', gap_mm = '8', margin_mm = '12' } = query;

  const columnsNum = Math.max(1, Math.min(10, parseInt(columns, 10) || 3));
  const rowsNum = Math.max(1, Math.min(20, parseInt(rowsPerPage, 10) || 5));
  const size = Math.max(15, Math.min(100, parseFloat(size_mm) || 25));
  const gap = Math.max(0, Math.min(30, parseFloat(gap_mm) || 8));
  const margin = Math.max(0, Math.min(40, parseFloat(margin_mm) || 12));

  const MM_TO_PT = 2.834645669;
  const pageW = 210 * MM_TO_PT;
  const pageH = 297 * MM_TO_PT;
  const gapPt = gap * MM_TO_PT;
  const marginPt = margin * MM_TO_PT;
  const usableW = pageW - 2 * marginPt;
  const usableH = pageH - 2 * marginPt;
  const cellW = size * MM_TO_PT;
  const cellH = size * MM_TO_PT;
  const maxCellW = (usableW - (columnsNum - 1) * gapPt) / columnsNum;
  const maxCellH = (usableH - (rowsNum - 1) * gapPt) / rowsNum;
  const cellPt = Math.min(cellW, cellH, maxCellW, maxCellH);

  const doc = new PDFDocument({ size: 'A4', layout: 'portrait', margin: 0 });
  const buffers = [];
  doc.on('data', (b) => buffers.push(b));
  const end = new Promise((resolve) => doc.on('end', resolve));

  res.set('Content-Type', 'application/pdf');
  res.set('Content-Disposition', 'attachment; filename="qrs-produccion.pdf"');
  res.set('Cache-Control', 'private, no-store');

  doc.pipe(res);

  let index = 0;
  const total = rows.length;
  while (index < total) {
    if (index > 0) {
      doc.addPage();
    }
    for (let r = 0; r < rowsNum && index < total; r++) {
      for (let c = 0; c < columnsNum && index < total; c++) {
        const row = rows[index];
        const x = marginPt + c * (cellPt + gapPt);
        const y = marginPt + r * (cellPt + gapPt);
        let png;
        try {
          png = await generateQrBuffer(row.value);
        } catch {
          index += 1;
          continue;
        }
        doc.image(png, x, y, { fit: [cellPt, cellPt], align: 'center', valign: 'center' });
        doc.fontSize(7).fillColor('#0b1016').text(row.value, x, y + cellPt + 2, {
          width: cellPt,
          align: 'center',
        });
        index += 1;
      }
    }
  }

  doc.end();
  await end;
  return { sent: true };
};

module.exports = {
  generateIdentifierValue,
  buildPublicUrl,
  generateQrBuffer,
  createIdentifier,
  getMyIdentifier,
  deactivateIdentifier,
  replaceIdentifier,
  downloadQr,
  getQrImage,
  getIdentifierDetail,
  exportQrsCsv,
  exportQrsZip,
  exportQrsPdf,
  bulkUpdatePrintStatus,
  ensureOrCreatePendingQr,
  activateQr,
  ensureProfileTx,
  listQrsAdmin,
  qrStats,
  linkQrToUser,
  unlinkQrFromUser,
  setQrPrintStatus,
  fetchQrsByIds,
  exportQrsByIdsCsv,
  exportQrsByIdsZip,
  exportQrsByIdsPdf,
};
