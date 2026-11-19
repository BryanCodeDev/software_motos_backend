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
  listAllProfiles,
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
const {
  listPackages,
  getPackage,
  createPackage,
  updatePackage,
  deletePackage,
} = require('../product-packages/package.controller');
const {
  packageCreateSchema,
  packageUpdateSchema,
  packageProfilesSchema,
} = require('../product-packages/package.schema');

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
router.get('/profiles', authenticate, authorize('users:read'), catchAsync(listAllProfiles));
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

// Administración de paquetes comerciales.
router.get('/packages', authenticate, authorize('products:read'), catchAsync(listPackages));
router.get('/packages/:id', authenticate, authorize('products:read'), catchAsync(getPackage));
router.post(
  '/packages',
  authenticate,
  authorize('products:write'),
  validate(packageCreateSchema),
  catchAsync(createPackage)
);
router.patch(
  '/packages/:id',
  authenticate,
  authorize('products:write'),
  validate(packageUpdateSchema),
  catchAsync(updatePackage)
);
router.patch(
  '/packages/:id/deactivate',
  authenticate,
  authorize('products:write'),
  catchAsync(deletePackage)
);
router.patch(
  '/packages/:id/profiles',
  authenticate,
  authorize('products:write'),
  validate(packageProfilesSchema),
  catchAsync(async (req, res) => {
    const { id } = req.params;
    const profiles = req.validated.body;
    const existing = await require('../../config/db').query(
      'SELECT id FROM product_packages WHERE id = ?',
      [id]
    );
    if (!existing.length) {
      return res.status(404).json({ error: 'Paquete no encontrado', code: 'package_not_found' });
    }
    const conn = await require('../../config/db').getConnection();
    try {
      await conn.query('START TRANSACTION');
      await conn.query('DELETE FROM package_profiles WHERE package_id = ?', [id]);
      for (const pp of profiles) {
        await conn.query(
          `INSERT INTO package_profiles (package_id, profile_type, quantity_profiles, stickers_per_profile)
           VALUES (?, ?, ?, ?)`,
          [id, pp.profile_type || 'person', pp.quantity_profiles || 1, pp.stickers_per_profile || 2]
        );
      }
      await conn.query(
        'INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, metadata, ip_address) VALUES (?, ?, ?, ?, ?, ?)',
        [req.user.id, 'package.profiles_update', 'product_packages', String(id), JSON.stringify({ profiles }), req.ip]
      );
      await conn.query('COMMIT');
    } catch (error) {
      await conn.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      conn.release();
    }
    return res.json({ message: 'Composición del paquete actualizada' });
  })
);

module.exports = router;
