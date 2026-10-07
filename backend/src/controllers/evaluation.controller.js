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
// B2 / M2 — was: import { RATING_SCALE, CONFIRMATION_OPTIONS } from '../config/ratingScale.js';
import { RATING_SCALE } from '../config/ratingScale.js';

/** True when the caller wants JSON rather than a rendered page. */
const wantsJson = (req) =>
  req.query.format === 'json' || (req.get('accept') || '').includes('application/json');

/**
 * Turn the flat form POST (rating_<key>, comments_<key>) into the nested shape
 * the service expects. A JSON client can post the nested shape directly.
 *
 * Either way `submitted_by` is stripped — R-01. The submitter is the reporting
 * manager the single-use link was issued to, which the service reads from the
 * token; accepting it from the body would let a POST name someone else as the
 * author of an evaluation. Dropped on BOTH paths, so the JSON route is no
 * weaker than the browser one.
 */
export function parseBody(body) {
  if (body.ratings) {
    const { submitted_by: _ignored, ...rest } = body;
    return rest;
  }

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
    confirmation_reason: body.confirmation_reason,
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
    return res
      .status(err.statusCode || 400)
      .type('html')
      .send(renderError(err.message, err.statusCode, { nonce: res.locals.cspNonce }));
  }

  if (wantsJson(req)) {
    // B2 / M2 — `data.confirmationOptions` is already the allowed subset for
    // this person. This used to send the full list regardless:
    // return success(res, { ...data, ratingScale: RATING_SCALE, confirmationOptions: CONFIRMATION_OPTIONS });
    return success(res, { ...data, ratingScale: RATING_SCALE });
  }

  // P11 — a draft saved against this link refills the form, on any device.
  // Was: renderForm(data, { nonce: res.locals.cspNonce })
  return res.type('html').send(renderForm(data, {
    nonce: res.locals.cspNonce,
    submitted: data.draft?.values || {},
  }));
});

/**
 * POST /api/evaluation/:token/draft — P11.
 *
 * Keeps unfinished answers. The form's script calls this as JSON a few seconds
 * after the last change; the "Save draft" button posts the form here with no
 * script at all, and gets the form back with a line saying it was saved.
 */
export const saveDraft = catchAsync(async (req, res) => {
  const body = parseBody(req.body || {});

  let result;
  try {
    result = await evaluationService.saveDraft(req.params.token, body);
  } catch (err) {
    if (wantsJson(req)) throw err;
    return res
      .status(err.statusCode || 400)
      .type('html')
      .send(renderError(err.message, err.statusCode, { nonce: res.locals.cspNonce }));
  }

  if (wantsJson(req)) return success(res, result, 'Draft saved');

  const data = await evaluationService.getFormData(req.params.token);
  return res.type('html').send(renderForm(data, {
    nonce: res.locals.cspNonce,
    submitted: data.draft?.values || body,
    notice: `Draft saved ${result.savedLabel}. Nothing has been submitted yet — come back to this same link to finish.`,
  }));
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
        .send(renderForm(data, {
          error: err.message,
          problems: err.problems || [],
          submitted: body,
          nonce: res.locals.cspNonce,
        }));
    } catch {
      return res
        .status(err.statusCode || 400)
        .type('html')
        .send(renderError(err.message, err.statusCode, { nonce: res.locals.cspNonce }));
    }
  }

  if (wantsJson(req)) return success(res, result, 'Evaluation submitted');
  return res.type('html').send(renderThanks(result, { nonce: res.locals.cspNonce }));
});
