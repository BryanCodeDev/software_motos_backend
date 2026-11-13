const mysql = require('mysql2/promise');
const config = require('./index');

let pool = null;

const buildUrl = () => {
  if (config.databaseUrl) {return config.databaseUrl;}
  const { host, port, user, password, database } = config.db;
  return `mysql://${user}:${encodeURIComponent(password)}@${host}:${port}/${database}`;
};

const getPool = () => {
  if (!pool) {
    pool = mysql.createPool(buildUrl());
  }
  return pool;
};

const query = async (sql, params = []) => {
  const conn = getPool();
  const [rows] = await conn.query(sql, params);
  return rows;
};

const ignoreDup = (err) =>
  err && (err.code === 'ER_DUP_FIELD' || err.code === 'ER_DUP_FIELDNAME' || err.code === 'ER_DUP_KEYNAME' || err.errno === 1060 || err.errno === 1061 || err.errno === 1050 || err.errno === 1062);

// Garantiza columnas de permanencia/impresión de QR en bases de datos existentes.
// Las bases nuevas las crean ya con estas columnas via schema.sql.
const ensureIdentifierColumns = async () => {
  try {
    await query(
      "ALTER TABLE identifiers ADD COLUMN activation_at TIMESTAMP NULL DEFAULT NULL AFTER status"
    );
  } catch (e) { if (!ignoreDup(e)) throw e; }
  try {
    await query(
      "ALTER TABLE identifiers ADD COLUMN print_status ENUM('pending_print','sent_to_print','printed','delivered') NOT NULL DEFAULT 'pending_print' AFTER activation_at"
    );
  } catch (e) { if (!ignoreDup(e)) throw e; }
  try {
    await query("CREATE INDEX idx_identifiers_print_status ON identifiers(print_status)");
  } catch (e) { if (!ignoreDup(e)) throw e; }
  try {
    await query("CREATE INDEX idx_identifiers_user_print ON identifiers(user_id, print_status)");
  } catch (e) { if (!ignoreDup(e)) throw e; }
  try {
    await query(
      "ALTER TABLE identifiers ADD COLUMN _one_active_per_user INT UNSIGNED AS (CASE WHEN status IN ('pending_activation','active') THEN user_id END) VIRTUAL AFTER print_status"
    );
  } catch (e) { if (!ignoreDup(e)) throw e; }
  try {
    await query("CREATE UNIQUE INDEX uq_identifiers_one_active_per_user ON identifiers(_one_active_per_user)");
  } catch (e) { if (!ignoreDup(e)) throw e; }
};

// Garantiza la tabla de diseños de stickers y las columnas de pedido en BDs existentes.
const ensureDesignAndOrderColumns = async () => {
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS product_designs (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        product_id INT UNSIGNED NOT NULL,
        name VARCHAR(100) NOT NULL,
        slug VARCHAR(120) NOT NULL,
        description TEXT NULL DEFAULT NULL,
        image_url VARCHAR(500) NULL DEFAULT NULL,
        is_available TINYINT(1) NOT NULL DEFAULT 1,
        sort_order INT NOT NULL DEFAULT 0,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uk_product_designs_slug (slug),
        KEY idx_product_designs_product (product_id),
        KEY idx_product_designs_available (product_id, is_available, sort_order),
        CONSTRAINT fk_product_designs_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  } catch (e) { if (!ignoreDup(e)) throw e; }

  const addColumn = (sql) => {
    try { return query(sql); } catch (e) { if (!ignoreDup(e)) throw e; }
  };

  await addColumn("ALTER TABLE orders ADD COLUMN design_id INT UNSIGNED NULL DEFAULT NULL AFTER variant_id");
  await addColumn("ALTER TABLE orders ADD COLUMN design_name VARCHAR(150) NULL DEFAULT NULL AFTER design_id");
  await addColumn("ALTER TABLE orders ADD COLUMN design_image_url VARCHAR(500) NULL DEFAULT NULL AFTER design_name");
  await addColumn("ALTER TABLE orders ADD COLUMN sticker_quantity INT UNSIGNED NOT NULL DEFAULT 2 AFTER design_image_url");
  try {
    await query("ALTER TABLE orders ADD CONSTRAINT fk_orders_design FOREIGN KEY (design_id) REFERENCES product_designs(id) ON DELETE SET NULL");
  } catch (e) { if (!ignoreDup(e)) throw e; }
  try {
    await query("CREATE INDEX idx_orders_design ON orders(design_id)");
  } catch (e) { if (!ignoreDup(e)) throw e; }
};

const getConnection = async () => getPool().getConnection();

const close = async () => {
  if (pool) {
    await pool.end();
    pool = null;
  }
};

module.exports = { query, getConnection, close, getPool, buildUrl, ensureIdentifierColumns };
