const db = require('../../config/db');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { promisify } = require('util');
const emailService = require('../../domains/email/email.service');
const config = require('../../config');

const writeFile = promisify(fs.writeFile);
const unlink = promisify(fs.unlink);
const stat = promisify(fs.stat);

const PUBLIC_FIELDS = [
  'display_name',
  'photo_url',
  'blood_type',
  'allergies',
  'medical_conditions',
  'medications',
  'additional_info',
  'emergency_note',
];

const PUBLIC_PROFILE_FIELDS = ['display_name', 'photo_url', 'blood_type', 'additional_info', 'emergency_note'];
const PUBLIC_MEDICAL_FIELDS = ['allergies', 'medical_conditions', 'medications'];

const PHOTO_STORAGE_DIR = path.join(__dirname, '..', '..', 'storage', 'photos');
const MAX_PHOTO_BYTES = 2 * 1024 * 1024; // 2 MB
const ALLOWED_PHOTO_MIME = ['image/jpeg', 'image/png', 'image/webp'];
const EXT_BY_MIME = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };

fs.mkdirSync(PHOTO_STORAGE_DIR, { recursive: true });

const isSafePhotoFilename = (filename) => /^[A-Za-z0-9_-]+\.(jpg|png|webp)$/.test(filename);

const parsePhotoDataUrl = (dataUrl) => {
  if (!dataUrl) return null;
  const match = String(dataUrl).match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/);
  if (!match) return null;
  const mime = match[1] === 'jpeg' ? 'image/jpeg' : `image/${match[1]}`;
  const buffer = Buffer.from(match[2], 'base64');
  return { mime, buffer, ext: EXT_BY_MIME[mime] };
};

const getOrCreateProfile = async (userId) => {
  let rows = await db.query(
    'SELECT * FROM emergency_profiles WHERE user_id = ?',
    [userId]
  );
  if (rows.length === 0) {
    try {
      const result = await db.query(
        'INSERT INTO emergency_profiles (user_id, display_name, is_active) VALUES (?, ?, 0)',
        [userId, '']
      );
      const newId = result.insertId;
      for (const field of PUBLIC_FIELDS) {
        try {
          await db.query(
            'INSERT INTO privacy_settings (profile_id, field_name, is_public) VALUES (?, ?, 0)',
            [newId, field]
          );
        } catch (err) {
          // ignore duplicates
        }
      }
      rows = await db.query('SELECT * FROM emergency_profiles WHERE id = ?', [
        newId,
      ]);
    } catch (err) {
      // If duplicate due to race condition, fetch the existing one
      if (err.code === 'ER_DUP_ENTRY') {
        rows = await db.query(
          'SELECT * FROM emergency_profiles WHERE user_id = ?',
          [userId]
        );
      } else {
        throw err;
      }
    }
  }
  return rows[0];
};

const getPrivacyMap = async (profileId) => {
  const rows = await db.query(
    'SELECT field_name, is_public FROM privacy_settings WHERE profile_id = ?',
    [profileId]
  );
  const map = {};
  rows.forEach((r) => {
    map[r.field_name] = r.is_public === 1;
  });
  return map;
};

const getProfile = async (req, res) => {
  const profile = await getOrCreateProfile(req.user.id);
  const privacy = await getPrivacyMap(profile.id);
  const contacts = await db.query(
    'SELECT id, name, relationship, phone, email, is_public, display_phone, display_email FROM emergency_contacts WHERE profile_id = ? AND is_public = 1 ORDER BY id ASC',
    [profile.id]
  );
  const identifiers = await db.query(
    'SELECT id, value, status, created_at FROM identifiers WHERE user_id = ? ORDER BY created_at DESC',
    [req.user.id]
  );
  return res.json({
    profile: { ...profile, privacy },
    contacts,
    identifiers,
  });
};

const getPrivacy = async (req, res) => {
  const profile = await getOrCreateProfile(req.user.id);
  const privacy = await getPrivacyMap(profile.id);
  const settings = Object.entries(privacy).map(([field_name, is_public]) => ({ field_name, is_public }));
  return res.json({ settings });
};

const updateProfile = async (req, res) => {
  const { user } = req;
  const {
    display_name,
    photo_url,
    blood_type,
    allergies,
    medical_conditions,
    medications,
    additional_info,
    emergency_note,
  } = req.validated.body;

  const profile = await getOrCreateProfile(user.id);

  await db.query(
    `UPDATE emergency_profiles
     SET display_name = COALESCE(?, display_name),
         photo_url = COALESCE(?, photo_url),
         blood_type = COALESCE(?, blood_type),
         allergies = COALESCE(?, allergies),
         medical_conditions = COALESCE(?, medical_conditions),
         medications = COALESCE(?, medications),
         additional_info = COALESCE(?, additional_info),
         emergency_note = COALESCE(?, emergency_note)
     WHERE id = ?`,
    [
      display_name,
      photo_url,
      blood_type,
      allergies,
      medical_conditions,
      medications,
      additional_info,
      emergency_note,
      profile.id,
    ]
  );

  await db.query(
    'INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, metadata, ip_address) VALUES (?, ?, ?, ?, ?, ?)',
    [user.id, 'profile.update', 'emergency_profiles', String(profile.id), JSON.stringify({}), req.ip]
  );

  return res.json({ message: 'Perfil actualizado' });
};

