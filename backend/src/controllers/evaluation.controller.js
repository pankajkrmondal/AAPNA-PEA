/**
 * evaluation.controller.js — the public, token-authenticated evaluation form.
 *
 * Serves HTML to the browser and JSON to API clients, chosen by the Accept
 * header. The manager gets a page; the test suite and any future React screen
 * get JSON from the same routes.
 */
import * as evaluationService from '../services/evaluation.service.js';
import catchAsync from '../utils/catchAsync.js';
import { success } from '../utils/apiResponse.js';
import { renderForm, renderThanks, renderError } from '../views/evaluationForm.js';
import { RATING_SCALE, CONFIRMATION_OPTIONS } from '../config/ratingScale.js';

/** True when the caller wants JSON rather than a rendered page. */
const wantsJson = (req) =>
  req.query.format === 'json' || (req.get('accept') || '').includes('application/json');

/**
 * Turn the flat form POST (rating_<key>, comments_<key>) into the nested shape
 * the service expects. A JSON client can post the nested shape directly.
 */
function parseBody(body) {
  if (body.ratings) return body;

  const ratings = {};
  for (const [field, value] of Object.entries(body)) {
    const rating = /^rating_(.+)$/.exec(field);
    if (rating) {
      ratings[rating[1]] = { ...(ratings[rating[1]] || {}), rating: value };
      continue;
    }
    const comment = /^comments_(.+)$/.exec(field);
    if (comment) {
      ratings[comment[1]] = { ...(ratings[comment[1]] || {}), comments: value };
    }
  }

  return {
    ratings,
    remarks: body.remarks,
    confirmation_status: body.confirmation_status,
    submitted_by: body.submitted_by,
  };
}

/** GET /api/evaluation/:token */
export const getForm = catchAsync(async (req, res) => {
  let data;
  try {
    data = await evaluationService.getFormData(req.params.token);
  } catch (err) {
    // A manager clicking an expired link should see a plain explanation, not a
    // JSON error body or a stack trace.
    if (wantsJson(req)) throw err;
    return res.status(err.statusCode || 400).type('html').send(renderError(err.message, err.statusCode));
  }

  if (wantsJson(req)) {
    return success(res, { ...data, ratingScale: RATING_SCALE, confirmationOptions: CONFIRMATION_OPTIONS });
  }

  return res.type('html').send(renderForm(data, { nonce: res.locals.cspNonce }));
});

/** POST /api/evaluation/:token/submit */
export const submitForm = catchAsync(async (req, res) => {
  const body = parseBody(req.body || {});
  // req.ip is correct behind nginx because app.js sets trust proxy.
  const ip = req.ip;

  let result;
  try {
    result = await evaluationService.submit(req.params.token, body, ip);
  } catch (err) {
    if (wantsJson(req)) throw err;

    // Re-render the form with the manager's answers still in place. Losing a
    // page of typed comments to a validation error is the fastest way to make
    // someone abandon the form.
    try {
      const data = await evaluationService.getFormData(req.params.token);
      return res
        .status(err.statusCode || 400)
        .type('html')
        .send(renderForm(data, { error: err.message, submitted: body, nonce: res.locals.cspNonce }));
    } catch {
      return res
        .status(err.statusCode || 400)
        .type('html')
        .send(renderError(err.message, err.statusCode));
    }
  }

  if (wantsJson(req)) return success(res, result, 'Evaluation submitted');
  return res.type('html').send(renderThanks(result));
});
