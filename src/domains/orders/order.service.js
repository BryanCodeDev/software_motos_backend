const crypto = require('crypto');
const db = require('../../config/db');
const emailService = require('../../domains/email/email.service');
const { activateQr } = require('../identifiers/identifier.service');

const STICKER_PRODUCT_SLUG = 'sticker-qr-personalizado';
const STICKER_PACK_QUANTITY = 2;

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

    // Evitar compras duplicadas de la activación única del QR
    if (product.slug === 'qr-digital-basico') {
      const [existingActive] = await conn.query(
        "SELECT id FROM identifiers WHERE user_id = ? AND status = 'active' LIMIT 1",
        [userId]
      );
      if (existingActive.length > 0) {
        await conn.query('ROLLBACK');
        return res.status(409).json({ error: 'Ya tienes un QR activado. No es necesario comprarlo de nuevo.', code: 'qr_already_active' });
      }
      const [existingPaid] = await conn.query(
        "SELECT id FROM orders WHERE user_id = ? AND product_id = ? AND payment_status = 'approved' AND commercial_status = 'paid' LIMIT 1",
        [userId, product.id]
      );
      if (existingPaid.length > 0) {
        await conn.query('ROLLBACK');
        return res.status(409).json({ error: 'Ya existe un pedido pagado para activar el QR.', code: 'qr_already_paid' });
      }
    }

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

    // Pedidos ya pagados (activación gratuita): activar el QR permanente (idempotente).
    if (product.slug === 'qr-digital-basico' && paymentStatus === 'approved') {
      try {
        await activateQr(userId, result.insertId, null);
      } catch {
        // No bloquear la creación del pedido si la activación del QR falla.
      }
    }

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

module.exports = {
  listOrders,
  getOrder,
  createOrder,
};
