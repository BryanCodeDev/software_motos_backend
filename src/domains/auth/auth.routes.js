const express = require('express');
const { authenticate } = require('../../middlewares/auth');
const { validate } = require('../../middlewares/validate');
const { catchAsync } = require('../../middlewares/catch-async');
const {
  registerSchema,
  loginSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
} = require('./auth.schema');
const {
  register,
  login,
  me,
  refresh,
  logout,
  forgotPassword,
  resetPassword,
} = require('./auth.controller');

const router = express.Router();

router.post('/register', validate(registerSchema), catchAsync(register));
router.post('/login', validate(loginSchema), catchAsync(login));
router.post('/logout', catchAsync(logout));
router.post('/refresh', catchAsync(refresh));
router.get('/me', authenticate, catchAsync(me));
router.post('/forgot-password', validate(forgotPasswordSchema), catchAsync(forgotPassword));
router.post('/reset-password', validate(resetPasswordSchema), catchAsync(resetPassword));

module.exports = router;

