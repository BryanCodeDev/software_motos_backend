const errorHandler = (err, _req, res) => {
  const status = err.status || 500;
  const payload = {
    error: err.message || 'Error interno del servidor',
  };

  if (process.env.NODE_ENV !== 'production') {
    payload.stack = err.stack;
    payload.details = err.details;
  }
  return res.status(status).json(payload);
};

module.exports = { errorHandler };
