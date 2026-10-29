const adminService = require('./admin.service');

const dashboardStats = async (req, res) => adminService.dashboardStats(req, res);
const listOrders = async (req, res) => adminService.listOrders(req, res);
const updateOrderStatus = async (req, res) => adminService.updateOrderStatus(req, res);
const auditLogs = async (req, res) => adminService.auditLogs(req, res);
const bootstrapAdmin = async (req, res) => adminService.bootstrapAdmin(req, res);
const listUsers = async (req, res) => adminService.listUsers(req, res);
const getUser = async (req, res) => adminService.getUser(req, res);
const updateUserRole = async (req, res) => adminService.updateUserRole(req, res);

module.exports = {
  dashboardStats,
  listOrders,
  updateOrderStatus,
  auditLogs,
  bootstrapAdmin,
  listUsers,
  getUser,
  updateUserRole,
};

