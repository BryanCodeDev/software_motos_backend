const orderService = require('./order.service');

const listOrders = async (req, res) => orderService.listOrders(req, res);
const getOrder = async (req, res) => orderService.getOrder(req, res);
const createOrder = async (req, res) => orderService.createOrder(req, res);

module.exports = {
  listOrders,
  getOrder,
  createOrder,
};

