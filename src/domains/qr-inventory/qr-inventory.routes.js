const express = require('express');
const { authenticate, authorize } = require('../../middlewares/auth');
const { validate } = require('../../middlewares/validate');
const { catchAsync } = require('../../middlewares/catch-async');
const {
  paginationSchema,
  packageIdSchema,
  batchIdSchema,
  createBatchSchema,
  setPackageStatusSchema,
  receiveBatchSchema,
  exportSchema,
} = require('./qr-inventory.schema');
const {
  listPackages,
  getPackageDetail,
  createBatch,
  markBatchPrinted,
  markBatchReceived,
  markBatchCancelled,
  setPackageStatus,
  getDashboardStats,
  releaseExpiredReservations,
  exportPackages,
} = require('./qr-inventory.controller');

const router = express.Router();

// Todas las operaciones de inventario requieren rol de administrador.
router.use(authenticate, authorize('admin'));

router.get('/stats', catchAsync(getDashboardStats));
router.get('/packages', validate(paginationSchema), catchAsync(listPackages));
router.get('/packages/:id', validate(packageIdSchema), catchAsync(getPackageDetail));
router.post('/packages/:id/status', validate(setPackageStatusSchema), catchAsync(setPackageStatus));
router.post('/batches', validate(createBatchSchema), catchAsync(createBatch));
router.post('/batches/:id/print', validate(batchIdSchema), catchAsync(markBatchPrinted));
router.post('/batches/:id/receive', validate(receiveBatchSchema), catchAsync(markBatchReceived));
router.post('/batches/:id/cancel', validate(batchIdSchema), catchAsync(markBatchCancelled));
router.post('/reservations/release-expired', catchAsync(releaseExpiredReservations));
router.get('/export', validate(exportSchema), catchAsync(exportPackages));

module.exports = router;
