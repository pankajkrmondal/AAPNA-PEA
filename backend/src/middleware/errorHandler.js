import logger from '../config/logger.js';
import config from '../config/index.js';
import AppError from '../utils/AppError.js';

/** 404 handler — mounted after all routes. */
export function notFound(req, _res, next) {
  next(new AppError(`Route ${req.method} ${req.originalUrl} not found`, 404));
}

/**
 * Global error handler.
 *
 * Operational errors keep their message. Programming errors are masked in
 * production, and stack traces are sent only in development, so a stack trace
 * or SQL fragment never reaches a client — note the evaluation form routes are
 * PUBLIC, so "a client" can be anyone holding a token link.
 */
// eslint-disable-next-line no-unused-vars -- Express needs the 4-arg signature
export function errorHandler(err, req, res, _next) {
  let statusCode = err.statusCode || 500;
  let message = err.message || 'Something went wrong';

  // ── Prisma errors → friendly messages ──────────────────────────────────
  if (err.code === 'P2002') {
    statusCode = 409;
    const target = err.meta?.target;
    message = `A record with this ${Array.isArray(target) ? target.join(', ') : 'value'} already exists`;
  } else if (err.code === 'P2025') {
    statusCode = 404;
    message = 'Record not found';
  } else if (err.code === 'P2003') {
    statusCode = 400;
    message = 'Related record not found';
  } else if (err.code === 'P2021' || err.code === 'P2022') {
    // Table or column missing — almost always a DDL file not applied to this
    // environment. Say so, because the raw Prisma text is cryptic. 503, not
    // 500: the feature is not available here yet, which is not a code fault.
    statusCode = 503;
    message = 'Database schema is out of date — a DDL file may not have been applied';
  }

  // Upload limits are the user's input being refused, not a server fault.
  if (err.name === 'MulterError') {
    if (err.code === 'LIMIT_FILE_SIZE') {
      statusCode = 413;
      message = 'File too large. The limit is 10 MB.';
    } else {
      statusCode = 400;
    }
  }

  if (err.name === 'JsonWebTokenError') {
    statusCode = 401;
    message = 'Invalid token';
  } else if (err.name === 'TokenExpiredError') {
    statusCode = 401;
    message = 'Token expired';
  }

  const logMeta = {
    method: req.method,
    url: req.originalUrl,
    statusCode,
    ...(err.code ? { prismaCode: err.code } : {}),
  };

  if (statusCode >= 500) {
    logger.error(message, { ...logMeta, stack: err.stack });
  } else {
    logger.warn(message, logMeta);
  }

  const isOperational = err instanceof AppError || err.isOperational || err.name === 'MulterError';
  const body = {
    status: `${statusCode}`.startsWith('4') ? 'fail' : 'error',
    message: config.isProduction && !isOperational ? 'Something went wrong' : message,
  };

  // A form validation error listing each problem (evaluation.service submit).
  if (isOperational && Array.isArray(err.problems)) body.problems = err.problems;

  // Development only: staging is internet-facing too, and must not leak stacks.
  if (config.isDevelopment) body.stack = err.stack;

  res.status(statusCode).json(body);
}
