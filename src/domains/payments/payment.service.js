const db = require('../../config/db');
const { MercadoPagoConfig, Preference, Payment } = require('mercadopago');
const crypto = require('crypto');
const config = require('../../config');
const { activateQr, activateQrForProfile } = require('../identifiers/identifier.service');

let mpClient = null;
if (config.mercadopago.accessToken) {
  mpClient = new MercadoPagoConfig({ accessToken: config.mercadopago.accessToken });
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
    /* Mercado Pago no configurado: registrar el pago como pendiente y devolver
       instrucciones de pago manual en lugar de fallar con 503. */
    await db.query(
      'UPDATE orders SET payment_status = ?, commercial_status = ? WHERE id = ?',
      ['pending', 'pending_confirmation', order.id]
    );
    await db.query(
      'INSERT INTO payment_events (order_id, type, status, amount, raw) VALUES (?, ?, ?, ?, ?)',
      [order.id, 'preference_created', 'pending', order.total_amount, JSON.stringify({ reason: 'payment_not_configured', manual: true })]
    );
    await db.query(
      'INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, metadata, ip_address) VALUES (?, ?, ?, ?, ?, ?)',
      [req.user.id, 'payment.pending_manual', 'orders', String(order.id), JSON.stringify({ amount: order.total_amount, reason: 'payment_not_configured' }), null]
    );
    return res.json({
      init_point: null,
      preference_id: null,
      order_id: order.id,
      payment_method: 'manual',
      message: 'Pago registrado como pendiente. Se procesará de forma manual (transferencia/bancaria). Te notificaremos al activarse tu QR.',
    });
  }

  const preference = {
    items: [
      {
        id: String(order.id),
        title: `Tu QR te Cuida - ${order.product_name || 'Producto'}`,
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
    const prefClient = new Preference(mpClient);
    const response = await prefClient.create({ body: preference });
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
    // eslint-disable-next-line no-console
    console.error('[MERCADOPAGO] Error creando preferencia:', error && error.message ? error.message : error);
    return res.status(502).json({ error: 'No se pudo crear la preferencia de pago', detail: error && error.message ? error.message : String(error) });
  }
};

const parseSignatureHeader = (header) => {
  const parts = {};
  if (!header) {return parts;}
  String(header).split(',').forEach((part) => {
    const eq = part.indexOf('=');
    if (eq === -1) {return;}
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key) {parts[key] = value;}
  });
  return parts;
};

const buildWebhookManifest = (dataId, requestId, ts) => {
  const segments = [];
  if (dataId) {segments.push(`id:${String(dataId).toLowerCase()}`);}
  if (requestId) {segments.push(`request-id:${requestId}`);}
  if (ts) {segments.push(`ts:${ts}`);}
  return segments.length ? segments.join(';') + ';' : '';
};

const verifyWebhookSignature = (req, secret) => {
  const header = req.headers['x-signature'];
  const requestId = req.headers['x-request-id'];
  const parsed = parseSignatureHeader(header);
  const ts = parsed.ts;
  const v1 = parsed.v1;
  if (!ts || !v1) {return false;}

  const dataId =
    (req.query && req.query['data.id']) ||
    (req.body && req.body.data && req.body.data.id);

  const manifest = buildWebhookManifest(dataId, requestId, ts);
  const expected = crypto.createHmac('sha256', secret).update(manifest).digest('hex');

  try {
    const expectedBuf = Buffer.from(expected, 'hex');
    const receivedBuf = Buffer.from(v1, 'hex');
    if (expectedBuf.length !== receivedBuf.length) {return false;}
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
      return res.status(400).json({ error: 'Firma de webhook inválida' });
    }
  }

  try {
    const { data } = req.body || {};
    const paymentId = data && data.id ? String(data.id) : null;
    if (!paymentId) {
      return res.status(200).json({ received: true });
    }

    if (!config.mercadopago.accessToken) {
      return res.status(200).json({ received: true });
    }

    // Consultar el estado real en Mercado Pago (nunca confiar solo en la notificación)
    const paymentClient = new Payment(mpClient);
    const payment = await paymentClient.get({ id: paymentId });
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
      return res.status(200).json({ received: true });
    }

    // Idempotencia: ya procesado
    const existing = await db.query(
      'SELECT id FROM payment_events WHERE order_id = ? AND mp_payment_id = ? AND type = ?',
      [order.id, paymentId, `payment_${status}`]
    );
    if (existing.length > 0) {
      return res.status(200).json({ received: true });
    }

    const conn = await db.getConnection();
    let newPaymentStatus = order.payment_status;
    let newCommercialStatus = order.commercial_status;

    try {
      await conn.query('START TRANSACTION');

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
      if (Math.abs(amount - expected) > 0.50 || currencyId !== order.currency) {
        await conn.query(
          'INSERT INTO payment_events (order_id, mp_payment_id, type, status, amount, raw) VALUES (?, ?, ?, ?, ?)',
          [order.id, paymentId, `payment_${status}`, amount, JSON.stringify({ p, warning: 'importe_moneda_no_coinciden', expected, received: amount, currencyId })]
        );
        await conn.query(
          'INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, metadata, ip_address) VALUES (?, ?, ?, ?, ?, ?)',
          [order.user_id, 'payment.webhook_mismatch', 'orders', String(order.id), JSON.stringify({ paymentId, expected, received: amount }), null]
        );
        await conn.query('COMMIT');
        return res.status(200).json({ received: true });
      }

      await conn.query(
        'UPDATE orders SET payment_status = ?, commercial_status = ?, mercado_pago_payment_id = ? WHERE id = ?',
        [newPaymentStatus, newCommercialStatus, paymentId, order.id]
      );

      // Historial de estado de pedido (rastro de auditoría del cambio vía webhook)
      await conn.query(
        `INSERT INTO order_status_history
          (order_id, previous_commercial_status, new_commercial_status,
           previous_payment_status, new_payment_status, changed_by, reason)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [order.id, order.commercial_status, newCommercialStatus,
         order.payment_status, newPaymentStatus, order.user_id, 'webhook_mercadopago']
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

    // Notificación de correo y activación de QR solo tras commit exitoso de la orden.
    if (newPaymentStatus === 'approved') {
      // Activar el QR automáticamente tras la compra aprobada (dentro del mismo flujo de pago).
      try {
        const orderProfiles = await db.query(
          'SELECT profile_id FROM order_profiles WHERE order_id = ?',
          [order.id]
        );
        if (orderProfiles.length > 0) {
          // Pedido de paquete comercial: activar un QR por perfil.
          for (const op of orderProfiles) {
            try {
              await activateQrForProfile(op.profile_id, order.id, null);
            } catch {
              // No bloquear la notificación de pago si la activación de un QR falla.
            }
          }
        } else {
          // Pedido de stickers simple: activar el QR vinculado al perfil principal.
          await activateQr(order.user_id, order.id, null);
        }
      } catch {
        // No bloquear la notificación de pago si la activación del QR falla.
      }
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
      } catch {
      }
    }

    // 2. Responder 200 a Mercado Pago DESPUÉS de procesar (evita reintentos innecesarios
    //    y confirma que el webhook fue consumido correctamente).
    return res.status(200).json({ received: true });
  } catch {
    return res.status(500).json({ error: 'Error procesando webhook' });
  }
};

module.exports = {
  createPreference,
  mercadopagoWebhook,
  parseSignatureHeader,
  buildWebhookManifest,
  verifyWebhookSignature,
};

