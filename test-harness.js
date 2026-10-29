const { createApp } = require('./app');
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
  MERCADOPAGO_ACCESS_TOKEN: process.env.MERCADOPAGO_ACCESS_TOKEN || '',
  MERCADOPAGO_PUBLIC_KEY: process.env.MERCADOPAGO_PUBLIC_KEY || '',
  MERCADOPAGO_WEBHOOK_SECRET: process.env.MERCADOPAGO_WEBHOOK_SECRET || '',
  RESEND_API_KEY: '',
  EMAIL_FROM: 'no-reply@prueba.emergencia.id',
  APP_NAME: 'Identificación de Emergencia',
};

// Apply env before requiring config
for (const [k, v] of Object.entries(TEST_ENV)) {
  if (process.env[k] === undefined) process.env[k] = v;
}

const apiRouter = require('./routes');
const app = createApp(apiRouter);

const server = http.createServer(app);

const start = () => new Promise((resolve) => {
  server.listen(4001, () => resolve(server));
});

module.exports = { app, server, start, TEST_ENV };