'use strict';

const SENSITIVE_KEYS = new Set([
  'password',
  'confirm_password',
  'token',
  'access_token',
  'refresh_token',
  'authorization',
  'api_key',
  'secret',
  'otp',
  'credit_card',
  'cvv',
]);

const MASK = '********';

function isSensitiveKey(key) {
  if (typeof key !== 'string') return false;
  const normalized = key.trim().toLowerCase().replace(/-/g, '_');
  if (SENSITIVE_KEYS.has(normalized)) return true;
  return [...SENSITIVE_KEYS].some((s) => normalized.includes(s));
}

function sanitizeValue(value, key) {
  if (key && isSensitiveKey(key)) return MASK;
  return sanitizeUnknown(value);
}

function sanitizeUnknown(value) {
  if (value == null) return value;
  if (Array.isArray(value)) return value.map((item) => sanitizeUnknown(item));
  if (typeof value !== 'object') return value;

  const out = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = isSensitiveKey(k) ? MASK : sanitizeUnknown(v);
  }
  return out;
}

function sanitizeHeaders(headers) {
  if (!headers || typeof headers !== 'object') return {};
  const out = {};
  for (const [key, value] of Object.entries(headers)) {
    out[key] = isSensitiveKey(key) ? MASK : value;
  }
  return out;
}

function truncatePayload(value, maxBytes) {
  if (value == null) return null;
  const str = typeof value === 'string' ? value : safeStringify(value);
  if (Buffer.byteLength(str, 'utf8') <= maxBytes) return str;
  let truncated = str;
  while (truncated.length > 0 && Buffer.byteLength(`${truncated}...(truncated)`, 'utf8') > maxBytes) {
    truncated = truncated.slice(0, Math.floor(truncated.length * 0.9));
  }
  return `${truncated}...(truncated)`;
}

function safeStringify(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function serializeBody(body, maxBytes) {
  if (body == null) return null;
  if (typeof body === 'string') return truncatePayload(body, maxBytes);
  if (Buffer.isBuffer(body)) return truncatePayload(body.toString('utf8'), maxBytes);
  return truncatePayload(sanitizeUnknown(body), maxBytes);
}

function sanitizeQueryParams(query) {
  if (!query || typeof query !== 'object') return {};
  return sanitizeUnknown(query);
}

module.exports = {
  MASK,
  isSensitiveKey,
  sanitizeValue,
  sanitizeUnknown,
  sanitizeHeaders,
  sanitizeQueryParams,
  truncatePayload,
  serializeBody,
  safeStringify,
};
