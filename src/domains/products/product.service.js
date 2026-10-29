const db = require('../../config/db');

const listProducts = async (_req, res) => {
  const rows = await db.query(
    `SELECT p.*, 
          (SELECT JSON_ARRAYAGG(JSON_OBJECT('id', v.id, 'name', v.name, 'price_adjustment', v.price_adjustment, 'is_active', v.is_active, 'sort_order', v.sort_order))
           FROM product_variants v WHERE v.product_id = p.id AND v.is_active = 1 ORDER BY v.sort_order, v.id) AS variants
     FROM products p
     ORDER BY p.sort_order ASC, p.id ASC`
  );
const products = rows.map((row) => {
    let variants = row.variants;
    if (typeof variants === 'string') {
      try {
        variants = variants ? JSON.parse(variants) : [];
      } catch {
        variants = [];
      }
    } else if (variants && typeof variants === 'object') {
      variants = Array.isArray(variants) ? variants : [variants];
    } else {
      variants = [];
    }
    return { ...row, variants };
  });
  return res.json({ products });
};

const getProduct = async (req, res) => {
  const { id } = req.params;
  const rows = await db.query('SELECT * FROM products WHERE id = ?', [id]);
  if (rows.length === 0) {
    return res.status(404).json({ error: 'Producto no encontrado' });
  }
  return res.json({ product: rows[0] });
};

const createProduct = async (req, res) => {
  const data = req.validated.body;
  const slug = data.slug || data.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  const result = await db.query(
    `INSERT INTO products (name, slug, description, price, currency, is_active, is_purchasable, is_visible, variant_options, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.name,
      slug,
      data.description || null,
      data.price === undefined ? 0 : data.price,
      data.currency,
      data.is_active === undefined ? 1 : data.is_active ? 1 : 0,
      data.is_purchasable === undefined ? 0 : data.is_purchasable ? 1 : 0,
      data.is_visible === undefined ? 1 : data.is_visible ? 1 : 0,
      data.variant_options || null,
      data.sort_order === undefined ? 0 : data.sort_order,
    ]
  );
  return res.status(201).json({ productId: result.insertId, slug });
};

const updateProduct = async (req, res) => {
  const { id } = req.params;
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
  setIf('description', data.description === undefined ? null : data.description);
  setIf('price', data.price);
  setIf('currency', data.currency);
  setIf('is_active', data.is_active === undefined ? undefined : data.is_active ? 1 : 0);
  setIf('is_purchasable', data.is_purchasable === undefined ? undefined : data.is_purchasable ? 1 : 0);
  setIf('is_visible', data.is_visible === undefined ? undefined : data.is_visible ? 1 : 0);
  setIf('variant_options', data.variant_options === undefined ? null : data.variant_options);
  setIf('sort_order', data.sort_order);
  if (fields.length === 0) {
    return res.status(400).json({ error: 'No hay campos para actualizar' });
  }
  values.push(id);
  await db.query(`UPDATE products SET ${fields.join(', ')} WHERE id = ?`, values);
  return res.json({ message: 'Producto actualizado' });
};

const deleteProduct = async (req, res) => {
  const { id } = req.params;
  await db.query('DELETE FROM products WHERE id = ?', [id]);
  return res.json({ message: 'Producto eliminado' });
};

module.exports = {
  listProducts,
  getProduct,
  createProduct,
  updateProduct,
  deleteProduct,
};

