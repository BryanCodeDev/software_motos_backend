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
  const dupErnos = [1060, 1061, 1050, 1062, 1067, 1091];
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

// ---------------------------------------------------------------------------
// Esquema de administración de pedidos, auditoría, archivado y métricas.
// Aditivo e idempotente: no borra tablas, columnas ni datos históricos.
// ---------------------------------------------------------------------------
const ensureAdminOrderSchema = async () => {
  const addColumn = async (sql) => {
    try { return await query(sql); } catch (e) { if (!ignoreDup(e)) { throw e; } }
  };
  const addConstraint = async (sql) => {
    try { return await query(sql); } catch (e) { if (!ignoreDup(e)) { throw e; } }
  };

  // 1. Historial de cambios de estado de pedidos.
  await query(`
    CREATE TABLE IF NOT EXISTS order_status_history (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      order_id INT UNSIGNED NOT NULL,
      previous_commercial_status ENUM('draft','pending_confirmation','pending_payment','paid','preparing','shipped','delivered','cancelled','refund_requested','refunded') NULL DEFAULT NULL,
      new_commercial_status ENUM('draft','pending_confirmation','pending_payment','paid','preparing','shipped','delivered','cancelled','refund_requested','refunded') NULL DEFAULT NULL,
      previous_payment_status ENUM('unpaid','pending','approved','rejected','cancelled','refunded') NULL DEFAULT NULL,
      new_payment_status ENUM('unpaid','pending','approved','rejected','cancelled','refunded') NULL DEFAULT NULL,
      changed_by INT UNSIGNED NULL DEFAULT NULL,
      reason VARCHAR(255) NULL DEFAULT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_order_status_history_order (order_id),
      KEY idx_order_status_history_created (created_at),
      CONSTRAINT fk_order_status_history_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
      CONSTRAINT fk_order_status_history_changed_by FOREIGN KEY (changed_by) REFERENCES users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // 2. Registro de correos enviados (idempotencia y trazabilidad).
  await query(`
    CREATE TABLE IF NOT EXISTS email_log (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      order_id INT UNSIGNED NULL DEFAULT NULL,
      user_id INT UNSIGNED NULL DEFAULT NULL,
      type VARCHAR(50) NOT NULL,
      to_email VARCHAR(255) NOT NULL,
      subject VARCHAR(255) NOT NULL,
      provider VARCHAR(30) NOT NULL DEFAULT 'resend',
      provider_id VARCHAR(100) NULL DEFAULT NULL,
      status ENUM('sent','failed','skipped_duplicate') NOT NULL DEFAULT 'sent',
      error TEXT NULL DEFAULT NULL,
      sent_at TIMESTAMP NULL DEFAULT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_email_log_order (order_id),
      KEY idx_email_log_type_status (type, status),
      KEY idx_email_log_created (created_at),
      CONSTRAINT fk_email_log_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL,
      CONSTRAINT fk_email_log_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // 3. Métricas de escaneos QR (sin GPS, sin IP completa, sin datos médicos).
  await query(`
    CREATE TABLE IF NOT EXISTS qr_scans (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      identifier_id INT UNSIGNED NULL DEFAULT NULL,
      identifier_value VARCHAR(80) NULL DEFAULT NULL,
      scanned_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      result ENUM('active','inactive','not_found') NOT NULL,
      ip_hash VARCHAR(64) NULL DEFAULT NULL,
      user_agent VARCHAR(500) NULL DEFAULT NULL,
      PRIMARY KEY (id),
      KEY idx_qr_scans_identifier (identifier_id),
      KEY idx_qr_scans_scanned_at (scanned_at),
      KEY idx_qr_scans_result (result),
      CONSTRAINT fk_qr_scans_identifier FOREIGN KEY (identifier_id) REFERENCES identifiers(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // 4. Pedidos: transportadora, guía y seguimiento (copia operativa).
  await addColumn("ALTER TABLE orders ADD COLUMN carrier VARCHAR(100) NULL DEFAULT NULL AFTER shipping_address");
  await addColumn("ALTER TABLE orders ADD COLUMN tracking_number VARCHAR(100) NULL DEFAULT NULL AFTER carrier");
  await addColumn("ALTER TABLE orders ADD COLUMN tracking_url VARCHAR(500) NULL DEFAULT NULL AFTER tracking_number");
  await addColumn("ALTER TABLE orders ADD COLUMN shipped_at TIMESTAMP NULL DEFAULT NULL AFTER tracking_url");
  await addColumn("ALTER TABLE orders ADD COLUMN delivered_at TIMESTAMP NULL DEFAULT NULL AFTER shipped_at");

  // 5. Identificadores QR: archivado lógico (no DELETE físico).
  await addColumn("ALTER TABLE identifiers ADD COLUMN archived_at TIMESTAMP NULL DEFAULT NULL AFTER deactivated_at");
  await addColumn("ALTER TABLE identifiers ADD COLUMN archived_by INT UNSIGNED NULL DEFAULT NULL AFTER archived_at");
  await addConstraint("ALTER TABLE identifiers ADD CONSTRAINT fk_identifiers_archived_by FOREIGN KEY (archived_by) REFERENCES users(id) ON DELETE SET NULL");

  // 6. Usuarios: suspensión y roles extendidos (superadmin, operator).
  await addColumn("ALTER TABLE users ADD COLUMN suspended_at TIMESTAMP NULL DEFAULT NULL AFTER updated_at");
  await addColumn("ALTER TABLE users ADD COLUMN suspended_by INT UNSIGNED NULL DEFAULT NULL AFTER suspended_at");
  await addColumn("ALTER TABLE users ADD COLUMN suspended_reason VARCHAR(255) NULL DEFAULT NULL AFTER suspended_by");
  await addConstraint("ALTER TABLE users ADD CONSTRAINT fk_users_suspended_by FOREIGN KEY (suspended_by) REFERENCES users(id) ON DELETE SET NULL");
  await query("ALTER TABLE users MODIFY COLUMN role ENUM('user','admin','operator','superadmin') NOT NULL DEFAULT 'user'");

  // 7. Auditoría: valores anterior y nuevo.
  await addColumn("ALTER TABLE audit_logs ADD COLUMN previous_values JSON NULL DEFAULT NULL AFTER metadata");
  await addColumn("ALTER TABLE audit_logs ADD COLUMN new_values JSON NULL DEFAULT NULL AFTER previous_values");
};

// ---------------------------------------------------------------------------
// Esquema de multíperfil: una cuenta puede tener varios perfiles (persona,
// mascota, persona gestionada), cada uno con su propio QR permanente.
// Aditivo e idempotente: no borra tablas, columnas ni datos históricos.
// ---------------------------------------------------------------------------
const ensureMultiProfileSchema = async () => {
  const addColumn = async (sql) => {
    try { return await query(sql); } catch (e) { if (!ignoreDup(e)) { throw e; } }
  };

  // 1. emergency_profiles: permitir varios perfiles por cuenta (quitar UNIQUE user_id).
  try {
    await query("ALTER TABLE emergency_profiles DROP INDEX uk_emergency_profiles_user");
  } catch (e) { if (!ignoreDup(e)) { throw e; } }

  // 2. emergency_profiles: columna de tipo de perfil.
  await addColumn("ALTER TABLE emergency_profiles ADD COLUMN profile_type ENUM('person','pet','managed_person') NOT NULL DEFAULT 'person' AFTER is_active");
  await addColumn("ALTER TABLE emergency_profiles ADD COLUMN relationship VARCHAR(50) NULL DEFAULT NULL AFTER profile_type");
  await addColumn("ALTER TABLE emergency_profiles ADD COLUMN is_managed_by_third_party TINYINT(1) NOT NULL DEFAULT 0 AFTER relationship");
  await addColumn("ALTER TABLE emergency_profiles ADD COLUMN consent_accepted TINYINT(1) NOT NULL DEFAULT 0 AFTER is_managed_by_third_party");
  await addColumn("ALTER TABLE emergency_profiles ADD COLUMN consent_at TIMESTAMP NULL DEFAULT NULL AFTER consent_accepted");
  await addColumn("ALTER TABLE emergency_profiles ADD COLUMN consent_by INT UNSIGNED NULL DEFAULT NULL AFTER consent_at");

  // 3. emergency_profiles: campos específicos de mascota.
  await addColumn("ALTER TABLE emergency_profiles ADD COLUMN pet_species VARCHAR(50) NULL DEFAULT NULL AFTER consent_by");
  await addColumn("ALTER TABLE emergency_profiles ADD COLUMN pet_breed VARCHAR(100) NULL DEFAULT NULL AFTER pet_species");
  await addColumn("ALTER TABLE emergency_profiles ADD COLUMN pet_age VARCHAR(30) NULL DEFAULT NULL AFTER pet_breed");
  await addColumn("ALTER TABLE emergency_profiles ADD COLUMN pet_birth_date DATE NULL DEFAULT NULL AFTER pet_age");
  await addColumn("ALTER TABLE emergency_profiles ADD COLUMN pet_sex ENUM('macho','hembra','no_especificado') NULL DEFAULT NULL AFTER pet_birth_date");
  await addColumn("ALTER TABLE emergency_profiles ADD COLUMN pet_weight DECIMAL(5,2) NULL DEFAULT NULL AFTER pet_sex");
  await addColumn("ALTER TABLE emergency_profiles ADD COLUMN pet_color VARCHAR(60) NULL DEFAULT NULL AFTER pet_weight");
  await addColumn("ALTER TABLE emergency_profiles ADD COLUMN pet_characteristics TEXT NULL DEFAULT NULL AFTER pet_color");
  await addColumn("ALTER TABLE emergency_profiles ADD COLUMN pet_microchip VARCHAR(80) NULL DEFAULT NULL AFTER pet_characteristics");
  await addColumn("ALTER TABLE emergency_profiles ADD COLUMN pet_sterilized TINYINT(1) NULL DEFAULT NULL AFTER pet_microchip");
  await addColumn("ALTER TABLE emergency_profiles ADD COLUMN pet_vaccines TEXT NULL DEFAULT NULL AFTER pet_sterilized");
  await addColumn("ALTER TABLE emergency_profiles ADD COLUMN pet_allergies TEXT NULL DEFAULT NULL AFTER pet_vaccines");
  await addColumn("ALTER TABLE emergency_profiles ADD COLUMN pet_medications TEXT NULL DEFAULT NULL AFTER pet_allergies");
  await addColumn("ALTER TABLE emergency_profiles ADD COLUMN pet_conditions TEXT NULL DEFAULT NULL AFTER pet_medications");
  await addColumn("ALTER TABLE emergency_profiles ADD COLUMN pet_vet_name VARCHAR(150) NULL DEFAULT NULL AFTER pet_conditions");
  await addColumn("ALTER TABLE emergency_profiles ADD COLUMN pet_vet_phone VARCHAR(30) NULL DEFAULT NULL AFTER pet_vet_name");
  await addColumn("ALTER TABLE emergency_profiles ADD COLUMN pet_owner_name VARCHAR(150) NULL DEFAULT NULL AFTER pet_vet_phone");
  await addColumn("ALTER TABLE emergency_profiles ADD COLUMN pet_owner_phone VARCHAR(30) NULL DEFAULT NULL AFTER pet_owner_name");
  await addColumn("ALTER TABLE emergency_profiles ADD COLUMN pet_alternate_contacts TEXT NULL DEFAULT NULL AFTER pet_owner_phone");
  await addColumn("ALTER TABLE emergency_profiles ADD COLUMN pet_care_instructions TEXT NULL DEFAULT NULL AFTER pet_alternate_contacts");
  await addColumn("ALTER TABLE emergency_profiles ADD COLUMN pet_lost TINYINT(1) NOT NULL DEFAULT 0 AFTER pet_care_instructions");
  await addColumn("ALTER TABLE emergency_profiles ADD COLUMN pet_reward VARCHAR(200) NULL DEFAULT NULL AFTER pet_lost");

  await addColumn("CREATE INDEX idx_emergency_profiles_user_type ON emergency_profiles(user_id, profile_type)");
  await addColumn("CREATE INDEX idx_emergency_profiles_pet_lost ON emergency_profiles(pet_lost)");

  // 4. identifiers: quitar la restricción de un QR activo por USUARIO.
  //    Ahora es un QR activo por PERFIL.
  try {
    await query("ALTER TABLE identifiers DROP INDEX uq_identifiers_one_active_per_user");
  } catch (e) { if (!ignoreDup(e)) { throw e; } }
  try {
    await query("ALTER TABLE identifiers DROP COLUMN _one_active_per_user");
  } catch (e) { if (!ignoreDup(e)) { throw e; } }

  // Un QR activo por perfil (profile_id puede ser NULL; los NULL no se restringen).
  try {
    await query(
      "ALTER TABLE identifiers ADD COLUMN _one_active_per_profile INT UNSIGNED AS (CASE WHEN status IN ('pending_activation','active') THEN profile_id END) VIRTUAL AFTER profile_id"
    );
  } catch (e) { if (!ignoreDup(e)) { throw e; } }
  try {
    await query("CREATE UNIQUE INDEX uq_identifiers_one_active_per_profile ON identifiers(_one_active_per_profile)");
  } catch (e) { if (!ignoreDup(e)) { throw e; } }

  // 5. orders: campos de paquete multi-perfil.
  await addColumn("ALTER TABLE orders ADD COLUMN profile_count INT UNSIGNED NOT NULL DEFAULT 1 AFTER sticker_quantity");
  await addColumn("ALTER TABLE orders ADD COLUMN sticker_total INT UNSIGNED NOT NULL DEFAULT 0 AFTER profile_count");
  await addColumn("ALTER TABLE orders ADD COLUMN discount_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00 AFTER sticker_total");

  // 6. order_profiles: perfiles incluidos en un pedido (normalizado, no cadena de texto).
  await query(`
    CREATE TABLE IF NOT EXISTS order_profiles (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      order_id INT UNSIGNED NOT NULL,
      profile_id INT UNSIGNED NOT NULL,
      identifier_id INT UNSIGNED NULL DEFAULT NULL,
      design_id INT UNSIGNED NULL DEFAULT NULL,
      quantity_stickers INT UNSIGNED NOT NULL DEFAULT 2,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_order_profiles_order (order_id),
      KEY idx_order_profiles_profile (profile_id),
      KEY idx_order_profiles_identifier (identifier_id),
      CONSTRAINT fk_order_profiles_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
      CONSTRAINT fk_order_profiles_profile FOREIGN KEY (profile_id) REFERENCES emergency_profiles(id) ON DELETE CASCADE,
      CONSTRAINT fk_order_profiles_identifier FOREIGN KEY (identifier_id) REFERENCES identifiers(id) ON DELETE SET NULL,
      CONSTRAINT fk_order_profiles_design FOREIGN KEY (design_id) REFERENCES product_designs(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // 7. product_packages: paquetes comerciales configurables.
  await query(`
    CREATE TABLE IF NOT EXISTS product_packages (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      name VARCHAR(120) NOT NULL,
      slug VARCHAR(120) NOT NULL,
      description TEXT NULL DEFAULT NULL,
      line ENUM('person','pet','combo') NOT NULL DEFAULT 'person',
      profile_count INT UNSIGNED NOT NULL DEFAULT 1,
      sticker_count INT UNSIGNED NOT NULL DEFAULT 0,
      price DECIMAL(12,2) NOT NULL DEFAULT 0.00,
      currency CHAR(3) NOT NULL DEFAULT 'COP',
      original_price DECIMAL(12,2) NULL DEFAULT NULL,
      discount_percent DECIMAL(5,2) NULL DEFAULT NULL,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      is_visible TINYINT(1) NOT NULL DEFAULT 1,
      sort_order INT NOT NULL DEFAULT 0,
      valid_from DATE NULL DEFAULT NULL,
      valid_to DATE NULL DEFAULT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uk_product_packages_slug (slug),
      KEY idx_product_packages_line_active (line, is_active, is_visible),
      KEY idx_product_packages_sort (sort_order)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // 8. package_profiles: qué tipos y cuántos perfiles incluye cada paquete.
  await query(`
    CREATE TABLE IF NOT EXISTS package_profiles (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      package_id INT UNSIGNED NOT NULL,
      profile_type ENUM('person','pet') NOT NULL DEFAULT 'person',
      quantity_profiles INT UNSIGNED NOT NULL DEFAULT 1,
      stickers_per_profile INT UNSIGNED NOT NULL DEFAULT 2,
      PRIMARY KEY (id),
      KEY idx_package_profiles_package (package_id),
      CONSTRAINT fk_package_profiles_package FOREIGN KEY (package_id) REFERENCES product_packages(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // 9. price_history: auditoría de cambios de precio.
  await query(`
    CREATE TABLE IF NOT EXISTS price_history (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      product_id INT UNSIGNED NULL DEFAULT NULL,
      package_id INT UNSIGNED NULL DEFAULT NULL,
      old_price DECIMAL(12,2) NULL DEFAULT NULL,
      new_price DECIMAL(12,2) NULL DEFAULT NULL,
      currency CHAR(3) NOT NULL DEFAULT 'COP',
      changed_by INT UNSIGNED NULL DEFAULT NULL,
      changed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      reason VARCHAR(255) NULL DEFAULT NULL,
      PRIMARY KEY (id),
      KEY idx_price_history_product (product_id),
      KEY idx_price_history_package (package_id),
      KEY idx_price_history_changed (changed_at),
      CONSTRAINT fk_price_history_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL,
      CONSTRAINT fk_price_history_package FOREIGN KEY (package_id) REFERENCES product_packages(id) ON DELETE SET NULL,
      CONSTRAINT fk_price_history_changed_by FOREIGN KEY (changed_by) REFERENCES users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // 10. profile_consent: autorización para perfiles gestionados por terceros.
  await query(`
    CREATE TABLE IF NOT EXISTS profile_consent (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      profile_id INT UNSIGNED NOT NULL,
      consent_type ENUM('data_processing','sensitive_data','medical_data','third_party_management') NOT NULL,
      accepted TINYINT(1) NOT NULL DEFAULT 0,
      accepted_at TIMESTAMP NULL DEFAULT NULL,
      accepted_by INT UNSIGNED NULL DEFAULT NULL,
      ip_address VARCHAR(45) NULL DEFAULT NULL,
      user_agent VARCHAR(500) NULL DEFAULT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uk_profile_consent_profile_type (profile_id, consent_type),
      KEY idx_profile_consent_profile (profile_id),
      CONSTRAINT fk_profile_consent_profile FOREIGN KEY (profile_id) REFERENCES emergency_profiles(id) ON DELETE CASCADE,
      CONSTRAINT fk_profile_consent_accepted_by FOREIGN KEY (accepted_by) REFERENCES users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // 11. Datos: backfill profile_id en identifiers donde exista un solo perfil del usuario.
  try {
    await query(`
      UPDATE identifiers i
      JOIN (
        SELECT user_id, id AS profile_id
        FROM emergency_profiles
        WHERE user_id IS NOT NULL
        GROUP BY user_id
        HAVING COUNT(*) = 1
      ) p ON i.user_id = p.user_id
      SET i.profile_id = p.profile_id
      WHERE i.profile_id IS NULL AND i.user_id IS NOT NULL
    `);
  } catch {
    // No bloquear el arranque si el backfill falla en alguna BD.
  }

  // 12. Catálogo de lanzamiento: paquetes y precios definitivos.
  //     Idempotente: usa ON DUPLICATE KEY UPDATE, por lo que es seguro ejecutar
  //     en cada arranque y actualiza precios/composición sin borrar pedidos.
  try {
    await ensureLaunchPackages();
  } catch {
    // No bloquear el arranque si la carga del catálogo falla.
  }
};

const getConnection = async () => getPool().getConnection();

/*
 * Catálogo de lanzamiento: paquetes y precios definitivos.
 * Idempotente: actualiza precios y composición sin tocar pedidos históricos.
 * Se ejecuta en cada arranque (dentro de ensureMultiProfileSchema).
 */
const ensureLaunchPackages = async () => {
  const packages = [
    {
      slug: 'perfil-individual',
      name: 'Perfil individual',
      description: '1 perfil de persona, 1 QR permanente y 2 stickers físicos con ese mismo QR.',
      line: 'person',
      profile_count: 1,
      sticker_count: 2,
      price: 39900,
      currency: 'COP',
      sort_order: 1,
      is_active: 1,
      is_visible: 1,
      profiles: [{ profile_type: 'person', quantity_profiles: 1, stickers_per_profile: 2 }],
    },
    {
      slug: 'familiar-x3',
      name: 'Familiar x3',
      description: '3 perfiles de personas, 3 QR independientes y 6 stickers. Ideal para familias.',
      line: 'person',
      profile_count: 3,
      sticker_count: 6,
      price: 99900,
      currency: 'COP',
      sort_order: 2,
      is_active: 1,
      is_visible: 1,
      profiles: [{ profile_type: 'person', quantity_profiles: 3, stickers_per_profile: 2 }],
    },
    {
      slug: 'familiar-x4',
      name: 'Familiar x4',
      description: '4 perfiles de personas, 4 QR independientes y 8 stickers.',
      line: 'person',
      profile_count: 4,
      sticker_count: 8,
      price: 124900,
      currency: 'COP',
      sort_order: 3,
      is_active: 1,
      is_visible: 1,
      profiles: [{ profile_type: 'person', quantity_profiles: 4, stickers_per_profile: 2 }],
    },
    {
      slug: 'familiar-x5',
      name: 'Familiar x5',
      description: '5 perfiles de personas, 5 QR independientes y 10 stickers.',
      line: 'person',
      profile_count: 5,
      sticker_count: 10,
      price: 149900,
      currency: 'COP',
      sort_order: 4,
      is_active: 1,
      is_visible: 1,
      profiles: [{ profile_type: 'person', quantity_profiles: 5, stickers_per_profile: 2 }],
    },
    {
      slug: 'mascota-individual',
      name: 'Mascota individual',
      description: '1 perfil de mascota, 1 QR permanente y 2 stickers físicos.',
      line: 'pet',
      profile_count: 1,
      sticker_count: 2,
      price: 34900,
      currency: 'COP',
      sort_order: 5,
      is_active: 1,
      is_visible: 1,
      profiles: [{ profile_type: 'pet', quantity_profiles: 1, stickers_per_profile: 2 }],
    },
    {
      slug: 'pack-mascotas-x2',
      name: 'Pack mascotas x2',
      description: '2 perfiles de mascotas, 2 QR independientes y 4 stickers.',
      line: 'pet',
      profile_count: 2,
      sticker_count: 4,
      price: 64900,
      currency: 'COP',
      sort_order: 6,
      is_active: 1,
      is_visible: 1,
      profiles: [{ profile_type: 'pet', quantity_profiles: 2, stickers_per_profile: 2 }],
    },
    {
      slug: 'pack-mascotas-x3',
      name: 'Pack mascotas x3',
      description: '3 perfiles de mascotas, 3 QR independientes y 6 stickers.',
      line: 'pet',
      profile_count: 3,
      sticker_count: 6,
      price: 89900,
      currency: 'COP',
      sort_order: 7,
      is_active: 1,
      is_visible: 1,
      profiles: [{ profile_type: 'pet', quantity_profiles: 3, stickers_per_profile: 2 }],
    },
    {
      slug: 'combo-familia-mascota',
      name: 'Familia + mascota',
      description: '3 personas + 1 mascota, 4 QR independientes y 8 stickers.',
      line: 'combo',
      profile_count: 4,
      sticker_count: 8,
      price: 119900,
      currency: 'COP',
      sort_order: 8,
      is_active: 1,
      is_visible: 1,
      profiles: [
        { profile_type: 'person', quantity_profiles: 3, stickers_per_profile: 2 },
        { profile_type: 'pet', quantity_profiles: 1, stickers_per_profile: 2 },
      ],
    },
    {
      slug: 'combo-familia-2-mascotas',
      name: 'Familia + 2 mascotas',
      description: '3 personas + 2 mascotas, 5 QR independientes y 10 stickers.',
      line: 'combo',
      profile_count: 5,
      sticker_count: 10,
      price: 139900,
      currency: 'COP',
      sort_order: 9,
      is_active: 1,
      is_visible: 1,
      profiles: [
        { profile_type: 'person', quantity_profiles: 3, stickers_per_profile: 2 },
        { profile_type: 'pet', quantity_profiles: 2, stickers_per_profile: 2 },
      ],
    },
    {
      slug: 'combo-familia-completa',
      name: 'Familia completa',
      description: '4 personas + 2 mascotas, 6 QR independientes y 12 stickers.',
      line: 'combo',
      profile_count: 6,
      sticker_count: 12,
      price: 164900,
      currency: 'COP',
      sort_order: 10,
      is_active: 1,
      is_visible: 1,
      profiles: [
        { profile_type: 'person', quantity_profiles: 4, stickers_per_profile: 2 },
        { profile_type: 'pet', quantity_profiles: 2, stickers_per_profile: 2 },
      ],
    },
  ];

  const conn = await getConnection();
  try {
    await conn.query('START TRANSACTION');

    for (const pkg of packages) {
      // Upsert del paquete por slug (única fuente de verdad del precio).
      await conn.query(
        `INSERT INTO product_packages
          (name, slug, description, line, profile_count, sticker_count, price, currency,
           is_active, is_visible, sort_order, valid_from)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
        ON DUPLICATE KEY UPDATE
          name = VALUES(name),
          description = VALUES(description),
          line = VALUES(line),
          profile_count = VALUES(profile_count),
          sticker_count = VALUES(sticker_count),
          price = VALUES(price),
          currency = VALUES(currency),
          is_active = VALUES(is_active),
          is_visible = VALUES(is_visible),
          sort_order = VALUES(sort_order),
          updated_at = NOW()`,
        [
          pkg.name, pkg.slug, pkg.description, pkg.line, pkg.profile_count, pkg.sticker_count,
          pkg.price, pkg.currency, pkg.is_active, pkg.is_visible, pkg.sort_order,
        ]
      );

      const [pkgRows] = await conn.query('SELECT id FROM product_packages WHERE slug = ?', [pkg.slug]);
      const packageId = pkgRows[0].id;

      // Sincronizar composición del paquete (borrar y reinsertar, pequeño conjunto).
      await conn.query('DELETE FROM package_profiles WHERE package_id = ?', [packageId]);
      for (const pp of pkg.profiles) {
        await conn.query(
          `INSERT INTO package_profiles (package_id, profile_type, quantity_profiles, stickers_per_profile)
           VALUES (?, ?, ?, ?)`,
          [packageId, pp.profile_type, pp.quantity_profiles, pp.stickers_per_profile]
        );
      }
    }

    // Producto individual: sticker adicional (se compra para un perfil existente).
    await conn.query(
      `INSERT INTO products
        (name, slug, description, price, currency, is_active, is_purchasable, is_visible, variant_options, sort_order)
       VALUES (?, ?, ?, ?, ?, 1, 1, 1, NULL, 99)
       ON DUPLICATE KEY UPDATE price = VALUES(price), currency = VALUES(currency),
         is_active = VALUES(is_active), is_purchasable = VALUES(is_purchasable)`,
      ['Sticker adicional', 'sticker-adicional',
       'Sticker físico extra para un perfil que ya tienes. Reutiliza su QR permanente y no genera otro identificador.',
       9900, 'COP']
    );

    await conn.query('COMMIT');
  } catch (error) {
    await conn.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    conn.release();
  }
};

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
  ensureAdminOrderSchema,
  ensureMultiProfileSchema,
};
