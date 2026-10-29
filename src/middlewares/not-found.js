const notFound = (req, res) => {
  return res.status(404).json({ error: 'Recurso no encontrado' });
};

module.exports = { notFound };

