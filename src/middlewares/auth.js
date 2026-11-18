const { verifyAccessToken } = require('../utils/jwt');
const db = require('../config/db');

/*
 * Permisos granulares por rol. No es un sistema paralelo de autorización:
 * es una capa sobre los roles existentes (user, admin, operator, superadmin).
 * Cada permiso es una acción concreta que un rol puede ejecutar.
 */
const PERMISSIONS_BY_ROLE = {
  user: [],
  operator: [
    'orders:read',
    'qrs:read',
    'qrs:write',
    'qrs:export',
    'designs:read',
    'dashboard:read',
  ],
  admin: [
    'orders:read',
    'orders:write',
    'orders:status_change',
    'orders:carrier_update',
    'qrs:read',
    'qrs:write',
    'qrs:bulk_actions',
    'qrs:archive',
    'qrs:export',
    'users:read',
    'users:write',
    'users:suspend',
    'payments:read',
    'dashboard:read',
    'products:read',
    'products:write',
    'designs:read',
    'designs:write',
    'audit:read',
  ],
  superadmin: ['*'],
};

const rolePermissions = (role) => {
  if (!role) {return [];}
  if (role === 'superadmin') {return PERMISSIONS_BY_ROLE.superadmin;}
  return PERMISSIONS_BY_ROLE[role] || [];
};

const hasPermission = (role, permission) => {
  const perms = rolePermissions(role);
  return perms.includes('*') || perms.includes(permission);
};

const authenticate = async (req, res, next) => {
  const authHeader = req.headers.authorization || '';
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  // También se acepta el token en la cookie access_token (flujo de sesiones basado en cookies).
  const cookieToken = req.cookies && req.cookies.access_token ? req.cookies.access_token : null;
  const token = bearerToken || cookieToken;
  if (!token) {
    return res.status(401).json({ error: 'No autenticado' });
  }

  try {
    const payload = verifyAccessToken(token);
    const rows = await db.query(
      'SELECT id, email, role, suspended_at FROM users WHERE id = ?',
      [payload.sub]
    );
    if (rows.length === 0) {
      return res.status(401).json({ error: 'Usuario no encontrado' });
    }
    const user = rows[0];

    // Una cuenta suspendida no puede autenticarse ni realizar operaciones protegidas.
    if (user.suspended_at) {
      return res.status(403).json({
        error: 'Cuenta suspendida',
        code: 'account_suspended',
        reason: user.suspended_reason || null,
      });
    }

    req.user = {
      id: user.id,
      email: user.email,
      role: user.role,
      name: payload.name || '',
      permissions: rolePermissions(user.role),
    };
    return next();
  } catch {
    return res.status(401).json({ error: 'Sesión inválida o expirada' });
  }
};

const requirePermission = (permission) => (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: 'No autenticado' });
  }
  if (!hasPermission(req.user.role, permission)) {
    return res.status(403).json({ error: 'No autorizado para esta acción' });
  }
  return next();
};

const authorizeRole = (...roles) => (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: 'No autenticado' });
  }
  if (!roles.includes(req.user.role)) {
    return res.status(403).json({ error: 'No autorizado' });
  }
  return next();
};

/* Compatibilidad: authorize sigue aceptando roles y ahora también un solo permiso. */
const authorize = (...spec) => {
  if (spec.length === 1 && typeof spec[0] === 'string' && !['user', 'admin', 'operator', 'superadmin'].includes(spec[0])) {
    return requirePermission(spec[0]);
  }
  return authorizeRole(...spec);
};

const can = (permission) => (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: 'No autenticado' });
  }
  if (!hasPermission(req.user.role, permission)) {
    return res.status(403).json({ error: 'No autorizado para esta acción' });
  }
  return next();
};

module.exports = { authenticate, authorize, authorizeRole, requirePermission, can, rolePermissions, hasPermission };
