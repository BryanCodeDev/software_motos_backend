const express = require('express');
const { authenticate, authorize } = require('../../middlewares/auth');
const { validate } = require('../../middlewares/validate');
const { catchAsync } = require('../../middlewares/catch-async');
const { z } = require('zod');
const {
  listQrs,
  qrStats,
  linkQr,
  unlinkQr,
  setPrintStatus,
  exportByIds,
} = require('./qrs.controller');

const router = express.Router();

// Todas las rutas de administración QR requieren rol de administrador.
router.use(authenticate, authorize('admin'));

const qrIdSchema = z.object({
  params: z.object({ id: z.string().regex(/^\d+$/, 'ID de QR inválido') }),
});

const linkSchema = z.object({
  body: z.object({
    qr_id: z.string().regex(/^\d+$/, 'ID de QR inválido'),
    user_id: z.string().regex(/^\d+$/, 'ID de usuario inválido'),
  }),
});

const unlinkSchema = z.object({
  body: z.object({
    qr_id: z.string().regex(/^\d+$/, 'ID de QR inválido'),
  }),
});

const printStatusSchema = z.object({
  params: z.object({ id: z.string().regex(/^\d+$/, 'ID de QR inválido') }),
  body: z.object({
    print_status: z.enum([
      'pending_print', 'sent_to_print', 'printed', 'delivered', 'cancelled',
    ]),
  }),
});

const exportSchema = z.object({
  query: z.object({
    ids: z.string().nonempty('Se requieren identificadores de QR'),
    format: z.enum(['csv', 'zip', 'pdf']).default('csv'),
  }),
});

router.get('/', catchAsync(listQrs));
router.get('/stats', catchAsync(qrStats));
router.post('/create', catchAsync(createQr));

// Detalle y imagen de un QR (controlador de identificadores).
const { getIdentifierDetail, getQrImage } = require('../identifiers/identifier.controller');
router.get('/:id', validate(qrIdSchema), catchAsync(getIdentifierDetail));
router.get('/:id/qr', validate(qrIdSchema), catchAsync(getQrImage));

router.post('/link', validate(linkSchema), catchAsync(linkQr));
router.post('/unlink', validate(unlinkSchema), catchAsync(unlinkQr));
router.post('/:id/print-status', validate(printStatusSchema), catchAsync(setPrintStatus));

router.get('/export/csv', validate(exportSchema), (req, res) => exportByIds(req, res, 'csv'));
router.get('/export/zip', validate(exportSchema), (req, res) => exportByIds(req, res, 'zip'));
router.get('/export/pdf', validate(exportSchema), (req, res) => exportByIds(req, res, 'pdf'));

module.exports = router;
