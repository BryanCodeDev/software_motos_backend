const { Resend } = require('resend');
const config = require('../../config');

let resend = null;
if (config.resend.apiKey) {
  resend = new Resend(config.resend.apiKey);
}

const send = async ({ to, subject, html, text }) => {
  if (!resend) {
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

module.exports = {
  send,
  sendPasswordReset,
  sendOrderConfirmation,
  sendPaymentConfirmed,
  sendOrderStatusChanged,
  sendAdminNewOrder,
};

