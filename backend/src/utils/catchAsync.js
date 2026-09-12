/**
 * Wrap an async route handler so a rejected promise reaches Express's error
 * middleware instead of becoming an unhandled rejection.
 *
 * @param {Function} fn - async (req, res, next) => {}
 * @returns {Function} Express handler
 */
export default function catchAsync(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
