-- =====================================================
-- emergency_id - Seed esencial (se ejecuta tras schema.sql)
-- Contiene solo: productos reales + usuario administrador.
-- migrate.js lo aplica automáticamente SOLO si la tabla users está vacía.
-- Todo va en una transacción: si algo falla, no queda nada a medias.
-- =====================================================
USE emergency_id;

START TRANSACTION;

-- Productos
INSERT IGNORE INTO products
  (name, slug, description, price, currency, is_active, is_purchasable, is_visible, variant_options, sort_order)
VALUES
('QR digital básico', 'qr-digital-basico',
 'Perfil de emergencia digital con código QR para descargar e imprimir. Pago único de $30.000 COP, sin suscripción.',
 30000.00, 'COP', 1, 1, 1, NULL, 1),
('Sticker QR personalizado', 'sticker-qr-personalizado',
 'Sticker físico personalizado con tu código QR de emergencia. Opciones de diseño y envío a domicilio.',
 25000.00, 'COP', 1, 1, 1, '["estándar", "resistente"]', 2),
('QR + NFC', 'qr-nfc',
 'Identificador QR con tecnología NFC. Próximamente disponible una vez validado el prototipo físico.',
 0.00, 'COP', 1, 0, 0, NULL, 3);

-- Variantes del sticker
INSERT INTO product_variants (product_id, name, price_adjustment, is_active, sort_order)
SELECT p.id, 'Estándar', 0.00, 1, 1
FROM products p
WHERE p.slug = 'sticker-qr-personalizado'
  AND NOT EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = p.id AND v.name = 'Estándar');

INSERT INTO product_variants (product_id, name, price_adjustment, is_active, sort_order)
SELECT p.id, 'Resistente', 8000.00, 1, 2
FROM products p
WHERE p.slug = 'sticker-qr-personalizado'
  AND NOT EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = p.id AND v.name = 'Resistente');

-- Usuario administrador (hash bcrypt). Cambia la contraseña desde la app tras el primer ingreso.
INSERT INTO users (email, password_hash, role, email_verified) VALUES
('admin@example.com', '$2a$10$RlpKgCrG/Nlx9m/AJdlO8e7qbhy48KSiCx30gdXGxag3ibBNwMcXe', 'admin', 1);

COMMIT;