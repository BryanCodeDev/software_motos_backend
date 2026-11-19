const identifierService = require('./identifier.service');

const getMyIdentifier = async (req, res) => identifierService.getMyIdentifier(req, res);
const deactivateIdentifier = async (req, res) => identifierService.deactivateIdentifier(req, res);
const replaceIdentifier = async (req, res) => identifierService.replaceIdentifier(req, res);
const downloadQr = async (req, res) => identifierService.downloadQr(req, res);
const getQrImage = async (req, res) => identifierService.getQrImage(req, res);
const getIdentifierDetail = async (req, res) => identifierService.getIdentifierDetail(req, res);
const exportQrsCsv = async (req, res) => identifierService.exportQrsCsv(req, res);
const exportQrsZip = async (req, res) => identifierService.exportQrsZip(req, res);
const exportQrsPdf = async (req, res) => identifierService.exportQrsPdf(req, res);
const recordScan = async (req, res) => {
  const { identifier_value, result } = req.body || {};
  const crypto = require('crypto');
  const ipHash = req.ip ? crypto.createHash('sha256').update(req.ip).digest('hex').slice(0, 16) : null;
  const outcome = await identifierService.recordScan({
    identifierValue: identifier_value,
    result,
    ipHash,
    userAgent: req.get('User-Agent') || null,
  });
  return res.json({ recorded: outcome.recorded });
};

module.exports = {
  getMyIdentifier,
  deactivateIdentifier,
  replaceIdentifier,
  downloadQr,
  getQrImage,
  getIdentifierDetail,
  exportQrsCsv,
  exportQrsZip,
  exportQrsPdf,
  recordScan,
};
