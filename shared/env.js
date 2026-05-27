'use strict';

const path = require('path');
const dotenv = require('dotenv');

let loaded = false;

/** Load repo-root .env once (does not override existing process.env). */
function loadRootEnv() {
  if (loaded) return;
  dotenv.config({ path: path.resolve(__dirname, '../.env') });
  loaded = true;
}

loadRootEnv();

function required(name) {
  const v = process.env[name];
  if (v === undefined || v === null || String(v).trim() === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return String(v).trim();
}

function requiredInt(name) {
  const n = parseInt(required(name), 10);
  if (!Number.isFinite(n)) {
    throw new Error(`Invalid integer for environment variable ${name}`);
  }
  return n;
}

/** Integer env var may be unset (returns undefined). No fallback values. */
function optionalInt(name) {
  const raw = readOptional(name);
  if (raw === undefined) return undefined;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) {
    throw new Error(`Invalid integer for environment variable ${name}`);
  }
  return n;
}

function requiredBool(name) {
  const v = required(name).toLowerCase();
  if (v === 'true' || v === '1') return true;
  if (v === 'false' || v === '0') return false;
  throw new Error(`Invalid boolean for environment variable ${name}: ${v}`);
}

/** Env var may be unset (returns undefined). No fallback values. */
function readOptional(name) {
  const v = process.env[name];
  if (v === undefined || v === null || String(v).trim() === '') {
    return undefined;
  }
  return String(v).trim();
}

function mysqlConfig(overrides = {}) {
  return {
    host: required('MYSQL_HOST'),
    port: requiredInt('MYSQL_PORT'),
    user: required('MYSQL_USER'),
    password: required('MYSQL_PASSWORD'),
    database: required('MYSQL_DATABASE'),
    connectionLimit: requiredInt('MYSQL_POOL_SIZE'),
    queueLimit: 0,
    waitForConnections: true,
    ...overrides,
  };
}

function migrationSrcConfig() {
  return {
    host: required('MIGRATION_SRC_HOST'),
    port: requiredInt('MIGRATION_SRC_PORT'),
    user: required('MIGRATION_SRC_USER'),
    password: required('MIGRATION_SRC_PASSWORD'),
    database: required('MIGRATION_SRC_DATABASE'),
  };
}

function migrationTgtConfig() {
  return {
    host: required('MIGRATION_TGT_HOST'),
    port: requiredInt('MIGRATION_TGT_PORT'),
    user: required('MIGRATION_TGT_USER'),
    password: required('MIGRATION_TGT_PASSWORD'),
    database: required('MIGRATION_TGT_DATABASE'),
  };
}

function serviceUrl(envName) {
  return required(envName).replace(/\/+$/, '');
}

module.exports = {
  loadRootEnv,
  required,
  requiredInt,
  optionalInt,
  requiredBool,
  readOptional,
  mysqlConfig,
  migrationSrcConfig,
  migrationTgtConfig,
  serviceUrl,
};
