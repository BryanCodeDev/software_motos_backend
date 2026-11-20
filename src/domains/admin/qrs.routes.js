const express = require('express');
const { authenticate, authorize } = require('../../middlewares/auth');
const { validate } = require('../../middlewares/validate');
const { catchAsync } = require('../../middlewares/catch-async');
const { z } = require('zod');
const {
  listQrs,
  qrStats,
  createQr,
  linkQr,
  unlinkQr,
  setPrintStatus,
  archiveQr,
  setQrStatus,
  activateQr,
  deactivateQr,
  deleteQr,
  bulkSetQrStatus,
  bulkDeleteQr,
  bulkPrintStatus,
  bulkSetDesign,
  exportByIds,
} = require('./qrs.controller');

const router = express.Router();

const qrIdSchema = z.object({
  params: z.object({ id: z.string().regex(/^\d+$/, 'ID de QR inválido') }),
});

const linkSchema = z.object({
  body: z.object({
    qr_id: z.union([z.string().regex(/^\d+$/, 'ID de QR inválido'), z.number().int().positive('ID de QR inválido')]),
    user_id: z.union([z.string().regex(/^\d+$/, 'ID de usuario inválido'), z.number().int().positive('ID de usuario inválido')]),
  }),
});

const unlinkSchema = z.object({
  body: z.object({
    qr_id: z.union([z.string().regex(/^\d+$/, 'ID de QR inválido'), z.number().int().positive('ID de QR inválido')]),
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

const archiveSchema = z.object({
  params: z.object({ id: z.string().regex(/^\d+$/, 'ID de QR inválido') }),
  body: z.object({
    reason: z.string().max(500).optional(),
    force: z.boolean().optional(),
  }),
});

const qrStatusSchema = z.object({
  params: z.object({ id: z.string().regex(/^\d+$/, 'ID de QR inválido') }),
  body: z.object({
    status: z.enum(['active', 'disabled']),
  }),
});

const qrDeleteSchema = z.object({
  params: z.object({ id: z.string().regex(/^\d+$/, 'ID de QR inválido') }),
  body: z.object({
    force: z.boolean().optional(),
  }),
});

const bulkQrStatusSchema = z.object({
  body: z.object({
    qr_ids: z.array(
      z.union([z.string().regex(/^\d+$/), z.number().int()])
    ).min(1, 'Se requiere al menos un QR'),
    status: z.enum(['active', 'disabled']),
  }),
});

const bulkQrDeleteSchema = z.object({
  body: z.object({
    qr_ids: z.array(
      z.union([z.string().regex(/^\d+$/), z.number().int()])
    ).min(1, 'Se requiere al menos un QR'),
    force: z.boolean().optional(),
  }),
});

const bulkPrintStatusSchema = z.object({
  body: z.object({
    qr_ids: z.array(
      z.union([z.string().regex(/^\d+$/), z.number().int()])
    ).min(1, 'Se requiere al menos un QR'),
    print_status: z.enum([
      'pending_print', 'sent_to_print', 'printed', 'delivered', 'cancelled',
    ]),
  }),
});

const bulkQrDesignSchema = z.object({
  body: z.object({
    qr_ids: z.array(
      z.union([z.string().regex(/^\d+$/), z.number().int()])
    ).min(1, 'Se requiere al menos un QR'),
    design_id: z.coerce.number().int().positive().optional().nullable(),
  }),
});

const exportSchema = z.object({
  query: z.object({
    ids: z.string().nonempty('Se requieren identificadores de QR'),
    format: z.enum(['csv', 'zip', 'pdf']).default('csv'),
  }),
});

router.get('/', authenticate, authorize('qrs:read'), catchAsync(listQrs));
router.get('/stats', authenticate, authorize('qrs:read'), catchAsync(qrStats));
router.post('/create', authenticate, authorize('qrs:write'), catchAsync(createQr));

// Detalle y imagen de un QR (controlador de identificadores).
router.get('/:id', authenticate, authorize('qrs:read'), validate(qrIdSchema), catchAsync(require('../identifiers/identifier.controller').getIdentifierDetail));
router.get('/:id/qr', authenticate, authorize('qrs:read'), validate(qrIdSchema), catchAsync(require('../identifiers/identifier.controller').getQrImage));

router.post('/link', authenticate, authorize('qrs:write'), validate(linkSchema), catchAsync(linkQr));
router.post('/unlink', authenticate, authorize('qrs:write'), validate(unlinkSchema), catchAsync(unlinkQr));

// Acciones masivas de impresión (debe ir ANTES de las rutas con :id para no colisionar).
router.post('/bulk/print-status', authenticate, authorize('qrs:bulk_actions'), validate(bulkPrintStatusSchema), catchAsync(bulkPrintStatus));

// Acciones masivas: activar/desactivar/eliminar QRs.
router.post('/bulk/activate', authenticate, authorize('qrs:write'), validate(bulkQrStatusSchema), catchAsync(bulkSetQrStatus));
router.post('/bulk/deactivate', authenticate, authorize('qrs:write'), validate(bulkQrStatusSchema), catchAsync(bulkSetQrStatus));
router.post('/bulk/delete', authenticate, authorize('qrs:archive'), validate(bulkQrDeleteSchema), catchAsync(bulkDeleteQr));
router.patch('/bulk/design', authenticate, authorize('qrs:write'), validate(bulkQrDesignSchema), catchAsync(bulkSetDesign));

router.post('/:id/print-status', authenticate, authorize('qrs:write'), validate(printStatusSchema), catchAsync(setPrintStatus));

// Archivado lógico (no borrado físico).
router.post('/:id/archive', authenticate, authorize('qrs:archive'), validate(archiveSchema), catchAsync(archiveQr));

// Activar / desactivar / eliminar un QR individual.
router.post('/:id/activate', authenticate, authorize('qrs:write'), catchAsync(activateQr));
router.post('/:id/deactivate', authenticate, authorize('qrs:write'), catchAsync(deactivateQr));
router.delete('/:id', authenticate, authorize('qrs:archive'), validate(qrDeleteSchema), catchAsync(deleteQr));

router.get('/export/csv', authenticate, authorize('qrs:export'), validate(exportSchema), (req, res) => exportByIds(req, res, 'csv'));
router.get('/export/zip', authenticate, authorize('qrs:export'), validate(exportSchema), (req, res) => exportByIds(req, res, 'zip'));
router.get('/export/pdf', authenticate, authorize('qrs:export'), validate(exportSchema), (req, res) => exportByIds(req, res, 'pdf'));

module.exports = router;
