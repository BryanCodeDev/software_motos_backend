const orderRoutes = require('./order.routes');

const mount = (app) => {
  app.use('/', orderRoutes);
};

module.exports = { mount };


