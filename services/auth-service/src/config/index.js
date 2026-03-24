module.exports = {
  port: parseInt(process.env.PORT || '4001', 10),
  serviceName: 'auth-service',
  mysql: {
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: parseInt(process.env.MYSQL_PORT || '3307', 10),
    user: process.env.MYSQL_USER || 'studycafe_user',
    password: process.env.MYSQL_PASSWORD || 'studycafe_pass',
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
  cacheTtl: parseInt(process.env.CACHE_TTL || '300', 10),
  internalApiKey: process.env.INTERNAL_API_KEY || '',
  /** Used to hydrate course titles for /user/courses */
  courseServiceUrl: process.env.COURSE_SERVICE_URL || 'http://localhost:4002',
};
