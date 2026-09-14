import CodeMirror from '@uiw/react-codemirror';
import { html as cmHtml } from '@codemirror/lang-html';
import { EditorView } from '@codemirror/view';

// Copied from ATS (components/common/EmailBodyEditor/EmailHtmlSourceEditor.jsx).

const CM_EXTENSIONS = [cmHtml(), EditorView.lineWrapping];

/** Raw HTML source view and edit for an email body. */
export default function EmailHtmlSourceEditor({ value, onChange, theme = 'light', autoHeight = false }) {
  return (
    <div className="email-html-editor">
      <CodeMirror
        value={value}
        onChange={onChange}
        extensions={CM_EXTENSIONS}
        theme={theme}
        height={autoHeight ? 'auto' : '100%'}
        basicSetup={{ foldGutter: true, highlightActiveLine: true, autocompletion: true }}
        aria-label="Raw email HTML source"
      />
    </div>
  );
}
