const validate = (schema) => (req, res, next) => {
  try {
    const data = schema.parse({
      body: req.body,
      query: req.query,
      params: req.params,
    });
    req.validated = data;
    return next();
  } catch (error) {
    const issues = error.issues || [];
    return res.status(400).json({
      error: 'Datos inválidos',
      details: issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }
};

module.exports = { validate };

