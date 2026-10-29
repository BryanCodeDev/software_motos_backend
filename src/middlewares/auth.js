const { verifyAccessToken } = require('../utils/jwt');

const authenticate = (req, res, next) => {
  const token = req.cookies && req.cookies.access_token;
  if (!token) {
    return res.status(401).json({ error: 'No autenticado' });
  }

  try {
    const payload = verifyAccessToken(token);
    req.user = {
      id: payload.sub,
      email: payload.email,
      role: payload.role,
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

