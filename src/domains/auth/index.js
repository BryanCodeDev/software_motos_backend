const authRoutes = require('./auth.routes');

const mount = (app) => {
  app.use('/api/auth', authRoutes);
};

module.exports = { mount };

