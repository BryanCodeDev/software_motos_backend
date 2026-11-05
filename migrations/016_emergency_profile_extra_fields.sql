-- =====================================================
-- emergency_id - Campos adicionales de perfil de emergencia
-- Datos médicos y de identificación críticos para primeros respondientes
-- =====================================================

ALTER TABLE emergency_profiles
  ADD COLUMN date_of_birth DATE NULL DEFAULT NULL AFTER blood_type,
  ADD COLUMN height_cm DECIMAL(5,2) NULL DEFAULT NULL AFTER date_of_birth,
  ADD COLUMN weight_kg DECIMAL(5,2) NULL DEFAULT NULL AFTER height_cm,
  ADD COLUMN is_pregnant TINYINT(1) NOT NULL DEFAULT 0 AFTER weight_kg,
  ADD COLUMN medical_devices TEXT NULL DEFAULT NULL AFTER is_pregnant,
  ADD COLUMN primary_doctor_name VARCHAR(200) NULL DEFAULT NULL AFTER medical_devices,
  ADD COLUMN primary_doctor_phone VARCHAR(30) NULL DEFAULT NULL AFTER primary_doctor_name,
  ADD COLUMN insurance_company VARCHAR(200) NULL DEFAULT NULL AFTER primary_doctor_phone,
  ADD COLUMN insurance_policy_number VARCHAR(100) NULL DEFAULT NULL AFTER insurance_company,
  ADD COLUMN document_number VARCHAR(50) NULL DEFAULT NULL AFTER insurance_policy_number,
  ADD COLUMN is_organ_donor TINYINT(1) NOT NULL DEFAULT 0 AFTER document_number;
