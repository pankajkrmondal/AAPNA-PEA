/**
 * Custom application error class.
 * Extends native Error with an HTTP status code and an operational flag.
 *
 * Operational errors are expected (404, 401, a bad upload) and safe to return
 * to the client. Programming errors (isOperational = false) are masked with a
 * generic message in production.
 */
export default class AppError extends Error {
  /**
   * @param {string} message - Human-readable error message
   * @param {number} statusCode - HTTP status code (e.g. 400, 404, 500)
   */
  constructor(message, statusCode) {
    super(message);

    /** @type {number} */
    this.statusCode = statusCode;

    /** @type {string} 'fail' for 4xx, 'error' for 5xx */
    this.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';

    /** @type {boolean} true for expected / operational errors */
    this.isOperational = true;

    Error.captureStackTrace(this, this.constructor);
  }
}
