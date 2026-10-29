-- =====================================================
-- emergency_id - Datos de prueba (ejecutar después de schema.sql)
-- Credenciales admin: admin@example.com / Admin1012@
-- =====================================================
USE emergency_id;

-- 016: Productos (precios configurables por el administrador)
INSERT IGNORE INTO products (name, slug, description, price, currency, is_active, is_purchasable, is_visible, variant_options, sort_order) VALUES
('QR digital básico', 'qr-digital-basico', 'Perfil de emergencia digital con código QR gratuito para descargar e imprimir. Acceso público autorizado pago unico 30000 COP.', 30000.00, 'COP', 1, 1, 1, NULL, 1),
('Sticker QR personalizado', 'sticker-qr-personalizado', 'Sticker físico personalizado con tu código QR de emergencia. Opciones de diseño y envío a domicilio. Precio pendiente de configuración por el administrador.', 0.00, 'COP', 1, 0, 1, '["estándar", "resistente"]', 2),
('QR + NFC', 'qr-nfc', 'Identificador QR con tecnología NFC. Próximamente disponible una vez validado el prototipo físico.', 0.00, 'COP', 1, 0, 0, NULL, 3);

-- Precio de prueba para poder probar el flujo de compra
UPDATE products SET price = 25000.00, is_purchasable = 1 WHERE slug = 'sticker-qr-personalizado';

-- Variantes
INSERT INTO product_variants (product_id, name, price_adjustment, is_active, sort_order)
SELECT id, 'Estándar', 0.00, 1, 1 FROM products WHERE slug = 'sticker-qr-personalizado';
INSERT INTO product_variants (product_id, name, price_adjustment, is_active, sort_order)
SELECT id, 'Resistente', 8000.00, 1, 2 FROM products WHERE slug = 'sticker-qr-personalizado';

-- Usuarios (hash bcrypt de 'Admin1012@')
INSERT INTO users (email, password_hash, role, email_verified) VALUES
('admin@example.com', '$2a$10$RlpKgCrG/Nlx9m/AJdlO8e7qbhy48KSiCx30gdXGxag3ibBNwMcXe', 'admin', 1),
('usuario@example.com', '$2a$10$RlpKgCrG/Nlx9m/AJdlO8e7qbhy48KSiCx30gdXGxag3ibBNwMcXe', 'user', 1);

SET @admin_id = (SELECT id FROM users WHERE email = 'admin@example.com');
SET @user_id  = (SELECT id FROM users WHERE email = 'usuario@example.com');

-- Perfiles de emergencia
INSERT INTO emergency_profiles
  (user_id, display_name, blood_type, allergies, medical_conditions, medications, additional_info, emergency_note, is_active, consent_version, consent_updated_at)
VALUES
(@admin_id, 'Bryan Muñoz', 'O+', 'Ninguna conocida', 'Ninguna', 'Ninguno', 'Perfil de prueba del administrador.', 'En caso de emergencia, contactar a mi familia.', 1, 'v1.0', NOW()),
(@user_id, 'Usuario de Prueba', 'A+', 'Penicilina', 'Asma', 'Salbutamol (inhalador)', 'Perfil de prueba de usuario regular.', 'Llevo inhalador en el bolso.', 1, 'v1.0', NOW());

SET @admin_profile = (SELECT id FROM emergency_profiles WHERE user_id = @admin_id);
SET @user_profile  = (SELECT id FROM emergency_profiles WHERE user_id = @user_id);

-- Contactos de emergencia
INSERT INTO emergency_contacts (profile_id, name, relationship, phone, email, is_public, display_phone, display_email, priority_order) VALUES
(@admin_profile, 'Contacto Familiar', 'Familiar', '+573001112233', 'familiar@example.com', 1, 1, 0, 1),
(@admin_profile, 'Contacto Amigo', 'Amigo', '+573004445566', NULL, 1, 1, 0, 2),
(@user_profile, 'Madre de Prueba', 'Madre', '+573007778899', 'madre@example.com', 1, 1, 1, 1);

-- Privacidad por campo
INSERT INTO privacy_settings (profile_id, field_name, is_public) VALUES
(@admin_profile, 'display_name', 1),
(@admin_profile, 'photo_url', 1),
(@admin_profile, 'blood_type', 1),
(@admin_profile, 'allergies', 1),
(@admin_profile, 'medical_conditions', 0),
(@admin_profile, 'medications', 0),
(@admin_profile, 'additional_info', 0),
(@admin_profile, 'emergency_note', 1),
(@user_profile, 'display_name', 1),
(@user_profile, 'blood_type', 1),
(@user_profile, 'allergies', 1),
(@user_profile, 'medical_conditions', 1),
(@user_profile, 'medications', 0),
(@user_profile, 'emergency_note', 1);

-- Identificadores QR
INSERT INTO identifiers (user_id, profile_id, value, status) VALUES
(@admin_id, @admin_profile, 'EID-ADMIN-0001-TESTQR', 'active'),
(@user_id, @user_profile, 'EID-USER-0001-TESTQR', 'active'),
(@user_id, NULL, 'EID-USER-OLD-0000-TESTQR', 'deactivated');

UPDATE identifiers SET deactivated_at = NOW(),
  replaced_by_id = (SELECT id FROM (SELECT id FROM identifiers WHERE value = 'EID-USER-0001-TESTQR') t)
WHERE value = 'EID-USER-OLD-0000-TESTQR';

-- Pedido de prueba (sticker resistente, pagado)
SET @sticker_id = (SELECT id FROM products WHERE slug = 'sticker-qr-personalizado');
SET @variant_id = (SELECT id FROM product_variants WHERE product_id = @sticker_id AND name = 'Resistente');

INSERT INTO orders
  (order_number, user_id, product_id, variant_id, commercial_status, payment_status, total_amount, currency, shipping_address, customization, mercado_pago_preference_id, mercado_pago_payment_id)
VALUES
('EID-20260001', @user_id, @sticker_id, @variant_id, 'paid', 'approved', 33000.00, 'COP',
 JSON_OBJECT('name', 'Usuario de Prueba', 'address', 'Calle 1 # 2-3', 'city', 'Mosquera', 'department', 'Cundinamarca', 'phone', '+573007778899'),
 JSON_OBJECT('color', 'rojo', 'text', 'Usuario de Prueba'),
 'PREF-TEST-0001', 'MP-TEST-0001');

SET @order_id = (SELECT id FROM orders WHERE order_number = 'EID-20260001');

INSERT INTO order_items (order_id, product_id, name, price, quantity)
VALUES (@order_id, @sticker_id, 'Sticker QR personalizado - Resistente', 33000.00, 1);

INSERT INTO payment_events (order_id, mp_payment_id, type, status, amount, raw) VALUES
(@order_id, 'MP-TEST-0001', 'payment', 'approved', 33000.00, JSON_OBJECT('source', 'seed', 'note', 'pago simulado'));

-- Auditoría
INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, metadata, ip_address) VALUES
(@admin_id, 'seed.created', 'user', CAST(@admin_id AS CHAR), JSON_OBJECT('email', 'admin@example.com'), '127.0.0.1'),
(@user_id, 'order.created', 'order', CAST(@order_id AS CHAR), JSON_OBJECT('order_number', 'EID-20260001'), '127.0.0.1');

-- Alertas (Fase 2)
INSERT INTO alert_configs (user_id, enabled, channels, recipients) VALUES
(@admin_id, 0, JSON_ARRAY('email'), JSON_ARRAY('familiar@example.com'));