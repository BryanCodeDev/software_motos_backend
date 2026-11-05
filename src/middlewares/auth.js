const { verifyAccessToken } = require('../utils/jwt');
const db = require('../config/db');

const authenticate = async (req, res, next) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'No autenticado' });
  }

  try {
    const payload = verifyAccessToken(token);
const rows = await db.query('SELECT id FROM users WHERE id = ?', [payload.sub]);
if (rows.length === 0) {
  return res.status(401).json({ error: 'Usuario no encontrado' });
}
req.user = {
  id: payload.sub,
  email: payload.email,
  role: payload.role,
  name: '',
};
    return next();
  } catch (error) {
    return res.status(401).json({ error: 'Sesión inválida o expirada' });
  }
};

const authorize = (...roles) => (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: 'No autenticado' });
  }
  if (!roles.includes(req.user.role)) {
    return res.status(403).json({ error: 'No autorizado' });
  }
  return next();
};

module.exports = { authenticate, authorize };

