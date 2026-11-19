const express = require('express');
const { authenticate } = require('../../middlewares/auth');
const { validate } = require('../../middlewares/validate');
const { catchAsync } = require('../../middlewares/catch-async');
const { profileCreateSchema, profileUpdateSchema, photoUploadSchema } = require('./profile.schema');
const {
  listProfiles,
  getProfile,
  createProfile,
  updateProfile,
  deactivateProfile,
  reactivateProfile,
  uploadPhoto,
  deletePhoto,
  servePhoto,
  getPublicProfile,
} = require('./profile.controller');

const router = express.Router();

// Mis perfiles (multi-perfil).
router.get('/me', authenticate, catchAsync(listProfiles));
router.get('/me/profiles', authenticate, catchAsync(listProfiles));
router.post('/me/profiles', authenticate, validate(profileCreateSchema), catchAsync(createProfile));
router.get('/me/profiles/:profileId', authenticate, catchAsync(getProfile));
router.patch('/me/profiles/:profileId', authenticate, validate(profileUpdateSchema), catchAsync(updateProfile));
router.patch('/me/profiles/:profileId/deactivate', authenticate, catchAsync(deactivateProfile));
router.patch('/me/profiles/:profileId/reactivate', authenticate, catchAsync(reactivateProfile));

// Fotografía por perfil.
router.post('/profiles/photo', authenticate, validate(photoUploadSchema), catchAsync(uploadPhoto));
router.delete('/profiles/photo', authenticate, validate(photoUploadSchema), catchAsync(deletePhoto));
router.get('/profiles/photo/:filename', catchAsync(servePhoto));

// Perfil público por identificador QR (compatibilidad con URL existentes).
router.get('/public/:identifier', catchAsync(getPublicProfile));

module.exports = router;
