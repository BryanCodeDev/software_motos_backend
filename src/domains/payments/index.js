const paymentRoutes = require('./payment.routes');

const mount = (app) => {
  app.use('/', paymentRoutes);
};

module.exports = { mount };


