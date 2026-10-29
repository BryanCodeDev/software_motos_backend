const contactRoutes = require('./contact.routes');

const mount = (app) => {
  app.use('/', contactRoutes);
};

module.exports = { mount };


