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
  role ENUM('user', 'admin') NOT NULL DEFAULT 'user',
  email_verified TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_users_email (email),
  KEY idx_users_role (role)
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

-- 007: Identificadores QR
CREATE TABLE IF NOT EXISTS identifiers (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id INT UNSIGNED NOT NULL,
  profile_id INT UNSIGNED NULL DEFAULT NULL,
  order_id INT UNSIGNED NULL DEFAULT NULL,
  value VARCHAR(80) NOT NULL,
  status ENUM('active', 'deactivated', 'replaced') NOT NULL DEFAULT 'active',
  replaced_by_id INT UNSIGNED NULL DEFAULT NULL,
  deactivated_at TIMESTAMP NULL DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_identifiers_value (value),
  KEY idx_identifiers_user (user_id),
  KEY idx_identifiers_status (status),
  KEY idx_identifiers_profile (profile_id),
  KEY idx_identifiers_order (order_id),
  CONSTRAINT fk_identifiers_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_identifiers_profile FOREIGN KEY (profile_id) REFERENCES emergency_profiles(id) ON DELETE SET NULL,
  CONSTRAINT fk_identifiers_replaced_by FOREIGN KEY (replaced_by_id) REFERENCES identifiers(id) ON DELETE SET NULL,
  CONSTRAINT fk_identifiers_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL
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
  commercial_status ENUM('draft', 'pending_confirmation', 'pending_payment', 'paid', 'preparing', 'shipped', 'delivered', 'cancelled', 'refund_requested', 'refunded') NOT NULL DEFAULT 'draft',
  payment_status ENUM('unpaid', 'pending', 'approved', 'rejected', 'cancelled', 'refunded') NOT NULL DEFAULT 'unpaid',
  total_amount DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
  currency CHAR(3) NOT NULL DEFAULT 'COP',
  shipping_address JSON NULL DEFAULT NULL,
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
  CONSTRAINT fk_orders_variant FOREIGN KEY (variant_id) REFERENCES product_variants(id) ON DELETE SET NULL
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

SET FOREIGN_KEY_CHECKS = 1;