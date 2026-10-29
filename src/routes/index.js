const express = require('express');
const profileModule = require('../domains/emergency-profiles');
const contactModule = require('../domains/contacts');
const identifierModule = require('../domains/identifiers');
const productModule = require('../domains/products');
const orderModule = require('../domains/orders');
const paymentModule = require('../domains/payments');
const adminModule = require('../domains/admin');

const apiRouter = express.Router();

apiRouter.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'emergency-id-api' });
});

apiRouter.get('/integrations/status', (_req, res) => {
  const config = require('../config');
  res.json({
    mercadopago: Boolean(config.mercadopago.accessToken),
    resend: Boolean(config.resend.apiKey),
    database: Boolean(config.databaseUrl),
  });
});

apiRouter.use('/auth', require('../domains/auth/auth.routes'));
apiRouter.use('/profiles', require('../domains/emergency-profiles/profile.routes'));
apiRouter.use('/contacts', require('../domains/contacts/contact.routes'));
apiRouter.use('/identifiers', require('../domains/identifiers/identifier.routes'));
apiRouter.use('/orders', require('../domains/orders/order.routes'));
apiRouter.use('/', require('../domains/emergency-profiles/profile.routes')); // privacy/me + public
apiRouter.use('/products', require('../domains/products/product.routes'));
apiRouter.use('/', require('../domains/payments/payment.routes'));
apiRouter.use('/admin', require('../domains/admin/admin.routes'));

module.exports = apiRouter;

