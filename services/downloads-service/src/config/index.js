module.exports = {
  port: parseInt(process.env.PORT || '4006', 10),
  serviceName: 'downloads-service',
  internalApiKey: process.env.INTERNAL_API_KEY || '',
  mysql: {
    host: process.env.MYSQL_HOST || 'localhost',
    port: parseInt(process.env.MYSQL_PORT || '3306', 10),
    user: process.env.MYSQL_USER || 'studycafe_user',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'studycafe_db',
    connectionLimit: 10,
    queueLimit: 0,
    waitForConnections: true,
  },
};
