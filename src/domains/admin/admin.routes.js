const express = require('express');
const { authenticate, authorize } = require('../../middlewares/auth');
const { validate } = require('../../middlewares/validate');
const { catchAsync } = require('../../middlewares/catch-async');
const { bootstrapAdminSchema } = require('./admin.schema');
const {
  dashboardStats,
  listOrders,
  updateOrderStatus,
  auditLogs,
  bootstrapAdmin,
  listUsers,
  getUser,
  updateUserRole,
} = require('./admin.controller');

const router = express.Router();

router.get('/dashboard', authenticate, authorize('admin'), catchAsync(dashboardStats));
router.get('/orders', authenticate, authorize('admin'), catchAsync(listOrders));
router.patch(
  '/orders/:id',
  authenticate,
  authorize('admin'),
  catchAsync(updateOrderStatus)
);
router.get('/audit', authenticate, authorize('admin'), catchAsync(auditLogs));
router.get('/users', authenticate, authorize('admin'), catchAsync(listUsers));
router.get('/users/:id', authenticate, authorize('admin'), catchAsync(getUser));
router.patch('/users/:id/role', authenticate, authorize('admin'), catchAsync(updateUserRole));
router.post(
  '/bootstrap-admin',
  validate(bootstrapAdminSchema),
  catchAsync(bootstrapAdmin)
);

module.exports = router;

