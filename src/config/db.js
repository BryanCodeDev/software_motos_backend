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

const ignoreDup = (err) => {
  if (!err) {return false;}
  const dupCodes = ['ER_DUP_FIELD', 'ER_DUP_FIELDNAME', 'ER_DUP_KEYNAME', 'ER_DUP_ENTRY', 'ER_TABLE_EXISTS', 'ER_DUP_INDEX'];
  const dupErnos = [1060, 1061, 1050, 1062, 1067];
  const dupMsgs = ['Duplicate column name', 'Duplicate key name', 'Duplicate entry', 'Table already exists', 'Duplicate index', 'Duplicate foreign key constraint name'];
  if (dupCodes.includes(err.code) || dupErnos.includes(err.errno)) {return true;}
  return dupMsgs.some((m) => String(err.message || '').includes(m));
};

// Garantiza columnas de permanencia/impresión de QR en bases de datos existentes.
// Las bases nuevas las crean ya con estas columnas via schema.sql.
const ensureIdentifierColumns = async () => {
  // Permitir QR sin propietario (user_id NULL) para códigos aún no asignados.
  try {
    await query(
      "ALTER TABLE identifiers MODIFY COLUMN user_id INT UNSIGNED NULL DEFAULT NULL"
    );
  } catch (e) { if (!ignoreDup(e)) {throw e;} }
  try {
    await query(
      "ALTER TABLE identifiers ADD COLUMN activation_at TIMESTAMP NULL DEFAULT NULL AFTER status"
    );
  } catch (e) { if (!ignoreDup(e)) {throw e;} }
  try {
    await query(
      "ALTER TABLE identifiers ADD COLUMN print_status ENUM('pending_print','sent_to_print','printed','delivered') NOT NULL DEFAULT 'pending_print' AFTER activation_at"
    );
  } catch (e) { if (!ignoreDup(e)) {throw e;} }
  try {
    await query("CREATE INDEX idx_identifiers_print_status ON identifiers(print_status)");
  } catch (e) { if (!ignoreDup(e)) {throw e;} }
  try {
    await query("CREATE INDEX idx_identifiers_user_print ON identifiers(user_id, print_status)");
  } catch (e) { if (!ignoreDup(e)) {throw e;} }
  try {
    await query(
      "ALTER TABLE identifiers ADD COLUMN _one_active_per_user INT UNSIGNED AS (CASE WHEN status IN ('pending_activation','active') THEN user_id END) VIRTUAL AFTER print_status"
    );
  } catch (e) { if (!ignoreDup(e)) {throw e;} }
  try {
    await query("CREATE UNIQUE INDEX uq_identifiers_one_active_per_user ON identifiers(_one_active_per_user)");
  } catch (e) { if (!ignoreDup(e)) {throw e;} }
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
  } catch (e) { if (!ignoreDup(e)) {throw e;} }

  const addColumn = async (sql) => {
    try { return await query(sql); } catch (e) { if (!ignoreDup(e)) {throw e;} }
  };

  await addColumn("ALTER TABLE orders ADD COLUMN design_id INT UNSIGNED NULL DEFAULT NULL AFTER variant_id");
  await addColumn("ALTER TABLE orders ADD COLUMN design_name VARCHAR(150) NULL DEFAULT NULL AFTER design_id");
  await addColumn("ALTER TABLE orders ADD COLUMN design_image_url VARCHAR(500) NULL DEFAULT NULL AFTER design_name");
  await addColumn("ALTER TABLE orders ADD COLUMN sticker_quantity INT UNSIGNED NOT NULL DEFAULT 2 AFTER design_image_url");
  try {
    await query("ALTER TABLE orders ADD CONSTRAINT fk_orders_design FOREIGN KEY (design_id) REFERENCES product_designs(id) ON DELETE SET NULL");
  } catch (e) { if (!ignoreDup(e)) {throw e;} }
  try {
    await query("CREATE INDEX idx_orders_design ON orders(design_id)");
  } catch (e) { if (!ignoreDup(e)) {throw e;} }
};

