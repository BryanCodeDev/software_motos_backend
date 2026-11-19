const privacyService = require('./privacy.service');
const db = require('../../config/db');

const recordConsent = async (req, res) => {
  const { user } = req;
  const { document_type, document_version, accepted, purpose, method } = req.validated.body;

  await privacyService.recordConsent(user.id, {
    documentType: document_type,
    documentVersion: document_version,
    accepted,
    purpose,
    method,
    ipAddress: req.ip,
    userAgent: req.get('User-Agent') || null,
  });

  await dbAudit(req, 'consent.record', 'consent_records', '0', {
    document_type,
    document_version,
    accepted,
    purpose,
    method,
  });

  return res.json({ message: 'Consentimiento registrado' });
};

const getConsentHistory = async (req, res) => {
  const { user } = req;
  const history = await privacyService.getConsentHistory(user.id);
  return res.json({ consents: history });
};

const getConsentStatus = async (req, res) => {
  const { user } = req;
  const terms = await privacyService.getLatestConsent(user.id, 'terms');
  const privacy = await privacyService.getLatestConsent(user.id, 'privacy');
  const dataProcessing = await privacyService.getLatestConsent(user.id, 'data_processing');
  const sensitiveData = await privacyService.getLatestConsent(user.id, 'sensitive_data');
  const notifications = await privacyService.getLatestConsent(user.id, 'notifications');

  return res.json({
    terms: terms ? { version: terms.document_version, accepted: terms.accepted === 1, created_at: terms.created_at } : null,
    privacy: privacy ? { version: privacy.document_version, accepted: privacy.accepted === 1, created_at: privacy.created_at } : null,
    data_processing: dataProcessing ? { version: dataProcessing.document_version, accepted: dataProcessing.accepted === 1, created_at: dataProcessing.created_at } : null,
    sensitive_data: sensitiveData ? { version: sensitiveData.document_version, accepted: sensitiveData.accepted === 1, created_at: sensitiveData.created_at } : null,
    notifications: notifications ? { version: notifications.document_version, accepted: notifications.accepted === 1, created_at: notifications.created_at } : null,
  });
};

const getPrivacySettings = async (req, res) => {
  const { user } = req;
  // Obtener los perfiles del usuario y sus configuraciones de privacidad
  const profiles = await db.query(
    'SELECT id, profile_type, display_name FROM emergency_profiles WHERE user_id = ?',
    [user.id]
  );
  const settings = [];
  for (const profile of profiles) {
    const rows = await db.query(
      'SELECT field_name, is_public FROM privacy_settings WHERE profile_id = ?',
      [profile.id]
    );
    for (const r of rows) {
      settings.push({
        profile_id: profile.id,
        profile_type: profile.profile_type,
        display_name: profile.display_name,
        field_name: r.field_name,
        is_public: r.is_public === 1,
      });
    }
  }
  return res.json({ settings });
};

const createDataRequest = async (req, res) => {
  const { user } = req;
  const { request_type, details } = req.validated.body;

  const id = await privacyService.createDataRequest(user.id, { requestType: request_type, details });

  await dbAudit(req, 'data_request.create', 'data_requests', String(id), {
    request_type,
    details,
  });

  return res.status(201).json({ message: 'Solicitud registrada', id });
};

const listMyDataRequests = async (req, res) => {
  const { user } = req;
  const requests = await privacyService.listMyDataRequests(user.id);
  return res.json({ requests });
};

const listAllDataRequests = async (req, res) => {
  const requests = await privacyService.listAllDataRequests();
  return res.json({ requests });
};

const respondToDataRequest = async (req, res) => {
  const { id } = req.params;
  const { status, response } = req.validated.body;
  const result = await privacyService.respondToDataRequest(Number(id), req.user.id, { status, response });

  if (!result) {
    return res.status(404).json({ error: 'Solicitud no encontrada' });
  }

  await dbAudit(req, 'data_request.respond', 'data_requests', id, { status, response });

  return res.json({ message: 'Solicitud atendida', request: result });
};

const dbAudit = async (req, action, entityType, entityId, metadata) => {
  const db = require('../../config/db');
  await db.query(
    'INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, metadata, ip_address) VALUES (?, ?, ?, ?, ?, ?)',
    [req.user.id, action, entityType, String(entityId), JSON.stringify(metadata || {}), req.ip]
  );
};

module.exports = {
  recordConsent,
  getConsentHistory,
  getConsentStatus,
  getPrivacySettings,
  createDataRequest,
  listMyDataRequests,
  listAllDataRequests,
  respondToDataRequest,
};
