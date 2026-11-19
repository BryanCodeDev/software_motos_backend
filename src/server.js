const { createApp } = require('./app');

const config = require('./config');
const db = require('./config/db');

const start = async () => {
  // Sincronizar columnas de permanencia/impresión de QR en BDs existentes
  // (schema.sql ya las incluye para bases nuevas).
  try {
    await db.ensureIdentifierColumns();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[QR] No se pudieron sincronizar columnas de identifiers:', err.message);
  }

  // Sincronizar tabla de diseños y columnas de pedido en BDs existentes.
  try {
    await db.ensureDesignAndOrderColumns();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[DISEÑOS] No se pudieron sincronizar diseños/pedidos:', err.message);
  }

  // Sincronizar tablas de privacidad (consentimientos y solicitudes de datos)
  // en BDs existentes creadas con versiones anteriores del esquema.
  try {
    await db.ensurePrivacySchema();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[PRIVACIDAD] No se pudieron sincronizar tablas de privacidad:', err.message);
  }

  // Sincronizar esquema de administración de pedidos (historial, correo,
  // archivado de QR, suspensión de usuarios, métricas de escaneo).
  try {
    await db.ensureAdminOrderSchema();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[ADMIN-ORDER] No se pudieron sincronizar tablas de administración:', err.message);
  }

  // Sincronizar esquema de multíperfil (varios perfiles por cuenta, QR por perfil,
  // paquetes comerciales, historial de precios, consentimiento).
  try {
    await db.ensureMultiProfileSchema();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[MULTI-PERFIL] No se pudieron sincronizar tablas de multíperfil:', err.message);
  }

  const routes = require('./routes');
  const serverApp = createApp(routes);

  serverApp.listen(config.port, () => {
    // eslint-disable-next-line no-console
    console.log(
      `[API] Servidor escuchando en http://localhost:${config.port} (${config.env})`
    );
  });
};

start();

