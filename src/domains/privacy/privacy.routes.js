const express = require('express');
const { authenticate } = require('../../middlewares/auth');
const { validate } = require('../../middlewares/validate');
const { catchAsync } = require('../../middlewares/catch-async');
const { consentRecordSchema, dataRequestSchema, dataRequestResponseSchema } = require('./privacy.schema');
const {
  recordConsent,
  getConsentHistory,
  getConsentStatus,
  createDataRequest,
  listMyDataRequests,
  listAllDataRequests,
  respondToDataRequest,
} = require('./privacy.controller');

const router = express.Router();

/* --- Consentimientos del usuario autenticado --- */
router.get('/consents/me', authenticate, catchAsync(getConsentStatus));
router.get('/consents/history', authenticate, catchAsync(getConsentHistory));
router.post('/consents', authenticate, validate(consentRecordSchema), catchAsync(recordConsent));

/* --- Solicitudes de derechos del titular --- */
router.get('/requests/me', authenticate, catchAsync(listMyDataRequests));
router.post('/requests', authenticate, validate(dataRequestSchema), catchAsync(createDataRequest));

/* --- Administración de solicitudes (solo admin) --- */
router.get('/admin/requests', authenticate, catchAsync(listAllDataRequests));
router.patch('/admin/requests/:id', authenticate, validate(dataRequestResponseSchema), catchAsync(respondToDataRequest));

module.exports = router;
