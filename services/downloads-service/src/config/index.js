const {
  required,
  requiredInt,
  mysqlConfig,
  serviceUrl,
} = require('../../../../shared/env');

module.exports = {
  port: requiredInt('PORT'),
  serviceName: 'downloads-service',
  internalApiKey: required('INTERNAL_API_KEY'),
  authServiceUrl: serviceUrl('AUTH_SERVICE_URL'),
  mysql: mysqlConfig(),
};

process.env.SERVICE_NAME = module.exports.serviceName;
