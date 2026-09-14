/**
 * emailLayout.service.js — the AAPNA branded email shell, the same one ATS uses.
 *
 * Every PEA email stores only its BODY. The green header with the logo, the
 * white card, the sign-off and the grey footer are added here, once, at send
 * time. Copied from ATS backend/src/services/emailLayout.service.js so a
 * manager who receives mail from both systems sees one design.
 *
 * Why wrap at send time instead of storing the shell in each template:
 *  - HR edits the body in the Email Templates screen; chrome inside that value
 *    could be deleted or broken by a stray edit,
 *  - one shell means one place to change the logo or colour.
 *
 * Markup is deliberately table-based — Outlook desktop does not honour div and
 * flex layouts. Do not re-author it as divs. Font-family is set on the tables
 * as well as <body> because mail clients cannot be trusted to inherit it.
 */

/** Brand tokens — identical to ATS. */
export const BRAND = Object.freeze({
  accent: '#7a922e',
  page: '#f4f6f9',
  card: '#ffffff',
  text: '#374151',
  muted: '#6b7280',
  footerBg: '#f3f4f6',
  footerText: '#9ca3af',
  logo: 'https://www.aapnainfotech.com/wp-content/uploads/2021/09/aapna-gptw-black.png',
});

export const DEFAULT_SUBTITLE = 'AAPNA Infotech — Performance Evaluation';

const FONT_STACK = 'Arial,Helvetica,sans-serif';

function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * True when the HTML already carries its own document shell, so it is never
 * wrapped twice.
 * @param {string} html
 * @returns {boolean}
 */
export function isFullHtmlDocument(html) {
  if (typeof html !== 'string' || html.trim() === '') return false;
  return /<!DOCTYPE\s|<html[\s>]|<body[\s>]/i.test(html);
}

/**
 * True when a body already ends with its own sign-off, so a second one is not
 * added underneath. Only the tail is examined, so the phrase appearing
 * mid-sentence does not suppress the real signature.
 * @param {string} html
 * @returns {boolean}
 */
export function hasOwnSignature(html) {
  if (typeof html !== 'string' || html.trim() === '') return false;
  const tail = html.slice(-400);
  return /\b(best|warm|kind)\s+regards\b|\bthanks\s*(&amp;|&|and)\s*regards\b|^\s*regards\s*,/im.test(tail);
}

/** The green header band: logo, the email subject as headline, and the sub-line. */
function headerHtml(title, subtitle) {
  const safeTitle = escapeHtml(title).trim();
  return `<tr><td style="background:${BRAND.accent};padding:32px 40px;text-align:center;font-family:${FONT_STACK}">`
    + `<img src="${BRAND.logo}" width="190" alt="AAPNA Infotech" style="display:block;margin:0 auto 16px auto">`
    + (safeTitle ? `<h1 style="margin:0;font-size:22px;color:#ffffff;font-weight:800">${safeTitle}</h1>` : '')
    + `<p style="margin:6px 0 0 0;color:#e7f0c5;font-size:13px">${escapeHtml(subtitle)}</p>`
    + `</td></tr>`;
}

/** The single sign-off, rendered once here rather than in every template. */
function signatureHtml() {
  return `<tr><td style="padding:0 40px 24px 40px;font-family:${FONT_STACK};font-size:15px;color:${BRAND.text}">`
    + `<p style="margin:0 0 4px 0;">Thanks &amp; Regards,</p>`
    + `<p style="margin:0;font-weight:700;color:${BRAND.accent};">AAPNA | HR Team</p>`
    + `</td></tr>`;
}

/** The grey footer band. */
function footerHtml() {
  return `<tr><td style="background:${BRAND.footerBg};padding:16px;text-align:center;font-family:${FONT_STACK};font-size:12px;color:${BRAND.footerText}">`
    + `This email was sent by AAPNA Infotech's performance evaluation system.<br>`
    + `&copy; ${new Date().getFullYear()} AAPNA Infotech. All rights reserved.`
    + `</td></tr>`;
}

/**
 * Wrap a body fragment in the AAPNA branded shell. A body that is already a
 * full document is returned unchanged.
 *
 * @param {string} bodyHtml
 * @param {{title?: string, subtitle?: string}} [opts] - title is the email subject
 * @returns {string} a full HTML document
 */
export function wrapBrandedEmail(bodyHtml, { title = '', subtitle = DEFAULT_SUBTITLE } = {}) {
  if (isFullHtmlDocument(bodyHtml)) return bodyHtml;
  const body = typeof bodyHtml === 'string' ? bodyHtml : '';

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>`
    + `<body style="margin:0;padding:0;background:${BRAND.page};font-family:${FONT_STACK}">`
    + `<table width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.page};padding:30px 10px;font-family:${FONT_STACK}"><tr><td align="center">`
    + `<table width="620" cellpadding="0" cellspacing="0" style="max-width:620px;background:${BRAND.card};border-radius:12px;overflow:hidden;box-shadow:0 6px 24px rgba(0,0,0,0.08);font-family:${FONT_STACK}">`
    + headerHtml(title, subtitle)
    + `<tr><td style="padding:32px 40px 24px 40px;font-family:${FONT_STACK};font-size:15px;color:${BRAND.text};line-height:1.8">`
    + `<div>${body}</div>`
    + `</td></tr>`
    + (hasOwnSignature(body) ? '' : signatureHtml())
    + footerHtml()
    + `</table></td></tr></table></body></html>`;
}

/**
 * The header and footer as separate strings, for the editor: the screen shows
 * them read-only around the editable body, built by the same functions the
 * send path uses so the two cannot drift.
 *
 * @param {{title?: string, subtitle?: string, bodyHtml?: string|null}} [opts]
 * @returns {{headerHtml: string, footerHtml: string}}
 */
export function brandedWrapperParts({ title = '', subtitle = DEFAULT_SUBTITLE, bodyHtml = null } = {}) {
  return {
    headerHtml: headerHtml(title, subtitle),
    footerHtml: (bodyHtml !== null && hasOwnSignature(bodyHtml) ? '' : signatureHtml()) + footerHtml(),
  };
}
