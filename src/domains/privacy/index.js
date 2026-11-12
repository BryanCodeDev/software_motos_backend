module.exports = {
  recordConsent: require('./privacy.controller').recordConsent,
  getConsentHistory: require('./privacy.controller').getConsentHistory,
  getConsentStatus: require('./privacy.controller').getConsentStatus,
  createDataRequest: require('./privacy.controller').createDataRequest,
  listMyDataRequests: require('./privacy.controller').listMyDataRequests,
  listAllDataRequests: require('./privacy.controller').listAllDataRequests,
  respondToDataRequest: require('./privacy.controller').respondToDataRequest,
};
