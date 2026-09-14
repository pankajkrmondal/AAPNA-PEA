import { useState } from 'react';
import useEmailIframeEditor from './useEmailIframeEditor';
import Toolbar, { DEFAULT_TOOLBAR } from './Toolbar';
import ImageUrlModal from './ImageUrlModal';

/**
 * Visual (WYSIWYG) email body editor — copied from ATS.
 *
 * Uncontrolled after mount: `initialHtml` seeds the document once and edits
 * stream out through `onChange`. To load different content, change its `key`.
 * With `wrapper` only the body slot inside the real AAPNA email is editable.
 */
export default function EmailBodyEditor({
  initialHtml,
  onChange,
  wrapper,
  subject,
  placeholders = [],
  toolbar = DEFAULT_TOOLBAR,
  compact = false,
  height,
  autoHeight = false,
}) {
  const editor = useEmailIframeEditor({ initialHtml, onChange, wrapper, subject, compact, autoHeight });
  const [imgModalOpen, setImgModalOpen] = useState(false);
  const showImageModal = toolbar.includes('image');

  return (
    <div className="email-editor-shell">
      <Toolbar
        buttons={toolbar}
        editor={editor}
        onImageClick={() => setImgModalOpen(true)}
        placeholders={placeholders}
        onInsertPlaceholder={editor.insertPlaceholder}
      />
      <iframe
        ref={editor.iframeRef}
        title="Email body editor"
        className="email-editor-iframe"
        srcDoc={editor.srcDoc}
        onLoad={editor.handleLoad}
        style={height ? { height } : undefined}
      />
      {showImageModal && (
        <ImageUrlModal
          open={imgModalOpen}
          onCancel={() => setImgModalOpen(false)}
          onInsert={(html) => {
            editor.exec('insertHTML', html);
            setImgModalOpen(false);
          }}
        />
      )}
    </div>
  );
}
