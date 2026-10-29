const crypto = require('crypto');
const db = require('../../config/db');
const emailService = require('../../domains/email/email.service');

const generateOrderNumber = () => {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const random = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `EID-${date}-${random}`;
};

const listOrders = async (req, res) => {
  const rows = await db.query(
    `SELECT o.*, p.name AS product_name, p.slug AS product_slug
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
    `SELECT o.*, p.name AS product_name, p.slug AS product_slug
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
  const { product_id, variant_id, shipping_address, customization } = req.validated.body;
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

    const totalAmount = parseFloat(product.price) + parseFloat(priceAdjustment);
    const currency = product.currency;
    const orderNumber = generateOrderNumber();

    const commercialStatus = totalAmount > 0 ? 'pending_confirmation' : 'paid';
    const paymentStatus = totalAmount > 0 ? 'unpaid' : 'approved';

    const [result] = await conn.query(
      `INSERT INTO orders (order_number, user_id, product_id, variant_id, commercial_status, payment_status, total_amount, currency, shipping_address, customization)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        orderNumber,
        userId,
        product_id,
        variant_id || null,
        commercialStatus,
        paymentStatus,
        totalAmount,
        currency,
        shipping_address ? JSON.stringify(shipping_address) : null,
        customization ? JSON.stringify(customization) : null,
      ]
    );

    await conn.query(
      'INSERT INTO order_items (order_id, product_id, name, price, quantity) VALUES (?, ?, ?, ?, 1)',
      [result.insertId, product_id, product.name, totalAmount]
    );

    if (totalAmount > 0) {
      await conn.query(
        'INSERT INTO payment_events (order_id, type, status, amount, raw) VALUES (?, ?, ?, ?, ?)',
        [result.insertId, 'created', 'unpaid', totalAmount, JSON.stringify({ totalAmount, currency })]
      );
    }

    await conn.query(
      'INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, metadata, ip_address) VALUES (?, ?, ?, ?, ?, ?)',
      [userId, 'order.create', 'orders', String(result.insertId), JSON.stringify({ order_number: orderNumber, total_amount: totalAmount, currency }), null]
    );

    await conn.query('COMMIT');

    const order = {
      id: result.insertId,
      order_number: orderNumber,
      product_name: product.name,
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
    } catch (error) {
      console.error('[EMAIL] No se envió confirmación de pedido:', error.message);
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

