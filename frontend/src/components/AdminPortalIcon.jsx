import { UserOutlined, SettingOutlined } from '@ant-design/icons';

/**
 * The ATS Admin Portal glyph — a person with a small gear badge ("manage
 * accounts"). antd has no single person+gear icon, so two are composed. Takes
 * colour and size from the surrounding text.
 */
export default function AdminPortalIcon() {
  return (
    <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', lineHeight: 0 }}>
      <UserOutlined />
      <SettingOutlined style={{ position: 'absolute', right: '-0.32em', bottom: '-0.16em', fontSize: '0.62em' }} />
    </span>
  );
}
