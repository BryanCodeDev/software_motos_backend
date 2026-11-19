const db = require('../../config/db');

const listPackages = async (req, res) => {
  const { q, line, is_active, is_visible, page = '1', limit = '25' } = req.query;
  const p = Math.max(1, parseInt(page, 10) || 1);
  const l = Math.min(100, Math.max(1, parseInt(limit, 10) || 25));
  const offset = (p - 1) * l;

  const where = [];
  const params = [];
  if (q) {
    where.push('(pp.name LIKE ? OR pp.slug LIKE ?)');
    params.push(`%${q}%`, `%${q}%`);
  }
  if (line && ['person', 'pet', 'combo'].includes(line)) {
    where.push('pp.line = ?');
    params.push(line);
  }
  if (is_active !== undefined) {
    where.push('pp.is_active = ?');
    params.push(is_active === 'true' || is_active === true ? 1 : 0);
  }
  if (is_visible !== undefined) {
    where.push('pp.is_visible = ?');
    params.push(is_visible === 'true' || is_visible === true ? 1 : 0);
  }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';

  const rows = await db.query(
    `SELECT pp.*,
          (SELECT JSON_ARRAYAGG(JSON_OBJECT(
            'id', p.id,
            'profile_type', p.profile_type,
            'quantity_profiles', p.quantity_profiles,
            'stickers_per_profile', p.stickers_per_profile
          ))
           FROM package_profiles p WHERE p.package_id = pp.id ORDER BY p.id) AS package_profiles
     FROM product_packages pp
     ${whereSql}
     ORDER BY pp.sort_order ASC, pp.id ASC
     LIMIT ? OFFSET ?`,
    params.concat([l, offset])
  );
  const [countRow] = await db.query(
    `SELECT COUNT(*) AS total FROM product_packages pp ${whereSql}`,
    params
  );

  const packages = rows.map((row) => {
    let profiles = row.package_profiles;
    if (typeof profiles === 'string') {
      try { profiles = profiles ? JSON.parse(profiles) : []; } catch { profiles = []; }
    } else if (!Array.isArray(profiles)) {
      profiles = [];
    }
    return { ...row, package_profiles: profiles };
  });

  return res.json({
    packages,
    pagination: { page: p, limit: l, total: countRow.total, pages: Math.ceil(countRow.total / l) },
  });
};

const getPackage = async (req, res) => {
  const { id } = req.params;
  const rows = await db.query('SELECT * FROM product_packages WHERE id = ?', [id]);
  if (!rows.length) {
    return res.status(404).json({ error: 'Paquete no encontrado', code: 'package_not_found' });
  }
  const pkg = rows[0];
  const profiles = await db.query(
    'SELECT id, package_id, profile_type, quantity_profiles, stickers_per_profile FROM package_profiles WHERE package_id = ? ORDER BY id',
    [id]
  );
  return res.json({ package: { ...pkg, package_profiles: profiles } });
};

