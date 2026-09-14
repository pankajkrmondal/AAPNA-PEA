import { useRef } from 'react';
import { Typography, Spin } from 'antd';
import { sanitizeDoc } from './sanitize';

const { Text } = Typography;

/**
 * Read-only preview of a compiled email, in a mail-client frame — the ATS
 * design. PEA's difference: `html` is the complete email rendered by the
 * SERVER with sample data, by the same code that sends real mail, so the
 * preview cannot drift from what recipients receive.
 */
export default function EmailPreviewPane({ subject, html, to, loading = false }) {
  const frameRef = useRef(null);

  // Grow the frame to its content so the page scrolls, not the frame.
  const handleLoad = () => {
    const doc = frameRef.current?.contentDocument;
    const h = doc?.documentElement && Math.ceil(doc.documentElement.getBoundingClientRect().height);
    if (h > 0) frameRef.current.style.height = `${h}px`;
  };

  const srcDoc = sanitizeDoc(html || '<p style="font-family:sans-serif;color:#8a8f8c;padding:16px">Building preview…</p>');

  return (
    <div className="email-preview-shell">
      <div className="email-preview-shell__chrome">
        <div className="email-preview-shell__lights">
          <div className="email-preview-shell__light email-preview-shell__light--r" />
          <div className="email-preview-shell__light email-preview-shell__light--y" />
          <div className="email-preview-shell__light email-preview-shell__light--g" />
          <Text className="email-preview-shell__mode">New Message — Preview with sample data</Text>
        </div>
        <div className="email-preview-shell__row">
          <Text className="email-preview-shell__key">Subject:</Text>
          <Text strong className="email-preview-shell__val email-preview-shell__val--strong">{subject}</Text>
        </div>
        <div className="email-preview-shell__row">
          <Text className="email-preview-shell__key">To:</Text>
          <Text className="email-preview-shell__val">{to}</Text>
        </div>
      </div>
      <Spin spinning={loading}>
        {/* allow-same-origin WITHOUT allow-scripts: the frame can be measured,
            but nothing inside it can ever run. */}
        <iframe
          ref={frameRef}
          title="Email preview"
          sandbox="allow-same-origin"
          className="email-preview-iframe"
          srcDoc={srcDoc}
          onLoad={handleLoad}
        />
      </Spin>
    </div>
  );
}
