const adminService = require('./admin.service');
const orderService = require('../orders/order.service');

const dashboardStats = async (req, res) => adminService.dashboardStats(req, res);
const dashboardAlerts = async (req, res) => adminService.dashboardAlerts(req, res);
const listPayments = async (req, res) => adminService.listPayments(req, res);
const scanMetrics = async (req, res) => adminService.scanMetrics(req, res);
const listOrders = async (req, res) => orderService.adminListOrders(req, res);
const getOrder = async (req, res) => orderService.adminGetOrder(req, res);
const updateOrderStatus = async (req, res) => orderService.adminUpdateOrderStatus(req, res);
const updateOrderCarrier = async (req, res) => orderService.adminUpdateOrderCarrier(req, res);
const resendOrderEmail = async (req, res) => orderService.adminResendOrderEmail(req, res);
const auditLogs = async (req, res) => adminService.auditLogs(req, res);
const bootstrapAdmin = async (req, res) => adminService.bootstrapAdmin(req, res);
const listUsers = async (req, res) => adminService.listUsers(req, res);
const getUser = async (req, res) => adminService.getUser(req, res);
const updateUserRole = async (req, res) => adminService.updateUserRole(req, res);
const suspendUser = async (req, res) => adminService.suspendUser(req, res);
const reactivateUser = async (req, res) => adminService.reactivateUser(req, res);
const verifyUser = async (req, res) => adminService.verifyUser(req, res);
const listAllProfiles = async (req, res) => adminService.listAllProfiles(req, res);

module.exports = {
  dashboardStats,
  dashboardAlerts,
  listPayments,
  scanMetrics,
  listAllProfiles,
  listOrders,
  getOrder,
  updateOrderStatus,
  updateOrderCarrier,
  resendOrderEmail,
  auditLogs,
  bootstrapAdmin,
  listUsers,
  getUser,
  updateUserRole,
  suspendUser,
  reactivateUser,
  verifyUser,
};
