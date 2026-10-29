const errorHandler = (err, req, res, next) => {
  const status = err.status || 500;
  const payload = {
    error: err.message || 'Error interno del servidor',
  };

  if (process.env.NODE_ENV !== 'production') {
    payload.stack = err.stack;
    payload.details = err.details;
  }

  console.error(`[${status}] ${err.message}`, err.stack || '');
  return res.status(status).json(payload);
};

module.exports = { errorHandler };
