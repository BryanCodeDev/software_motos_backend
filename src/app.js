const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const express = require('express');
const { errorHandler } = require('./middlewares/error-handler');
const { notFound } = require('./middlewares/not-found');

const config = require('./config');

const createApp = (apiRouter) => {
  const app = express();

  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
    })
  );

  app.use(
    cors({
      origin: config.frontendUrl,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    })
  );

  app.use(cookieParser());
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  app.use('/api', apiRouter);

  app.use(notFound);
  app.use(errorHandler);

  return app;
};

module.exports = { createApp };

