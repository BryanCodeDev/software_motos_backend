const http = require('http');

const TEST_ENV = {
  NODE_ENV: 'test',
  PORT: '4001',
  APP_URL: 'http://localhost:4001',
  FRONTEND_URL: 'http://localhost:5173',
  DB_HOST: 'localhost',
  DB_PORT: '3307',
  DB_USER: 'root',
  DB_PASSWORD: 'Santimajo101219@',
  DB_NAME: 'emergency_id_test',
  SESSION_SECRET: 'prueba_session_secret_minimo_32_caracteres_',
  JWT_ACCESS_SECRET: 'prueba_jwt_access_secret_desarrollo_',
  JWT_REFRESH_SECRET: 'prueba_jwt_refresh_secret_desarrollo_',
  ADMIN_BOOTSTRAP_TOKEN: 'prueba_bootstrap_token_seguro',
  // URL de conexión explícita para el pool (evita el DATABASE_URL por defecto del entorno).
  DATABASE_URL: 'mysql://root:Santimajo101219%40@localhost:3307/emergency_id_test',
  MERCADOPAGO_ACCESS_TOKEN: process.env.MERCADOPAGO_ACCESS_TOKEN || '',
  MERCADOPAGO_PUBLIC_KEY: process.env.MERCADOPAGO_PUBLIC_KEY || '',
  MERCADOPAGO_WEBHOOK_SECRET: process.env.MERCADOPAGO_WEBHOOK_SECRET || '',
  RESEND_API_KEY: '',
  EMAIL_FROM: 'no-reply@prueba.emergencia.id',
  APP_NAME: 'Tu QR te Cuida',
};

// Aplicar variables de entorno de pruebas ANTES de cargar la aplicación/config.
// src/app requiere ./config, que lee DB_* y JWT_* al iniciarse.
for (const [k, v] of Object.entries(TEST_ENV)) {
  if (process.env[k] === undefined) process.env[k] = v;
}

// Dotenv puede cargar .env (solo Resend en este repo); las variables de prueba
// ya están definidas y no se sobrescriben.
try { require('dotenv').config(); } catch (_) {}

const { createApp } = require('./src/app');
const apiRouter = require('./src/routes');
const app = createApp(apiRouter);

const server = http.createServer(app);

const start = () => new Promise((resolve) => {
  server.listen(parseInt(process.env.PORT, 10) || 4001, () => resolve(server));
});

module.exports = { app, server, start, TEST_ENV };
