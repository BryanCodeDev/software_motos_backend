const identifierService = require('../identifiers/identifier.service');
const db = require('../../config/db');

const handleServiceResult = (res, result, defaultStatus = 200) => {
  if (result && result.error) {
    return res.status(result.status || 500).json({ error: result.error, code: result.error });
  }
  return res.status(defaultStatus).json(result);
};

const listQrs = async (req, res) => {
  const result = await identifierService.listQrsAdmin(req.query);
  return res.json(result);
};

const qrStats = async (req, res) => {
  const result = await identifierService.qrStats();
  return res.json(result);
};

const createQr = async (req, res) => {
  const actorId = req.user && req.user.id ? req.user.id : null;
  const result = await identifierService.createQr({ actorId, ipAddress: req.ip });
  return handleServiceResult(res, result, 201);
};

const linkQr = async (req, res) => {
  const { qr_id, user_id } = req.validated.body || {};
  const actorId = req.user && req.user.id ? req.user.id : null;
  const result = await identifierService.linkQrToUser({
    qrId: qr_id,
    userId: user_id,
    actorId,
    ipAddress: req.ip,
  });
  return handleServiceResult(res, result, 200);
};

const unlinkQr = async (req, res) => {
  const { qr_id } = req.validated.body || {};
  const actorId = req.user && req.user.id ? req.user.id : null;
  const result = await identifierService.unlinkQrFromUser({
    qrId: qr_id,
    actorId,
    ipAddress: req.ip,
  });
  return handleServiceResult(res, result, 200);
};

const setPrintStatus = async (req, res) => {
  const { id } = req.validated.params || {};
  const { print_status } = req.validated.body || {};
  const actorId = req.user && req.user.id ? req.user.id : null;
  const result = await identifierService.setQrPrintStatus({
    qrId: id,
    printStatus: print_status,
    actorId,
    ipAddress: req.ip,
  });
  return handleServiceResult(res, result, 200);
};

const archiveQr = async (req, res) => {
  const { id } = req.validated.params || {};
  const { reason, force } = req.body || {};
  const actorId = req.user && req.user.id ? req.user.id : null;
  const result = await identifierService.archiveQr({
    qrId: id,
    actorId,
    reason,
    ipAddress: req.ip,
    force: force === true,
  });
  return handleServiceResult(res, result, 200);
};

const setQrStatus = async (req, res) => {
  const { id } = req.validated.params || {};
  const { status } = req.validated.body || {};
  const actorId = req.user && req.user.id ? req.user.id : null;
  const result = await identifierService.setQrStatus({
    qrId: id,
    status,
    actorId,
    ipAddress: req.ip,
  });
  return handleServiceResult(res, result, 200);
};

const deleteQr = async (req, res) => {
  const { id } = req.validated.params || {};
  const { force } = req.body || {};
  const actorId = req.user && req.user.id ? req.user.id : null;
  const result = await identifierService.deleteQr({
    qrId: id,
    actorId,
    ipAddress: req.ip,
    force: force === true,
  });
  return handleServiceResult(res, result, 200);
};

const activateQr = async (req, res) => {
  const { id } = req.validated.params || {};
  const actorId = req.user && req.user.id ? req.user.id : null;
  const result = await identifierService.setQrStatus({
    qrId: id,
    status: 'active',
    actorId,
    ipAddress: req.ip,
  });
  return handleServiceResult(res, result, 200);
};

const deactivateQr = async (req, res) => {
  const { id } = req.validated.params || {};
  const actorId = req.user && req.user.id ? req.user.id : null;
  const result = await identifierService.setQrStatus({
    qrId: id,
    status: 'disabled',
    actorId,
    ipAddress: req.ip,
  });
  return handleServiceResult(res, result, 200);
};

const bulkSetQrStatus = async (req, res) => {
  const { qr_ids, status } = req.validated.body || {};
  const actorId = req.user && req.user.id ? req.user.id : null;
  const allowed = ['active', 'disabled'];
  if (!allowed.includes(status)) {
    return res.status(400).json({ error: 'Estado inválido', code: 'invalid_status' });
  }
  if (!Array.isArray(qr_ids) || qr_ids.length === 0) {
    return res.status(400).json({ error: 'Se requieren identificadores de QR', code: 'missing_qr_ids' });
  }

  let ok = 0;
  let fail = 0;
  const errors = [];
  for (const qrId of qr_ids) {
    try {
      const result = await identifierService.setQrStatus({
        qrId,
        status,
        actorId,
        ipAddress: req.ip,
      });
      if (result.error) {
        fail += 1;
        errors.push({ qr_id: qrId, error: result.error });
      } else {
        ok += 1;
      }
    } catch {
      fail += 1;
      errors.push({ qr_id: qrId, error: 'server_error' });
    }
  }
  return res.status(200).json({
    ok,
    fail,
    errors,
    message: `${ok} QR ${status === 'active' ? 'activados' : 'desactivados'}${fail ? `, ${fail} fallaron` : ''}`,
  });
};

