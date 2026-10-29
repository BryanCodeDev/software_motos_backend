const db = require('../../config/db');
const mercadopago = require('mercadopago');
const crypto = require('crypto');
const config = require('../../config');

if (config.mercadopago.accessToken) {
  mercadopago.configure({ access_token: config.mercadopago.accessToken });
}

const FRONTEND_URL = config.frontendUrl;

const createPreference = async (req, res) => {
  const { order_id } = req.validated.body;

  const orders = await db.query(
    `SELECT o.*, u.email FROM orders o JOIN users u ON o.user_id = u.id WHERE o.id = ?`,
    [order_id]
  );
  const order = orders[0];
  if (!order) {
    return res.status(404).json({ error: 'Pedido no encontrado' });
  }
  if (order.user_id !== req.user.id) {
    return res.status(403).json({ error: 'No autorizado para este pedido' });
  }
  if (order.payment_status !== 'unpaid') {
    return res.status(409).json({ error: 'El pago de este pedido ya fue procesado' });
  }
  if (order.total_amount <= 0) {
    return res.status(409).json({ error: 'Este pedido no requiere pago' });
  }
  if (!config.mercadopago.accessToken) {
    return res.status(503).json({
      error: 'Integración de pagos no configurada',
      code: 'payment_not_configured',
    });
  }

  const preference = {
    items: [
      {
        id: String(order.id),
        title: `Identificación de Emergencia - ${order.product_name || 'Producto'}`,
        quantity: 1,
        unit_price: parseFloat(order.total_amount),
        currency_id: order.currency || 'COP',
      },
    ],
    external_reference: String(order.id),
    notification_url: `${config.appUrl}/api/webhooks/mercadopago`,
    back_urls: {
      success: `${FRONTEND_URL}/pedidos`,
      pending: `${FRONTEND_URL}/pedidos`,
      failure: `${FRONTEND_URL}/pedidos`,
    },
    auto_return: 'approved',
    payment_methods: {
      excluded_payment_types: [],
      excluded_payment_methods: [],
      installments: 12,
    },
  };

  try {
    const response = await mercadopago.preferences.create(preference);
    const pref = response.body || response;
    await db.query(
      'UPDATE orders SET mercado_pago_preference_id = ? WHERE id = ?',
      [pref.id, order.id]
    );
    await db.query(
      'INSERT INTO payment_events (order_id, type, status, amount, raw) VALUES (?, ?, ?, ?, ?)',
      [order.id, 'preference_created', 'pending', order.total_amount, JSON.stringify({ preference_id: pref.id })]
    );
    await db.query(
      'INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, metadata, ip_address) VALUES (?, ?, ?, ?, ?, ?)',
      [req.user.id, 'payment.preference_created', 'orders', String(order.id), JSON.stringify({ preference_id: pref.id, amount: order.total_amount }), null]
    );
    return res.json({
      init_point: pref.init_point,
      preference_id: pref.id,
      order_id: order.id,
    });
  } catch (error) {
    console.error('[MERCADOPAGO] Error creando preferencia:', error.message);
    return res.status(502).json({ error: 'No se pudo crear la preferencia de pago' });
  }
};

const parseSignatureHeader = (header) => {
  const parts = {};
  if (!header) return parts;
  String(header).split(',').forEach((part) => {
    const eq = part.indexOf('=');
    if (eq === -1) return;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key) parts[key] = value;
  });
  return parts;
};

const buildWebhookManifest = (dataId, requestId, ts) => {
  const segments = [];
  if (dataId) segments.push(`id:${String(dataId).toLowerCase()}`);
  if (requestId) segments.push(`request-id:${requestId}`);
  if (ts) segments.push(`ts:${ts}`);
  return segments.length ? segments.join(';') + ';' : '';
};

const verifyWebhookSignature = (req, secret) => {
  const header = req.headers['x-signature'];
  const requestId = req.headers['x-request-id'];
  const parsed = parseSignatureHeader(header);
  const ts = parsed.ts;
  const v1 = parsed.v1;
  if (!ts || !v1) return false;

  const dataId =
    (req.query && req.query['data.id']) ||
    (req.body && req.body.data && req.body.data.id);

  const manifest = buildWebhookManifest(dataId, requestId, ts);
  const expected = crypto.createHmac('sha256', secret).update(manifest).digest('hex');

  try {
    const expectedBuf = Buffer.from(expected, 'hex');
    const receivedBuf = Buffer.from(v1, 'hex');
    if (expectedBuf.length !== receivedBuf.length) return false;
    return crypto.timingSafeEqual(expectedBuf, receivedBuf);
  } catch {
    return false;
  }
};

