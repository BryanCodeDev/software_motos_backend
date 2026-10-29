const express = require('express');
const { authenticate } = require('../../middlewares/auth');
const { validate } = require('../../middlewares/validate');
const { catchAsync } = require('../../middlewares/catch-async');
const { contactSchema } = require('./contact.schema');
const {
  listContacts,
  createContact,
  updateContact,
  deleteContact,
} = require('./contact.controller');

const router = express.Router();

router.get('/', authenticate, catchAsync(listContacts));
router.post('/', authenticate, validate(contactSchema), catchAsync(createContact));
router.patch('/:id', authenticate, validate(contactSchema), catchAsync(updateContact));
router.delete('/:id', authenticate, catchAsync(deleteContact));

module.exports = router;

