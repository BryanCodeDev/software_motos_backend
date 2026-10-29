const authService = require('./auth.service');

const register = async (req, res) => authService.register(req, res);
const login = async (req, res) => authService.login(req, res);
const me = async (req, res) => authService.me(req, res);
const refresh = async (req, res) => authService.refresh(req, res);
const logout = async (req, res) => authService.logout(req, res);
const forgotPassword = async (req, res) => authService.forgotPassword(req, res);
const resetPassword = async (req, res) => authService.resetPassword(req, res);

module.exports = {
  register,
  login,
  me,
  refresh,
  logout,
  forgotPassword,
  resetPassword,
};

