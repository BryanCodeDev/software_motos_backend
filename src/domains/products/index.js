const productRoutes = require('./product.routes');

const mount = (app) => {
  app.use('/products', productRoutes);
};

module.exports = { mount };


