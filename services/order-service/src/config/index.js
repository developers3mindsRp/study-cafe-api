module.exports = {
  port: parseInt(process.env.PORT || '4003', 10),
  serviceName: 'order-service',
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
  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
  },
  authServiceUrl: process.env.AUTH_SERVICE_URL || 'http://localhost:4001',
  courseServiceUrl: process.env.COURSE_SERVICE_URL || 'http://localhost:4002',
  platformServiceUrl: process.env.PLATFORM_SERVICE_URL || 'http://localhost:4005',
  adminServiceUrl: process.env.ADMIN_SERVICE_URL || 'http://localhost:4004',
  platformServiceUrl: process.env.PLATFORM_SERVICE_URL || 'http://localhost:4005',
  internalApiKey: process.env.INTERNAL_API_KEY || '',
  razorpay: {
    keyId: process.env.RAZORPAY_KEY_ID || 'rzp_test_Se6xiUO30POWCb',
    keySecret: process.env.RAZORPAY_KEY_SECRET || 'WhuT8NpFxKnH4PXV02Kp2vkE',
    webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET || '0a90a3a99c5352a941e53758a21f0e9229cfe86cf97d8962dd11a9ad2777f1d2',
  },
  outbox: {
    pollMs: parseInt(process.env.OUTBOX_POLL_MS || '5000', 10),
  },
};
