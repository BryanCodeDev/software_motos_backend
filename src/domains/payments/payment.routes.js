const express = require('express');
const { authenticate } = require('../../middlewares/auth');
const { validate } = require('../../middlewares/validate');
const { catchAsync } = require('../../middlewares/catch-async');
const { preferenceSchema } = require('./payment.schema');
const { createPreference, mercadopagoWebhook } = require('./payment.controller');

const router = express.Router();

// Webhook sin autenticación de sesión (Mercado Pago lo llama directamente)
router.post('/webhooks/mercadopago', catchAsync(mercadopagoWebhook));

router.post('/preference', authenticate, validate(preferenceSchema), catchAsync(createPreference));

module.exports = router;

