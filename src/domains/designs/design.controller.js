const designService = require('./design.service');

const listDesigns = async (req, res) => designService.listDesigns(req, res);
const adminListDesigns = async (req, res) => designService.adminListDesigns(req, res);
const updateDesign = async (req, res) => designService.updateDesign(req, res);

module.exports = {
  listDesigns,
  adminListDesigns,
  updateDesign,
};
