-- =====================================================
-- emergency_id - Esquema de base de datos (MySQL 8+)
-- =====================================================
CREATE DATABASE IF NOT EXISTS emergency_id
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE emergency_id;

SET FOREIGN_KEY_CHECKS = 0;

-- 001: Usuarios
CREATE TABLE IF NOT EXISTS users (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  email VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('user', 'admin', 'operator', 'superadmin') NOT NULL DEFAULT 'user',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  suspended_at TIMESTAMP NULL DEFAULT NULL COMMENT 'Fecha de suspensión de la cuenta',
  suspended_by INT UNSIGNED NULL DEFAULT NULL COMMENT 'Administrador que suspendió la cuenta',
  suspended_reason VARCHAR(255) NULL DEFAULT NULL COMMENT 'Motivo de la suspensión',
  PRIMARY KEY (id),
  UNIQUE KEY uk_users_email (email),
  KEY idx_users_role (role),
  KEY idx_users_suspended (suspended_at),
  CONSTRAINT fk_users_suspended_by FOREIGN KEY (suspended_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 002: Sesiones (refresh tokens)
CREATE TABLE IF NOT EXISTS user_sessions (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id INT UNSIGNED NOT NULL,
  refresh_token_hash VARCHAR(255) NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at TIMESTAMP NULL DEFAULT NULL,
  PRIMARY KEY (id),
  KEY idx_user_sessions_user_id (user_id),
  KEY idx_user_sessions_expires (expires_at),
  CONSTRAINT fk_user_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 003: Tokens de recuperación de contraseña
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id INT UNSIGNED NOT NULL,
  token_hash VARCHAR(255) NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  used_at TIMESTAMP NULL DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_password_reset_tokens_token (token_hash),
  KEY idx_password_reset_tokens_user (user_id),
  KEY idx_password_reset_tokens_expires (expires_at),
  CONSTRAINT fk_password_reset_tokens_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 004: Perfiles de emergencia
CREATE TABLE IF NOT EXISTS emergency_profiles (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id INT UNSIGNED NOT NULL,
  display_name VARCHAR(100) NOT NULL DEFAULT '',
  photo_url VARCHAR(500) NULL,
  blood_type VARCHAR(10) NULL DEFAULT NULL,
  date_of_birth DATE NULL DEFAULT NULL,
  height_cm DECIMAL(5,2) NULL DEFAULT NULL,
  weight_kg DECIMAL(5,2) NULL DEFAULT NULL,
  is_pregnant TINYINT(1) NOT NULL DEFAULT 0,
  medical_devices TEXT NULL DEFAULT NULL,
  primary_doctor_name VARCHAR(200) NULL DEFAULT NULL,
  primary_doctor_phone VARCHAR(30) NULL DEFAULT NULL,
  insurance_company VARCHAR(200) NULL DEFAULT NULL,
  insurance_policy_number VARCHAR(100) NULL DEFAULT NULL,
  document_number VARCHAR(50) NULL DEFAULT NULL,
  is_organ_donor TINYINT(1) NOT NULL DEFAULT 0,
  allergies TEXT NULL DEFAULT NULL,
  medical_conditions TEXT NULL DEFAULT NULL,
  medications TEXT NULL DEFAULT NULL,
  additional_info TEXT NULL DEFAULT NULL,
  emergency_note VARCHAR(255) NULL DEFAULT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 0,
  consent_version VARCHAR(20) NULL DEFAULT NULL,
  consent_updated_at TIMESTAMP NULL DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_emergency_profiles_user (user_id),
  KEY idx_emergency_profiles_active (is_active),
  CONSTRAINT fk_emergency_profiles_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 005: Contactos de emergencia
CREATE TABLE IF NOT EXISTS emergency_contacts (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  profile_id INT UNSIGNED NOT NULL,
  name VARCHAR(100) NOT NULL,
  relationship VARCHAR(50) NOT NULL DEFAULT '',
  phone VARCHAR(30) NULL DEFAULT NULL,
  email VARCHAR(255) NULL DEFAULT NULL,
  is_public TINYINT(1) NOT NULL DEFAULT 0,
  display_phone TINYINT(1) NOT NULL DEFAULT 0,
  display_email TINYINT(1) NOT NULL DEFAULT 0,
  priority_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_emergency_contacts_profile (profile_id),
  KEY idx_emergency_contacts_priority (profile_id, priority_order),
  CONSTRAINT fk_emergency_contacts_profile FOREIGN KEY (profile_id) REFERENCES emergency_profiles(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 006: Configuración de privacidad por campo
CREATE TABLE IF NOT EXISTS privacy_settings (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  profile_id INT UNSIGNED NOT NULL,
  field_name VARCHAR(50) NOT NULL,
  is_public TINYINT(1) NOT NULL DEFAULT 0,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_privacy_settings_profile_field (profile_id, field_name),
  KEY idx_privacy_settings_profile (profile_id),
  CONSTRAINT fk_privacy_settings_profile FOREIGN KEY (profile_id) REFERENCES emergency_profiles(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 007: Identificadores QR (permanentes por usuario)
CREATE TABLE IF NOT EXISTS identifiers (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id INT UNSIGNED NULL DEFAULT NULL,
  profile_id INT UNSIGNED NULL DEFAULT NULL,
  order_id INT UNSIGNED NULL DEFAULT NULL,
  value VARCHAR(80) NOT NULL,
  status ENUM('pending_activation', 'active', 'disabled', 'deactivated', 'replaced') NOT NULL DEFAULT 'pending_activation',
  activation_at TIMESTAMP NULL DEFAULT NULL,
  print_status ENUM('pending_print', 'sent_to_print', 'printed', 'delivered') NOT NULL DEFAULT 'pending_print',
  replaced_by_id INT UNSIGNED NULL DEFAULT NULL,
  deactivated_at TIMESTAMP NULL DEFAULT NULL,
  archived_at TIMESTAMP NULL DEFAULT NULL COMMENT 'Fecha de archivado lógico (no se borra el registro)',
  archived_by INT UNSIGNED NULL DEFAULT NULL COMMENT 'Administrador que archivó el identificador',
  package_id INT UNSIGNED NULL DEFAULT NULL COMMENT 'Paquete físico de sticker del cual proviene este identificador',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  _one_active_per_user INT UNSIGNED AS (CASE WHEN status IN ('pending_activation', 'active') THEN user_id END) VIRTUAL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_identifiers_value (value),
  UNIQUE KEY uq_identifiers_one_active_per_user (_one_active_per_user),
  KEY idx_identifiers_user (user_id),
  KEY idx_identifiers_status (status),
  KEY idx_identifiers_print_status (print_status),
  KEY idx_identifiers_user_print (user_id, print_status),
  KEY idx_identifiers_profile (profile_id),
  KEY idx_identifiers_order (order_id),
  KEY idx_identifiers_package (package_id),
  CONSTRAINT fk_identifiers_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_identifiers_profile FOREIGN KEY (profile_id) REFERENCES emergency_profiles(id) ON DELETE SET NULL,
  CONSTRAINT fk_identifiers_replaced_by FOREIGN KEY (replaced_by_id) REFERENCES identifiers(id) ON DELETE SET NULL,
  CONSTRAINT fk_identifiers_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL,
  CONSTRAINT fk_identifiers_package FOREIGN KEY (package_id) REFERENCES qr_inventory_packages(id) ON DELETE SET NULL,
  CONSTRAINT fk_identifiers_archived_by FOREIGN KEY (archived_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 008: Productos
CREATE TABLE IF NOT EXISTS products (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(100) NOT NULL,
  slug VARCHAR(120) NOT NULL,
  description TEXT NULL DEFAULT NULL,
  price DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
  currency CHAR(3) NOT NULL DEFAULT 'COP',
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  is_purchasable TINYINT(1) NOT NULL DEFAULT 0,
  is_visible TINYINT(1) NOT NULL DEFAULT 1,
  variant_options JSON NULL DEFAULT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_products_slug (slug),
  KEY idx_products_purchasable (is_purchasable, is_active, is_visible),
  KEY idx_products_sort (sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 009: Variantes de producto
CREATE TABLE IF NOT EXISTS product_variants (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  product_id INT UNSIGNED NOT NULL,
  name VARCHAR(100) NOT NULL,
  price_adjustment DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  sort_order INT NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY idx_product_variants_product (product_id),
  CONSTRAINT fk_product_variants_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 010: Pedidos
CREATE TABLE IF NOT EXISTS orders (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_number VARCHAR(32) NOT NULL,
  user_id INT UNSIGNED NOT NULL,
  product_id INT UNSIGNED NOT NULL,
  variant_id INT UNSIGNED NULL DEFAULT NULL,
  design_id INT UNSIGNED NULL DEFAULT NULL,
  design_name VARCHAR(150) NULL DEFAULT NULL,
  design_image_url VARCHAR(500) NULL DEFAULT NULL,
  sticker_quantity INT UNSIGNED NOT NULL DEFAULT 2,
  inventory_origin ENUM('inventory', 'on_demand') NULL DEFAULT NULL COMMENT 'Origen del QR asignado: inventario físico anticipado o producción bajo pedido',
  package_id INT UNSIGNED NULL DEFAULT NULL COMMENT 'Paquete físico de sticker asignado al pedido',
  commercial_status ENUM('draft', 'pending_confirmation', 'pending_payment', 'paid', 'preparing', 'shipped', 'delivered', 'cancelled', 'refund_requested', 'refunded') NOT NULL DEFAULT 'draft',
  payment_status ENUM('unpaid', 'pending', 'approved', 'rejected', 'cancelled', 'refunded') NOT NULL DEFAULT 'unpaid',
  total_amount DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
  currency CHAR(3) NOT NULL DEFAULT 'COP',
  shipping_address JSON NULL DEFAULT NULL,
  carrier VARCHAR(100) NULL DEFAULT NULL COMMENT 'Transportadora asignada al envío',
  tracking_number VARCHAR(100) NULL DEFAULT NULL COMMENT 'Número de guía de envío',
  tracking_url VARCHAR(500) NULL DEFAULT NULL COMMENT 'URL de seguimiento del envío',
  shipped_at TIMESTAMP NULL DEFAULT NULL COMMENT 'Fecha de despacho',
  delivered_at TIMESTAMP NULL DEFAULT NULL COMMENT 'Fecha de entrega',
  customization JSON NULL DEFAULT NULL,
  mercado_pago_preference_id VARCHAR(100) NULL DEFAULT NULL,
  mercado_pago_payment_id VARCHAR(100) NULL DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_orders_order_number (order_number),
  KEY idx_orders_user (user_id),
  KEY idx_orders_commercial_status (commercial_status),
  KEY idx_orders_payment_status (payment_status),
  CONSTRAINT fk_orders_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_orders_product FOREIGN KEY (product_id) REFERENCES products(id),
  CONSTRAINT fk_orders_variant FOREIGN KEY (variant_id) REFERENCES product_variants(id) ON DELETE SET NULL,
  CONSTRAINT fk_orders_design FOREIGN KEY (design_id) REFERENCES product_designs(id) ON DELETE SET NULL,
  CONSTRAINT fk_orders_package FOREIGN KEY (package_id) REFERENCES qr_inventory_packages(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 011: Ítems de pedido
CREATE TABLE IF NOT EXISTS order_items (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_id INT UNSIGNED NOT NULL,
  product_id INT UNSIGNED NOT NULL,
  name VARCHAR(150) NOT NULL,
  price DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
  quantity INT UNSIGNED NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  KEY idx_order_items_order (order_id),
  CONSTRAINT fk_order_items_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  CONSTRAINT fk_order_items_product FOREIGN KEY (product_id) REFERENCES products(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 012: Eventos de pago
CREATE TABLE IF NOT EXISTS payment_events (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_id INT UNSIGNED NOT NULL,
  mp_payment_id VARCHAR(100) NULL DEFAULT NULL,
  type VARCHAR(50) NOT NULL,
  status VARCHAR(50) NOT NULL,
  amount DECIMAL(12, 2) NULL DEFAULT NULL,
  raw JSON NULL DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_payment_events_order (order_id),
  KEY idx_payment_events_mp (mp_payment_id),
  CONSTRAINT fk_payment_events_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 013: Registro de auditoría
CREATE TABLE IF NOT EXISTS audit_logs (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  actor_user_id INT UNSIGNED NULL DEFAULT NULL,
  action VARCHAR(100) NOT NULL,
  entity_type VARCHAR(50) NOT NULL,
  entity_id VARCHAR(50) NOT NULL,
  metadata JSON NULL DEFAULT NULL,
  previous_values JSON NULL DEFAULT NULL COMMENT 'Valor anterior del campo modificado',
  new_values JSON NULL DEFAULT NULL COMMENT 'Valor nuevo asignado',
  ip_address VARCHAR(45) NULL DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_audit_logs_actor (actor_user_id),
  KEY idx_audit_logs_created (created_at),
  KEY idx_audit_logs_entity (entity_type, entity_id),
  CONSTRAINT fk_audit_logs_actor FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 014: Configuración de alertas (preparación Fase 2)
CREATE TABLE IF NOT EXISTS alert_configs (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id INT UNSIGNED NOT NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 0,
  channels JSON NULL DEFAULT NULL,
  recipients JSON NULL DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_alert_configs_user (user_id),
  CONSTRAINT fk_alert_configs_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 015: Eventos de alerta (preparación Fase 2)
CREATE TABLE IF NOT EXISTS alert_events (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id INT UNSIGNED NOT NULL,
  identifier_id INT UNSIGNED NULL DEFAULT NULL,
  type VARCHAR(50) NOT NULL,
  channel VARCHAR(30) NOT NULL,
  status ENUM('created', 'sending', 'sent', 'failed') NOT NULL DEFAULT 'created',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_alert_events_user (user_id),
  KEY idx_alert_events_status (status),
  CONSTRAINT fk_alert_events_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_alert_events_identifier FOREIGN KEY (identifier_id) REFERENCES identifiers(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 016: Versiones de documentos legales
CREATE TABLE IF NOT EXISTS legal_document_versions (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  document_type ENUM('terms', 'privacy') NOT NULL,
  version VARCHAR(20) NOT NULL,
  title VARCHAR(200) NOT NULL,
  effective_date DATE NOT NULL,
  content_summary TEXT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_legal_document_versions_type_version (document_type, version),
  KEY idx_legal_document_versions_active (document_type, is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 017: Registros de consentimiento del usuario
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 018: Solicitudes de derechos de los titulares
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Índice para evitar solicitudes duplicadas recientes del mismo tipo por usuario
CREATE INDEX idx_data_requests_user_type_status ON data_requests(user_id, request_type, status);

-- 019: Diseños de stickers (plantillas gráficas del catálogo)
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Índice para consultas rápidas de diseños por pedido
CREATE INDEX idx_orders_design ON orders(design_id);
CREATE INDEX idx_orders_package ON orders(package_id);
CREATE INDEX idx_orders_inventory_origin ON orders(inventory_origin);

-- 020: Lotes de producción de inventario físico de stickers QR
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 021: Paquetes físicos de stickers QR (inventario real de stickers)
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 022: Historial de cambios de estado de pedidos (auditoría operativa).
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 023: Registro de correos transaccionales enviados (idempotencia y trazabilidad).
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 024: Métricas de escaneos QR (sin GPS, sin IP completa, sin datos médicos).
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;