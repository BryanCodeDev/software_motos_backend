const db = require('../../config/db');

const DESIGN_FIELDS = `
  id, product_id, name, slug, description, image_url, is_available, sort_order,
  created_at, updated_at
`;

const listDesigns = async (req, res) => {
  const { product_id } = req.validated.query;
  const where = product_id ? 'WHERE product_id = ?' : '';
  const params = product_id ? [product_id] : [];
  const rows = await db.query(
    `SELECT ${DESIGN_FIELDS} FROM product_designs ${where} ORDER BY sort_order ASC, id ASC`,
    params
  );
  return res.json({ designs: rows });
};

const adminListDesigns = async (req, res) => {
  const rows = await db.query(
    `SELECT ${DESIGN_FIELDS} FROM product_designs ORDER BY sort_order ASC, id ASC`
  );
  return res.json({ designs: rows });
};

const updateDesign = async (req, res) => {
  const { id } = req.validated.params;
  const data = req.validated.body;
  const fields = [];
  const values = [];
  const setIf = (key, val) => {
    if (val !== undefined) {
      fields.push(`${key} = ?`);
      values.push(val);
    }
  };
  setIf('name', data.name);
  setIf('slug', data.slug);
  setIf('description', data.description === undefined ? null : data.description);
  setIf('image_url', data.image_url === undefined ? null : data.image_url);
  setIf('is_available', data.is_available === undefined ? undefined : data.is_available ? 1 : 0);
  setIf('sort_order', data.sort_order);
  if (fields.length === 0) {
    return res.status(400).json({ error: 'No hay campos para actualizar' });
  }
  values.push(id);
  const [existing] = await db.query('SELECT id FROM product_designs WHERE id = ?', [id]);
  if (!existing) {
    return res.status(404).json({ error: 'Diseño no encontrado' });
  }
  await db.query(`UPDATE product_designs SET ${fields.join(', ')} WHERE id = ?`, values);
  return res.json({ message: 'Diseño actualizado', id });
};

module.exports = {
  listDesigns,
  adminListDesigns,
  updateDesign,
};
