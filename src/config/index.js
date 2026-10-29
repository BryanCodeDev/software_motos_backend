require('dotenv').config();

const schema = require('./env.schema');

const missing = schema.required.filter((key) => !process.env[key]);
if (missing.length > 0) {
  console.warn(
    `[ADVERTENCIA] Faltan variables de entorno requeridas: ${missing.join(
      ', '
    )}. El sistema funcionar\u00e1 en modo de configuraci\u00f3n pendiente para las integraciones afectadas.`
  );
}

const get = (key, def) => {
  const value = process.env[key];
  return value === undefined ? def : value;
};

module.exports = {
  env: get('NODE_ENV', 'development'),
  port: parseInt(get('PORT', '4000'), 10),
  appUrl: get('APP_URL', 'http://localhost:4000'),
  frontendUrl: get('FRONTEND_URL', 'http://localhost:5173'),
  databaseUrl: get('DATABASE_URL', '') || `mysql://${get('DB_USER', 'root')}:${encodeURIComponent(get('DB_PASSWORD', ''))}@${get('DB_HOST', 'localhost')}:${get('DB_PORT', '3306')}/${get('DB_NAME', 'emergency_id')}`,
  db: {
    host: get('DB_HOST', 'localhost'),
    port: parseInt(get('DB_PORT', '3306'), 10),
    user: get('DB_USER', 'root'),
    password: get('DB_PASSWORD', ''),
    database: get('DB_NAME', 'emergency_id'),
  },
  sessionSecret: get('SESSION_SECRET', 'cambiar_este_secreto_en_produccion'),
  jwt: {
    accessSecret: get('JWT_ACCESS_SECRET', 'cambiar_acceso'),
    refreshSecret: get('JWT_REFRESH_SECRET', 'cambiar_refresh'),
    accessExpiresIn: get('JWT_ACCESS_EXPIRES_IN', '15m'),
    refreshExpiresIn: get('JWT_REFRESH_EXPIRES_IN', '7d'),
  },
  mercadopago: {
    accessToken: get('MERCADOPAGO_ACCESS_TOKEN', ''),
    publicKey: get('MERCADOPAGO_PUBLIC_KEY', ''),
    webhookSecret: get('MERCADOPAGO_WEBHOOK_SECRET', ''),
  },
  resend: {
    apiKey: get('RESEND_API_KEY', ''),
    from: get('EMAIL_FROM', 'no-reply@ejemplo.com'),
  },
  appName: get('APP_NAME', 'Identificaci\u00f3n de Emergencia'),
  cookie: {
    secure: get('NODE_ENV', 'development') === 'production',
    sameSite: 'lax',
    domain: get('COOKIE_DOMAIN', ''),
  },
};

