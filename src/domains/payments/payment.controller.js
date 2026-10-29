const paymentService = require('./payment.service');

const createPreference = async (req, res) => paymentService.createPreference(req, res);
const mercadopagoWebhook = async (req, res) => paymentService.mercadopagoWebhook(req, res);

module.exports = {
  createPreference,
  mercadopagoWebhook,
};

