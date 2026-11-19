const profileService = require('./profile.service');

const listProfiles = async (req, res) => {
  const profiles = await profileService.listProfiles(req.user.id);
  return res.json({ profiles });
};

const getProfile = async (req, res) => {
  const { profileId } = req.params;
  const profile = await profileService.getProfileById(req.user.id, profileId);
  if (!profile) {
    return res.status(404).json({ error: 'Perfil no encontrado', code: 'profile_not_found' });
  }
  const privacy = await profileService.getPrivacyMapByProfile(profile.id);
  return res.json({ profile: { ...profile, privacy } });
};

const createProfile = async (req, res) => {
  const result = await profileService.createProfile({
    userId: req.user.id,
    data: req.validated.body,
    ipAddress: req.ip,
  });
  if (result.error) {
    return res.status(result.status).json({ error: result.error, code: result.error, detail: result.detail });
  }
  return res.status(201).json({ profile: result.profile, message: 'Perfil creado' });
};

const updateProfile = async (req, res) => {
  const { profileId } = req.params;
  const result = await profileService.updateProfileById({
    userId: req.user.id,
    profileId,
    data: req.validated.body,
    ipAddress: req.ip,
  });
  if (result.error) {
    return res.status(result.status).json({ error: result.error, code: result.error });
  }
  return res.json({ profile: result.profile, message: 'Perfil actualizado' });
};

const deactivateProfile = async (req, res) => {
  const { profileId } = req.params;
  const result = await profileService.deactivateProfile({
    userId: req.user.id,
    profileId,
    ipAddress: req.ip,
  });
  if (result.error) {
    return res.status(result.status).json({ error: result.error, code: result.error });
  }
  return res.json({ message: result.message });
};

const reactivateProfile = async (req, res) => {
  const { profileId } = req.params;
  const result = await profileService.reactivateProfile({
    userId: req.user.id,
    profileId,
    ipAddress: req.ip,
  });
  if (result.error) {
    return res.status(result.status).json({ error: result.error, code: result.error });
  }
  return res.json({ message: result.message });
};

const uploadPhoto = async (req, res) => profileService.uploadPhoto(req, res);
const deletePhoto = async (req, res) => profileService.deletePhoto(req, res);
const servePhoto = async (req, res) => profileService.servePhoto(req, res);
const getPublicProfile = async (req, res) => profileService.getPublicProfile(req, res);

module.exports = {
  listProfiles,
  getProfile,
  createProfile,
  updateProfile,
  deactivateProfile,
  reactivateProfile,
  uploadPhoto,
  deletePhoto,
  servePhoto,
  getPublicProfile,
};
