const express = require('express');
const { authenticate, authorize } = require('../../middlewares/auth');
const { validate } = require('../../middlewares/validate');
const { catchAsync } = require('../../middlewares/catch-async');
const { bootstrapAdminSchema } = require('./admin.schema');
const {
  dashboardStats,
  dashboardAlerts,
  listPayments,
  scanMetrics,
  listOrders,
  getOrder,
  updateOrderStatus,
  updateOrderCarrier,
  resendOrderEmail,
  auditLogs,
  bootstrapAdmin,
  listUsers,
  getUser,
  updateUserRole,
  suspendUser,
  reactivateUser,
  verifyUser,
} = require('./admin.controller');

const router = express.Router();

router.get('/dashboard', authenticate, authorize('dashboard:read'), catchAsync(dashboardStats));
router.get('/alerts', authenticate, authorize('dashboard:read'), catchAsync(dashboardAlerts));
router.get('/payments', authenticate, authorize('payments:read'), catchAsync(listPayments));
router.get('/scans/metrics', authenticate, authorize('dashboard:read'), catchAsync(scanMetrics));

// Pedidos: listado paginado con filtros y detalle completo.
router.get('/orders', authenticate, authorize('orders:read'), catchAsync(listOrders));
router.get('/orders/:id', authenticate, authorize('orders:read'), catchAsync(getOrder));
router.patch(
  '/orders/:id/status',
  authenticate,
  authorize('orders:status_change'),
  catchAsync(updateOrderStatus)
);
router.patch(
  '/orders/:id/carrier',
  authenticate,
  authorize('orders:carrier_update'),
  catchAsync(updateOrderCarrier)
);
router.post(
  '/orders/:id/resend-email',
  authenticate,
  authorize('orders:write'),
  catchAsync(resendOrderEmail)
);

router.get('/audit', authenticate, authorize('audit:read'), catchAsync(auditLogs));
router.get('/users', authenticate, authorize('users:read'), catchAsync(listUsers));
router.get('/users/:id', authenticate, authorize('users:read'), catchAsync(getUser));
router.patch('/users/:id/role', authenticate, authorize('users:write'), catchAsync(updateUserRole));
router.patch('/users/:id/suspend', authenticate, authorize('users:suspend'), catchAsync(suspendUser));
router.patch('/users/:id/reactivate', authenticate, authorize('users:suspend'), catchAsync(reactivateUser));
router.patch('/users/:id/verify', authenticate, authorize('admin'), catchAsync(verifyUser));
router.post(
  '/bootstrap-admin',
  validate(bootstrapAdminSchema),
  catchAsync(bootstrapAdmin)
);

module.exports = router;
