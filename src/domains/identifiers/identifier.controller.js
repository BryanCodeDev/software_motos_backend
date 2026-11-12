const identifierService = require('./identifier.service');

const createIdentifier = async (req, res) => identifierService.createIdentifier(req, res);
const getMyIdentifier = async (req, res) => identifierService.getMyIdentifier(req, res);
const deactivateIdentifier = async (req, res) => identifierService.deactivateIdentifier(req, res);
const replaceIdentifier = async (req, res) => identifierService.replaceIdentifier(req, res);
const downloadQr = async (req, res) => identifierService.downloadQr(req, res);
const getQrImage = async (req, res) => identifierService.getQrImage(req, res);
const getIdentifierDetail = async (req, res) => identifierService.getIdentifierDetail(req, res);
const exportQrsCsv = async (req, res) => identifierService.exportQrsCsv(req, res);
const exportQrsZip = async (req, res) => identifierService.exportQrsZip(req, res);
const exportQrsPdf = async (req, res) => identifierService.exportQrsPdf(req, res);
const bulkUpdatePrintStatus = async (req, res) => identifierService.bulkUpdatePrintStatus(req, res);

module.exports = {
  createIdentifier,
  getMyIdentifier,
  deactivateIdentifier,
  replaceIdentifier,
  downloadQr,
  getQrImage,
  getIdentifierDetail,
  exportQrsCsv,
  exportQrsZip,
  exportQrsPdf,
  bulkUpdatePrintStatus,
};
