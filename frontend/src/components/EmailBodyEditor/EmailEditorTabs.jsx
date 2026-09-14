import { useRef, useState } from 'react';
import { Tabs } from 'antd';
import { EditOutlined, CodeOutlined, EyeOutlined } from '@ant-design/icons';
import EmailBodyEditor from './EmailBodyEditor';
import EmailHtmlSourceEditor from './EmailHtmlSourceEditor';
import { formatHtml } from './sanitize';
import { DEFAULT_TOOLBAR } from './Toolbar';

/**
 * Editor / HTML Code / Live Preview — the ATS three-tab email editor.
 *
 * `bodyHtml` / `onBodyChange` are controlled by the caller. `preview` is the
 * node shown in the Live Preview tab (PEA renders it on the server), and
 * `onTabChange` tells the caller when to build it.
 */
export default function EmailEditorTabs({
  bodyHtml,
  onBodyChange,
  subject,
  wrapper,
  placeholders = [],
  toolbar = DEFAULT_TOOLBAR,
  isDark = false,
  htmlExtra,
  preview,
  onTabChange,
}) {
  const [activeTab, setActiveTab] = useState('1');
  const [editorRev, setEditorRev] = useState(0);
  const [htmlView, setHtmlView] = useState({ rev: 0, text: '' });
  const htmlDirtyRef = useRef(false);
  const bodyRef = useRef(bodyHtml);
  bodyRef.current = bodyHtml;

  const handleTabChange = (key) => {
    // Entering the code tab: pretty-print so the source is readable.
    if (key === '2') {
      setHtmlView((v) => ({ rev: v.rev + 1, text: formatHtml(bodyRef.current) }));
    }
    // Back to the visual editor after raw-HTML edits: remount it from the latest body.
    if (key === '1' && htmlDirtyRef.current) {
      htmlDirtyRef.current = false;
      setEditorRev((r) => r + 1);
    }
    setActiveTab(key);
    onTabChange?.(key);
  };

  const handleHtmlChange = (value) => {
    onBodyChange(value);
    htmlDirtyRef.current = true;
  };

  return (
    <Tabs
      activeKey={activeTab}
      onChange={handleTabChange}
      type="card"
      size="small"
      className="email-editor-tabs"
      items={[
        {
          key: '1',
          label: <span><EditOutlined /> Editor</span>,
          children: (
            <EmailBodyEditor
              key={`ed-${editorRev}`}
              initialHtml={bodyHtml}
              onChange={onBodyChange}
              wrapper={wrapper}
              subject={subject}
              placeholders={placeholders}
              toolbar={toolbar}
              autoHeight
            />
          ),
        },
        {
          key: '2',
          label: <span><CodeOutlined /> HTML Code</span>,
          children: (
            <>
              {htmlExtra && (
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>{htmlExtra}</div>
              )}
              <EmailHtmlSourceEditor
                key={`html-${htmlView.rev}`}
                value={htmlView.text}
                onChange={handleHtmlChange}
                theme={isDark ? 'dark' : 'light'}
                autoHeight
              />
            </>
          ),
        },
        {
          key: '3',
          label: <span><EyeOutlined /> Live Preview</span>,
          children: preview,
        },
      ]}
    />
  );
}