const createPackage = async (req, res) => {
  const data = req.validated.body;
  const slug = data.slug || data.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');

  const conn = await db.getConnection();
  let packageId;
  try {
    await conn.query('START TRANSACTION');

    const [result] = await conn.query(
      `INSERT INTO product_packages
        (name, slug, description, line, profile_count, sticker_count, price, currency,
         original_price, discount_percent, is_active, is_visible, sort_order, valid_from, valid_to)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.name, slug, data.description || null, data.line || 'person',
        data.profile_count || 1, data.sticker_count || 0, data.price, data.currency || 'COP',
        data.original_price || null, data.discount_percent || null,
        data.is_active === undefined ? 1 : data.is_active ? 1 : 0,
        data.is_visible === undefined ? 1 : data.is_visible ? 1 : 0,
        data.sort_order === undefined ? 0 : data.sort_order,
        data.valid_from || null, data.valid_to || null,
      ]
    );
    packageId = result.insertId;

    // Registrar historial de precio inicial.
    await conn.query(
      `INSERT INTO price_history (package_id, old_price, new_price, currency, changed_by, changed_at, reason)
       VALUES (?, NULL, ?, ?, ?, NOW(), 'creacion_paquete')`,
      [packageId, data.price, data.currency || 'COP', req.user.id]
    );

    // Insertar perfiles del paquete si se proporcionan.
    const packageProfiles = data.package_profiles || [];
    for (const pp of packageProfiles) {
      await conn.query(
        `INSERT INTO package_profiles (package_id, profile_type, quantity_profiles, stickers_per_profile)
         VALUES (?, ?, ?, ?)`,
        [packageId, pp.profile_type || 'person', pp.quantity_profiles || 1, pp.stickers_per_profile || 2]
      );
    }

    await conn.query(
      'INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, metadata, ip_address) VALUES (?, ?, ?, ?, ?, ?)',
      [req.user.id, 'package.create', 'product_packages', String(packageId), JSON.stringify({ name: data.name, price: data.price }), req.ip]
    );

    await conn.query('COMMIT');
  } catch (error) {
    await conn.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    conn.release();
  }

  return res.status(201).json({ packageId, slug, message: 'Paquete creado' });
};

const updatePackage = async (req, res) => {
  const { id } = req.params;
  const data = req.validated.body;

  // Verificar existencia y capturar precio anterior para historial.
  const existing = await db.query('SELECT * FROM product_packages WHERE id = ?', [id]);
  if (!existing.length) {
    return res.status(404).json({ error: 'Paquete no encontrado', code: 'package_not_found' });
  }
  const oldPkg = existing[0];

  const fields = [];
  const values = [];
  const setIf = (key, val) => {
    if (val !== undefined) {
      fields.push(`${key} = ?`);
      values.push(val);
    }
  };
  setIf('name', data.name);
  if (data.slug !== undefined) {
    fields.push('slug = ?');
    values.push(data.slug);
  }
  setIf('description', data.description === undefined ? null : data.description);
  setIf('line', data.line);
  setIf('profile_count', data.profile_count);
  setIf('sticker_count', data.sticker_count);
  setIf('price', data.price);
  setIf('currency', data.currency);
  setIf('original_price', data.original_price === undefined ? null : data.original_price);
  setIf('discount_percent', data.discount_percent);
  setIf('is_active', data.is_active === undefined ? undefined : data.is_active ? 1 : 0);
  setIf('is_visible', data.is_visible === undefined ? undefined : data.is_visible ? 1 : 0);
  setIf('sort_order', data.sort_order);
  setIf('valid_from', data.valid_from === undefined ? null : data.valid_from);
  setIf('valid_to', data.valid_to === undefined ? null : data.valid_to);

  if (fields.length === 0) {
    return res.status(400).json({ error: 'No hay campos para actualizar' });
  }
  values.push(id);

  const conn = await db.getConnection();
  try {
    await conn.query('START TRANSACTION');
    await conn.query(`UPDATE product_packages SET ${fields.join(', ')} WHERE id = ?`, values);

    // Historial de precio si cambió.
    if (data.price !== undefined && parseFloat(data.price) !== parseFloat(oldPkg.price)) {
      await conn.query(
        `INSERT INTO price_history (package_id, old_price, new_price, currency, changed_by, changed_at, reason)
         VALUES (?, ?, ?, ?, ?, NOW(), 'actualizacion_precio')`,
        [id, oldPkg.price, data.price, data.currency || oldPkg.currency, req.user.id]
      );
    }

    // Actualizar perfiles del paquete si se proporcionan.
    if (data.package_profiles !== undefined) {
      await conn.query('DELETE FROM package_profiles WHERE package_id = ?', [id]);
      for (const pp of data.package_profiles) {
        await conn.query(
          `INSERT INTO package_profiles (package_id, profile_type, quantity_profiles, stickers_per_profile)
           VALUES (?, ?, ?, ?)`,
          [id, pp.profile_type || 'person', pp.quantity_profiles || 1, pp.stickers_per_profile || 2]
        );
      }
    }

    await conn.query(
      'INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, metadata, ip_address) VALUES (?, ?, ?, ?, ?, ?)',
      [req.user.id, 'package.update', 'product_packages', String(id), JSON.stringify({ fields: fields.map(f => f.split(' = ')[0]) }), req.ip]
    );
    await conn.query('COMMIT');
  } catch (error) {
    await conn.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    conn.release();
  }

  return res.json({ message: 'Paquete actualizado' });
};

const deletePackage = async (req, res) => {
  const { id } = req.params;
  const existing = await db.query('SELECT id FROM product_packages WHERE id = ?', [id]);
  if (!existing.length) {
    return res.status(404).json({ error: 'Paquete no encontrado', code: 'package_not_found' });
  }
  // No borrar físicamente: desactivar.
  await db.query('UPDATE product_packages SET is_active = 0 WHERE id = ?', [id]);
  await db.query(
    'INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, metadata, ip_address) VALUES (?, ?, ?, ?, ?, ?)',
    [req.user.id, 'package.deactivate', 'product_packages', String(id), JSON.stringify({}), req.ip]
  );
  return res.json({ message: 'Paquete desactivado' });
};

const getPriceHistory = async (req, res) => {
  const { package_id } = req.query;
  const where = [];
  const params = [];
  if (package_id) {
    where.push('package_id = ?');
    params.push(package_id);
  }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const rows = await db.query(
    `SELECT ph.*, u.email AS changed_by_email
     FROM price_history ph
     LEFT JOIN users u ON u.id = ph.changed_by
     ${whereSql}
     ORDER BY ph.changed_at DESC
     LIMIT 100`,
    params
  );
  return res.json({ price_history: rows });
};

module.exports = {
  listPackages,
  getPackage,
  createPackage,
  updatePackage,
  deletePackage,
  getPriceHistory,
};
