const packageService = require('./package.service');

const listPackages = async (req, res) => packageService.listPackages(req, res);
const getPackage = async (req, res) => packageService.getPackage(req, res);
const createPackage = async (req, res) => packageService.createPackage(req, res);
const updatePackage = async (req, res) => packageService.updatePackage(req, res);
const deletePackage = async (req, res) => packageService.deletePackage(req, res);
const getPriceHistory = async (req, res) => packageService.getPriceHistory(req, res);

module.exports = {
  listPackages,
  getPackage,
  createPackage,
  updatePackage,
  deletePackage,
  getPriceHistory,
};
