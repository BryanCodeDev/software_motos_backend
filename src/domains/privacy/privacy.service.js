const db = require('../../config/db');

const { consentRecordSchema } = require('./privacy.schema');

const DEFAULT_TERMS_VERSION = process.env.TERMS_VERSION || '1.0';
const DEFAULT_PRIVACY_VERSION = process.env.PRIVACY_VERSION || '1.0';

const recordConsent = async (userId, { documentType, documentVersion, accepted, purpose, method, ipAddress, userAgent }) => {
  await db.query(
    `INSERT INTO consent_records
      (user_id, document_type, document_version, accepted, purpose, method, ip_address, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [userId, documentType, documentVersion || null, accepted === true ? 1 : 0, purpose || null, method, ipAddress || null, userAgent || null]
  );
};

const getConsentHistory = async (userId) => {
  const rows = await db.query(
    `SELECT id, document_type, document_version, accepted, purpose, method, ip_address, created_at
     FROM consent_records
     WHERE user_id = ?
     ORDER BY created_at DESC`,
    [userId]
  );
  return rows;
};

const getLatestConsent = async (userId, documentType) => {
  const rows = await db.query(
    `SELECT document_version, accepted, created_at
     FROM consent_records
     WHERE user_id = ? AND document_type = ?
     ORDER BY created_at DESC
     LIMIT 1`,
    [userId, documentType]
  );
  return rows[0] || null;
};

const hasAccepted = async (userId, documentType, version) => {
  const latest = await getLatestConsent(userId, documentType);
  return latest && latest.accepted === 1 && latest.document_version === version;
};

const createDataRequest = async (userId, { requestType, details }) => {
  const result = await db.query(
    `INSERT INTO data_requests (user_id, request_type, status, details)
     VALUES (?, ?, 'pending', ?)`,
    [userId, requestType, details || null]
  );
  return result.insertId;
};

const listMyDataRequests = async (userId) => {
  const rows = await db.query(
    `SELECT id, request_type, status, details, response, created_at, updated_at, responded_at
     FROM data_requests
     WHERE user_id = ?
     ORDER BY created_at DESC`,
    [userId]
  );
  return rows;
};

const listAllDataRequests = async () => {
  const rows = await db.query(
    `SELECT dr.id, dr.user_id, u.email, dr.request_type, dr.status, dr.details, dr.response,
             dr.created_at, dr.updated_at, dr.responded_at
     FROM data_requests dr
     LEFT JOIN users u ON dr.user_id = u.id
     ORDER BY dr.created_at DESC
     LIMIT 200`
  );
  return rows;
};

const respondToDataRequest = async (requestId, adminUserId, { status, response }) => {
  const existing = await db.query('SELECT id FROM data_requests WHERE id = ?', [requestId]);
  if (existing.length === 0) {
    return null;
  }

  await db.query(
    `UPDATE data_requests
     SET status = ?, response = ?, responded_by = ?, responded_at = NOW(), updated_at = NOW()
     WHERE id = ?`,
    [status, response || null, adminUserId, requestId]
  );
  return { id: requestId, status, response, responded_by: adminUserId };
};

const recordPrivacySettingsChange = async (userId, ipAddress, userAgent) => {
  const latestPrivacy = await getLatestConsent(userId, 'privacy');
  const latestTerms = await getLatestConsent(userId, 'terms');

  await db.query(
    `INSERT INTO consent_records
      (user_id, document_type, document_version, accepted, purpose, method, ip_address, user_agent)
     VALUES (?, 'privacy', ?, 1, 'Actualización de configuración de visibilidad del perfil desde el centro de privacidad', 'privacy_center', ?, ?)`,
    [userId, latestPrivacy ? latestPrivacy.document_version : DEFAULT_PRIVACY_VERSION, ipAddress || null, userAgent || null]
  );

  if (latestTerms) {
    await db.query(
      `INSERT INTO consent_records
        (user_id, document_type, document_version, accepted, purpose, method, ip_address, user_agent)
       VALUES (?, 'terms', ?, 1, 'Reafirmación de aceptación de Términos y Condiciones al modificar privacidad', 'privacy_center', ?, ?)`,
      [userId, latestTerms.document_version, ipAddress || null, userAgent || null]
    );
  }
};

module.exports = {
  recordConsent,
  getConsentHistory,
  getLatestConsent,
  hasAccepted,
  createDataRequest,
  listMyDataRequests,
  listAllDataRequests,
  respondToDataRequest,
  recordPrivacySettingsChange,
  DEFAULT_TERMS_VERSION,
  DEFAULT_PRIVACY_VERSION,
};
