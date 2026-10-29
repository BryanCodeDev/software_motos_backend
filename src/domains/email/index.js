const emailService = require('./email.service');

const sendPasswordReset = (to, resetUrl) =>
  emailService.sendPasswordReset(to, resetUrl);

const sendOrderConfirmation = (to, order) =>
  emailService.sendOrderConfirmation(to, order);

const sendPaymentConfirmed = (to, order) =>
  emailService.sendPaymentConfirmed(to, order);

const sendOrderStatusChanged = (to, order) =>
  emailService.sendOrderStatusChanged(to, order);

const sendAdminNewOrder = (to, order) =>
  emailService.sendAdminNewOrder(to, order);

module.exports = {
  sendPasswordReset,
  sendOrderConfirmation,
  sendPaymentConfirmed,
  sendOrderStatusChanged,
  sendAdminNewOrder,
};