const mercadopagoWebhook = async (req, res) => {
  // 1. Validar firma y autenticidad del webhook cuando el secreto esté configurado.
  //    Un webhook sin firma válida nunca activa un QR.
  if (config.mercadopago.webhookSecret) {
    if (!verifyWebhookSignature(req, config.mercadopago.webhookSecret)) {
      console.warn('[MERCADOPAGO] Webhook con firma inválida o ausente');
      return res.status(400).json({ error: 'Firma de webhook inválida' });
    }
  } else {
    console.warn('[MERCADOPAGO] Webhook recibido sin MERCADOPAGO_WEBHOOK_SECRET configurado');
  }

  // 2. Responder rápido a Mercado Pago para evitar reintentos.
  res.status(200).json({ received: true });

  try {
    const { action, type, data } = req.body || {};
    const paymentId = data && data.id ? String(data.id) : null;
    if (!paymentId) {
      return;
    }

    if (!config.mercadopago.accessToken) {
      console.warn('[MERCADOPAGO] Webhook recibido sin credenciales configuradas');
      return;
    }

    // Consultar el estado real en Mercado Pago (nunca confiar solo en la notificación)
    const payment = await mercadopago.payment.get(paymentId);
    const p = payment.body || payment;
    const status = p.status; // approved, pending, rejected, cancelled, refunded
    const externalReference = String(p.external_reference || '');
    const amount = parseFloat(p.transaction_amount || 0);
    const currencyId = p.currency_id || 'COP';

    const orders = await db.query('SELECT * FROM orders WHERE id = ?', [
      externalReference,
    ]);
    const order = orders[0];
    if (!order) {
      console.warn(`[MERCADOPAGO] Pago ${paymentId} referencia orden inexistente ${externalReference}`);
      return;
    }

    // Idempotencia: ya procesado
    const existing = await db.query(
      'SELECT id FROM payment_events WHERE order_id = ? AND mp_payment_id = ? AND type = ?',
      [order.id, paymentId, `payment_${status}`]
    );
    if (existing.length > 0) {
      return;
    }

    const conn = await db.getConnection();
    try {
      await conn.query('START TRANSACTION');

      let newPaymentStatus = order.payment_status;
      let newCommercialStatus = order.commercial_status;

      if (status === 'approved') {
        newPaymentStatus = 'approved';
        newCommercialStatus = 'paid';
      } else if (status === 'pending') {
        newPaymentStatus = 'pending';
      } else if (status === 'rejected') {
        newPaymentStatus = 'rejected';
      } else if (status === 'cancelled' || status === 'refunded') {
        newPaymentStatus = status === 'refunded' ? 'refunded' : 'cancelled';
        newCommercialStatus = 'cancelled';
      }

      // Verificar importe y moneda esperados (del servidor, no del frontend).
      const expected = parseFloat(order.total_amount);
      if (Math.abs(amount - expected) > 0.009 || currencyId !== order.currency) {
        await conn.query(
          'INSERT INTO payment_events (order_id, mp_payment_id, type, status, amount, raw) VALUES (?, ?, ?, ?, ?)',
          [order.id, paymentId, `payment_${status}`, amount, JSON.stringify({ p, warning: 'importe_moneda_no_coinciden', expected, received: amount, currencyId })]
        );
        await conn.query(
          'INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, metadata, ip_address) VALUES (?, ?, ?, ?, ?, ?)',
          [order.user_id, 'payment.webhook_mismatch', 'orders', String(order.id), JSON.stringify({ paymentId, expected, received: amount }), null]
        );
        await conn.query('COMMIT');
        return;
      }

      await conn.query(
        'UPDATE orders SET payment_status = ?, commercial_status = ?, mercado_pago_payment_id = ? WHERE id = ?',
        [newPaymentStatus, newCommercialStatus, paymentId, order.id]
      );

      await conn.query(
        'INSERT INTO payment_events (order_id, mp_payment_id, type, status, amount, raw) VALUES (?, ?, ?, ?, ?)',
        [order.id, paymentId, `payment_${status}`, amount, JSON.stringify({ p })]
      );

      await conn.query(
        'INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, metadata, ip_address) VALUES (?, ?, ?, ?, ?, ?)',
        [order.user_id, `payment.${status}`, 'orders', String(order.id), JSON.stringify({ paymentId, amount, commercial_status: newCommercialStatus }), null]
      );

      await conn.query('COMMIT');
    } catch (error) {
      await conn.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      conn.release();
    }

    // Notificación de correo solo tras verificar el estado en el backend
    if (newPaymentStatus === 'approved') {
      try {
        const users = await db.query('SELECT email FROM users WHERE id = ?', [
          order.user_id,
        ]);
        if (users[0]) {
          const emailService = require('../../domains/email/email.service');
          await emailService.sendPaymentConfirmed(users[0].email, {
            orderNumber: order.order_number,
            totalAmount: order.total_amount,
            currency: order.currency,
          });
        }
      } catch (error) {
        console.error('[EMAIL] No se envió confirmación de pago:', error.message);
      }
    }
  } catch (error) {
    console.error('[MERCADOPAGO] Error procesando webhook:', error.message);
  }
};

module.exports = {
  createPreference,
  mercadopagoWebhook,
  parseSignatureHeader,
  buildWebhookManifest,
  verifyWebhookSignature,
};

