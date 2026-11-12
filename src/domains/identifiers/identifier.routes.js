const express = require('express');
const { authenticate, authorize } = require('../../middlewares/auth');
const { validate } = require('../../middlewares/validate');
const { catchAsync } = require('../../middlewares/catch-async');
const { identifierSchema } = require('./identifier.schema');
const {
  createIdentifier,
  getMyIdentifier,
  deactivateIdentifier,
  replaceIdentifier,
  downloadQr,
  getQrImage,
  getIdentifierDetail,
  exportQrsCsv,
  exportQrsZip,
  exportQrsPdf,
  bulkUpdatePrintStatus,
} = require('./identifier.controller');

const router = express.Router();

// Usuario autenticado: su propio QR
router.post('/', authenticate, catchAsync(createIdentifier));
router.get('/my', authenticate, catchAsync(getMyIdentifier));
router.post('/deactivate', authenticate, catchAsync(deactivateIdentifier));
router.post('/replace', authenticate, catchAsync(replaceIdentifier));
router.get('/my/qr', authenticate, catchAsync(downloadQr));

// Administrador: detalle, imagen, historial, exportación y control de impresión de un QR
router.get('/:id', authenticate, authorize('admin'), validate(identifierSchema), catchAsync(getIdentifierDetail));
router.get('/:id/qr', authenticate, authorize('admin'), validate(identifierSchema), catchAsync(getQrImage));

// Administrador: exportación masiva (selección por IDs de usuario: ?ids=1,2,3)
router.get('/export/csv', authenticate, authorize('admin'), catchAsync(exportQrsCsv));
router.get('/export/zip', authenticate, authorize('admin'), catchAsync(exportQrsZip));
router.get('/export/pdf', authenticate, authorize('admin'), catchAsync(exportQrsPdf));
router.post('/bulk-print-status', authenticate, authorize('admin'), catchAsync(bulkUpdatePrintStatus));

module.exports = router;
