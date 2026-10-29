const identifierRoutes = require('./identifier.routes');

const mount = (app) => {
  app.use('/', identifierRoutes);
};

module.exports = { mount };