const ensureInventorySchema = async () => {
  const createBatches = `
    CREATE TABLE IF NOT EXISTS qr_inventory_batches (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      batch_code VARCHAR(40) NOT NULL,
      design_id INT UNSIGNED NOT NULL,
      quantity_requested INT UNSIGNED NOT NULL DEFAULT 0,
      quantity_confirmed INT UNSIGNED NOT NULL DEFAULT 0,
      status ENUM('pending_generation', 'generated', 'pending_print', 'printed', 'confirmed_received', 'cancelled') NOT NULL DEFAULT 'pending_generation',
      created_by INT UNSIGNED NULL DEFAULT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      confirmed_at TIMESTAMP NULL DEFAULT NULL,
      notes VARCHAR(500) NULL DEFAULT NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uk_qr_inventory_batches_code (batch_code),
      KEY idx_qr_inventory_batches_design (design_id),
      KEY idx_qr_inventory_batches_status (status),
      CONSTRAINT fk_qr_inventory_batches_design FOREIGN KEY (design_id) REFERENCES product_designs(id) ON DELETE RESTRICT,
      CONSTRAINT fk_qr_inventory_batches_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `;
  const createPackages = `
    CREATE TABLE IF NOT EXISTS qr_inventory_packages (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      package_code VARCHAR(40) NOT NULL,
      batch_id INT UNSIGNED NULL DEFAULT NULL,
      design_id INT UNSIGNED NOT NULL,
      identifier_id INT UNSIGNED NULL DEFAULT NULL,
      value VARCHAR(80) NOT NULL,
      public_url VARCHAR(500) NOT NULL,
      status ENUM('available', 'reserved', 'assigned', 'in_production', 'printed', 'dispatched', 'delivered', 'cancelled', 'retired') NOT NULL DEFAULT 'available',
      user_id INT UNSIGNED NULL DEFAULT NULL,
      order_id INT UNSIGNED NULL DEFAULT NULL,
      origin ENUM('inventory', 'on_demand') NOT NULL DEFAULT 'inventory',
      quantity_stickers INT UNSIGNED NOT NULL DEFAULT 2,
      reserved_until TIMESTAMP NULL DEFAULT NULL,
      printed_at TIMESTAMP NULL DEFAULT NULL,
      dispatched_at TIMESTAMP NULL DEFAULT NULL,
      delivered_at TIMESTAMP NULL DEFAULT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uk_qr_inventory_packages_code (package_code),
      UNIQUE KEY uk_qr_inventory_packages_value (value),
      KEY idx_qr_inventory_packages_design_status (design_id, status),
      KEY idx_qr_inventory_packages_status_reserved (status, reserved_until),
      KEY idx_qr_inventory_packages_user (user_id),
      KEY idx_qr_inventory_packages_order (order_id),
      KEY idx_qr_inventory_packages_batch (batch_id),
      KEY idx_qr_inventory_packages_origin (origin, status),
      CONSTRAINT fk_qr_inventory_packages_batch FOREIGN KEY (batch_id) REFERENCES qr_inventory_batches(id) ON DELETE SET NULL,
      CONSTRAINT fk_qr_inventory_packages_design FOREIGN KEY (design_id) REFERENCES product_designs(id) ON DELETE RESTRICT,
      CONSTRAINT fk_qr_inventory_packages_identifier FOREIGN KEY (identifier_id) REFERENCES identifiers(id) ON DELETE SET NULL,
      CONSTRAINT fk_qr_inventory_packages_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
      CONSTRAINT fk_qr_inventory_packages_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `;
  const addColumns = [
    "ALTER TABLE orders ADD COLUMN inventory_origin ENUM('inventory', 'on_demand') NULL DEFAULT NULL AFTER sticker_quantity",
    "ALTER TABLE orders ADD COLUMN package_id INT UNSIGNED NULL DEFAULT NULL AFTER inventory_origin",
    "ALTER TABLE identifiers ADD COLUMN package_id INT UNSIGNED NULL DEFAULT NULL AFTER order_id",
    "CREATE INDEX idx_orders_inventory_origin ON orders(inventory_origin)",
    "CREATE INDEX idx_orders_package ON orders(package_id)",
    "CREATE INDEX idx_identifiers_package ON identifiers(package_id)",
    "ALTER TABLE orders ADD CONSTRAINT fk_orders_package FOREIGN KEY (package_id) REFERENCES qr_inventory_packages(id) ON DELETE SET NULL",
    "ALTER TABLE identifiers ADD CONSTRAINT fk_identifiers_package FOREIGN KEY (package_id) REFERENCES qr_inventory_packages(id) ON DELETE SET NULL",
    "ALTER TABLE qr_inventory_batches ADD COLUMN updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at",
  ];
  try { await query(createBatches); } catch (e) { if (!ignoreDup(e)) {throw e;} }
  try { await query(createPackages); } catch (e) { if (!ignoreDup(e)) {throw e;} }
  for (const sql of addColumns) {
    try { await query(sql); } catch (e) { if (!ignoreDup(e)) {throw e;} }
  }
};

