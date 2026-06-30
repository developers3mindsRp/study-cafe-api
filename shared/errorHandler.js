/**
 * Shared Express Error Handler
 *
 * Classifies errors and returns appropriate HTTP responses.
 * Must be the LAST middleware registered with app.use().
 *
 * All error responses follow the envelope:
 *   { success: false, error: "message", details?: [...] }
 *
 * Handles:
 *   - AppError          → returns statusCode + message
 *   - Joi Validation    → 400 with field-level details
 *   - SequelizeUnique   → 409 Conflict
 *   - SequelizeValid    → 400 Bad Request
 *   - SequelizeForeignKey → 400 Bad Request (invalid reference)
 *   - SequelizeDatabaseError → often 400/413 (e.g. value too large for column)
 *   - JWT errors        → 401 Unauthorized
 *   - Axios errors      → forwards upstream status + message
 *   - Request too large → 413 (express body limit)
 *   - Unknown           → 500 (never leaks stack to client)
 */

const { logger } = require('./logger');

function errorHandler(err, req, res, _next) {
    req._apiLogException = {
        message: err?.message || 'Unknown error',
        stack: err?.stack || null,
    };

    // 1. AppError — expected operational error
    if (err.isOperational) {
        const body = { success: false, error: err.message };
        if (err.details) body.details = err.details;
        return res.status(err.statusCode).json(body);
    }

    // 2. Joi ValidationError (if thrown directly, not via validate middleware)
    if (err.isJoi || err.name === 'ValidationError') {
        const details =
            err.details?.map((d) => ({
                field: d.path?.join('.') || 'unknown',
                message: d.message,
            })) || [];
        const msg = details.map((d) => d.message).join('; ') || err.message;
        return res.status(400).json({ success: false, error: msg, details });
    }

    // 3. Sequelize unique constraint (duplicate email, etc.)
    if (err.name === 'SequelizeUniqueConstraintError') {
        const field = err.errors?.[0]?.path || 'field';
        return res.status(409).json({ success: false, error: `Duplicate value for ${field}` });
    }

    // 4. Sequelize validation error (missing required, wrong type, etc.)
    if (err.name === 'SequelizeValidationError') {
        const messages = err.errors?.map((e) => e.message) || ['Validation error'];
        return res.status(400).json({ success: false, error: messages.join(', ') });
    }

    // 5. Sequelize foreign key constraint
    if (err.name === 'SequelizeForeignKeyConstraintError') {
        return res.status(400).json({ success: false, error: 'Invalid reference — related record not found' });
    }

    // 6. JWT errors
    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
        return res.status(401).json({ success: false, error: 'Invalid or expired token' });
    }

    // 7. Axios errors (service-to-service HTTP client failures)
    if (err.isAxiosError) {
        const status = err.response?.status || 502;
        const upstream = err.response?.data;
        let message =
            (typeof upstream === 'object' && upstream?.error) ||
            (typeof upstream === 'object' && upstream?.message) ||
            (typeof upstream === 'string' && upstream) ||
            null;
        if (!message && (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND')) {
            const target = err.config?.baseURL ? `${err.config.baseURL}${err.config.url || ''}` : '';
            message = `Upstream unreachable (${err.code}${target ? `: ${target}` : ''}). Is the service running and URL correct?`;
        }
        if (!message) {
            message = err.message || 'Upstream service error';
        }
        return res.status(status).json({ success: false, error: message });
    }

    // 8. Payload / body limits
    if (err.status === 413 || err.statusCode === 413 || err.type === 'entity.too.large') {
        return res.status(413).json({ success: false, error: err.message || 'Request body too large' });
    }

    // 9. Sequelize / general database errors (e.g. ER_DATA_TOO_LONG_VALUE)
    if (err.name === 'SequelizeDatabaseError') {
        const errno = err.parent?.errno ?? err.original?.errno;
        const sqlMessage =
            typeof err.parent?.sqlMessage === 'string' ? err.parent.sqlMessage : err.message || 'Database error';
        logger.error('Database error', {
            errno,
            sqlMessage,
            url: req.originalUrl,
            method: req.method,
        });
        if (errno === 1406 || /Data too long/i.test(sqlMessage)) {
            return res.status(413).json({
                success: false,
                error:
                    'Stored value exceeds database column limit. Widen `sc_course_page_settings.setting_value` to LONGTEXT (see services/course-service/scripts/ensure-page-settings-longtext.sql in the API repo).',
            });
        }
        return res.status(400).json({ success: false, error: sqlMessage });
    }

    // 10. Malformed JSON (express body parser)
    if (err instanceof SyntaxError && 'body' in err) {
        return res.status(400).json({ success: false, error: 'Invalid JSON body' });
    }

    // 11. Unknown / programming error — log full details, return generic message
    logger.error('Unhandled error', {
        message: err.message,
        stack: err.stack,
        url: req.originalUrl,
        method: req.method,
    });

    return res.status(500).json({ success: false, error: 'Internal server error' });
}

module.exports = { errorHandler };
