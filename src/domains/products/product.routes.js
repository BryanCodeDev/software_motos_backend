const express = require('express');
const { authenticate, authorize } = require('../../middlewares/auth');
const { validate } = require('../../middlewares/validate');
const { catchAsync } = require('../../middlewares/catch-async');
const { productSchema } = require('./product.schema');
const {
  listProducts,
  getProduct,
  createProduct,
  updateProduct,
  deleteProduct,
} = require('./product.controller');

const router = express.Router();

router.get('/', catchAsync(listProducts));
router.get('/:id', catchAsync(getProduct));
router.post('/', authenticate, authorize('admin'), validate(productSchema), catchAsync(createProduct));
router.patch('/:id', authenticate, authorize('admin'), validate(productSchema), catchAsync(updateProduct));
router.delete('/:id', authenticate, authorize('admin'), catchAsync(deleteProduct));

module.exports = router;