// Garantiza las tablas de privacidad (consentimientos y solicitudes de datos)
// en bases de datos creadas con versiones anteriores del esquema que no las
// incluían. Usa CREATE TABLE IF NOT EXISTS, por lo que es idempotente y seguro
// de ejecutar en cada arranque.
const ensurePrivacySchema = async () => {
  const createConsentRecords = `
    CREATE TABLE IF NOT EXISTS consent_records (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id INT UNSIGNED NOT NULL,
      document_type ENUM('terms', 'privacy', 'data_processing', 'sensitive_data', 'notifications') NOT NULL,
      document_version VARCHAR(20) NULL,
      accepted TINYINT(1) NOT NULL DEFAULT 0,
      purpose TEXT NULL,
      method ENUM('register', 'privacy_center', 'profile_update', 'admin_update') NOT NULL DEFAULT 'register',
      ip_address VARCHAR(45) NULL,
      user_agent VARCHAR(500) NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_consent_records_user (user_id),
      KEY idx_consent_records_type (document_type),
      KEY idx_consent_records_created (created_at),
      CONSTRAINT fk_consent_records_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `;
  const createDataRequests = `
    CREATE TABLE IF NOT EXISTS data_requests (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id INT UNSIGNED NOT NULL,
      request_type ENUM('access', 'rectification', 'suppression', 'portability', 'revocation', 'consultation') NOT NULL,
      status ENUM('pending', 'in_review', 'completed', 'rejected') NOT NULL DEFAULT 'pending',
      details TEXT NULL,
      response TEXT NULL,
      responded_by INT UNSIGNED NULL,
      responded_at TIMESTAMP NULL DEFAULT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_data_requests_user (user_id),
      KEY idx_data_requests_status (status),
      KEY idx_data_requests_type (request_type),
      CONSTRAINT fk_data_requests_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT fk_data_requests_responder FOREIGN KEY (responded_by) REFERENCES users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `;
  const createIndex = `
    CREATE INDEX idx_data_requests_user_type_status ON data_requests(user_id, request_type, status)
  `;
  try { await query(createConsentRecords); } catch (e) { if (!ignoreDup(e)) {throw e;} }
  try { await query(createDataRequests); } catch (e) { if (!ignoreDup(e)) {throw e;} }
  try { await query(createIndex); } catch (e) { if (!ignoreDup(e)) {throw e;} }
};

const getConnection = async () => getPool().getConnection();

const close = async () => {
  if (pool) {
    await pool.end();
    pool = null;
  }
};

module.exports = {
  query,
  getConnection,
  close,
  getPool,
  buildUrl,
  ensureIdentifierColumns,
  ensureDesignAndOrderColumns,
  ensureInventorySchema,
  ensurePrivacySchema,
};
