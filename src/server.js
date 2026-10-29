const { createApp } = require('./app');

const config = require('./config');

const start = async () => {
  const routes = require('./routes');
  const serverApp = createApp(routes);

  serverApp.listen(config.port, () => {
    console.log(
      `[API] Servidor escuchando en http://localhost:${config.port} (${config.env})`
    );
  });
};

start();

