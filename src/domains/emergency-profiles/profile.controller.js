const profileService = require('./profile.service');

const getProfile = async (req, res) => profileService.getProfile(req, res);
const updateProfile = async (req, res) => profileService.updateProfile(req, res);
const getPrivacy = async (req, res) => profileService.getPrivacy(req, res);
const updatePrivacy = async (req, res) => profileService.updatePrivacy(req, res);
const getPublicProfile = async (req, res) => profileService.getPublicProfile(req, res);
const uploadPhoto = async (req, res) => profileService.uploadPhoto(req, res);
const deletePhoto = async (req, res) => profileService.deletePhoto(req, res);
const servePhoto = async (req, res) => profileService.servePhoto(req, res);

module.exports = {
  getProfile,
  updateProfile,
  getPrivacy,
  updatePrivacy,
  getPublicProfile,
  uploadPhoto,
  deletePhoto,
  servePhoto,
};
