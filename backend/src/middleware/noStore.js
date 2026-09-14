/**
 * Cache-Control: no-store for the public token pages (evaluation form, manager
 * portal, self view). Each one shows state HR can change at any time — paused,
 * resumed, re-sent, submitted — and without this header a browser may show the
 * manager a stale "paused" or "expired" page after HR has fixed it.
 */
export function noStore(_req, res, next) {
  res.set('Cache-Control', 'no-store');
  next();
}
