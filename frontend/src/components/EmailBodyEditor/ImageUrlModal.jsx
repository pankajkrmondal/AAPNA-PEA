import { useState } from 'react';
import { Modal, Input, Typography } from 'antd';

// Copied from ATS (components/common/EmailBodyEditor/ImageUrlModal.jsx).

const { Text } = Typography;

export default function ImageUrlModal({ open, onCancel, onInsert }) {
  const [url, setUrl] = useState('');
  const [alt, setAlt] = useState('');

  const handleOk = () => {
    const trimmed = url.trim();
    if (!trimmed) { onCancel(); return; }
    const safeUrl = trimmed.replace(/"/g, '&quot;');
    const safeAlt = alt.trim().replace(/"/g, '&quot;');
    onInsert(`<img src="${safeUrl}" alt="${safeAlt}" style="max-width:100%" />`);
    setUrl('');
    setAlt('');
  };

  return (
    <Modal title="Insert image by URL" open={open} onOk={handleOk} onCancel={onCancel} okText="Insert" centered destroyOnClose>
      <Input
        placeholder="https://…"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        onPressEnter={handleOk}
        style={{ marginBottom: 8 }}
        autoFocus
      />
      <Input placeholder="Alt text (optional)" value={alt} onChange={(e) => setAlt(e.target.value)} style={{ marginBottom: 8 }} />
      <Text type="secondary" style={{ fontSize: 12 }}>
        Use a hosted <b>https</b> image URL. Local or pasted images aren’t supported because they don’t render
        reliably in delivered email.
      </Text>
    </Modal>
  );
}
