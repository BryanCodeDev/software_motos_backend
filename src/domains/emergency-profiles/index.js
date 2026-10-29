const profileRoutes = require('./profile.routes');

const mount = (app) => {
  app.use('/', profileRoutes);
};

module.exports = { mount };


