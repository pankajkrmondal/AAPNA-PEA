import { useEffect, useMemo, useRef } from 'react';
import { message } from 'antd';
import { sanitizeFragment } from './sanitize';
import { buildBrandedShellHtml } from './brandedShell';

// Copied from ATS (components/common/EmailBodyEditor/useEmailIframeEditor.js).

const contentCss = (compact) => `
  html, body { margin: 0; }
  body:focus { outline: none; }
  body:not(:has([data-editable-body])) { padding: ${compact ? '12px' : '16px'}; font-family: Arial, Helvetica, sans-serif; font-size: ${compact ? '13px' : '14px'}; -webkit-font-smoothing: antialiased; }
  /* The editable region is unmarked at rest so the shell reads as the delivered
     email; hover and focus show a soft green tint. */
  [data-editable-body] { outline: none; min-height: 60px; border-radius: 4px; transition: background-color 120ms ease, box-shadow 120ms ease; }
  [data-editable-body]:hover { background-color: rgba(122,146,46,0.06); box-shadow: 0 0 0 6px rgba(122,146,46,0.06); }
  [data-editable-body]:focus { background-color: rgba(122,146,46,0.08); box-shadow: 0 0 0 6px rgba(122,146,46,0.08), 0 0 0 7px rgba(122,146,46,0.35); }
  img { max-width: 100%; }
`;

/**
 * Iframe rich-text editing engine.
 *
 * Protected-chrome mode (`wrapper` = {headerHtml, footerHtml}): only the
 * [data-editable-body] slot inside the real AAPNA email is editable; the header
 * and footer stay read-only, so a stray edit can never delete them.
 * Whole-document mode (`wrapper` absent): the entire iframe is editable.
 */
export default function useEmailIframeEditor({ initialHtml, onChange, wrapper, subject, compact = false, autoHeight = false }) {
  const iframeRef = useRef(null);
  const savedSelRef = useRef(null);
  const resizeObsRef = useRef(null);

  /** Grow the frame to its content so the page scrolls, not the frame. */
  const autoSize = () => {
    if (!autoHeight) return;
    const iframe = iframeRef.current;
    const doc = iframe?.contentDocument;
    if (!iframe || !doc?.documentElement) return;
    const h = Math.ceil(doc.documentElement.getBoundingClientRect().height);
    if (h > 0) iframe.style.height = `${h}px`;
  };

  useEffect(() => () => {
    resizeObsRef.current?.disconnect();
    resizeObsRef.current = null;
  }, []);

  // Frozen on first mount — reloading on every keystroke would drop the caret.
  // Remount via `key` to load different content.
  const srcDoc = useMemo(() => {
    const body = sanitizeFragment(initialHtml || '<p>Empty.</p>');
    return wrapper?.headerHtml ? buildBrandedShellHtml(body, wrapper, { editable: true }) : body;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The header headline IS the subject, so keep it in step while HR types.
  useEffect(() => {
    if (!wrapper?.headerHtml) return;
    const doc = iframeRef.current?.contentDocument;
    const h1 = doc?.querySelector('h1');
    if (!h1) return;
    const next = (subject || '').trim();
    if (h1.textContent !== next) h1.textContent = next;
  }, [subject, wrapper?.headerHtml]);

  /** Read back only the editable region. */
  const syncFromEditor = () => {
    const doc = iframeRef.current?.contentDocument;
    if (!doc) return;
    const slot = doc.querySelector('[data-editable-body]');
    if (slot) {
      onChange(slot.innerHTML);
      autoSize();
      return;
    }
    if (doc.designMode === 'on') {
      const clone = doc.documentElement.cloneNode(true);
      clone.querySelectorAll('style[data-editor-css]').forEach((el) => el.remove());
      clone.querySelectorAll('img[src^="data:"]').forEach((el) => el.remove());
      onChange(clone.outerHTML);
    }
    autoSize();
  };

  const handleLoad = () => {
    const doc = iframeRef.current?.contentDocument;
    if (!doc) return;
    const slot = doc.querySelector('[data-editable-body]');
    if (slot) {
      slot.setAttribute('contenteditable', 'true');
    } else {
      doc.designMode = 'on';
    }

    doc.querySelectorAll('style').forEach((s) => {
      if (s.getAttribute('data-editor-css')) s.remove();
    });
    const style = doc.createElement('style');
    style.textContent = contentCss(compact);
    style.setAttribute('data-editor-css', '1');
    doc.head?.appendChild(style);

    autoSize();
    if (autoHeight && typeof ResizeObserver !== 'undefined' && doc.documentElement) {
      resizeObsRef.current?.disconnect();
      resizeObsRef.current = new ResizeObserver(autoSize);
      resizeObsRef.current.observe(doc.documentElement);
    }

    doc.addEventListener('input', syncFromEditor);
    doc.addEventListener('selectionchange', () => {
      const sel = doc.getSelection?.();
      if (sel && sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        // Only remember selections inside the editable region, so the toolbar
        // can never format the protected header or footer.
        const scope = slot || doc.body;
        if (scope?.contains(range.commonAncestorContainer)) {
          savedSelRef.current = range.cloneRange();
        }
      }
    });
    doc.addEventListener('paste', (e) => {
      const items = e.clipboardData?.items || [];
      if (Array.from(items).some((it) => it.type?.startsWith('image/'))) {
        e.preventDefault();
        message.info('Pasted images aren’t supported. Use "Insert image" to add a hosted URL.');
        return;
      }
      setTimeout(syncFromEditor, 0);
    }, true);
    doc.addEventListener('drop', (e) => {
      const files = e.dataTransfer?.files || [];
      if (Array.from(files).some((f) => f.type?.startsWith('image/'))) {
        e.preventDefault();
        message.info('Dropped images aren’t supported. Use "Insert image" to add a hosted URL.');
      }
    }, true);
  };

  const exec = (command, value = null) => {
    const doc = iframeRef.current?.contentDocument;
    if (!doc) return;
    iframeRef.current.contentWindow?.focus();
    doc.querySelector('[data-editable-body]')?.focus?.();
    const sel = doc.getSelection?.();
    if (sel && savedSelRef.current) {
      try { sel.removeAllRanges(); sel.addRange(savedSelRef.current); } catch { /* stale range */ }
    }
    try { doc.execCommand(command, false, value); } catch { /* noop */ }
    syncFromEditor();
  };

  const handleInsertLink = () => {
    const url = window.prompt('Link URL (https://…)');
    if (url && url.trim()) exec('createLink', url.trim());
  };

  const insertPlaceholder = (token) => exec('insertText', token);

  return { iframeRef, srcDoc, handleLoad, exec, handleInsertLink, insertPlaceholder };
}
