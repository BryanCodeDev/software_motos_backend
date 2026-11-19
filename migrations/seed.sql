-- =====================================================
-- emergency_id - Seed esencial (se ejecuta tras schema.sql)
-- Contiene: productos reales, paquetes comerciales, usuario administrador.
-- migrate.js lo aplica automáticamente SOLO si la tabla users está vacía.
-- Todo va en una transacción: si algo falla, no queda nada a medias.
-- =====================================================
USE emergency_id;

START TRANSACTION;

-- =====================================================
-- 1. PRODUCTOS (catálogo individual)
-- =====================================================
-- Precios definitivos de lanzamiento (enteros en COP, sin centavos).
INSERT IGNORE INTO products
  (name, slug, description, price, currency, is_active, is_purchasable, is_visible, variant_options, sort_order)
VALUES
-- Perfil individual (1 persona, 1 QR, 2 stickers) - $29.000
('Perfil individual', 'sticker-qr-personalizado',
 'Perfil de emergencia digital con código QR permanente. Incluye 1 perfil, 1 QR independiente y 2 stickers físicos con ese mismo QR. Pago único, sin suscripción.',
 29000, 'COP', 1, 1, 1, NULL, 1),

-- Sticker adicional (para perfil existente, reutiliza su QR) - $9.900
('Sticker adicional', 'sticker-adicional',
 'Sticker físico extra para un perfil que ya tienes. Reutiliza su QR permanente y no genera otro identificador.',
 9900, 'COP', 1, 1, 1, NULL, 2),

-- QR + NFC (prototipo, no disponible aún) - $0
('QR + NFC', 'qr-nfc',
 'Identificador QR con tecnología NFC. Próximamente disponible una vez validado el prototipo físico.',
 0, 'COP', 1, 0, 0, NULL, 3);

-- =====================================================
-- 2. VARIANTES DEL STICKER QR PERSONALIZADO
-- =====================================================
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

-- =====================================================
-- 3. DISEÑOS DE STICKERS (diseños gráficos del catálogo)
-- =====================================================
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

-- =====================================================
-- 4. PAQUETES COMERCIALES (product_packages)
-- Precios y composiciones definitivas de lanzamiento.
-- =====================================================
INSERT INTO product_packages
  (name, slug, description, line, profile_count, sticker_count, price, currency, is_active, is_visible, sort_order, valid_from)
VALUES
-- Línea: Personas
('Perfil individual', 'perfil-individual',
 '1 perfil de persona, 1 QR permanente y 2 stickers físicos con ese mismo QR.',
 'person', 1, 2, 29000, 'COP', 1, 1, 1, NOW()),

('Familiar x3', 'familiar-x3',
 '3 perfiles de personas, 3 QR independientes y 6 stickers. Ideal para familias.',
 'person', 3, 6, 99900, 'COP', 1, 1, 2, NOW()),

('Familiar x4', 'familiar-x4',
 '4 perfiles de personas, 4 QR independientes y 8 stickers.',
 'person', 4, 8, 124900, 'COP', 1, 1, 3, NOW()),

('Familiar x5', 'familiar-x5',
 '5 perfiles de personas, 5 QR independientes y 10 stickers.',
 'person', 5, 10, 149900, 'COP', 1, 1, 4, NOW()),

-- Línea: Mascotas
('Mascota individual', 'mascota-individual',
 '1 perfil de mascota, 1 QR permanente y 2 stickers físicos.',
 'pet', 1, 2, 34900, 'COP', 1, 1, 5, NOW()),

('Pack mascotas x2', 'pack-mascotas-x2',
 '2 perfiles de mascotas, 2 QR independientes y 4 stickers.',
 'pet', 2, 4, 64900, 'COP', 1, 1, 6, NOW()),

('Pack mascotas x3', 'pack-mascotas-x3',
 '3 perfiles de mascotas, 3 QR independientes y 6 stickers.',
 'pet', 3, 6, 89900, 'COP', 1, 1, 7, NOW()),

-- Línea: Combos (Familia + Mascotas)
('Familia + mascota', 'combo-familia-mascota',
 '3 personas + 1 mascota, 4 QR independientes y 8 stickers.',
 'combo', 4, 8, 119900, 'COP', 1, 1, 8, NOW()),

('Familia + 2 mascotas', 'combo-familia-2-mascotas',
 '3 personas + 2 mascotas, 5 QR independientes y 10 stickers.',
 'combo', 5, 10, 139900, 'COP', 1, 1, 9, NOW()),

('Familia completa', 'combo-familia-completa',
 '4 personas + 2 mascotas, 6 QR independientes y 12 stickers.',
 'combo', 6, 12, 164900, 'COP', 1, 1, 10, NOW())
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
  sort_order = VALUES(sort_order);

-- =====================================================
-- 5. COMPOSICIÓN DE PAQUETES (package_profiles)
-- Define cuántos perfiles de cada tipo incluye cada paquete.
-- =====================================================
-- Perfil individual: 1 persona x 2 stickers
INSERT INTO package_profiles (package_id, profile_type, quantity_profiles, stickers_per_profile)
SELECT p.id, 'person', 1, 2
FROM product_packages p
WHERE p.slug = 'perfil-individual'
  AND NOT EXISTS (SELECT 1 FROM package_profiles pp WHERE pp.package_id = p.id);

