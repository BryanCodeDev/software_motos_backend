const db = require('../../config/db');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { promisify } = require('util');

const writeFile = promisify(fs.writeFile);
const unlink = promisify(fs.unlink);
const stat = promisify(fs.stat);

const PUBLIC_PROFILE_FIELDS = ['display_name', 'photo_url', 'blood_type', 'date_of_birth', 'document_number', 'insurance_company', 'insurance_policy_number', 'is_organ_donor', 'primary_doctor_name', 'primary_doctor_phone', 'emergency_note', 'additional_info'];
const PUBLIC_MEDICAL_FIELDS = ['allergies', 'medical_conditions', 'medications', 'height_cm', 'weight_kg', 'is_pregnant', 'medical_devices'];

const PHOTO_STORAGE_DIR = path.join(__dirname, '..', '..', 'storage', 'photos');
const MAX_PHOTO_BYTES = 2 * 1024 * 1024;
const ALLOWED_PHOTO_MIME = ['image/jpeg', 'image/png', 'image/webp'];
const EXT_BY_MIME = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };

fs.mkdirSync(PHOTO_STORAGE_DIR, { recursive: true });

const isSafePhotoFilename = (filename) => /^[A-Za-z0-9_-]+\.(jpg|png|webp)$/.test(filename);

const parsePhotoDataUrl = (dataUrl) => {
  if (!dataUrl) {return null;}
  const match = String(dataUrl).match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/);
  if (!match) {return null;}
  const mime = match[1] === 'jpeg' ? 'image/jpeg' : `image/${match[1]}`;
  const buffer = Buffer.from(match[2], 'base64');
  return { mime, buffer, ext: EXT_BY_MIME[mime] };
};

const PROFILE_TYPES = ['person', 'pet', 'managed_person'];

/*
 * Obtiene los perfiles de una cuenta (usuario). Nunca auto-crea: cada perfil
 * se crea explícitamente. Los perfiles existentes del usuario se conservan.
 */
const listProfiles = async (userId) => {
  const rows = await db.query(
    `SELECT id, user_id, profile_type, relationship, display_name, photo_url, is_active,
            is_managed_by_third_party, consent_accepted, consent_at, consent_by,
            blood_type, date_of_birth, height_cm, weight_kg,
            is_pregnant, medical_devices, primary_doctor_name, primary_doctor_phone,
            insurance_company, insurance_policy_number, document_number, is_organ_donor,
            allergies, medical_conditions, medications, additional_info, emergency_note,
            pet_species, pet_breed, pet_age, pet_birth_date, pet_sex, pet_weight,
            pet_color, pet_characteristics, pet_microchip, pet_sterilized,
            pet_vaccines, pet_allergies, pet_medications, pet_conditions,
            pet_vet_name, pet_vet_phone, pet_owner_name, pet_owner_phone,
            pet_alternate_contacts, pet_care_instructions, pet_lost, pet_reward,
            consent_version, consent_updated_at, created_at, updated_at
     FROM emergency_profiles
     WHERE user_id = ?
     ORDER BY created_at ASC`,
    [userId]
  );
  return rows;
};

/*
 * Obtiene un perfil específico verificando que pertenece al usuario autenticado.
 */
const getProfileById = async (userId, profileId) => {
  const rows = await db.query(
    `SELECT id, user_id, profile_type, relationship, display_name, photo_url, is_active,
            is_managed_by_third_party, consent_accepted, consent_at, consent_by,
            pet_species, pet_breed, pet_age, pet_birth_date, pet_sex, pet_weight,
            pet_color, pet_characteristics, pet_microchip, pet_sterilized,
            pet_vaccines, pet_allergies, pet_medications, pet_conditions,
            pet_vet_name, pet_vet_phone, pet_owner_name, pet_owner_phone,
            pet_alternate_contacts, pet_care_instructions, pet_lost, pet_reward,
            consent_version, consent_updated_at, created_at, updated_at
     FROM emergency_profiles
     WHERE id = ? AND user_id = ?`,
    [profileId, userId]
  );
  if (rows.length === 0) {return null;}
  return rows[0];
};

/*
 * Crea un perfil para el usuario autenticado.
 */
