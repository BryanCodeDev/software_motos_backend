const express = require('express');
const { authenticate, authorize } = require('../../middlewares/auth');
const { validate } = require('../../middlewares/validate');
const { catchAsync } = require('../../middlewares/catch-async');
const {
  designParamsSchema,
  designQuerySchema,
  updateDesignSchema,
} = require('./design.schema');
const {
  listDesigns,
  adminListDesigns,
  updateDesign,
} = require('./design.controller');

const router = express.Router();

// Público: catálogo de diseños de stickers.
router.get('/', validate(designQuerySchema), catchAsync(listDesigns));

// Administrador: gestión de diseños.
router.get('/admin', authenticate, authorize('designs:write'), catchAsync(adminListDesigns));
router.patch(
  '/admin/:id',
  authenticate,
  authorize('designs:write'),
  validate(designParamsSchema),
  validate(updateDesignSchema),
  catchAsync(updateDesign)
);

module.exports = router;
