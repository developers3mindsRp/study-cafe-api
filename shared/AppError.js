class AppError extends Error {
    /**
     * @param {string} message      Shown to the user.
     * @param {number} [statusCode]
     * @param {string} [code]       Stable machine-readable reason (e.g. 'PASSWORD_NOT_SET') for
     *                              clients that must branch on more than the status code.
     *                              Sent as `code` in the error envelope; omitted when not given.
     */
    constructor(message, statusCode = 500, code) {
        super(message);
        this.name = 'AppError';
        this.statusCode = statusCode;
        this.isOperational = true;
        if (code) this.code = code;
        Error.captureStackTrace(this, this.constructor);
    }
}

module.exports = { AppError };
