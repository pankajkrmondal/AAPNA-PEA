import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

let scriptPromise;

/** Load Cloudflare's script once per page, however many times the widget mounts. */
function loadTurnstile() {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = SCRIPT_SRC;
      script.async = true;
      script.onload = () => resolve(window.turnstile);
      script.onerror = () => {
        scriptPromise = null; // allow a retry on the next mount
        reject(new Error('Turnstile failed to load'));
      };
      document.head.appendChild(script);
    });
  }
  return scriptPromise;
}

/**
 * Cloudflare Turnstile widget. Reports its token through `onToken`, and ''
 * whenever the token stops being usable (expired, errored, reset).
 *
 * Tokens are single-use, so after a failed sign-in the parent calls
 * `ref.current.reset()` to get a fresh one.
 */
const Turnstile = forwardRef(function Turnstile({ siteKey, onToken, onLoadError }, ref) {
  const box = useRef(null);
  const widgetId = useRef(null);
  // Latest callbacks without re-rendering the widget each time they change.
  const handlers = useRef({ onToken, onLoadError });
  handlers.current = { onToken, onLoadError };

  useImperativeHandle(ref, () => ({
    reset() {
      if (widgetId.current == null) return;
      window.turnstile?.reset(widgetId.current);
      handlers.current.onToken('');
    },
  }), []);

  useEffect(() => {
    let cancelled = false;

    loadTurnstile()
      .then((turnstile) => {
        if (cancelled || !box.current) return;
        widgetId.current = turnstile.render(box.current, {
          sitekey: siteKey,
          theme: 'auto',
          size: 'flexible',
          callback: (token) => handlers.current.onToken(token),
          'expired-callback': () => handlers.current.onToken(''),
          'error-callback': () => handlers.current.onToken(''),
        });
      })
      .catch(() => handlers.current.onLoadError?.());

    return () => {
      cancelled = true;
      if (widgetId.current != null) {
        window.turnstile?.remove(widgetId.current);
        widgetId.current = null;
      }
    };
  }, [siteKey]);

  return <div ref={box} className="pea-turnstile" />;
});

export default Turnstile;
