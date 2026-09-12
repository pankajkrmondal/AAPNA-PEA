/**
 * Standardised API response helpers.
 * Every controller uses these so response shapes stay consistent.
 */

/**
 * Send a success response.
 * @param {import('express').Response} res
 * @param {*} data
 * @param {string} [message='Success']
 * @param {number} [statusCode=200]
 */
export function success(res, data, message = 'Success', statusCode = 200) {
  return res.status(statusCode).json({ status: 'success', message, data });
}

/**
 * Send an error response.
 * @param {import('express').Response} res
 * @param {string} [message='Something went wrong']
 * @param {number} [statusCode=500]
 * @param {*} [errors=null]
 */
export function error(res, message = 'Something went wrong', statusCode = 500, errors = null) {
  const body = { status: 'error', message };
  if (errors) body.errors = errors;
  return res.status(statusCode).json(body);
}

/**
 * Send a paginated success response.
 * @param {import('express').Response} res
 * @param {Array} data
 * @param {number} page - 1-indexed
 * @param {number} limit
 * @param {number} total
 * @param {string} [message='Success']
 */
export function paginated(res, data, page, limit, total, message = 'Success') {
  return res.status(200).json({
    status: 'success',
    message,
    data,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      hasNext: page * limit < total,
      hasPrev: page > 1,
    },
  });
}

/**
 * JSON.stringify replacer for BigInt.
 *
 * Prisma returns BigInt for every `id` here (the DDL uses BIGSERIAL), and
 * `JSON.stringify` throws on BigInt rather than serialising it. Registered
 * globally in app.js so no controller has to remember.
 */
export function bigIntSafe(_key, value) {
  return typeof value === 'bigint' ? value.toString() : value;
}
