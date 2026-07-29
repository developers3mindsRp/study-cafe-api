'use strict';

const path = require('path');
const dotenv = require('dotenv');

let loaded = false;

const REPO_ROOT = path.resolve(__dirname, '..');

/**
 * Which env file to load, in priority order:
 *   1. ENV_FILE=<path>      — explicit override (absolute, or relative to repo root)
 *   2. APP_ENV=production   — .env.production  (real prod DB / SMTP / gateway)
 *   3. default              — .env             (local development)
 *
 * Selection is deliberately explicit: nothing points at production unless the
 * caller asks for it by name, so a plain `npm run dev` can never reach prod.
 */
function resolveEnvFile() {
  const explicit = (process.env.ENV_FILE || '').trim();
  if (explicit) {
    return path.isAbsolute(explicit) ? explicit : path.resolve(REPO_ROOT, explicit);
  }
  const appEnv = (process.env.APP_ENV || '').trim().toLowerCase();
  if (appEnv === 'production' || appEnv === 'prod') {
    return path.resolve(REPO_ROOT, '.env.production');
  }
  return path.resolve(REPO_ROOT, '.env');
}

/**
 * Load the resolved env file once. Does not override vars already present in
 * process.env, so shell / npm-script values (PORT, APP_ENV, …) always win.
 */
function loadRootEnv() {
  if (loaded) return;
  const envFile = resolveEnvFile();
  const result = dotenv.config({ path: envFile });
  loaded = true;

  if (result.error && (process.env.ENV_FILE || process.env.APP_ENV)) {
    // A caller explicitly asked for a specific env file — failing silently here
    // would fall through to confusing "Missing required environment variable"
    // errors, or worse, a half-configured process.
    throw new Error(`Could not load env file: ${envFile} (${result.error.message})`);
  }

  // Loud, unmissable banner whenever a process is pointed at production.
  if (path.basename(envFile) !== '.env') {
    const target = process.env.MYSQL_DATABASE || 'unknown';
    const host = process.env.MYSQL_HOST || 'unknown';
    process.stderr.write(
      `\n\x1b[41m\x1b[97m ⚠  NON-LOCAL ENV: ${path.basename(envFile)} \x1b[0m\n` +
        `\x1b[33m   DB   : ${host}/${target}\n` +
        `   SMTP : ${process.env.SMTP_HOST || 'unset'} (real email may be delivered)\n` +
        `   Writes hit this database for real. Ctrl-C now if unintended.\x1b[0m\n\n`
    );
  }
}

loadRootEnv();

function required(name) {
  const v = process.env[name];
  if (v === undefined || v === null || String(v).trim() === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  const trimmed = String(v).trim();
  // Unfilled template placeholder — surface it here rather than let a service boot
  // with a literal "REPLACE_ME" host/secret and fail confusingly at first use.
  if (trimmed === 'REPLACE_ME') {
    throw new Error(`Environment variable ${name} is still the placeholder REPLACE_ME — fill it in.`);
  }
  return trimmed;
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
  resolveEnvFile,
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
