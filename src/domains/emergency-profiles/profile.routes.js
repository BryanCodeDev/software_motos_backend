const express = require('express');
const { authenticate } = require('../../middlewares/auth');
const { validate } = require('../../middlewares/validate');
const { catchAsync } = require('../../middlewares/catch-async');
const { profileSchema, privacySchema, photoUploadSchema } = require('./profile.schema');
const {
  getProfile,
  updateProfile,
  getPrivacy,
  updatePrivacy,
  getPublicProfile,
  uploadPhoto,
  deletePhoto,
  servePhoto,
} = require('./profile.controller');

const router = express.Router();

router.get('/me', authenticate, catchAsync(getProfile));
router.patch('/me', authenticate, validate(profileSchema), catchAsync(updateProfile));
router.get('/privacy/me', authenticate, catchAsync(getPrivacy));
router.patch('/privacy/me', authenticate, validate(privacySchema), catchAsync(updatePrivacy));
router.post('/photo', authenticate, validate(photoUploadSchema), catchAsync(uploadPhoto));
router.delete('/photo', authenticate, catchAsync(deletePhoto));
router.get('/public/:identifier', catchAsync(getPublicProfile));
router.get('/photo/:filename', catchAsync(servePhoto));

module.exports = router;
