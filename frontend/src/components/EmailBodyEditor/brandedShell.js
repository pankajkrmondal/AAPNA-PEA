/**
 * Copied from ATS. Mirrors wrapBrandedEmail()'s table skeleton
 * (backend/src/services/emailLayout.service.js) so the editor shows the body
 * inside the real AAPNA email. `wrapper` = { headerHtml, footerHtml } comes
 * from the server — built by the same functions the send path uses.
 *
 * Font-family is set on the tables, not only <body>: without a doctype an
 * iframe parses in quirks mode, where tables do not inherit it.
 */
const FONT_STACK = 'Arial,Helvetica,sans-serif';

export function buildBrandedShellHtml(bodyHtml, wrapper, { editable = false } = {}) {
  const bodyCell = editable
    ? `<div data-editable-body contenteditable="true">${bodyHtml}</div>`
    : (bodyHtml || '');
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>`
    + `<body style="margin:0;padding:0;background:#f4f6f9;font-family:${FONT_STACK}">`
    + `<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f9;padding:30px 10px;font-family:${FONT_STACK}"><tr><td align="center">`
    + `<table width="620" cellpadding="0" cellspacing="0" style="max-width:620px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 6px 24px rgba(0,0,0,0.08);font-family:${FONT_STACK}">`
    + wrapper.headerHtml
    + `<tr><td style="padding:32px 40px 24px 40px;font-family:${FONT_STACK};font-size:15px;color:#374151;line-height:1.8">${bodyCell}</td></tr>`
    + (wrapper.footerHtml || '')
    + `</table></td></tr></table></body></html>`;
}
