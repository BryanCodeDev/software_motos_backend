const productService = require('./product.service');

const listProducts = async (req, res) => productService.listProducts(req, res);
const getProduct = async (req, res) => productService.getProduct(req, res);
const createProduct = async (req, res) => productService.createProduct(req, res);
const updateProduct = async (req, res) => productService.updateProduct(req, res);
const deleteProduct = async (req, res) => productService.deleteProduct(req, res);

module.exports = {
  listProducts,
  getProduct,
  createProduct,
  updateProduct,
  deleteProduct,
};

