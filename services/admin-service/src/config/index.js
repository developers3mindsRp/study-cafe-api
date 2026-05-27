const {
  required,
  requiredInt,
  mysqlConfig,
  serviceUrl,
} = require('../../../../shared/env');

module.exports = {
  port: requiredInt('PORT'),
  serviceName: 'admin-service',
  mysql: mysqlConfig(),
  authServiceUrl: serviceUrl('AUTH_SERVICE_URL'),
  courseServiceUrl: serviceUrl('COURSE_SERVICE_URL'),
  orderServiceUrl: serviceUrl('ORDER_SERVICE_URL'),
  platformServiceUrl: serviceUrl('PLATFORM_SERVICE_URL'),
  internalApiKey: required('INTERNAL_API_KEY'),
  frontendUrl: required('FRONTEND_URL'),
};

process.env.SERVICE_NAME = module.exports.serviceName;
