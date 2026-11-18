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

