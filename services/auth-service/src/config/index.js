module.exports = {
  port: parseInt(process.env.PORT || '4001', 10),
  serviceName: 'auth-service',
  mysql: {
    host: process.env.MYSQL_HOST || '168.144.1.14',
    port: parseInt(process.env.MYSQL_PORT || '3306', 10),
    user: process.env.MYSQL_USER || 'studycafe_user',
    password: process.env.MYSQL_PASSWORD || 'GDZ@p84i-F2X',
    database: process.env.MYSQL_DATABASE || 'studycafe_db',
    connectionLimit: 10,
    queueLimit: 0,
    waitForConnections: true,
  },
  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
  },
  jwt: {
    secret: process.env.JWT_SECRET || 'studycafe-jwt-secret',
    refreshSecret: process.env.JWT_REFRESH_SECRET || 'studycafe-refresh-secret',
    expiry: process.env.JWT_EXPIRY || '1h',
    refreshExpiry: process.env.REFRESH_EXPIRY || '7d',
  },
  /** Signed into OTP HMAC — keep stable in production */
  otpPepper: process.env.OTP_PEPPER || process.env.JWT_SECRET || 'studycafe-otp-pepper',
  otpTtlSeconds: parseInt(process.env.OTP_TTL_SECONDS || '600', 10),
  loginOtpMaxPerHour: parseInt(process.env.LOGIN_OTP_RATE_PER_HOUR || '10', 10),
  smtp: {
    host: process.env.SMTP_HOST || '',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || 'no-reply@studycafe.local',
  },
  cacheTtl: parseInt(process.env.CACHE_TTL || '300', 10),
  internalApiKey: process.env.INTERNAL_API_KEY || 'dev-internal',
  /** Used to hydrate course titles for /user/courses */
  courseServiceUrl: process.env.COURSE_SERVICE_URL || 'http://localhost:4002',
  /** Used to resolve plan course lists for membership courses */
  platformServiceUrl: process.env.PLATFORM_SERVICE_URL || 'http://localhost:4005',
  /** Public website URL for email CTAs (same as newsletter links) */
  publicSiteUrl: (process.env.PUBLIC_SITE_URL || 'https://studycafe.in').replace(/\/+$/, ''),
};
