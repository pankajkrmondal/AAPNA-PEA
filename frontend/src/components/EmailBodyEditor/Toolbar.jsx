import { Button, Tag, Tooltip } from 'antd';
import {
  BoldOutlined,
  ItalicOutlined,
  UnderlineOutlined,
  UnorderedListOutlined,
  OrderedListOutlined,
  LinkOutlined,
  PictureOutlined,
  ClearOutlined,
} from '@ant-design/icons';

// Copied from ATS (components/common/EmailBodyEditor/Toolbar.jsx).

const BUTTONS = {
  bold: { icon: <BoldOutlined />, title: 'Bold', run: (e) => e.exec('bold') },
  italic: { icon: <ItalicOutlined />, title: 'Italic', run: (e) => e.exec('italic') },
  underline: { icon: <UnderlineOutlined />, title: 'Underline', run: (e) => e.exec('underline') },
  bulletList: { icon: <UnorderedListOutlined />, title: 'Bulleted list', run: (e) => e.exec('insertUnorderedList') },
  numberedList: { icon: <OrderedListOutlined />, title: 'Numbered list', run: (e) => e.exec('insertOrderedList') },
  link: { icon: <LinkOutlined />, title: 'Insert link', run: (e) => e.handleInsertLink() },
  image: { icon: <PictureOutlined />, title: 'Insert image by URL' }, // handled by the consumer (opens ImageUrlModal)
  clearFormatting: { icon: <ClearOutlined />, title: 'Clear formatting', run: (e) => e.exec('removeFormat') },
};

// A separator is drawn between groups that have at least one visible button.
const GROUPS = [['bold', 'italic', 'underline'], ['bulletList', 'numberedList'], ['link', 'image'], ['clearFormatting']];

export const DEFAULT_TOOLBAR = ['bold', 'italic', 'underline', 'bulletList', 'numberedList', 'link', 'clearFormatting'];
export const FULL_TOOLBAR = ['bold', 'italic', 'underline', 'bulletList', 'numberedList', 'link', 'image', 'clearFormatting'];

const noBlur = (e) => e.preventDefault(); // keep the caret in the iframe when clicking the toolbar

export default function Toolbar({ buttons, editor, onImageClick, placeholders = [], onInsertPlaceholder }) {
  const active = new Set(buttons);
  return (
    <div className="email-editor-toolbar">
      {GROUPS.map((group, gi) => {
        const visible = group.filter((key) => active.has(key));
        if (visible.length === 0) return null;
        return (
          <span key={group[0]} style={{ display: 'inline-flex', alignItems: 'center' }}>
            {gi > 0 && <span className="email-editor-toolbar__sep" />}
            {visible.map((key) => {
              const btn = BUTTONS[key];
              return (
                <Tooltip title={btn.title} key={key}>
                  <Button
                    type="text"
                    size="small"
                    icon={btn.icon}
                    className="email-editor-toolbar__btn"
                    onMouseDown={noBlur}
                    onClick={() => (key === 'image' ? onImageClick?.() : btn.run(editor))}
                  />
                </Tooltip>
              );
            })}
          </span>
        );
      })}
      {placeholders.length > 0 && (
        <>
          <span className="email-editor-toolbar__sep" />
          {placeholders.map((token) => (
            <Tooltip title="Insert at cursor" key={token}>
              <Tag
                onMouseDown={noBlur}
                onClick={() => onInsertPlaceholder(token)}
                style={{ cursor: 'pointer', margin: '2px', fontSize: 11, fontWeight: 500 }}
              >
                +{token.replace(/[{}]/g, '')}
              </Tag>
            </Tooltip>
          ))}
        </>
      )}
    </div>
  );
}
