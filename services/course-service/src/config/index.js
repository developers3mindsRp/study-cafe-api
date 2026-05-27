const {
  required,
  requiredInt,
  mysqlConfig,
  serviceUrl,
} = require('../../../../shared/env');

module.exports = {
  port: requiredInt('PORT'),
  serviceName: 'course-service',
  authServiceUrl: serviceUrl('AUTH_SERVICE_URL'),
  internalApiKey: required('INTERNAL_API_KEY'),
  mysql: mysqlConfig(),
};

process.env.SERVICE_NAME = module.exports.serviceName;
