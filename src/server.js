const { createApp } = require('./app');

const config = require('./config');
const db = require('./config/db');

const start = async () => {
  // Sincronizar columnas de permanencia/impresión de QR en BDs existentes
  // (schema.sql ya las incluye para bases nuevas).
  try {
    await db.ensureIdentifierColumns();
  } catch (err) {
    console.warn('[QR] No se pudieron sincronizar columnas de identifiers:', err.message);
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

