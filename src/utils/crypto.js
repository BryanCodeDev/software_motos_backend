const crypto = require('crypto');

const generateIdentifier = () =>
  `emg_${crypto.randomBytes(12).toString('hex')}`;

const generateToken = (bytes = 32) => crypto.randomBytes(bytes).toString('hex');

const hashPassword = (password) => {
  const bcrypt = require('bcryptjs');
  const salt = bcrypt.genSaltSync(12);
  return bcrypt.hashSync(password, salt);
};

const comparePassword = (plain, hash) => {
  const bcrypt = require('bcryptjs');
  return bcrypt.compareSync(plain, hash);
};

const sanitizeError = (error) => ({
  message: error.message || 'Error interno del servidor',
});

module.exports = {
  generateIdentifier,
  generateToken,
  hashPassword,
  comparePassword,
  sanitizeError,
};

