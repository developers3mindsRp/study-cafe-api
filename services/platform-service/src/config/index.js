module.exports = {
  port: parseInt(process.env.PORT || '4005', 10),
  serviceName: 'platform-service',
  /** Same secret as auth-service JWT for optional Bearer parsing on public article routes. */
  jwt: {
    secret: process.env.JWT_SECRET || 'studycafe-jwt-secret',
  },
  mysql: {
    host: process.env.MYSQL_HOST || 'localhost',
    port: parseInt(process.env.MYSQL_PORT || '3306', 10),
    user: process.env.MYSQL_USER || 'studycafe_user',
    password: process.env.MYSQL_PASSWORD || 'GDZ@p84i-F2X',
    database: process.env.MYSQL_DATABASE || 'studycafe_db',
    connectionLimit: 10,
    queueLimit: 0,
    waitForConnections: true,
  },
  internalApiKey: process.env.INTERNAL_API_KEY || '',
  smtp: {
    host: process.env.SMTP_HOST || '',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || 'no-reply@studycafe.local',
  },
  publicBaseUrl: process.env.PUBLIC_BASE_URL || 'http://localhost:3000',
};