-- Familiar x3: 3 personas x 2 stickers
INSERT INTO package_profiles (package_id, profile_type, quantity_profiles, stickers_per_profile)
SELECT p.id, 'person', 3, 2
FROM product_packages p
WHERE p.slug = 'familiar-x3'
  AND NOT EXISTS (SELECT 1 FROM package_profiles pp WHERE pp.package_id = p.id);

-- Familiar x4: 4 personas x 2 stickers
INSERT INTO package_profiles (package_id, profile_type, quantity_profiles, stickers_per_profile)
SELECT p.id, 'person', 4, 2
FROM product_packages p
WHERE p.slug = 'familiar-x4'
  AND NOT EXISTS (SELECT 1 FROM package_profiles pp WHERE pp.package_id = p.id);

-- Familiar x5: 5 personas x 2 stickers
INSERT INTO package_profiles (package_id, profile_type, quantity_profiles, stickers_per_profile)
SELECT p.id, 'person', 5, 2
FROM product_packages p
WHERE p.slug = 'familiar-x5'
  AND NOT EXISTS (SELECT 1 FROM package_profiles pp WHERE pp.package_id = p.id);

-- Mascota individual: 1 mascota x 2 stickers
INSERT INTO package_profiles (package_id, profile_type, quantity_profiles, stickers_per_profile)
SELECT p.id, 'pet', 1, 2
FROM product_packages p
WHERE p.slug = 'mascota-individual'
  AND NOT EXISTS (SELECT 1 FROM package_profiles pp WHERE pp.package_id = p.id);

-- Pack mascotas x2: 2 mascotas x 2 stickers
INSERT INTO package_profiles (package_id, profile_type, quantity_profiles, stickers_per_profile)
SELECT p.id, 'pet', 2, 2
FROM product_packages p
WHERE p.slug = 'pack-mascotas-x2'
  AND NOT EXISTS (SELECT 1 FROM package_profiles pp WHERE pp.package_id = p.id);

-- Pack mascotas x3: 3 mascotas x 2 stickers
INSERT INTO package_profiles (package_id, profile_type, quantity_profiles, stickers_per_profile)
SELECT p.id, 'pet', 3, 2
FROM product_packages p
WHERE p.slug = 'pack-mascotas-x3'
  AND NOT EXISTS (SELECT 1 FROM package_profiles pp WHERE pp.package_id = p.id);

-- Familia + mascota: 3 personas x 2 stickers + 1 mascota x 2 stickers
INSERT INTO package_profiles (package_id, profile_type, quantity_profiles, stickers_per_profile)
SELECT p.id, 'person', 3, 2
FROM product_packages p
WHERE p.slug = 'combo-familia-mascota'
  AND NOT EXISTS (SELECT 1 FROM package_profiles pp WHERE pp.package_id = p.id AND pp.profile_type = 'person');

INSERT INTO package_profiles (package_id, profile_type, quantity_profiles, stickers_per_profile)
SELECT p.id, 'pet', 1, 2
FROM product_packages p
WHERE p.slug = 'combo-familia-mascota'
  AND NOT EXISTS (SELECT 1 FROM package_profiles pp WHERE pp.package_id = p.id AND pp.profile_type = 'pet');

-- Familia + 2 mascotas: 3 personas x 2 stickers + 2 mascotas x 2 stickers
INSERT INTO package_profiles (package_id, profile_type, quantity_profiles, stickers_per_profile)
SELECT p.id, 'person', 3, 2
FROM product_packages p
WHERE p.slug = 'combo-familia-2-mascotas'
  AND NOT EXISTS (SELECT 1 FROM package_profiles pp WHERE pp.package_id = p.id AND pp.profile_type = 'person');

INSERT INTO package_profiles (package_id, profile_type, quantity_profiles, stickers_per_profile)
SELECT p.id, 'pet', 2, 2
FROM product_packages p
WHERE p.slug = 'combo-familia-2-mascotas'
  AND NOT EXISTS (SELECT 1 FROM package_profiles pp WHERE pp.package_id = p.id AND pp.profile_type = 'pet');

-- Familia completa: 4 personas x 2 stickers + 2 mascotas x 2 stickers
INSERT INTO package_profiles (package_id, profile_type, quantity_profiles, stickers_per_profile)
SELECT p.id, 'person', 4, 2
FROM product_packages p
WHERE p.slug = 'combo-familia-completa'
  AND NOT EXISTS (SELECT 1 FROM package_profiles pp WHERE pp.package_id = p.id AND pp.profile_type = 'person');

INSERT INTO package_profiles (package_id, profile_type, quantity_profiles, stickers_per_profile)
SELECT p.id, 'pet', 2, 2
FROM product_packages p
WHERE p.slug = 'combo-familia-completa'
  AND NOT EXISTS (SELECT 1 FROM package_profiles pp WHERE pp.package_id = p.id AND pp.profile_type = 'pet');

-- =====================================================
-- 6. USUARIO ADMINISTRADOR
-- Hash bcrypt. Cambia la contraseña desde la app tras el primer ingreso.
-- =====================================================
INSERT INTO users (email, password_hash, role) VALUES
('admin@example.com', '$2a$10$RlpKgCrG/Nlx9m/AJdlO8e7qbhy48KSiCx30gdXGxag3ibBNwMcXe', 'admin')
ON DUPLICATE KEY UPDATE role = VALUES(role);

COMMIT;
