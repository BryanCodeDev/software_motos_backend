const adminRoutes = require('./admin.routes');

const mount = (app) => {
  app.use('/', adminRoutes);
};

module.exports = { mount };


