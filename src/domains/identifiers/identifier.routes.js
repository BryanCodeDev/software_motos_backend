const express = require('express');
const { authenticate } = require('../../middlewares/auth');
const { catchAsync } = require('../../middlewares/catch-async');
const { getMyIdentifier,
  deactivateIdentifier,
  replaceIdentifier,
  downloadQr,
  recordScan,
} = require('./identifier.controller');

const router = express.Router();

// Usuario autenticado: su propio QR
router.get('/my', authenticate, catchAsync(getMyIdentifier));
router.post('/deactivate', authenticate, catchAsync(deactivateIdentifier));
router.post('/replace', authenticate, catchAsync(replaceIdentifier));
router.get('/my/qr', authenticate, catchAsync(downloadQr));

// Público: registro de escaneo QR (métricas). Tolerante a fallos, sin autenticación.
router.post('/scans', catchAsync(recordScan));

module.exports = router;
