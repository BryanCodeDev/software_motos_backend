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

-- Diseños de stickers (diez plantillas gráficas del catálogo).
-- Las imágenes (public/img/sticker-1.png ... sticker-10.png) deben
-- proporcionarse en el frontend público. La UI degrada con gracia si faltan.
INSERT INTO product_designs (product_id, name, slug, description, image_url, is_available, sort_order)
SELECT p.id, 'Diseño 1', 'diseno-1', 'Diseño de sticker para casco y moto. Plantilla gráfica 1.', '/img/sticker-1.png', 1, 1
FROM products p
WHERE p.slug = 'sticker-qr-personalizado'
  AND NOT EXISTS (SELECT 1 FROM product_designs d WHERE d.product_id = p.id AND d.slug = 'diseno-1');

INSERT INTO product_designs (product_id, name, slug, description, image_url, is_available, sort_order)
SELECT p.id, 'Diseño 2', 'diseno-2', 'Diseño de sticker para casco y moto. Plantilla gráfica 2.', '/img/sticker-2.png', 1, 2
FROM products p
WHERE p.slug = 'sticker-qr-personalizado'
  AND NOT EXISTS (SELECT 1 FROM product_designs d WHERE d.product_id = p.id AND d.slug = 'diseno-2');

INSERT INTO product_designs (product_id, name, slug, description, image_url, is_available, sort_order)
SELECT p.id, 'Diseño 3', 'diseno-3', 'Diseño de sticker para casco y moto. Plantilla gráfica 3.', '/img/sticker-3.png', 1, 3
FROM products p
WHERE p.slug = 'sticker-qr-personalizado'
  AND NOT EXISTS (SELECT 1 FROM product_designs d WHERE d.product_id = p.id AND d.slug = 'diseno-3');

INSERT INTO product_designs (product_id, name, slug, description, image_url, is_available, sort_order)
SELECT p.id, 'Diseño 4', 'diseno-4', 'Diseño de sticker para casco y moto. Plantilla gráfica 4.', '/img/sticker-4.png', 1, 4
FROM products p
WHERE p.slug = 'sticker-qr-personalizado'
  AND NOT EXISTS (SELECT 1 FROM product_designs d WHERE d.product_id = p.id AND d.slug = 'diseno-4');

INSERT INTO product_designs (product_id, name, slug, description, image_url, is_available, sort_order)
SELECT p.id, 'Diseño 5', 'diseno-5', 'Diseño de sticker para casco y moto. Plantilla gráfica 5.', '/img/sticker-5.png', 1, 5
FROM products p
WHERE p.slug = 'sticker-qr-personalizado'
  AND NOT EXISTS (SELECT 1 FROM product_designs d WHERE d.product_id = p.id AND d.slug = 'diseno-5');

INSERT INTO product_designs (product_id, name, slug, description, image_url, is_available, sort_order)
SELECT p.id, 'Diseño 6', 'diseno-6', 'Diseño de sticker para casco y moto. Plantilla gráfica 6.', '/img/sticker-6.png', 1, 6
FROM products p
WHERE p.slug = 'sticker-qr-personalizado'
  AND NOT EXISTS (SELECT 1 FROM product_designs d WHERE d.product_id = p.id AND d.slug = 'diseno-6');

INSERT INTO product_designs (product_id, name, slug, description, image_url, is_available, sort_order)
SELECT p.id, 'Diseño 7', 'diseno-7', 'Diseño de sticker para casco y moto. Plantilla gráfica 7.', '/img/sticker-7.png', 1, 7
FROM products p
WHERE p.slug = 'sticker-qr-personalizado'
  AND NOT EXISTS (SELECT 1 FROM product_designs d WHERE d.product_id = p.id AND d.slug = 'diseno-7');

INSERT INTO product_designs (product_id, name, slug, description, image_url, is_available, sort_order)
SELECT p.id, 'Diseño 8', 'diseno-8', 'Diseño de sticker para casco y moto. Plantilla gráfica 8.', '/img/sticker-8.png', 1, 8
FROM products p
WHERE p.slug = 'sticker-qr-personalizado'
  AND NOT EXISTS (SELECT 1 FROM product_designs d WHERE d.product_id = p.id AND d.slug = 'diseno-8');

INSERT INTO product_designs (product_id, name, slug, description, image_url, is_available, sort_order)
SELECT p.id, 'Diseño 9', 'diseno-9', 'Diseño de sticker para casco y moto. Plantilla gráfica 9.', '/img/sticker-9.png', 1, 9
FROM products p
WHERE p.slug = 'sticker-qr-personalizado'
  AND NOT EXISTS (SELECT 1 FROM product_designs d WHERE d.product_id = p.id AND d.slug = 'diseno-9');

INSERT INTO product_designs (product_id, name, slug, description, image_url, is_available, sort_order)
SELECT p.id, 'Diseño 10', 'diseno-10', 'Diseño de sticker para casco y moto. Plantilla gráfica 10.', '/img/sticker-10.png', 1, 10
FROM products p
WHERE p.slug = 'sticker-qr-personalizado'
  AND NOT EXISTS (SELECT 1 FROM product_designs d WHERE d.product_id = p.id AND d.slug = 'diseno-10');

-- Usuario administrador (hash bcrypt). Cambia la contraseña desde la app tras el primer ingreso.
INSERT INTO users (email, password_hash, role) VALUES
('admin@example.com', '$2a$10$RlpKgCrG/Nlx9m/AJdlO8e7qbhy48KSiCx30gdXGxag3ibBNwMcXe', 'admin');

COMMIT;