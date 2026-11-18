require('dotenv').config();

const schema = require('./env.schema');

const missing = schema.required.filter((key) => !process.env[key]);
if (missing.length > 0) {
  // eslint-disable-next-line no-console
  console.warn(
    `[ADVERTENCIA] Faltan variables de entorno requeridas: ${missing.join(
      ', '
    )}. El sistema funcionará en modo de configuración pendiente para las integraciones afectadas.`
  );
}

const get = (key, def) => {
  const value = process.env[key];
  return value === undefined ? def : value;
};

// Debug log for Railway/MySQL vars
const dbHost = get('DB_HOST', get('MYSQLHOST', get('MYSQL_HOST', get('RAILWAY_PRIVATE_DOMAIN', 'localhost'))));
const dbPort = parseInt(get('DB_PORT', get('MYSQLPORT', get('MYSQL_PORT', '3306'))), 10);
const dbUser = get('DB_USER', get('MYSQLUSER', get('MYSQL_USER', 'root')));
const dbPass = get('DB_PASSWORD', get('MYSQLPASSWORD', get('MYSQL_PASSWORD', get('MYSQL_ROOT_PASSWORD', ''))));
const dbName = get('DB_NAME', get('MYSQL_DATABASE', get('MYSQLDATABASE', get('MYSQL_DB', 'railway'))));
const dbUrl = get('DATABASE_URL', '') || get('MYSQL_URL', '') || '';

module.exports = {
  env: get('NODE_ENV', 'development'),
  port: parseInt(get('PORT', '4000'), 10),
  appUrl: get('APP_URL', 'http://localhost:4000'),
  frontendUrl: get('FRONTEND_URL', 'http://localhost:5173'),
  databaseUrl: dbUrl || `mysql://${dbUser}:${encodeURIComponent(dbPass)}@${dbHost}:${dbPort}/${dbName}`,
  db: {
    host: dbHost,
    port: dbPort,
    user: dbUser,
    password: dbPass,
    database: dbName,
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
  appName: get('APP_NAME', 'Identificación de Emergencia'),
  company: {
    name: get('COMPANY_NAME', 'PENDIENTE DE CONFIGURAR'),
    nit: get('COMPANY_NIT', 'PENDIENTE DE CONFIGURAR'),
    address: get('COMPANY_ADDRESS', 'PENDIENTE DE CONFIGURAR'),
    email: get('COMPANY_EMAIL', 'PENDIENTE DE CONFIGURAR'),
    phone: get('COMPANY_PHONE', 'PENDIENTE DE CONFIGURAR'),
    privacyEmail: get('PRIVACY_EMAIL', 'PENDIENTE DE CONFIGURAR'),
  },
  documents: {
    termsVersion: get('TERMS_VERSION', '1.0'),
    privacyVersion: get('PRIVACY_VERSION', '1.0'),
    termsEffectiveDate: get('TERMS_EFFECTIVE_DATE', ''),
    privacyEffectiveDate: get('PRIVACY_EFFECTIVE_DATE', ''),
  },
  cookie: {
    secure: get('NODE_ENV', 'development') === 'production',
    sameSite: get('NODE_ENV', 'development') === 'production' ? 'none' : 'lax',
    domain: get('COOKIE_DOMAIN', ''),
  },
};
