const {
  required,
  requiredInt,
  optionalInt,
  mysqlConfig,
  serviceUrl,
} = require('../../../../shared/env');

/** Env override with a built-in default — these are tuning knobs, not deployment secrets. */
function limit(name, fallback) {
  const v = optionalInt(name);
  return v === undefined ? fallback : v;
}

module.exports = {
  port: requiredInt('PORT'),
  serviceName: 'course-service',
  authServiceUrl: serviceUrl('AUTH_SERVICE_URL'),
  internalApiKey: required('INTERNAL_API_KEY'),
  /** Used to build the claim-page URL sent in the certificate email. */
  publicSiteUrl: required('PUBLIC_SITE_URL').replace(/\/+$/, ''),
  mysql: mysqlConfig(),

  /**
   * Throttle buckets for the PUBLIC certificate claim endpoint (unauthenticated, mints serials).
   * Every bucket counts NEW identities created, not repeat downloads — a repeat claim dedupes on
   * (link_id, email_norm) and short-circuits before any throttle work, so honest re-downloads are
   * never blocked. Enforced in publicCertificateLink.service.js against the claims tables.
   */
  certificateClaim: {
    maxPerIpHour: limit('CERT_CLAIM_MAX_PER_IP_HOUR', 10),
    maxPerIpDay: limit('CERT_CLAIM_MAX_PER_IP_DAY', 30),
    maxPerLinkMinute: limit('CERT_CLAIM_MAX_PER_LINK_MIN', 20),
    maxPerEmailDay: limit('CERT_CLAIM_MAX_PER_EMAIL_DAY', 5),
    maxEmailsPerPhoneDay: limit('CERT_CLAIM_MAX_EMAILS_PER_PHONE_DAY', 5),
  },
};

process.env.SERVICE_NAME = module.exports.serviceName;
