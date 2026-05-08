/**
 * PM2: one process per microservice (replaces a single "npm start" with concurrently).
 * Usage from repo root (after: npm run install:all, copy .env from .env.example and set secrets):
 *   pm2 start ecosystem.config.cjs
 *   pm2 status
 *   pm2 logs
 *   pm2 delete ecosystem.config.cjs
 *
 * Environment: loads ./.env via dotenv. You can also export variables before `pm2 start`.
 * Override inter-service URLs with AUTH_SERVICE_URL, etc., or set INTERNAL_SERVICE_HOST=127.0.0.1
 * to default all service base URLs at once.
 *
 * `override: true` — dotenv normally does not override variables already in the process (e.g. MYSQL_USER=root
 * left in the PM2/shell environment). The repo .env should win so production uses the intended DB user and host.
 */
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env'), override: true });

const root = __dirname;
const logsDir = path.join(root, 'logs');
try {
  fs.mkdirSync(logsDir, { recursive: true });
} catch (_) {
  /* PM2 may still use ~/.pm2/logs if this fails */
}

const h = process.env.INTERNAL_SERVICE_HOST || '127.0.0.1';
const auth = process.env.AUTH_SERVICE_URL || `http://${h}:4001`;
const course = process.env.COURSE_SERVICE_URL || `http://${h}:4002`;
const order = process.env.ORDER_SERVICE_URL || `http://${h}:4003`;
const admin = process.env.ADMIN_SERVICE_URL || `http://${h}:4004`;
const platform = process.env.PLATFORM_SERVICE_URL || `http://${h}:4005`;
const downloads = process.env.DOWNLOADS_SERVICE_URL || `http://${h}:4006`;

const mysql = {
  MYSQL_HOST: process.env.MYSQL_HOST || '127.0.0.1',
  MYSQL_PORT: process.env.MYSQL_PORT || '3306',
  MYSQL_USER: process.env.MYSQL_USER || 'studycafe_user',
  MYSQL_PASSWORD: process.env.MYSQL_PASSWORD,
  MYSQL_DATABASE: process.env.MYSQL_DATABASE || 'studycafe_db',
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
      REDIS_URL: process.env.REDIS_URL || 'redis://127.0.0.1:6379',
      JWT_SECRET: process.env.JWT_SECRET,
      JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET,
      INTERNAL_API_KEY: process.env.INTERNAL_API_KEY,
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
      PUBLIC_SITE_URL: process.env.PUBLIC_SITE_URL,
      CERTIFICATES_UPLOAD_DIR: process.env.CERTIFICATES_UPLOAD_DIR,
      INTERNAL_API_KEY: process.env.INTERNAL_API_KEY,
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
      REDIS_URL: process.env.REDIS_URL || 'redis://127.0.0.1:6379',
      AUTH_SERVICE_URL: auth,
      COURSE_SERVICE_URL: course,
      PLATFORM_SERVICE_URL: platform,
      ADMIN_SERVICE_URL: admin,
      INTERNAL_API_KEY: process.env.INTERNAL_API_KEY,
      RAZORPAY_KEY_ID: process.env.RAZORPAY_KEY_ID,
      RAZORPAY_KEY_SECRET: process.env.RAZORPAY_KEY_SECRET,
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
      REDIS_URL: process.env.REDIS_URL || 'redis://127.0.0.1:6379',
      JWT_SECRET: process.env.JWT_SECRET,
      INTERNAL_API_KEY: process.env.INTERNAL_API_KEY,
      ASSETS_BASE_URL: process.env.ASSETS_BASE_URL,
      UPLOADS_DIR: process.env.UPLOADS_DIR,
      PUBLIC_BASE_URL: process.env.PUBLIC_BASE_URL,
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
      REDIS_URL: process.env.REDIS_URL || 'redis://127.0.0.1:6379',
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
      INTERNAL_API_KEY: process.env.INTERNAL_API_KEY,
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
      INTERNAL_API_KEY: process.env.INTERNAL_API_KEY,
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
      REDIS_URL: process.env.REDIS_URL || 'redis://127.0.0.1:6379',
      AUTH_SERVICE_URL: auth,
      COURSE_SERVICE_URL: course,
      ORDER_SERVICE_URL: order,
      ADMIN_SERVICE_URL: admin,
      PLATFORM_SERVICE_URL: platform,
      DOWNLOADS_SERVICE_URL: downloads,
      INTERNAL_API_KEY: process.env.INTERNAL_API_KEY,
    }),
  },
];

module.exports = { apps };
