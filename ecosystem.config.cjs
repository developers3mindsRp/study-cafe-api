/**
 * PM2: one process per microservice (replaces a single "npm start" with concurrently).
 * Usage from repo root (after: npm run install:all, copy .env from .env.example and set secrets):
 *   pm2 start ecosystem.config.cjs
 */
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env'), override: true });

const { required, serviceUrl } = require('./shared/env');

const root = __dirname;
const logsDir = path.join(root, 'logs');
try {
  fs.mkdirSync(logsDir, { recursive: true });
} catch (_) {
  /* PM2 may still use ~/.pm2/logs if this fails */
}

const auth = serviceUrl('AUTH_SERVICE_URL');
const course = serviceUrl('COURSE_SERVICE_URL');
const order = serviceUrl('ORDER_SERVICE_URL');
const admin = serviceUrl('ADMIN_SERVICE_URL');
const platform = serviceUrl('PLATFORM_SERVICE_URL');
const downloads = serviceUrl('DOWNLOADS_SERVICE_URL');

const mysql = {
  MYSQL_HOST: required('MYSQL_HOST'),
  MYSQL_PORT: String(required('MYSQL_PORT')),
  MYSQL_USER: required('MYSQL_USER'),
  MYSQL_PASSWORD: required('MYSQL_PASSWORD'),
  MYSQL_DATABASE: required('MYSQL_DATABASE'),
};

function stripUndefined(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
}

const proc = {
  autorestart: true,
  max_restarts: 15,
  min_uptime: '5s',
  time: true,
  kill_timeout: 5000,
  watch: false,
  merge_logs: true,
  log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
};
   
function logFiles(name) {
  return {
    out_file: path.join(logsDir, `${name}.log`),
    error_file: path.join(logsDir, `${name}-error.log`),
  };
}

const prod = { NODE_ENV: 'production' };

const apps = [
  {
    name: 'studycafe-auth',
    cwd: path.join(root, 'services/auth-service'),
    script: 'src/server.js',
    ...proc,
    ...logFiles('auth'),
    env: stripUndefined({
      ...prod,
      ...mysql,
      PORT: '4001',
      REDIS_URL: required('REDIS_URL'),
      JWT_SECRET: required('JWT_SECRET'),
      JWT_REFRESH_SECRET: required('JWT_REFRESH_SECRET'),
      INTERNAL_API_KEY: required('INTERNAL_API_KEY'),
      COURSE_SERVICE_URL: course,
      PLATFORM_SERVICE_URL: platform,
    }),
  },
  {
    name: 'studycafe-course',
    cwd: path.join(root, 'services/course-service'),
    script: 'src/server.js',
    ...proc,
    ...logFiles('course'),
    env: stripUndefined({
      ...prod,
      ...mysql,
      PORT: '4002',
      AUTH_SERVICE_URL: auth,
      PUBLIC_SITE_URL: required('PUBLIC_SITE_URL'),
      CERTIFICATES_UPLOAD_DIR: process.env.CERTIFICATES_UPLOAD_DIR,
      INTERNAL_API_KEY: required('INTERNAL_API_KEY'),
    }),
  },
  {
    name: 'studycafe-order',
    cwd: path.join(root, 'services/order-service'),
    script: 'src/server.js',
    ...proc,
    ...logFiles('order'),
    env: stripUndefined({
      ...prod,
      ...mysql,
      PORT: '4003',
      REDIS_URL: required('REDIS_URL'),
      AUTH_SERVICE_URL: auth,
      COURSE_SERVICE_URL: course,
      PLATFORM_SERVICE_URL: platform,
      ADMIN_SERVICE_URL: admin,
      INTERNAL_API_KEY: required('INTERNAL_API_KEY'),
      RAZORPAY_KEY_ID: required('RAZORPAY_KEY_ID'),
      RAZORPAY_KEY_SECRET: required('RAZORPAY_KEY_SECRET'),
      RAZORPAY_WEBHOOK_SECRET: required('RAZORPAY_WEBHOOK_SECRET'),
    }),
  },
  {
    name: 'studycafe-platform',
    cwd: path.join(root, 'services/platform-service'),
    script: 'src/server.js',
    ...proc,
    ...logFiles('platform'),
    env: stripUndefined({
      ...prod,
      ...mysql,
      PORT: '4005',
      REDIS_URL: required('REDIS_URL'),
      JWT_SECRET: required('JWT_SECRET'),
      INTERNAL_API_KEY: required('INTERNAL_API_KEY'),
      ASSETS_BASE_URL: required('ASSETS_BASE_URL'),
      UPLOADS_DIR: process.env.UPLOADS_DIR,
      PUBLIC_BASE_URL: required('PUBLIC_BASE_URL'),
    }),
  },
  {
    name: 'studycafe-platform-worker',
    cwd: path.join(root, 'services/platform-service'),
    script: 'src/workers/article-publish-worker.js',
    ...proc,
    ...logFiles('platform-worker'),
    env: stripUndefined({
      ...prod,
      ...mysql,
      REDIS_URL: required('REDIS_URL'),
    }),
  },
  {
    name: 'studycafe-admin',
    cwd: path.join(root, 'services/admin-service'),
    script: 'src/server.js',
    ...proc,
    ...logFiles('admin'),
    env: stripUndefined({
      ...prod,
      ...mysql,
      PORT: '4004',
      AUTH_SERVICE_URL: auth,
      COURSE_SERVICE_URL: course,
      ORDER_SERVICE_URL: order,
      PLATFORM_SERVICE_URL: platform,
      INTERNAL_API_KEY: required('INTERNAL_API_KEY'),
      FRONTEND_URL: required('FRONTEND_URL'),
    }),
  },
  {
    name: 'studycafe-downloads',
    cwd: path.join(root, 'services/downloads-service'),
    script: 'src/server.js',
    ...proc,
    ...logFiles('downloads'),
    env: stripUndefined({
      ...prod,
      ...mysql,
      PORT: '4006',
      AUTH_SERVICE_URL: auth,
      INTERNAL_API_KEY: required('INTERNAL_API_KEY'),
    }),
  },
  {
    name: 'studycafe-gateway',
    cwd: path.join(root, 'services/api-gateway'),
    script: 'src/server.js',
    ...proc,
    ...logFiles('gateway'),
    env: stripUndefined({
      ...prod,
      PORT: '3000',
      REDIS_URL: required('REDIS_URL'),
      AUTH_SERVICE_URL: auth,
      COURSE_SERVICE_URL: course,
      ORDER_SERVICE_URL: order,
      ADMIN_SERVICE_URL: admin,
      PLATFORM_SERVICE_URL: platform,
      DOWNLOADS_SERVICE_URL: downloads,
      INTERNAL_API_KEY: required('INTERNAL_API_KEY'),
    }),
  },
];

module.exports = { apps };
