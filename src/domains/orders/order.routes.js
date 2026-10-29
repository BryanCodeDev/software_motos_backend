const express = require('express');
const { authenticate } = require('../../middlewares/auth');
const { validate } = require('../../middlewares/validate');
const { catchAsync } = require('../../middlewares/catch-async');
const { orderSchema } = require('./order.schema');
const {
  listOrders,
  getOrder,
  createOrder,
} = require('./order.controller');

const router = express.Router();

router.get('/', authenticate, catchAsync(listOrders));
router.get('/:id', authenticate, catchAsync(getOrder));
router.post('/', authenticate, validate(orderSchema), catchAsync(createOrder));

module.exports = router;

