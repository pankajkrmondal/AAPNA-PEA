import { Tooltip } from 'antd';
import { InfoCircleOutlined } from '@ant-design/icons';

/**
 * The one "hover me for an explanation" icon. Styled by `.pea-hint` in app.css
 * so every tooltip trigger in the app looks the same and is easy to spot.
 */
export default function HintIcon({ title, placement = 'top' }) {
  return (
    <Tooltip title={title} placement={placement}>
      <span className="pea-hint" role="img" aria-label="More information" tabIndex={0}>
        <InfoCircleOutlined />
      </span>
    </Tooltip>
  );
}
