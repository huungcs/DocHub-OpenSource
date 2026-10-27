const handler = require('../src/server/organization-api').createApi();
module.exports = handler;
module.exports.config = {
  api: {
    bodyParser: false,
    responseLimit: false
  }
};