const bulkDeleteQr = async (req, res) => {
  const { qr_ids, force } = req.validated.body || {};
  const actorId = req.user && req.user.id ? req.user.id : null;
  if (!Array.isArray(qr_ids) || qr_ids.length === 0) {
    return res.status(400).json({ error: 'Se requieren identificadores de QR', code: 'missing_qr_ids' });
  }

  let ok = 0;
  let fail = 0;
  const errors = [];
  for (const qrId of qr_ids) {
    try {
      const result = await identifierService.deleteQr({
        qrId,
        actorId,
        ipAddress: req.ip,
        force: force === true,
      });
      if (result.error) {
        fail += 1;
        errors.push({ qr_id: qrId, error: result.error });
      } else {
        ok += 1;
      }
    } catch {
      fail += 1;
      errors.push({ qr_id: qrId, error: 'server_error' });
    }
  }
  return res.status(200).json({
    ok,
    fail,
    errors,
    message: `${ok} QR eliminado${ok !== 1 ? 's' : ''}${fail ? `, ${fail} fallaron` : ''}`,
  });
};

const bulkPrintStatus = async (req, res) => {
  const { qr_ids, print_status } = req.validated.body || {};
  const actorId = req.user && req.user.id ? req.user.id : null;
  const result = await identifierService.bulkUpdatePrintStatus({
    qr_ids,
    print_status,
    actorId,
    ipAddress: req.ip,
  });
  return handleServiceResult(res, result, 200);
};

const bulkSetDesign = async (req, res) => {
  const { qr_ids, design_id } = req.validated.body || {};
  const actorId = req.user && req.user.id ? req.user.id : null;
  if (!Array.isArray(qr_ids) || qr_ids.length === 0) {
    return res.status(400).json({ error: 'Se requieren identificadores de QR', code: 'missing_qr_ids' });
  }

  // Validar que el diseño exista (si se proporciona uno).
  if (design_id !== null && design_id !== undefined) {
    const [designRows] = await db.query('SELECT id FROM product_designs WHERE id = ? AND is_available = 1 LIMIT 1', [design_id]);
    if (!designRows.length) {
      return res.status(404).json({ error: 'Diseño no disponible', code: 'design_not_available' });
    }
  }

  const conn = await db.getConnection();
  try {
    await conn.query('START TRANSACTION');

    const idList = qr_ids.map((x) => parseInt(x, 10)).filter((x) => Number.isFinite(x));
    if (idList.length === 0) {
      await conn.query('ROLLBACK');
      return res.status(400).json({ error: 'Identificadores de QR inválidos', code: 'invalid_qr_ids' });
    }

    const placeholders = idList.map(() => '?').join(',');
    const [rows] = await conn.query(
      `SELECT id, user_id, status, print_status, archived_at FROM identifiers WHERE id IN (${placeholders}) FOR UPDATE`,
      idList
    );

    let ok = 0;
    let fail = 0;
    const errors = [];
    const accepted = [];

    for (const qr of rows) {
      if (qr.archived_at) {
        fail += 1;
        errors.push({ qr_id: qr.id, error: 'qr_archived' });
        continue;
      }
      // No reasignar diseño a QRs ya entregados/impresos sin force (evitar inconsistencia de producción).
      if (qr.print_status === 'delivered') {
        fail += 1;
        errors.push({ qr_id: qr.id, error: 'qr_delivered_cannot_change_design' });
        continue;
      }

      await conn.query(
        'UPDATE identifiers SET design_id = ?, updated_at = NOW() WHERE id = ?',
        [design_id !== null && design_id !== undefined ? design_id : null, qr.id]
      );

      await conn.query(
        'INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, metadata, ip_address) VALUES (?, ?, ?, ?, ?, ?)',
        [actorId, 'admin.qr.design_assign', 'identifiers', String(qr.id), JSON.stringify({ design_id, previous_design_id: null }), req.ip]
      );

      ok += 1;
      accepted.push({ qr_id: qr.id, design_id });
    }

    await conn.query('COMMIT');

    return res.json({
      ok,
      fail,
      errors,
      accepted,
      message: `${ok} QR asignado${ok !== 1 ? 's' : ''} con diseño${fail ? `, ${fail} fallaron` : ''}`,
    });
  } catch {
    await conn.query('ROLLBACK').catch(() => {});
    return res.status(500).json({ error: 'No se pudo asignar el diseño', code: 'server_error' });
  } finally {
    conn.release();
  }
};

const exportByIds = async (req, res, format) => {
  const { ids } = req.query;
  if (!ids) {
    return res.status(400).json({ error: 'Faltan identificadores de QR', code: 'missing_ids' });
  }
  const idList = ids.split(',').map((x) => parseInt(x, 10)).filter((x) => !Number.isNaN(x));
  if (idList.length === 0) {
    return res.status(400).json({ error: 'Identificadores inválidos', code: 'invalid_ids' });
  }

  if (format === 'csv') {
    const result = await identifierService.exportQrsByIdsCsv(idList);
    if (result.error) {
      return res.status(result.status || 500).json({ error: result.error, code: result.error });
    }
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', 'attachment; filename="qrs-produccion.csv"');
    res.set('Cache-Control', 'private, no-store');
    return res.send(result.csv);
  }

  if (format === 'zip') {
    return identifierService.exportQrsByIdsZip(idList, res);
  }

  if (format === 'pdf') {
    return identifierService.exportQrsByIdsPdf(idList, res, req.query);
  }

  return res.status(400).json({ error: 'Formato no soportado', code: 'format_not_supported' });
};

module.exports = {
  listQrs,
  qrStats,
  createQr,
  linkQr,
  unlinkQr,
  setPrintStatus,
  archiveQr,
  setQrStatus,
  activateQr,
  deactivateQr,
  deleteQr,
  bulkSetQrStatus,
  bulkDeleteQr,
  bulkPrintStatus,
  bulkSetDesign,
  exportByIds,
};
