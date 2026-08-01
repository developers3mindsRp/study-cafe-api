const {
  required,
  requiredInt,
  optionalInt,
  mysqlConfig,
  serviceUrl,
} = require('../../../../shared/env');

module.exports = {
  port: requiredInt('PORT'),
  serviceName: 'auth-service',
  mysql: mysqlConfig(),
  redis: {
    url: required('REDIS_URL'),
  },
  jwt: {
    secret: required('JWT_SECRET'),
    refreshSecret: required('JWT_REFRESH_SECRET'),
    expiry: required('JWT_EXPIRY'),
    refreshExpiry: required('REFRESH_EXPIRY'),
  },
  otpPepper: required('OTP_PEPPER'),
  otpTtlSeconds: requiredInt('OTP_TTL_SECONDS'),
  loginOtpMaxPerHour: requiredInt('LOGIN_OTP_RATE_PER_HOUR'),
  /** Optional — quick signup falls back to LOGIN_OTP_RATE_PER_HOUR when unset. */
  quickRegisterMaxPerHour: optionalInt('QUICK_REGISTER_RATE_PER_HOUR'),
  smtp: {
    host: required('SMTP_HOST'),
    port: requiredInt('SMTP_PORT'),
    secure: required('SMTP_SECURE') === 'true',
    user: required('SMTP_USER'),
    pass: required('SMTP_PASS'),
    from: required('SMTP_FROM'),
  },
  cacheTtl: requiredInt('CACHE_TTL'),
  internalApiKey: required('INTERNAL_API_KEY'),
  courseServiceUrl: serviceUrl('COURSE_SERVICE_URL'),
  platformServiceUrl: serviceUrl('PLATFORM_SERVICE_URL'),
  publicSiteUrl: required('PUBLIC_SITE_URL').replace(/\/+$/, ''),
};

process.env.SERVICE_NAME = module.exports.serviceName;
