const crypto = require('crypto');
const db = require('../../config/db');
const emailService = require('../../domains/email/email.service');

const STICKER_PRODUCT_SLUG = 'sticker-qr-personalizado';
const STICKER_PACK_QUANTITY = 2;
const STICKER_CURRENCY = 'COP';

const generateOrderNumber = () => {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const random = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `EID-${date}-${random}`;
};

const listOrders = async (req, res) => {
  const rows = await db.query(
    `SELECT o.id, o.order_number, o.design_id, o.design_name, o.design_image_url, o.sticker_quantity,
            o.variant_id, o.commercial_status, o.payment_status, o.total_amount, o.currency,
            o.shipping_address, o.created_at, o.updated_at,
            p.name AS product_name, p.slug AS product_slug
     FROM orders o
     JOIN products p ON o.product_id = p.id
     WHERE o.user_id = ?
     ORDER BY o.created_at DESC`,
    [req.user.id]
  );
  return res.json({ orders: rows });
};

const getOrder = async (req, res) => {
  const { id } = req.params;
  const orders = await db.query(
    `SELECT o.id, o.order_number, o.design_id, o.design_name, o.design_image_url, o.sticker_quantity,
            o.variant_id, o.commercial_status, o.payment_status, o.total_amount, o.currency,
            o.shipping_address, o.created_at, o.updated_at,
            p.name AS product_name, p.slug AS product_slug
     FROM orders o
     JOIN products p ON o.product_id = p.id
     WHERE o.id = ? AND o.user_id = ?`,
    [id, req.user.id]
  );
  if (orders.length === 0) {
    return res.status(404).json({ error: 'Pedido no encontrado' });
  }
  const items = await db.query(
    'SELECT * FROM order_items WHERE order_id = ?',
    [id]
  );
  const events = await db.query(
    'SELECT type, status, amount, created_at FROM payment_events WHERE order_id = ? ORDER BY created_at DESC',
    [id]
  );
  return res.json({ order: { ...orders[0], items, events } });
};

