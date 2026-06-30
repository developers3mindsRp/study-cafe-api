'use strict';

const { AsyncLocalStorage } = require('async_hooks');
const { isQueryLoggingEnabled } = require('./config');
const { sanitizeUnknown } = require('./LogSanitizer');

const asyncLocalStorage = new AsyncLocalStorage();

function runWithQueryContext(fn) {
  return asyncLocalStorage.run({ queries: [] }, fn);
}

function getCollectedQueries() {
  const store = asyncLocalStorage.getStore();
  if (!store || !Array.isArray(store.queries)) return [];
  return store.queries;
}

function attachQueryCollector(sequelize) {
  if (!sequelize || sequelize._apiRequestLoggerHookAttached) return;
  if (!isQueryLoggingEnabled()) return;

  sequelize.addHook('beforeQuery', (options) => {
    options._apiRequestLoggerStartedAt = Date.now();
  });

  sequelize.addHook('afterQuery', (_options, query) => {
    const store = asyncLocalStorage.getStore();
    if (!store) return;

    const startedAt = _options?._apiRequestLoggerStartedAt;
    const executionTimeMs =
      typeof startedAt === 'number' ? Math.max(0, Date.now() - startedAt) : null;

    store.queries.push({
      sql: typeof query?.sql === 'string' ? query.sql : String(query?.sql || ''),
      bindings: sanitizeUnknown(Array.isArray(query?.bind) ? query.bind : query?.bind ?? null),
      execution_time_ms: executionTimeMs,
    });
  });

  sequelize._apiRequestLoggerHookAttached = true;
}

module.exports = {
  runWithQueryContext,
  getCollectedQueries,
  attachQueryCollector,
};
