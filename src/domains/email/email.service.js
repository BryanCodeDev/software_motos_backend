const { Resend } = require('resend');
const config = require('../../config');
const db = require('../../config/db');

let resend = null;
if (config.resend.apiKey) {
  resend = new Resend(config.resend.apiKey);
}

const send = async ({ to, subject, html, text }) => {
  if (!resend) {
    // eslint-disable-next-line no-console
    console.warn(
      '[EMAIL] Resend no configurado. Correo no enviado:',
      subject,
      'para',
      to
    );
    return { provider: 'resend', sent: false, reason: 'not_configured' };
  }

  try {
    const response = await resend.emails.send({
      from: config.resend.from,
      to,
      subject,
      html,
      text,
    });
    return { provider: 'resend', sent: true, id: response.data && response.data.id };
  } catch (error) {
    return { provider: 'resend', sent: false, error: error.message };
  }
};

/*
 * Envío idempotente de correo de pedido. Evita duplicados consultando email_log:
 * si ya existe un registro 'sent' para la misma orden y tipo, se omite el envío.
 * Nunca bloquea al llamante: devuelve el resultado aunque Resend falle.
 */
const sendOrderEmail = async ({
  orderId,
  userId,
  type,
  to,
  subject,
  html,
  text,
}) => {
  try {
    const existing = await db.query(
      `SELECT id FROM email_log
       WHERE order_id = ? AND type = ? AND status = 'sent'
       ORDER BY created_at DESC LIMIT 1`,
      [orderId, type]
    );
    if (existing.length > 0) {
      return { provider: 'resend', sent: true, skipped: true, reason: 'duplicate' };
    }
  } catch {
    // Si la tabla aún no existe, continuar con el envío normal.
  }

  const result = await send({ to, subject, html, text });
  const status = result.sent ? 'sent' : 'failed';
  try {
    await db.query(
      `INSERT INTO email_log
        (order_id, user_id, type, to_email, subject, provider, provider_id, status, error, sent_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        orderId || null,
        userId || null,
        type,
        to,
        subject,
        result.provider || 'resend',
        result.id || null,
        status,
        result.error || null,
        result.sent ? new Date().toISOString().slice(0, 19).replace('T', ' ') : null,
      ]
    );
  } catch {
    // No bloquear el resultado del envío si falla el registro de log.
  }
  return result;
};

const renderBase = ({ title, body }) => `
<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
</head>
<body style="margin:0;padding:0;font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#0b1016;color:#e8eef5;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
  <tr>
    <td align="center" style="padding:24px 12px;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;background:#131a23;border:1px solid #25303a;border-radius:14px;">
        <tr>
          <td align="center" style="padding:32px 24px 20px;border-bottom:1px solid #25303a;">
            <div style="width:40px;height:40px;background:#22d3ee;border-radius:10px;display:inline-block;"></div>
          </td>
        </tr>
        <tr>
          <td style="padding:24px;">
            <h1 style="margin:0 0 12px;font-size:22px;font-weight:700;color:#e8eef5;">${title}</h1>
            <div style="color:#8fa3b8;font-size:15px;line-height:1.6;">${body}</div>
          </td>
        </tr>
        <tr>
          <td style="padding:24px;border-top:1px solid #25303a;color:#5a7088;font-size:13px;text-align:center;">
            ${config.appName} — <a href="https://mastercodecompany.com/" style="color:#5a7088;">MasterCode Company</a><br/>
            Este correo es transaccional. No responde a este mensaje.
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>
`;

const sendPasswordReset = async (to, resetUrl) => {
  return send({
    to,
    subject: 'Restablece tu contraseña — Tu QR te Cuida',
    text: `Restablece tu contraseña accediendo a: ${resetUrl}. El enlace expira en 1 hora.`,
    html: renderBase({
      title: 'Restablecimiento de contraseña',
      body: `Solicitaste restablecer tu contraseña. Haz clic en el botón para crear una nueva. El enlace expira en 1 hora.<br><br>
<a href="${resetUrl}" style="display:inline-block;margin-top:16px;padding:12px 24px;background:#22d3ee;color:#0b1016;text-decoration:none;border-radius:8px;font-weight:700;">Restablecer contraseña</a>`,
    }),
  });
};

const sendOrderConfirmation = async (to, order) => {
  return send({
    to,
    subject: `Confirmación de pedido ${order.orderNumber}`,
    text: `Hemos recibido tu pedido ${order.orderNumber}. Monto: ${order.totalAmount} ${order.currency}.`,
    html: renderBase({
      title: 'Pedido recibido',
      body: `Gracias por tu pedido <strong>${order.orderNumber}</strong>. Monto total: <strong>${order.totalAmount} ${order.currency}</strong>.<br>
Estado: ${order.status}. Te notificaremos cuando el pago se confirme y el pedido avance.`,
    }),
  });
};

const sendEmailVerification = async (to, code) => {
  return send({
    to,
    subject: 'Código de verificación — Tu QR te Cuida',
    text: `Tu código de verificación es: ${code}. Expira en 15 minutos.`,
    html: renderBase({
      title: 'Verificación de correo electrónico',
      body: `Tu código de verificación es <strong style="font-size:24px;letter-spacing:4px;">${code}</strong>.<br>
Este código expira en 15 minutos. Ingrésalo en la app para activar tu cuenta.<br><br>
Si no solicitaste este código, ignora este mensaje.`,
    }),
  });
};

const sendPaymentConfirmed = async (to, order) => {
  return send({
    to,
    subject: `Pago confirmado — pedido ${order.orderNumber}`,
    text: `El pago de tu pedido ${order.orderNumber} fue confirmado.`,
    html: renderBase({
      title: 'Pago confirmado',
      body: `El pago de tu pedido <strong>${order.orderNumber}</strong> por <strong>${order.totalAmount} ${order.currency}</strong> fue confirmado correctamente.`,
    }),
  });
};

const sendOrderStatusChanged = async (to, order) => {
  return send({
    to,
    subject: `Actualización de tu pedido ${order.orderNumber}`,
    text: `Tu pedido ${order.orderNumber} pasó a estado: ${order.status}.`,
    html: renderBase({
      title: 'Actualización de pedido',
      body: `Tu pedido <strong>${order.orderNumber}</strong> cambió de estado: <strong>${order.status}</strong>.`,
    }),
  });
};

const sendAdminNewOrder = async (to, order) => {
  return send({
    to,
    subject: `Nuevo pedido ${order.orderNumber}`,
    text: `Nuevo pedido ${order.orderNumber} de ${order.customerEmail}. Monto: ${order.totalAmount} ${order.currency}.`,
    html: renderBase({
      title: 'Nuevo pedido (administración)',
      body: `Se registró un nuevo pedido <strong>${order.orderNumber}</strong>.<br>
Cliente: ${order.customerEmail}<br>
Producto: ${order.productName}<br>
Monto: <strong>${order.totalAmount} ${order.currency}</strong><br>
Estado: ${order.status}`,
    }),
  });
};

const sendOrderPrepared = async (to, order) => {
  return sendOrderEmail({
    to,
    userId: order.userId || null,
    orderId: order.orderId || null,
    type: 'preparing',
    subject: `Tu pedido ${order.orderNumber} está en preparación`,
    text: `Tu pedido ${order.orderNumber} pasó a estado: En preparación.`,
    html: renderBase({
      title: 'Pedido en preparación',
      body: `Tu pedido <strong>${order.orderNumber}</strong> está siendo preparado para impresión y despacho.<br>
Monto: <strong>${order.totalAmount} ${order.currency}</strong>.`,
    }),
  });
};

const sendOrderShipped = async (to, order) => {
  const carrierLine = order.carrier ? `<br>Transportadora: <strong>${order.carrier}</strong>` : '';
  const guideLine = order.trackingNumber ? `<br>Número de guía: <strong>${order.trackingNumber}</strong>` : '';
  const trackLine = order.trackingUrl ? `<br>Seguimiento: <a href="${order.trackingUrl}" style="color:#22d3ee;">Ver rastreo</a>` : '';
  return sendOrderEmail({
    to,
    userId: order.userId || null,
    orderId: order.orderId || null,
    type: 'shipped',
    subject: `Tu pedido ${order.orderNumber} fue despachado`,
    text: `Tu pedido ${order.orderNumber} fue enviado.${carrierLine}${guideLine}${order.trackingUrl ? ' Seguimiento: ' + order.trackingUrl : ''}.`,
    html: renderBase({
      title: 'Pedido despachado',
      body: `Tu pedido <strong>${order.orderNumber}</strong> ha sido despachado.<br>
Monto: <strong>${order.totalAmount} ${order.currency}</strong>.${carrierLine}${guideLine}${trackLine}`,
    }),
  });
};

const sendOrderDelivered = async (to, order) => {
  return sendOrderEmail({
    to,
    userId: order.userId || null,
    orderId: order.orderId || null,
    type: 'delivered',
    subject: `Tu pedido ${order.orderNumber} fue entregado`,
    text: `Tu pedido ${order.orderNumber} ha sido entregado.`,
    html: renderBase({
      title: 'Pedido entregado',
      body: `Tu pedido <strong>${order.orderNumber}</strong> ha sido entregado correctamente.<br>
Gracias por confiar en Tu QR te Cuida.`,
    }),
  });
};

const sendOrderCancelled = async (to, order) => {
  return sendOrderEmail({
    to,
    userId: order.userId || null,
    orderId: order.orderId || null,
    type: 'cancelled',
    subject: `Tu pedido ${order.orderNumber} fue cancelado`,
    text: `Tu pedido ${order.orderNumber} fue cancelado.`,
    html: renderBase({
      title: 'Pedido cancelado',
      body: `Tu pedido <strong>${order.orderNumber}</strong> fue cancelado.<br>
Si crees que es un error, escríbenos a soporte.`,
    }),
  });
};

module.exports = {
  send,
  sendOrderEmail,
  sendPasswordReset,
  sendEmailVerification,
  sendOrderConfirmation,
  sendPaymentConfirmed,
  sendOrderStatusChanged,
  sendOrderPrepared,
  sendOrderShipped,
  sendOrderDelivered,
  sendOrderCancelled,
  sendAdminNewOrder,
};

