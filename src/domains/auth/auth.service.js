const db = require('../../config/db');
const { hashPassword, comparePassword, generateToken } = require('../../utils/crypto');
const {
  createAccessToken,
  createRefreshToken,
  verifyRefreshToken,
} = require('../../utils/jwt');
const { createRecoveryToken } = require('../../utils/recovery-tokens');
const config = require('../../config');

const setAuthTokens = (res, accessToken, refreshToken) => {
  // Tokens se devuelven en el body de la respuesta (Bearer token, funciona cross-domain)
  // No se usan cookies para evitar problemas de CORS entre dominios distintos.
  return { accessToken, refreshToken };
};

const clearAuthTokens = (res) => {
  // No-op en backend: el frontend limpia localStorage en logout
};

const register = async (req, res) => {
  const { name, email, password } = req.validated.body;

  const role = 'user';

  const existing = await db.query('SELECT id FROM users WHERE email = ?', [email]);
  if (existing.length > 0) {
    return res.status(409).json({ error: 'El correo ya está registrado' });
  }

  const passwordHash = hashPassword(password);
  const result = await db.query(
    'INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?)',
    [email, passwordHash, role]
  );
  const userId = result.insertId;

  await db.query(
    'INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, metadata, ip_address) VALUES (?, ?, ?, ?, ?, ?)',
    [userId, 'user.register', 'users', String(userId), JSON.stringify({ email, role }), req.ip]
  );

  const accessToken = createAccessToken({ sub: userId, email, role });
  const refreshToken = createRefreshToken({ sub: userId, email, role });

  await db.query(
    'INSERT INTO user_sessions (user_id, refresh_token_hash, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 7 DAY))',
    [userId, require('crypto').createHash('sha256').update(refreshToken).digest('hex')]
  );

  return res.status(201).json({
    user: { id: userId, email, name, role: role || 'user' },
    accessToken,
    refreshToken,
  });
};

const login = async (req, res) => {
  const { email, password } = req.validated.body;

  const users = await db.query('SELECT * FROM users WHERE email = ?', [email]);
  const user = users[0];
  if (!user) {
    return res.status(401).json({ error: 'Credenciales inválidas' });
  }

  const valid = await comparePassword(password, user.password_hash);
  if (!valid) {
    return res.status(401).json({ error: 'Credenciales inválidas' });
  }

  const accessToken = createAccessToken({
    sub: user.id,
    email: user.email,
    role: user.role,
  });
  const refreshToken = createRefreshToken({
    sub: user.id,
    email: user.email,
    role: user.role,
  });

  await db.query(
    'INSERT INTO user_sessions (user_id, refresh_token_hash, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 7 DAY))',
    [user.id, require('crypto').createHash('sha256').update(refreshToken).digest('hex')]
  );

  return res.json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name || '',
      role: user.role,
    },
    accessToken,
    refreshToken,
  });
};

const refresh = async (req, res) => {
  const token = req.body && req.body.refresh_token;
  if (!token) {
    return res.status(401).json({ error: 'Sesión expirada' });
  }

  try {
    const payload = verifyRefreshToken(token);
    const sessions = await db.query(
      'SELECT id FROM user_sessions WHERE user_id = ? AND revoked_at IS NULL AND expires_at > NOW() LIMIT 1',
      [payload.sub]
    );
    if (sessions.length === 0) {
      return res.status(401).json({ error: 'Sesión inválida' });
    }

    const accessToken = createAccessToken({
      sub: payload.sub,
      email: payload.email,
      role: payload.role,
    });
    return res.json({ ok: true, accessToken });
  } catch (error) {
    return res.status(401).json({ error: 'Sesión inválida o expirada' });
  }
};

const logout = async (req, res) => {
  const token = req.body && req.body.refresh_token;
  if (token) {
    try {
      const payload = verifyRefreshToken(token);
      await db.query(
        'UPDATE user_sessions SET revoked_at = NOW() WHERE user_id = ? AND refresh_token_hash = ?',
        [payload.sub, require('crypto').createHash('sha256').update(token).digest('hex')]
      );
    } catch (error) {
      // ignore invalid token on logout
    }
  }
  clearAuthTokens(res);
  return res.json({ ok: true });
};

const forgotPassword = async (req, res) => {
  const { email } = req.validated.body;

  // No revelar si el correo existe o no (protección contra enumeración)
  const users = await db.query('SELECT id FROM users WHERE email = ?', [email]);
  if (users.length > 0) {
    const token = createRecoveryToken(users[0].id);
    await db.query(
      'INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 1 HOUR))',
      [users[0].id, require('crypto').createHash('sha256').update(token).digest('hex')]
    );

    const resetUrl = `${config.frontendUrl}/auth/reset-password?token=${token}`;
    try {
      await emailService.sendPasswordReset(email, resetUrl);
    } catch (error) {
    }
  }

  return res.json({
    message: 'Si el correo está registrado, recibirá un enlace de restablecimiento.',
  });
};

const resetPassword = async (req, res) => {
  const { token, password } = req.validated.body;

  const tokenHash = require('crypto').createHash('sha256').update(token).digest('hex');
  const tokens = await db.query(
    'SELECT * FROM password_reset_tokens WHERE token_hash = ? AND used_at IS NULL AND expires_at > NOW()',
    [tokenHash]
  );
  if (tokens.length === 0) {
    return res.status(400).json({ error: 'Token inválido o expirado' });
  }

  const passwordHash = hashPassword(password);
  await db.query('UPDATE users SET password_hash = ? WHERE id = ?', [
    passwordHash,
    tokens[0].user_id,
  ]);
  await db.query(
    'UPDATE password_reset_tokens SET used_at = NOW() WHERE id = ?',
    [tokens[0].id]
  );
  await db.query('UPDATE user_sessions SET revoked_at = NOW() WHERE user_id = ?', [
    tokens[0].user_id,
  ]);

  await db.query(
    'INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, metadata, ip_address) VALUES (?, ?, ?, ?, ?, ?)',
    [tokens[0].user_id, 'user.password_reset', 'users', String(tokens[0].user_id), JSON.stringify({}), req.ip]
  );

  return res.json({ message: 'Contraseña restablecida correctamente' });
};

const me = async (req, res) => {
  return res.json({ user: req.user });
};

module.exports = {
  register,
  login,
  me,
  refresh,
  logout,
  forgotPassword,
  resetPassword,
};

