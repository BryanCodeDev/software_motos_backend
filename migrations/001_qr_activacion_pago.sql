-- ============================================================
-- 001: Monetización del QR — activación solo tras pago verificado
-- Precio: $30.000 COP, pago único, sin suscripción.
-- Compatible con registros existentes: no elimina ni modifica
-- identificadores ya emitidos (seed/datos de prueba).
-- ============================================================
USE emergency_id;

-- Vincular cada identificador con la orden de activación pagada que lo originó.
SET @col_exists := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = 'emergency_id'
    AND table_name = 'identifiers'
    AND column_name = 'order_id'
);

SET @sql = IF(@col_exists = 0,
  'ALTER TABLE identifiers
     ADD COLUMN order_id INT UNSIGNED NULL AFTER profile_id,
     ADD KEY idx_identifiers_order (order_id),
     ADD CONSTRAINT fk_identifiers_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL',
  'SELECT "identifiers.order_id ya existe" AS msg'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Precio del producto de activación de QR digital: $30.000 COP (pago único).
UPDATE products
SET price = 30000.00, currency = 'COP'
WHERE slug = 'qr-digital-basico';

-- ============================================================
-- Fin de migración 001
-- ============================================================