const updatePrivacy = async (req, res) => {
  const { settings } = req.validated.body;
  const profile = await getOrCreateProfile(req.user.id);

  const conn = await db.getConnection();
  try {
    await conn.query('START TRANSACTION');
    for (const [field, isPublic] of Object.entries(settings)) {
      await conn.query(
        `INSERT INTO privacy_settings (profile_id, field_name, is_public) VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE is_public = VALUES(is_public)`,
        [profile.id, field, isPublic ? 1 : 0]
      );
    }
    await conn.query(
      'UPDATE emergency_profiles SET consent_updated_at = NOW() WHERE id = ?',
      [profile.id]
    );
    await conn.query(
      'INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, metadata, ip_address) VALUES (?, ?, ?, ?, ?, ?)',
      [req.user.id, 'privacy.update', 'emergency_profiles', String(profile.id), JSON.stringify({ fieldCount: Object.keys(settings).length }), req.ip]
    );
    await conn.query('COMMIT');
  } catch (error) {
    await conn.query('ROLLBACK');
    throw error;
  } finally {
    conn.release();
  }

  return res.json({ message: 'Configuración de privacidad actualizada' });
};

const getPublicProfile = async (req, res) => {
  const { identifier } = req.params;
  const idRows = await db.query(
    'SELECT i.*, p.user_id FROM identifiers i LEFT JOIN emergency_profiles p ON i.profile_id = p.id WHERE i.value = ?',
    [identifier]
  );
  const idRow = idRows[0];
  if (!idRow) {
    return res.status(404).json({ error: 'Identificador no encontrado' });
  }
  if (idRow.status !== 'active') {
    return res.status(410).json({ error: 'Identificador inactivo' });
  }
  if (!idRow.profile_id) {
    return res.status(410).json({ error: 'Identificador sin perfil asociado' });
  }

  const profiles = await db.query(
    'SELECT * FROM emergency_profiles WHERE id = ?',
    [idRow.profile_id]
  );
  const profile = profiles[0];
  if (!profile || !profile.is_active) {
    return res.status(410).json({ error: 'Perfil desactivado' });
  }

  const privacy = await getPrivacyMap(profile.id);

  // Lista permitida estricta: ningún campo privado se incluye, ni siquiera como
  // null, vacío, indicador o metadato.
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

  const response = {
    status: 'active',
    profile: profileData,
  };

  res.set('Cache-Control', 'private, no-store, max-age=0');
  return res.json(response);
};

const uploadPhoto = async (req, res) => {
  const userId = req.user.id;
  const { photo_data } = (req.validated && req.validated.body) || {};
  const profile = await getOrCreateProfile(userId);

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

  // Reemplazar foto anterior si es local.
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
  await db.query('UPDATE emergency_profiles SET photo_url = ? WHERE id = ?', [photoUrl, profile.id]);

  await db.query(
    'INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, metadata, ip_address) VALUES (?, ?, ?, ?, ?, ?)',
    [userId, 'profile.photo_upload', 'emergency_profiles', String(profile.id), JSON.stringify({ mime: parsed.mime, size: parsed.buffer.length }), req.ip]
  );

  return res.json({ photo_url: photoUrl });
};

const deletePhoto = async (req, res) => {
  const userId = req.user.id;
  const profile = await getOrCreateProfile(userId);

  if (profile.photo_url && profile.photo_url.startsWith('/api/profiles/photo/')) {
    const oldName = path.basename(profile.photo_url);
    if (isSafePhotoFilename(oldName)) {
      await unlink(path.join(PHOTO_STORAGE_DIR, oldName)).catch(() => {});
    }
  }

  await db.query('UPDATE emergency_profiles SET photo_url = NULL WHERE id = ?', [profile.id]);

  await db.query(
    'INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, metadata, ip_address) VALUES (?, ?, ?, ?, ?, ?)',
    [userId, 'profile.photo_delete', 'emergency_profiles', String(profile.id), JSON.stringify({}), req.ip]
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
  } catch {
    exists = false;
  }
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
    const privacy = await getPrivacyMap(profile.id);
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
  getProfile,
  updateProfile,
  getPrivacy,
  updatePrivacy,
  getPublicProfile,
  uploadPhoto,
  deletePhoto,
  servePhoto,
};



