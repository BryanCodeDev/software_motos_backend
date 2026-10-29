const express = require('express');
const { authenticate } = require('../../middlewares/auth');
const { catchAsync } = require('../../middlewares/catch-async');
const {
  createIdentifier,
  getMyIdentifier,
  deactivateIdentifier,
  replaceIdentifier,
  downloadQr,
} = require('./identifier.controller');

const router = express.Router();

router.post('/', authenticate, catchAsync(createIdentifier));
router.get('/my', authenticate, catchAsync(getMyIdentifier));
router.post('/deactivate', authenticate, catchAsync(deactivateIdentifier));
router.post('/replace', authenticate, catchAsync(replaceIdentifier));
router.get('/my/qr', authenticate, catchAsync(downloadQr));

module.exports = router;