const createOrder = async (req, res) => {
  const { product_id, design_id, variant_id, shipping_address, customization } = req.validated.body;
  const userId = req.user.id;

  const conn = await db.getConnection();
  try {
    await conn.query('START TRANSACTION');

    const [products] = await conn.query(
      'SELECT id, name, price, currency, slug FROM products WHERE id = ? AND is_active = 1',
      [product_id]
    );
    if (products.length === 0) {
      await conn.query('ROLLBACK');
      return res.status(404).json({ error: 'Producto no disponible' });
    }
    const product = products[0];

    const requiresDesign = product.slug === STICKER_PRODUCT_SLUG;

    // El producto de stickers exige un diseño seleccionado, disponible y vinculado al producto.
    let design = null;
    if (requiresDesign) {
      if (!design_id) {
        await conn.query('ROLLBACK');
        return res.status(400).json({ error: 'Debes seleccionar un diseño para comprar los stickers.', code: 'design_required' });
      }
      if (!shipping_address) {
        await conn.query('ROLLBACK');
        return res.status(400).json({ error: 'La dirección de envío es requerida para los stickers.', code: 'shipping_required' });
      }
      const [designs] = await conn.query(
        'SELECT id, name, image_url FROM product_designs WHERE id = ? AND product_id = ? AND is_available = 1 LIMIT 1',
        [design_id, product_id]
      );
      if (designs.length === 0) {
        await conn.query('ROLLBACK');
        return res.status(404).json({ error: 'Diseño no disponible', code: 'design_not_available' });
      }
      design = designs[0];
    }

    let priceAdjustment = 0;
    if (variant_id) {
      const [variants] = await conn.query(
        'SELECT price_adjustment FROM product_variants WHERE id = ? AND product_id = ? AND is_active = 1',
        [variant_id, product_id]
      );
      if (variants.length === 0) {
        await conn.query('ROLLBACK');
        return res.status(404).json({ error: 'Variante no disponible' });
      }
      priceAdjustment = variants[0].price_adjustment;
    }

    // El precio se fija exclusivamente en el servidor; el frontend no lo envía ni lo modifica.
    const totalAmount = parseFloat(product.price) + parseFloat(priceAdjustment);
    const currency = product.currency;
    const orderNumber = generateOrderNumber();

    const commercialStatus = totalAmount > 0 ? 'pending_confirmation' : 'paid';
    const paymentStatus = totalAmount > 0 ? 'unpaid' : 'approved';

    const stickerQuantity = requiresDesign ? STICKER_PACK_QUANTITY : 1;

    const [result] = await conn.query(
      `INSERT INTO orders (order_number, user_id, product_id, variant_id, design_id, design_name, design_image_url,
                           sticker_quantity, commercial_status, payment_status, total_amount, currency, shipping_address, customization)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        orderNumber,
        userId,
        product_id,
        variant_id || null,
        design ? design.id : null,
        design ? design.name : null,
        design ? design.image_url : null,
        stickerQuantity,
        commercialStatus,
        paymentStatus,
        totalAmount,
        currency,
        shipping_address ? JSON.stringify(shipping_address) : null,
        customization ? JSON.stringify(customization) : null,
      ]
    );

    // Paquete de stickers: exactamente 2 unidades del mismo diseño. Precio unitario = total / 2.
    const itemQuantity = requiresDesign ? STICKER_PACK_QUANTITY : 1;
    const itemUnitPrice = requiresDesign ? parseFloat((totalAmount / STICKER_PACK_QUANTITY).toFixed(2)) : totalAmount;
    await conn.query(
      'INSERT INTO order_items (order_id, product_id, name, price, quantity) VALUES (?, ?, ?, ?, ?)',
      [result.insertId, product_id, product.name, itemUnitPrice, itemQuantity]
    );

    if (totalAmount > 0) {
      await conn.query(
        'INSERT INTO payment_events (order_id, type, status, amount, raw) VALUES (?, ?, ?, ?, ?)',
        [result.insertId, 'created', 'unpaid', totalAmount, JSON.stringify({ totalAmount, currency, design: design ? { id: design.id, name: design.name } : null })]
      );
    }

    await conn.query(
      'INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, metadata, ip_address) VALUES (?, ?, ?, ?, ?, ?)',
      [userId, 'order.create', 'orders', String(result.insertId), JSON.stringify({ order_number: orderNumber, total_amount: totalAmount, currency, design_id: design ? design.id : null, sticker_quantity: stickerQuantity }), null]
    );

    // Compra de stickers físicos: crear el identifier (QR) vinculado al perfil principal
    // del usuario, en estado pending_activation. Se activa al aprobarse el pago.
    if (requiresDesign && paymentStatus === 'unpaid') {
      try {
        const [mainProfiles] = await conn.query(
          'SELECT id FROM emergency_profiles WHERE user_id = ? AND is_main = 1 LIMIT 1',
          [userId]
        );
        if (mainProfiles.length > 0) {
          const profileId = mainProfiles[0].id;
          const [existingIdentifier] = await conn.query(
            'SELECT id FROM identifiers WHERE user_id = ? AND profile_id = ? AND status IN (?, ?) LIMIT 1',
            [userId, profileId, 'pending_activation', 'active']
          );
          if (existingIdentifier.length === 0) {
            const value = crypto.randomBytes(8).toString('hex');
            await conn.query(
              'INSERT INTO identifiers (user_id, profile_id, value, status, order_id) VALUES (?, ?, ?, ?, ?)',
              [userId, profileId, value, 'pending_activation', result.insertId]
            );
          }
        }
      } catch {
        // No bloquear la creación del pedido si la reserva del QR falla.
      }
    }

    await conn.query('COMMIT');

    const order = {
      id: result.insertId,
      order_number: orderNumber,
      product_name: product.name,
      design_id: design ? design.id : null,
      design_name: design ? design.name : null,
      design_image_url: design ? design.image_url : null,
      sticker_quantity: stickerQuantity,
      commercial_status: commercialStatus,
      payment_status: paymentStatus,
      total_amount: totalAmount,
      currency,
    };

    // Confirmación de pedido (transaccional: el backend verifica antes de notificar)
    try {
      const [user] = await conn.query('SELECT email FROM users WHERE id = ?', [userId]);
      if (user[0]) {
        await emailService.sendOrderConfirmation(user[0].email, {
          orderNumber,
          totalAmount,
          currency,
          status: commercialStatus,
          customerEmail: user[0].email,
          productName: product.name,
        });
      }
    } catch {
    }

    return res.status(201).json({ order });
  } catch (error) {
    await conn.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    conn.release();
  }
};

/* ───────── Compra de stickers (precio desde el catálogo) ─────────
   Dos stickers del mismo diseño por perfil. El precio se obtiene del producto
   en la base de datos (única fuente de verdad); el frontend no lo envía ni lo
   modifica. El diseño se asocia al pedido (no al identificador QR).
   ────────────────────────────────────────────────── */
const createStickerOrder = async (req, res) => {
  const { design_id } = req.validated.body;
  const userId = req.user.id;

  const conn = await db.getConnection();
  try {
    await conn.query('START TRANSACTION');

    // Precio obtenido del catálogo (única fuente de verdad).
    const [products] = await conn.query(
      'SELECT id, name, price, currency FROM products WHERE slug = ? AND is_active = 1 AND is_purchasable = 1 LIMIT 1',
      [STICKER_PRODUCT_SLUG]
    );
    if (products.length === 0) {
      await conn.query('ROLLBACK');
      return res.status(404).json({ error: 'Producto de stickers no disponible', code: 'sticker_product_not_available' });
    }
    const product = products[0];

    // Precio fijo del servidor; el frontend no lo envía ni lo modifica
    const totalAmount = parseFloat(product.price);
    const currency = product.currency || STICKER_CURRENCY;
    const orderNumber = generateOrderNumber();

    const commercialStatus = 'pending_confirmation';
    const paymentStatus = 'unpaid';

    const [result] = await conn.query(
      `INSERT INTO orders (order_number, user_id, product_id, design_id, design_name, design_image_url,
                           sticker_quantity, commercial_status, payment_status, total_amount, currency, shipping_address, customization)
       VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, NULL, ?)`,
      [
        orderNumber,
        userId,
        product.id,
        design_id,
        STICKER_PACK_QUANTITY,
        commercialStatus,
        paymentStatus,
        totalAmount,
        currency,
        JSON.stringify({ tipo: 'compra_stickers_simplificada', diseño_seleccionado: design_id }),
      ]
    );

    // Ítem del pedido: 2 stickers del mismo diseño, precio unitario = total / 2
    const itemUnitPrice = parseFloat((totalAmount / STICKER_PACK_QUANTITY).toFixed(2));
    await conn.query(
      'INSERT INTO order_items (order_id, product_id, name, price, quantity) VALUES (?, ?, ?, ?, ?)',
      [result.insertId, product.id, product.name, itemUnitPrice, STICKER_PACK_QUANTITY]
    );

    // Evento de pago inicial
    await conn.query(
      'INSERT INTO payment_events (order_id, type, status, amount, raw) VALUES (?, ?, ?, ?, ?)',
      [result.insertId, 'created', 'unpaid', totalAmount, JSON.stringify({ totalAmount, currency, design_id })]
    );

    await conn.query(
      'INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, metadata, ip_address) VALUES (?, ?, ?, ?, ?, ?)',
      [userId, 'order.create_stickers', 'orders', String(result.insertId), JSON.stringify({ order_number: orderNumber, total_amount: totalAmount, currency, design_id, sticker_quantity: STICKER_PACK_QUANTITY }), null]
    );

    // Compra de stickers físicos: crear el identificador QR vinculado al perfil principal
    // del usuario, en estado pending_activation. Se activa al aprobarse el pago (webhook).
    try {
      const [mainProfiles] = await conn.query(
        'SELECT id FROM emergency_profiles WHERE user_id = ? AND is_main = 1 LIMIT 1',
        [userId]
      );
      if (mainProfiles.length > 0) {
        const profileId = mainProfiles[0].id;
        const [existingIdentifier] = await conn.query(
          'SELECT id FROM identifiers WHERE user_id = ? AND profile_id = ? AND status IN (?, ?) LIMIT 1',
          [userId, profileId, 'pending_activation', 'active']
        );
        if (existingIdentifier.length === 0) {
          const value = crypto.randomBytes(8).toString('hex');
          await conn.query(
            'INSERT INTO identifiers (user_id, profile_id, value, status, order_id) VALUES (?, ?, ?, ?, ?)',
            [userId, profileId, value, 'pending_activation', result.insertId]
          );
          await conn.query(
            'INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, metadata, ip_address) VALUES (?, ?, ?, ?, ?, ?)',
            [userId, 'identifier.create.pending_stickers', 'identifiers', String(result.insertId), JSON.stringify({ order_id: result.insertId, order_number: orderNumber, profile_id: profileId }), null]
          );
        }
      }
    } catch {
      // No bloquear la creación del pedido si la reserva del QR falla.
    }

    await conn.query('COMMIT');

    return res.status(201).json({
      order: {
        id: result.insertId,
        order_number: orderNumber,
        design_id,
        sticker_quantity: STICKER_PACK_QUANTITY,
        commercial_status: commercialStatus,
        payment_status: paymentStatus,
        total_amount: totalAmount,
        currency,
      },
    });
  } catch (error) {
    await conn.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    conn.release();
  }
};

/* ───────── Compra de paquete comercial multi-perfil ─────────
   Crea un pedido vinculado a un product_package con uno o varios perfiles.
   El precio y la composición se validan exclusivamente en el servidor.
   Los perfiles pueden ser existentes (pertenecientes al usuario) o nuevos
   (se crean durante la compra). Cada perfil recibe su propio QR permanente
   tras la aprobación del pago (gestionado por el webhook).
  ────────────────────────────────────────────────── */
const createPackageOrder = async (req, res) => {
  const { package_id, profile_ids, new_profiles, shipping_address, customization } = req.validated.body;
  const userId = req.user.id;

  const conn = await db.getConnection();
  try {
    await conn.query('START TRANSACTION');

    // 1. Validar que el paquete exista y esté activo/visible.
    const [packages] = await conn.query(
      `SELECT id, name, slug, line, profile_count, sticker_count, price, currency,
              is_active, is_visible
       FROM product_packages
       WHERE id = ? AND is_active = 1 AND is_visible = 1`,
      [package_id]
    );
    if (!packages.length) {
      await conn.query('ROLLBACK');
      return res.status(404).json({ error: 'Paquete no disponible', code: 'package_not_available' });
    }
    const pkg = packages[0];

    // 2. Validar perfiles existentes: deben pertenecer al usuario.
    const existingProfiles = [];
    if (profile_ids && profile_ids.length > 0) {
      const placeholders = profile_ids.map(() => '?').join(',');
      const rows = await conn.query(
        `SELECT id, profile_type, is_active FROM emergency_profiles
         WHERE id IN (${placeholders}) AND user_id = ?`,
        [...profile_ids, userId]
      );
      if (rows.length !== profile_ids.length) {
        await conn.query('ROLLBACK');
        return res.status(400).json({ error: 'Uno o más perfiles no pertenecen a esta cuenta', code: 'profiles_not_owned' });
      }
      existingProfiles.push(...rows);
    }

    // 3. Validar que la cantidad de perfiles coincida con el paquete.
    const totalProfiles = existingProfiles.length + (new_profiles ? new_profiles.length : 0);
    if (totalProfiles !== pkg.profile_count) {
      await conn.query('ROLLBACK');
      return res.status(400).json({
        error: `El paquete requiere ${pkg.profile_count} perfil(es), se proporcionaron ${totalProfiles}`,
        code: 'profile_count_mismatch',
      });
    }

    // 4. Crear perfiles nuevos si se proporcionan.
    const createdProfiles = [];
    if (new_profiles && new_profiles.length > 0) {
      for (const np of new_profiles) {
        const {
          profile_type = 'person',
          relationship,
          display_name = '',
          is_managed_by_third_party = 0,
          consent_accepted = 0,
          // campos persona
          blood_type, date_of_birth, height_cm, weight_kg, is_pregnant, medical_devices,
          primary_doctor_name, primary_doctor_phone, insurance_company,
          insurance_policy_number, document_number, is_organ_donor,
          allergies, medical_conditions, medications, additional_info, emergency_note,
          // campos mascota
          pet_species, pet_breed, pet_age, pet_birth_date, pet_sex, pet_weight,
          pet_color, pet_characteristics, pet_microchip, pet_sterilized,
          pet_vaccines, pet_allergies, pet_medications, pet_conditions,
          pet_vet_name, pet_vet_phone, pet_owner_name, pet_owner_phone,
          pet_alternate_contacts, pet_care_instructions, pet_lost = 0, pet_reward,
        } = np;

        if (!['person', 'pet', 'managed_person'].includes(profile_type)) {
          await conn.query('ROLLBACK');
          return res.status(400).json({ error: 'Tipo de perfil inválido', code: 'profile_type_invalid' });
        }
        if (profile_type === 'managed_person' && is_managed_by_third_party && !consent_accepted) {
          await conn.query('ROLLBACK');
          return res.status(400).json({ error: 'Consentimiento requerido para perfil gestionado por tercero', code: 'consent_required' });
        }

        const [result] = await conn.query(
          `INSERT INTO emergency_profiles
            (user_id, profile_type, relationship, is_managed_by_third_party,
             consent_accepted, consent_at, consent_by,
             display_name, blood_type, date_of_birth, height_cm, weight_kg,
             is_pregnant, medical_devices, primary_doctor_name, primary_doctor_phone,
             insurance_company, insurance_policy_number, document_number, is_organ_donor,
             allergies, medical_conditions, medications, additional_info, emergency_note,
             pet_species, pet_breed, pet_age, pet_birth_date, pet_sex, pet_weight,
             pet_color, pet_characteristics, pet_microchip, pet_sterilized,
             pet_vaccines, pet_allergies, pet_medications, pet_conditions,
             pet_vet_name, pet_vet_phone, pet_owner_name, pet_owner_phone,
             pet_alternate_contacts, pet_care_instructions, pet_lost, pet_reward,
             is_active)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                   ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            userId, profile_type, relationship, is_managed_by_third_party ? 1 : 0,
            consent_accepted ? 1 : 0, consent_accepted ? new Date() : null, userId,
            display_name, blood_type, date_of_birth, height_cm, weight_kg,
            is_pregnant ? 1 : 0, medical_devices,
            primary_doctor_name, primary_doctor_phone,
            insurance_company, insurance_policy_number, document_number,
            is_organ_donor ? 1 : 0,
            allergies, medical_conditions, medications, additional_info, emergency_note,
            pet_species, pet_breed, pet_age, pet_birth_date, pet_sex, pet_weight,
            pet_color, pet_characteristics, pet_microchip,
            pet_sterilized !== undefined ? (pet_sterilized ? 1 : 0) : null,
            pet_vaccines, pet_allergies, pet_medications, pet_conditions,
            pet_vet_name, pet_vet_phone, pet_owner_name, pet_owner_phone,
            pet_alternate_contacts, pet_care_instructions,
            pet_lost ? 1 : 0, pet_reward,
            0
          ]
        );
        createdProfiles.push({ id: result.insertId, profile_type, display_name });
      }
    }

    // 5. Calcular totales desde el servidor (precio del paquete, no del frontend).
    const totalAmount = parseFloat(pkg.price);
    const currency = pkg.currency || 'COP';
    const orderNumber = generateOrderNumber();

    const commercialStatus = totalAmount > 0 ? 'pending_confirmation' : 'paid';
    const paymentStatus = totalAmount > 0 ? 'unpaid' : 'approved';

    // 6. Crear la orden.
    const [result] = await conn.query(
      `INSERT INTO orders (order_number, user_id, product_id, package_id, design_id, design_name,
                           design_image_url, sticker_quantity, profile_count, sticker_total,
                           commercial_status, payment_status, total_amount, currency,
                           shipping_address, customization)
       VALUES (?, ?, NULL, ?, NULL, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        orderNumber,
        userId,
        package_id,
        pkg.sticker_count || 0,
        totalProfiles,
        pkg.sticker_count || 0,
        commercialStatus,
        paymentStatus,
        totalAmount,
        currency,
        shipping_address ? JSON.stringify(shipping_address) : null,
        customization ? JSON.stringify(customization) : null,
      ]
    );
    const orderId = result.insertId;

    // 7. Registrar order_profiles (normalizado: un registro por perfil).
    const allProfiles = [...existingProfiles, ...createdProfiles];
    for (const profile of allProfiles) {
      // Determinar stickers para este perfil según la composición del paquete.
      let stickersForProfile = 2; // default
      if (pkg.sticker_count && totalProfiles > 0) {
        stickersForProfile = Math.floor(pkg.sticker_count / totalProfiles);
      }
      await conn.query(
        `INSERT INTO order_profiles (order_id, profile_id, quantity_stickers)
         VALUES (?, ?, ?)`,
        [orderId, profile.id, stickersForProfile]
      );
    }

    // 8. Ítem del pedido: el paquete como línea única.
    await conn.query(
      'INSERT INTO order_items (order_id, product_id, name, price, quantity) VALUES (?, NULL, ?, ?, ?)',
      [orderId, pkg.name, totalAmount, 1]
    );

    if (totalAmount > 0) {
      await conn.query(
        'INSERT INTO payment_events (order_id, type, status, amount, raw) VALUES (?, ?, ?, ?, ?)',
        [orderId, 'created', 'unpaid', totalAmount, JSON.stringify({ totalAmount, currency, package_id, package_name: pkg.name, profile_count: totalProfiles })]
      );
    }

    await conn.query(
      'INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, metadata, ip_address) VALUES (?, ?, ?, ?, ?, ?)',
      [userId, 'order.create_package', 'orders', String(orderId), JSON.stringify({ order_number: orderNumber, package_id, package_name: pkg.name, total_amount: totalAmount, currency, profile_count: totalProfiles }), null]
    );

    await conn.query('COMMIT');

    return res.status(201).json({
      order: {
        id: orderId,
        order_number: orderNumber,
        package_id: pkg.id,
        package_name: pkg.name,
        profile_count: totalProfiles,
        sticker_total: pkg.sticker_count || 0,
        commercial_status: commercialStatus,
        payment_status: paymentStatus,
        total_amount: totalAmount,
        currency,
        profiles: allProfiles.map((p) => ({ id: p.id, profile_type: p.profile_type, display_name: p.display_name || '' })),
      },
    });
  } catch (error) {
    await conn.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    conn.release();
  }
};

const COMMERCIAL_STATUSES = [
  'draft', 'pending_confirmation', 'pending_payment', 'paid', 'preparing',
  'shipped', 'delivered', 'cancelled', 'refund_requested', 'refunded',
];
const PAYMENT_STATUSES = ['unpaid', 'pending', 'approved', 'rejected', 'cancelled', 'refunded'];

/* Transiciones comerciales permitidas. Un pedido no puede saltar estados ni
   retroceder salvo cancelación/reembolso explícito. */
const COMMERCIAL_TRANSITIONS = {
  draft: ['pending_confirmation', 'pending_payment', 'cancelled'],
  pending_confirmation: ['pending_payment', 'paid', 'cancelled'],
  pending_payment: ['paid', 'cancelled'],
  paid: ['preparing', 'cancelled', 'refund_requested'],
  preparing: ['shipped', 'cancelled'],
  shipped: ['delivered', 'cancelled'],
  delivered: [],
  cancelled: [],
  refund_requested: ['refunded', 'cancelled'],
  refunded: [],
};

const isTerminal = (status) => ['delivered', 'cancelled', 'refunded'].includes(status);

/* ───────── Administración: listado paginado con filtros ───────── */
const adminListOrders = async (req, res) => {
  const { q, status, payment_status, dateFrom, dateTo, page = '1', limit = '25' } = req.query;
  const p = Math.max(1, parseInt(page, 10) || 1);
  const l = Math.min(100, Math.max(1, parseInt(limit, 10) || 25));
  const offset = (p - 1) * l;

  const where = [];
  const params = [];
  if (q) {
    const numericQ = /^\d+$/.test(q) ? parseInt(q, 10) : null;
    where.push('(o.order_number LIKE ? OR u.email LIKE ?)');
    params.push(`%${q}%`, `%${q}%`);
    if (numericQ) {
      where.push('OR o.id = ?');
      params.push(numericQ);
    }
  }
  if (status && COMMERCIAL_STATUSES.includes(status)) {
    where.push('AND o.commercial_status = ?');
    params.push(status);
  }
  if (payment_status && PAYMENT_STATUSES.includes(payment_status)) {
    where.push('AND o.payment_status = ?');
    params.push(payment_status);
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
    `SELECT o.id, o.order_number, o.commercial_status, o.payment_status, o.total_amount, o.currency,
            o.carrier, o.tracking_number, o.tracking_url, o.shipped_at, o.delivered_at,
            o.shipping_address, o.created_at, o.updated_at,
            u.id AS user_id, u.email AS customer_email,
            p.name AS product_name, o.design_name, o.sticker_quantity,
            (SELECT i.value FROM identifiers i WHERE i.order_id = o.id ORDER BY i.created_at DESC LIMIT 1) AS qr_value
     FROM orders o
     JOIN users u ON o.user_id = u.id
     JOIN products p ON o.product_id = p.id
     ${whereSql}
     ORDER BY o.created_at DESC
     LIMIT ? OFFSET ?`,
    params.concat([l, offset])
  );
  const [countRow] = await db.query(
    `SELECT COUNT(*) AS total FROM orders o
     JOIN users u ON o.user_id = u.id
     JOIN products p ON o.product_id = p.id
     ${whereSql}`,
    params
  );
  return res.json({
    orders: rows,
    pagination: { page, limit: l, total: countRow.total, pages: Math.ceil(countRow.total / l) },
  });
};

/* ───────── Administración: detalle completo del pedido ───────── */
const adminGetOrder = async (req, res) => {
  const { id } = req.params;
  const orders = await db.query(
    `SELECT o.id, o.order_number, o.commercial_status, o.payment_status, o.total_amount, o.currency,
            o.carrier, o.tracking_number, o.tracking_url, o.shipped_at, o.delivered_at,
            o.shipping_address, o.customization, o.created_at, o.updated_at,
            o.mercado_pago_preference_id, o.mercado_pago_payment_id,
            u.id AS user_id, u.email AS customer_email, u.role AS customer_role,
            p.name AS product_name, p.slug AS product_slug,
            o.design_id, o.design_name, o.design_image_url, o.sticker_quantity, o.variant_id
     FROM orders o
     JOIN users u ON o.user_id = u.id
     JOIN products p ON o.product_id = p.id
     WHERE o.id = ?`,
    [id]
  );
  if (!orders.length) {
    return res.status(404).json({ error: 'Pedido no encontrado' });
  }
  const order = orders[0];

  const items = await db.query(
    'SELECT id, product_id, name, price, quantity FROM order_items WHERE order_id = ? ORDER BY id',
    [id]
  );
  const events = await db.query(
    'SELECT id, type, status, amount, mp_payment_id, created_at FROM payment_events WHERE order_id = ? ORDER BY created_at DESC',
    [id]
  );
  const history = await db.query(
    `SELECT h.id, h.previous_commercial_status, h.new_commercial_status,
            h.previous_payment_status, h.new_payment_status, h.reason, h.created_at,
            u.email AS changed_by_email
     FROM order_status_history h
     LEFT JOIN users u ON u.id = h.changed_by
     WHERE h.order_id = ?
     ORDER BY h.created_at DESC`,
    [id]
  );
  const qrs = await db.query(
    'SELECT id, value, status, print_status, activation_at, created_at FROM identifiers WHERE order_id = ? ORDER BY created_at DESC',
    [id]
  );

  let shippingAddress = null;
  if (order.shipping_address) {
    try {
      shippingAddress = typeof order.shipping_address === 'string'
        ? JSON.parse(order.shipping_address)
        : order.shipping_address;
    } catch { shippingAddress = null; }
  }
  let customization = null;
  if (order.customization) {
    try {
      customization = typeof order.customization === 'string'
        ? JSON.parse(order.customization)
        : order.customization;
    } catch { customization = null; }
  }

  return res.json({
    order: {
      ...order,
      shipping_address: shippingAddress,
      customization,
      items,
      payment_events: events,
      status_history: history,
      qrs,
    },
  });
};

/* ───────── Administración: cambio de estado con historial ───────── */
const adminUpdateOrderStatus = async (req, res) => {
  const { id } = req.params;
  const { commercial_status, payment_status, reason } = req.body;
  const actorId = req.user.id;

  if (commercial_status === undefined && payment_status === undefined) {
    return res.status(400).json({ error: 'Debe indicar al menos un estado para actualizar' });
  }
  if (commercial_status !== undefined && !COMMERCIAL_STATUSES.includes(commercial_status)) {
    return res.status(400).json({ error: 'Estado comercial inválido' });
  }
  if (payment_status !== undefined && !PAYMENT_STATUSES.includes(payment_status)) {
    return res.status(400).json({ error: 'Estado de pago inválido' });
  }

  const conn = await db.getConnection();
  try {
    await conn.query('START TRANSACTION');

    const [orders] = await conn.query(
      'SELECT id, user_id, order_number, commercial_status, payment_status FROM orders WHERE id = ? FOR UPDATE',
      [id]
    );
    if (!orders.length) {
      await conn.query('ROLLBACK');
      return res.status(404).json({ error: 'Pedido no encontrado' });
    }
    const order = orders[0];
    const previous = {
      commercial_status: order.commercial_status,
      payment_status: order.payment_status,
    };
    const next = { ...previous };

    let commercialChanged = false;
    let paymentChanged = false;

    if (commercial_status !== undefined && commercial_status !== order.commercial_status) {
      if (isTerminal(order.commercial_status)) {
        await conn.query('ROLLBACK');
        return res.status(409).json({ error: 'El pedido está en un estado final y no puede cambiarse' });
      }
      const allowed = COMMERCIAL_TRANSITIONS[order.commercial_status] || [];
      if (!allowed.includes(commercial_status)) {
        await conn.query('ROLLBACK');
        return res.status(400).json({ error: `Transición no permitida: ${order.commercial_status} → ${commercial_status}` });
      }
      next.commercial_status = commercial_status;
      commercialChanged = true;
    }

    if (payment_status !== undefined && payment_status !== order.payment_status) {
      // El pago aprobado solo se confirma explícitamente (webhook o operación de admin autorizada).
      if (payment_status === 'approved') {
        next.payment_status = 'approved';
        if (next.commercial_status !== 'paid' && !isTerminal(next.commercial_status)) {
          next.commercial_status = 'paid';
          commercialChanged = true;
        }
      } else if (payment_status === 'rejected' || payment_status === 'cancelled') {
        next.payment_status = payment_status;
        if (!isTerminal(next.commercial_status)) {
          next.commercial_status = payment_status === 'cancelled' ? 'cancelled' : 'cancelled';
          commercialChanged = true;
        }
      } else {
        next.payment_status = payment_status;
      }
      paymentChanged = true;
    }

    const updates = [];
    const values = [];
    if (commercialChanged) {
      updates.push('commercial_status = ?');
      values.push(next.commercial_status);
    }
    if (paymentChanged) {
      updates.push('payment_status = ?');
      values.push(next.payment_status);
    }
    if (commercial_status === 'paid' && payment_status === undefined && order.payment_status !== 'approved') {
      // No se permite marcar pagado sin confirmación de pago válida.
      await conn.query('ROLLBACK');
      return res.status(400).json({ error: 'No se puede marcar como pagado sin una confirmación de pago válida' });
    }
    if (updates.length) {
      values.push(id);
      await conn.query(`UPDATE orders SET ${updates.join(', ')} WHERE id = ?`, values);
    }

    if (commercialChanged || paymentChanged) {
      await conn.query(
        `INSERT INTO order_status_history
          (order_id, previous_commercial_status, new_commercial_status,
           previous_payment_status, new_payment_status, changed_by, reason)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [id, previous.commercial_status, next.commercial_status,
         previous.payment_status, next.payment_status, actorId, reason || null]
      );
      await conn.query(
        `INSERT INTO audit_logs
          (actor_user_id, action, entity_type, entity_id, metadata, previous_values, new_values, ip_address)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          actorId, 'admin.order.status_change', 'orders', String(id),
          JSON.stringify({ order_number: order.order_number, reason }),
          JSON.stringify(previous), JSON.stringify(next), req.ip,
        ]
      );
    }

    await conn.query('COMMIT');

    // Correos no bloqueantes según el nuevo estado.
    const finalStatus = next.commercial_status;
    try {
      const [userRows] = await conn.query('SELECT email FROM users WHERE id = ?', [order.user_id]);
      if (userRows.length) {
        const emailService = require('../../domains/email/email.service');
        const base = {
          orderNumber: order.order_number,
          totalAmount: order.total_amount,
          currency: order.currency,
          customerEmail: userRows[0].email,
          orderId: order.id,
          userId: order.user_id,
        };
        if (finalStatus === 'paid') {
          await emailService.sendPaymentConfirmed(userRows[0].email, base);
        } else if (finalStatus === 'preparing') {
          await emailService.sendOrderPrepared(userRows[0].email, { ...base, status: 'preparing' });
        } else if (finalStatus === 'shipped') {
          await emailService.sendOrderShipped(userRows[0].email, {
            ...base,
            status: 'shipped',
            carrier: order.carrier,
            trackingNumber: order.tracking_number,
            trackingUrl: order.tracking_url,
          });
        } else if (finalStatus === 'delivered') {
          await emailService.sendOrderDelivered(userRows[0].email, base);
        } else if (finalStatus === 'cancelled') {
          await emailService.sendOrderCancelled(userRows[0].email, base);
        }
      }
    } catch {
      // El correo nunca bloquea la actualización del pedido.
    }

    return res.json({
      message: 'Estado actualizado',
      order: { id, order_number: order.order_number, previous, next },
    });
  } catch (error) {
    await conn.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    conn.release();
  }
};

/* ───────── Administración: transportadora y guía ───────── */
const adminUpdateOrderCarrier = async (req, res) => {
  const { id } = req.params;
  const { carrier, tracking_number, tracking_url } = req.body;
  const actorId = req.user.id;

  const conn = await db.getConnection();
  try {
    await conn.query('START TRANSACTION');

    const [orders] = await conn.query(
      'SELECT id, order_number, user_id, carrier, tracking_number, tracking_url, commercial_status FROM orders WHERE id = ? FOR UPDATE',
      [id]
    );
    if (!orders.length) {
      await conn.query('ROLLBACK');
      return res.status(404).json({ error: 'Pedido no encontrado' });
    }
    const order = orders[0];
    const previous = { carrier: order.carrier, tracking_number: order.tracking_number, tracking_url: order.tracking_url };
    const next = {
      carrier: carrier !== undefined ? carrier : order.carrier,
      tracking_number: tracking_number !== undefined ? tracking_number : order.tracking_number,
      tracking_url: tracking_url !== undefined ? tracking_url : order.tracking_url,
    };

    const updates = [];
    const values = [];
    if (carrier !== undefined) { updates.push('carrier = ?'); values.push(carrier); }
    if (tracking_number !== undefined) { updates.push('tracking_number = ?'); values.push(tracking_number); }
    if (tracking_url !== undefined) { updates.push('tracking_url = ?'); values.push(tracking_url); }

    if (updates.length) {
      values.push(id);
      await conn.query(`UPDATE orders SET ${updates.join(', ')} WHERE id = ?`, values);
      // Si se registra guía y el pedido está pagado, avanzar a enviado si aún no lo está.
      if (tracking_number && order.commercial_status === 'paid') {
        await conn.query('UPDATE orders SET commercial_status = ? WHERE id = ?', ['shipped', id]);
        await conn.query(
          `INSERT INTO order_status_history
            (order_id, previous_commercial_status, new_commercial_status,
             previous_payment_status, new_payment_status, changed_by, reason)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [id, order.commercial_status, 'shipped', order.payment_status, order.payment_status, actorId, 'Envío registrado con guía']
        );
      }
    }

    await conn.query(
      `INSERT INTO audit_logs
        (actor_user_id, action, entity_type, entity_id, metadata, previous_values, new_values, ip_address)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        actorId, 'admin.order.carrier_update', 'orders', String(id),
        JSON.stringify({ order_number: order.order_number }),
        JSON.stringify(previous), JSON.stringify(next), req.ip,
      ]
    );

    await conn.query('COMMIT');

    // Correo de envío no bloqueante.
    try {
      const [userRows] = await conn.query('SELECT email FROM users WHERE id = ?', [order.user_id]);
      if (userRows.length && tracking_number) {
        const emailService = require('../../domains/email/email.service');
        await emailService.sendOrderShipped(userRows[0].email, {
          orderNumber: order.order_number,
          totalAmount: order.total_amount,
          currency: order.currency,
          customerEmail: userRows[0].email,
          orderId: order.id,
          userId: order.user_id,
          status: 'shipped',
          carrier: next.carrier,
          trackingNumber: next.tracking_number,
          trackingUrl: next.tracking_url,
        });
      }
    } catch {
      // No bloquear.
    }

    return res.json({
      message: 'Información de envío actualizada',
      order: { id, order_number: order.order_number, previous, next },
    });
  } catch (error) {
    await conn.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    conn.release();
  }
};

/* ───────── Administración: reenvío de correo de pedido ───────── */
const adminResendOrderEmail = async (req, res) => {
  const { id } = req.params;
  const { type } = req.body;
  const allowedTypes = ['payment_confirmed', 'preparing', 'shipped', 'delivered', 'cancelled'];
  if (!type || !allowedTypes.includes(type)) {
    return res.status(400).json({ error: 'Tipo de correo no válido' });
  }

  const [orders] = await db.query(
    'SELECT o.id, o.order_number, o.user_id, o.total_amount, o.currency, o.carrier, o.tracking_number, o.tracking_url, u.email FROM orders o JOIN users u ON u.id = o.user_id WHERE o.id = ?',
    [id]
  );
  if (!orders.length) {
    return res.status(404).json({ error: 'Pedido no encontrado' });
  }
  const order = orders[0];

  try {
    const emailService = require('../../domains/email/email.service');
    const base = {
      orderNumber: order.order_number,
      totalAmount: order.total_amount,
      currency: order.currency,
      customerEmail: order.email,
    };
    let result;
    if (type === 'payment_confirmed') {
      result = await emailService.sendPaymentConfirmed(order.email, base);
    } else if (type === 'preparing') {
      result = await emailService.sendOrderPrepared(order.email, { ...base, status: 'preparing' });
    } else if (type === 'shipped') {
      result = await emailService.sendOrderShipped(order.email, {
        ...base, status: 'shipped',
        carrier: order.carrier, trackingNumber: order.tracking_number, trackingUrl: order.tracking_url,
      });
    } else if (type === 'delivered') {
      result = await emailService.sendOrderDelivered(order.email, base);
    } else if (type === 'cancelled') {
      result = await emailService.sendOrderCancelled(order.email, base);
    }
    return res.json({ message: 'Correo enviado', sent: Boolean(result && result.sent), provider: result ? result.provider : null });
  } catch (error) {
    return res.status(500).json({ error: 'No se pudo enviar el correo', detail: error.message });
  }
};

module.exports = {
  listOrders,
  getOrder,
  createOrder,
  createStickerOrder,
  createPackageOrder,
  adminListOrders,
  adminGetOrder,
  adminUpdateOrderStatus,
  adminUpdateOrderCarrier,
  adminResendOrderEmail,
};

