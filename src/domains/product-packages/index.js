const packageRoutes = require('./package.routes');

const mount = (app) => {
  app.use('/', packageRoutes);
};

module.exports = { mount };
