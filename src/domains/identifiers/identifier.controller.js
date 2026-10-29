const identifierService = require('./identifier.service');

const createIdentifier = async (req, res) => identifierService.createIdentifier(req, res);
const getMyIdentifier = async (req, res) => identifierService.getMyIdentifier(req, res);
const deactivateIdentifier = async (req, res) => identifierService.deactivateIdentifier(req, res);
const replaceIdentifier = async (req, res) => identifierService.replaceIdentifier(req, res);
const downloadQr = async (req, res) => identifierService.downloadQr(req, res);

module.exports = {
  createIdentifier,
  getMyIdentifier,
  deactivateIdentifier,
  replaceIdentifier,
  downloadQr,
};

