const identifierService = require('../identifiers/identifier.service');

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
  linkQr,
  unlinkQr,
  setPrintStatus,
  exportByIds,
};