const createProfile = async ({ userId, data, ipAddress }) => {
  const {
    profile_type = 'person',
    relationship,
    is_managed_by_third_party = 0,
    consent_accepted = 0,
    // campos persona
    display_name = '',
    blood_type, date_of_birth, height_cm, weight_kg, is_pregnant, medical_devices,
    primary_doctor_name, primary_doctor_phone, insurance_company,
    insurance_policy_number, document_number, is_organ_donor,
    allergies, medical_conditions, medications, additional_info, emergency_note,
    // campos mascota
    pet_species, pet_breed, pet_age, pet_birth_date, pet_sex, pet_weight,
    pet_color, pet_characteristics, pet_microchip, pet_sterilized,
    pet_vaccines, pet_allergies, pet_medications, pet_conditions,
    pet_vet_name, pet_vet_phone, pet_owner_name, pet_owner_phone,
    pet_alternate_contacts, pet_care_instructions, pet_lost = 0, pet_reward,
  } = data || {};

  if (!PROFILE_TYPES.includes(profile_type)) {
    return { error: 'profile_type_invalid', status: 400 };
  }

  // Si es perfil gestionado por tercero, requiere consentimiento explícito.
  if (profile_type === 'managed_person' && is_managed_by_third_party && !consent_accepted) {
    return { error: 'consent_required', status: 400, detail: 'Se requiere consentimiento para perfiles gestionados por terceros.' };
  }

  const conn = await db.getConnection();
  try {
    await conn.query('START TRANSACTION');

    const [result] = await conn.query(
      `INSERT INTO emergency_profiles
        (user_id, profile_type, relationship, is_managed_by_third_party,
         consent_accepted, consent_at, consent_by,
         display_name, blood_type, date_of_birth, height_cm, weight_kg,
         is_pregnant, medical_devices, primary_doctor_name, primary_doctor_phone,
         insurance_company, insurance_policy_number, document_number, is_organ_donor,
         allergies, medical_conditions, medications, additional_info, emergency_note,
         pet_species, pet_breed, pet_age, pet_birth_date, pet_sex, pet_weight,
         pet_color, pet_characteristics, pet_microchip, pet_sterilized,
         pet_vaccines, pet_allergies, pet_medications, pet_conditions,
         pet_vet_name, pet_vet_phone, pet_owner_name, pet_owner_phone,
         pet_alternate_contacts, pet_care_instructions, pet_lost, pet_reward,
         is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
               ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        userId, profile_type, relationship, is_managed_by_third_party ? 1 : 0,
        consent_accepted ? 1 : 0,
        consent_accepted ? new Date() : null, userId,
        display_name, blood_type, date_of_birth, height_cm, weight_kg,
        is_pregnant ? 1 : 0, medical_devices,
        primary_doctor_name, primary_doctor_phone,
        insurance_company, insurance_policy_number, document_number,
        is_organ_donor ? 1 : 0,
        allergies, medical_conditions, medications, additional_info, emergency_note,
        pet_species, pet_breed, pet_age, pet_birth_date, pet_sex, pet_weight,
        pet_color, pet_characteristics, pet_microchip,
        pet_sterilized !== undefined ? (pet_sterilized ? 1 : 0) : null,
        pet_vaccines, pet_allergies, pet_medications, pet_conditions,
        pet_vet_name, pet_vet_phone, pet_owner_name, pet_owner_phone,
        pet_alternate_contacts, pet_care_instructions,
        pet_lost ? 1 : 0, pet_reward,
        0
      ]
    );
    const profileId = result.insertId;

    // Inicializar configuración de privacidad por defecto (todo privado).
    const defaultFields = [
      'display_name','photo_url','blood_type','date_of_birth','height_cm','weight_kg',
      'is_pregnant','medical_devices','primary_doctor_name','primary_doctor_phone',
      'insurance_company','insurance_policy_number','document_number','is_organ_donor',
      'allergies','medical_conditions','medications','additional_info','emergency_note',
      'pet_species','pet_breed','pet_age','pet_birth_date','pet_sex','pet_weight',
      'pet_color','pet_characteristics','pet_microchip','pet_sterilized',
      'pet_vaccines','pet_allergies','pet_medications','pet_conditions',
      'pet_vet_name','pet_vet_phone','pet_owner_name','pet_owner_phone',
      'pet_alternate_contacts','pet_care_instructions','pet_lost','pet_reward',
    ];
    for (const field of defaultFields) {
      try {
        await conn.query(
          'INSERT INTO privacy_settings (profile_id, field_name, is_public) VALUES (?, ?, 0)',
          [profileId, field]
        );
      } catch { /* ignore duplicates */ }
    }

    // Registrar consentimiento si aplica.
    if (profile_type === 'managed_person' && consent_accepted) {
      try {
        await conn.query(
          `INSERT INTO profile_consent (profile_id, consent_type, accepted, accepted_at, accepted_by, ip_address)
           VALUES (?, 'third_party_management', 1, NOW(), ?, ?)`,
          [profileId, userId, ipAddress]
        );
      } catch { /* ignore */ }
    }

    await conn.query(
      'INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, metadata, ip_address) VALUES (?, ?, ?, ?, ?, ?)',
      [userId, 'profile.create', 'emergency_profiles', String(profileId), JSON.stringify({ profile_type }), ipAddress]
    );

    await conn.query('COMMIT');

    const created = await getProfileById(userId, profileId);
    return { profile: created };
  } catch (error) {
    await conn.query('ROLLBACK').catch(() => {});
    if (error && error.code === 'ER_DUP_ENTRY') {
      return { error: 'profile_already_exists', status: 409, detail: 'Ya existe un perfil de emergencia para esta cuenta.' };
    }
    throw error;
  } finally {
    conn.release();
  }
};

/*
 * Actualiza un perfil. Solo los campos enviados se modifican.
 * Campos médicos y de mascota se filtran según el tipo de perfil.
 */
const updateProfileById = async ({ userId, profileId, data, ipAddress }) => {
  const profile = await getProfileById(userId, profileId);
  if (!profile) {
    return { error: 'profile_not_found', status: 404 };
  }

  const fields = [];
  const values = [];
  const setIf = (key, val) => {
    if (val !== undefined) {
      fields.push(`${key} = ?`);
      values.push(val);
    }
  };

  // Campos comunes a todos los tipos.
  setIf('display_name', data.display_name);
  setIf('photo_url', data.photo_url === undefined ? null : data.photo_url);
  setIf('relationship', data.relationship);
  setIf('is_managed_by_third_party', data.is_managed_by_third_party === undefined ? undefined : (data.is_managed_by_third_party ? 1 : 0));
  if (data.consent_accepted !== undefined) {
    setIf('consent_accepted', data.consent_accepted ? 1 : 0);
    if (data.consent_accepted) {
      setIf('consent_at', new Date());
      setIf('consent_by', userId);
    }
  }

  // Campos de persona (no se aplican a mascota).
  if (profile.profile_type === 'person' || profile.profile_type === 'managed_person') {
    setIf('blood_type', data.blood_type);
    setIf('date_of_birth', data.date_of_birth);
    setIf('height_cm', data.height_cm);
    setIf('weight_kg', data.weight_kg);
    setIf('is_pregnant', data.is_pregnant === undefined ? undefined : (data.is_pregnant ? 1 : 0));
    setIf('medical_devices', data.medical_devices);
    setIf('primary_doctor_name', data.primary_doctor_name);
    setIf('primary_doctor_phone', data.primary_doctor_phone);
    setIf('insurance_company', data.insurance_company);
    setIf('insurance_policy_number', data.insurance_policy_number);
    setIf('document_number', data.document_number);
    setIf('is_organ_donor', data.is_organ_donor === undefined ? undefined : (data.is_organ_donor ? 1 : 0));
    setIf('allergies', data.allergies);
    setIf('medical_conditions', data.medical_conditions);
    setIf('medications', data.medications);
    setIf('additional_info', data.additional_info);
    setIf('emergency_note', data.emergency_note);
  }

  // Campos de mascota.
  if (profile.profile_type === 'pet') {
    setIf('pet_species', data.pet_species);
    setIf('pet_breed', data.pet_breed);
    setIf('pet_age', data.pet_age);
    setIf('pet_birth_date', data.pet_birth_date);
    setIf('pet_sex', data.pet_sex);
    setIf('pet_weight', data.pet_weight);
    setIf('pet_color', data.pet_color);
    setIf('pet_characteristics', data.pet_characteristics);
    setIf('pet_microchip', data.pet_microchip);
    setIf('pet_sterilized', data.pet_sterilized === undefined ? undefined : (data.pet_sterilized ? 1 : 0));
    setIf('pet_vaccines', data.pet_vaccines);
    setIf('pet_allergies', data.pet_allergies);
    setIf('pet_medications', data.pet_medications);
    setIf('pet_conditions', data.pet_conditions);
    setIf('pet_vet_name', data.pet_vet_name);
    setIf('pet_vet_phone', data.pet_vet_phone);
    setIf('pet_owner_name', data.pet_owner_name);
    setIf('pet_owner_phone', data.pet_owner_phone);
    setIf('pet_alternate_contacts', data.pet_alternate_contacts);
    setIf('pet_care_instructions', data.pet_care_instructions);
    setIf('pet_lost', data.pet_lost === undefined ? undefined : (data.pet_lost ? 1 : 0));
    setIf('pet_reward', data.pet_reward);
  }

  if (fields.length === 0) {
    return { profile };
  }
  values.push(profileId);

  const conn = await db.getConnection();
  try {
    await conn.query('START TRANSACTION');
    await conn.query(`UPDATE emergency_profiles SET ${fields.join(', ')} WHERE id = ?`, values);
    await conn.query(
      'INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, metadata, ip_address) VALUES (?, ?, ?, ?, ?, ?)',
      [userId, 'profile.update', 'emergency_profiles', String(profileId), JSON.stringify({ fields: fields.map(f => f.split(' = ')[0]) }), ipAddress]
    );
    await conn.query('COMMIT');
  } catch (error) {
    await conn.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    conn.release();
  }

  return { profile: await getProfileById(userId, profileId) };
};

/*
 * Desactiva un perfil (no borra). Solo el propietario de la cuenta.
 */
const deactivateProfile = async ({ userId, profileId, ipAddress }) => {
  const profile = await getProfileById(userId, profileId);
  if (!profile) {
    return { error: 'profile_not_found', status: 404 };
  }
  if (!profile.is_active) {
    return { error: 'profile_inactive', status: 409 };
  }

  const conn = await db.getConnection();
  try {
    await conn.query('START TRANSACTION');
    await conn.query('UPDATE emergency_profiles SET is_active = 0 WHERE id = ?', [profileId]);
    await conn.query(
      'UPDATE identifiers SET status = ?, deactivated_at = NOW() WHERE profile_id = ? AND status = ?',
      ['disabled', profileId, 'active']
    );
    await conn.query(
      'INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, metadata, ip_address) VALUES (?, ?, ?, ?, ?, ?)',
      [userId, 'profile.deactivate', 'emergency_profiles', String(profileId), JSON.stringify({}), ipAddress]
    );
    await conn.query('COMMIT');
  } catch (error) {
    await conn.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    conn.release();
  }

  return { message: 'Perfil desactivado' };
};

/*
 * Reactiva un perfil.
 */
const reactivateProfile = async ({ userId, profileId, ipAddress }) => {
  const profile = await getProfileById(userId, profileId);
  if (!profile) {
    return { error: 'profile_not_found', status: 404 };
  }
  if (profile.is_active) {
    return { error: 'profile_active', status: 409 };
  }

  await db.query('UPDATE emergency_profiles SET is_active = 1 WHERE id = ?', [profileId]);
  await db.query(
    'INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, metadata, ip_address) VALUES (?, ?, ?, ?, ?, ?)',
    [userId, 'profile.reactivate', 'emergency_profiles', String(profileId), JSON.stringify({}), ipAddress]
  );

  return { message: 'Perfil reactivado' };
};

/*
 * Obtiene el mapa de privacidad de un perfil (verificación de propiedad).
 */
const getPrivacyMapByProfile = async (profileId) => {
  const rows = await db.query(
    'SELECT field_name, is_public FROM privacy_settings WHERE profile_id = ?',
    [profileId]
  );
  const map = {};
  rows.forEach((r) => { map[r.field_name] = r.is_public === 1; });
  return map;
};

/*
 * Construye la respuesta pública de un perfil por identificador QR.
 * Reutiliza la lógica existente pero filtra campos médicos según tipo.
 */
const buildPublicProfileData = async (profile, privacy) => {
  const profileData = {};

  for (const field of PUBLIC_PROFILE_FIELDS) {
    if (privacy[field] === true) {
      const value = profile[field];
      if (value !== null && value !== undefined && value !== '') {
        profileData[field] = value;
      }
    }
  }

  const medical = {};
  for (const field of PUBLIC_MEDICAL_FIELDS) {
    if (privacy[field] === true) {
      const value = profile[field];
      if (value !== null && value !== undefined && value !== '') {
        medical[field] = value;
      }
    }
  }
  if (Object.keys(medical).length > 0) {
    profileData.medical = medical;
  }

  // Campos específicos de mascota (solo si es mascota).
  if (profile.profile_type === 'pet') {
    const petFields = ['pet_species', 'pet_breed', 'pet_age', 'pet_sex', 'pet_color', 'pet_microchip', 'pet_sterilized', 'pet_vaccines', 'pet_allergies', 'pet_medications', 'pet_conditions', 'pet_vet_name', 'pet_vet_phone', 'pet_owner_name', 'pet_owner_phone', 'pet_alternate_contacts', 'pet_care_instructions', 'pet_lost', 'pet_reward'];
    const petData = {};
    for (const field of petFields) {
      if (privacy[field] === true) {
        const value = profile[field];
        if (value !== null && value !== undefined && value !== '') {
          petData[field] = value;
        }
      }
    }
    if (Object.keys(petData).length > 0) {
      profileData.pet = petData;
    }
    if (profile.pet_lost) {
      profileData.lost_pet = true;
    }
  }

  const contacts = await db.query(
    'SELECT name, relationship, phone, email, display_phone, display_email FROM emergency_contacts WHERE profile_id = ? AND is_public = 1 ORDER BY id ASC',
    [profile.id]
  );
  const publicContacts = contacts.map((c) => ({
    name: c.name,
    relationship: c.relationship,
    ...(c.display_phone && c.phone ? { phone: c.phone } : {}),
    ...(c.display_email && c.email ? { email: c.email } : {}),
  }));
  if (publicContacts.length > 0) {
    profileData.contacts = publicContacts;
  }

  return profileData;
};

const getPublicProfile = async (req, res) => {
  const { identifier } = req.params;
  const idRows = await db.query(
    'SELECT i.*, p.user_id FROM identifiers i LEFT JOIN emergency_profiles p ON i.profile_id = p.id WHERE i.value = ?',
    [identifier]
  );
  const idRow = idRows[0];
  if (!idRow) {
    const pkgRows = await db.query(
      'SELECT status, user_id, origin FROM qr_inventory_packages WHERE value = ? LIMIT 1',
      [identifier]
    );
    const pkg = pkgRows[0];
    if (!pkg) {
      return res.status(404).json({ error: 'Identificador no encontrado', code: 'qr_not_found' });
    }
    return res.status(410).json({
      error: pkg.user_id
        ? 'Este QR está asignado pero todavía no tiene perfil público.'
        : 'Este código QR todavía no está asociado a un perfil de emergencia.',
      code: 'qr_not_assigned',
    });
  }
  if (idRow.status === 'pending_activation') {
    return res.status(410).json({ error: 'Este QR todavía no está activado.', code: 'qr_pending_activation' });
  }
  if (idRow.status === 'disabled') {
    return res.status(410).json({ error: 'Este QR está deshabilitado.', code: 'qr_disabled' });
  }
  if (idRow.status !== 'active') {
    return res.status(410).json({ error: 'Identificador inactivo', code: 'qr_inactive' });
  }
  if (!idRow.profile_id) {
    return res.status(410).json({ error: 'Identificador sin perfil asociado', code: 'qr_no_profile' });
  }

  const profiles = await db.query('SELECT * FROM emergency_profiles WHERE id = ?', [idRow.profile_id]);
  const profile = profiles[0];
  if (!profile || !profile.is_active) {
    return res.status(410).json({ error: 'Perfil desactivado', code: 'qr_profile_disabled' });
  }

  const privacy = await getPrivacyMapByProfile(profile.id);
  const profileData = await buildPublicProfileData(profile, privacy);

  const response = { status: 'active', profile: profileData };
  res.set('Cache-Control', 'private, no-store, max-age=0');
  return res.json(response);
};

const uploadPhoto = async (req, res) => {
  const userId = req.user.id;
  const { profile_id, photo_data } = (req.validated && req.validated.body) || {};
  if (!profile_id) {
    return res.status(400).json({ error: 'Se requiere el ID del perfil', code: 'missing_profile_id' });
  }
  const profile = await getProfileById(userId, profile_id);
  if (!profile) {
    return res.status(404).json({ error: 'Perfil no encontrado', code: 'profile_not_found' });
  }

  if (!photo_data) {
    return res.json({ photo_url: profile.photo_url });
  }

  const parsed = parsePhotoDataUrl(photo_data);
  if (!parsed) {
    return res.status(400).json({ error: 'Formato de imagen inválido. Usa JPEG, PNG o WebP.' });
  }
  if (!ALLOWED_PHOTO_MIME.includes(parsed.mime)) {
    return res.status(400).json({ error: 'Tipo de archivo no permitido.' });
  }
  if (parsed.buffer.length > MAX_PHOTO_BYTES) {
    return res.status(400).json({ error: 'La imagen supera el límite de 2 MB.' });
  }

  if (profile.photo_url && profile.photo_url.startsWith('/api/profiles/photo/')) {
    const oldName = path.basename(profile.photo_url);
    if (isSafePhotoFilename(oldName)) {
      await unlink(path.join(PHOTO_STORAGE_DIR, oldName)).catch(() => {});
    }
  }

  const fileName = `${crypto.randomBytes(16).toString('hex')}${parsed.ext}`;
  const filePath = path.join(PHOTO_STORAGE_DIR, fileName);
  await writeFile(filePath, parsed.buffer);

  const photoUrl = `/api/profiles/photo/${fileName}`;
  await db.query('UPDATE emergency_profiles SET photo_url = ? WHERE id = ?', [photoUrl, profile_id]);

  await db.query(
    'INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, metadata, ip_address) VALUES (?, ?, ?, ?, ?, ?)',
    [userId, 'profile.photo_upload', 'emergency_profiles', String(profile_id), JSON.stringify({ mime: parsed.mime, size: parsed.buffer.length }), req.ip]
  );

  return res.json({ photo_url: photoUrl });
};

const deletePhoto = async (req, res) => {
  const userId = req.user.id;
  const { profile_id } = (req.validated && req.validated.body) || {};
  if (!profile_id) {
    return res.status(400).json({ error: 'Se requiere el ID del perfil', code: 'missing_profile_id' });
  }
  const profile = await getProfileById(userId, profile_id);
  if (!profile) {
    return res.status(404).json({ error: 'Perfil no encontrado', code: 'profile_not_found' });
  }

  if (profile.photo_url && profile.photo_url.startsWith('/api/profiles/photo/')) {
    const oldName = path.basename(profile.photo_url);
    if (isSafePhotoFilename(oldName)) {
      await unlink(path.join(PHOTO_STORAGE_DIR, oldName)).catch(() => {});
    }
  }

  await db.query('UPDATE emergency_profiles SET photo_url = NULL WHERE id = ?', [profile_id]);
  await db.query(
    'INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, metadata, ip_address) VALUES (?, ?, ?, ?, ?, ?)',
    [userId, 'profile.photo_delete', 'emergency_profiles', String(profile_id), JSON.stringify({}), req.ip]
  );

  return res.json({ message: 'Fotografía eliminada' });
};

const servePhoto = async (req, res) => {
  const { filename } = req.params;
  if (!isSafePhotoFilename(filename)) {
    return res.status(404).json({ error: 'Fotografía no encontrada' });
  }
  const filePath = path.join(PHOTO_STORAGE_DIR, filename);
  let exists;
  try {
    await stat(filePath);
    exists = true;
  } catch { exists = false; }
  if (!exists) {
    return res.status(404).json({ error: 'Fotografía no encontrada' });
  }
  const profiles = await db.query('SELECT id, user_id FROM emergency_profiles WHERE photo_url = ?', [
    `/api/profiles/photo/${filename}`,
  ]);
  const profile = profiles[0];
  if (!profile) {
    return res.status(404).json({ error: 'Fotografía no encontrada' });
  }
  const viewerId = req.user && req.user.id;
  const isOwner = viewerId && viewerId === profile.user_id;
  let isPublic = false;
  if (!isOwner) {
    const privacy = await getPrivacyMapByProfile(profile.id);
    isPublic = privacy.photo_url === true;
  }
  if (!isOwner && !isPublic) {
    return res.status(404).json({ error: 'Fotografía no encontrada' });
  }
  const ext = path.extname(filename).toLowerCase();
  const contentType = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' }[ext] || 'application/octet-stream';
  res.set('Content-Type', contentType);
  res.set('Cache-Control', isPublic ? 'public, max-age=86400, immutable' : 'private, no-store');
  res.set('Content-Disposition', `inline; filename="${filename}"`);
  return res.sendFile(filePath);
};

module.exports = {
  listProfiles,
  getProfileById,
  createProfile,
  updateProfileById,
  deactivateProfile,
  reactivateProfile,
  getPrivacyMapByProfile,
  buildPublicProfileData,
  getPublicProfile,
  uploadPhoto,
  deletePhoto,
  servePhoto,
  PROFILE_TYPES,
};
