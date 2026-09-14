import DOMPurify from 'dompurify';
import { html_beautify } from 'js-beautify';

// Copied from ATS (components/common/EmailBodyEditor/sanitize.js).
//
// Strip base64/data-URI images anywhere we sanitize — Outlook and Gmail block
// them and they bloat stored HTML. Hosted https images (Insert image) are kept.
// Registered once, globally: DOMPurify hooks are not scoped per call.
DOMPurify.addHook('uponSanitizeElement', (node, data) => {
  if (data.tagName === 'img' && node.getAttribute) {
    const src = (node.getAttribute('src') || '').trim().toLowerCase();
    if (src.startsWith('data:') && node.parentNode) {
      node.parentNode.removeChild(node);
    }
  }
});

export const SANITIZE_OPTS = { WHOLE_DOCUMENT: true, ADD_TAGS: ['style'], ADD_ATTR: ['target'] };

/** A whole email document — the Live Preview. */
export const sanitizeDoc = (html) => DOMPurify.sanitize(html || '', SANITIZE_OPTS);

/**
 * A body fragment — what HR edits and what is saved. Never a whole document:
 * PEA adds the AAPNA header, logo and footer on the server.
 */
export const sanitizeFragment = (html) => DOMPurify.sanitize(html || '', { ADD_ATTR: ['target'] });

// Pretty-print serialized email HTML so the HTML Code tab is readable — the
// visual editor emits it as one long line.
export const formatHtml = (html) => {
  try {
    return html_beautify(html || '', {
      indent_size: 2,
      wrap_line_length: 0,
      preserve_newlines: true,
      max_preserve_newlines: 1,
    });
  } catch {
    return html || '';
  }
};
