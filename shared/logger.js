const SERVICE_NAME = process.env.SERVICE_NAME || 'app';
const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const LOG_LEVEL = LEVELS[process.env.LOG_LEVEL] ?? LEVELS.debug;

function formatMeta(meta) {
    if (!meta || Object.keys(meta).length === 0) return '';
    try {
        return ' ' + JSON.stringify(meta);
    } catch {
        return ' [unserializable]';
    }
}

function log(level, message, meta) {
    if (LEVELS[level] < LOG_LEVEL) return;

    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] [${SERVICE_NAME}] [${level.toUpperCase()}]`;
    const line = `${prefix} ${message}${formatMeta(meta)}`;

    if (level === 'error') {
        console.error(line);
    } else if (level === 'warn') {
        console.warn(line);
    } else {
        console.log(line);
    }
}

const logger = {
    debug: (msg, meta) => log('debug', msg, meta),
    info: (msg, meta) => log('info', msg, meta),
    warn: (msg, meta) => log('warn', msg, meta),
    error: (msg, meta) => log('error', msg, meta),

    /** Express middleware — logs each request */
    requestLogger(req, res, next) {
        const start = Date.now();
        res.on('finish', () => {
            const duration = Date.now() - start;
            log('info', `${req.method} ${req.originalUrl} ${res.statusCode}`, {
                duration: `${duration}ms`,
                ip: req.ip,
            });
        });
        next();
    },
};

module.exports = { logger };
