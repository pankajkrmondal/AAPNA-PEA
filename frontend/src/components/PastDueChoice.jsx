/**
 * PastDueChoice — what to do with evaluations that are already past due.
 *
 * B5 / U9. PEA sends anything due and not yet sent, which is what makes it
 * dependable — and is also why adding someone who joined four months ago, or
 * resuming someone after a long hold, used to email their manager three or four
 * forms the next morning. So the three places that can cause it ask first: Add,
 * New-joiner accept, and Resume.
 *
 * The value is the API's `past_due_action`. "Keep blank" and "I will enter
 * them" both close the past-due evaluations; they differ only in what HR does
 * next, so they are two choices on screen and one value on the wire.
 */
import { Alert, Radio, Space } from 'antd';

/** The default: the manager gets one form, for the most recent period. */
export const PAST_DUE_DEFAULT = 'send_latest';

/** The on-screen choice → the API value. */
export const pastDueAction = (choice) => (choice === 'enter' ? 'close' : choice || PAST_DUE_DEFAULT);

/**
 * @param {{count: number, value?: string, onChange: (v: string) => void, manager?: string}} props
 *   `count` — how many evaluations are already past due; renders nothing at 0
 */
export default function PastDueChoice({ count, value = PAST_DUE_DEFAULT, onChange, manager = 'the manager' }) {
  if (!count) return null;
  const many = count > 1;

  return (
    <Alert
      type="warning"
      showIcon
      style={{ marginBottom: 14 }}
      message={`${count} evaluation${many ? 's are' : ' is'} already past due`}
      description={
        <>
          <p style={{ margin: '4px 0 8px' }}>
            Left as {many ? 'they are' : 'it is'}, {many ? 'all of them go' : 'it goes'} to {manager} with the next daily
            send. What should happen to {many ? 'them' : 'it'}?
          </p>
          <Radio.Group value={value} onChange={(ev) => onChange(ev.target.value)}>
            <Space direction="vertical" size={6}>
              {many && (
                <Radio value="send_latest">
                  <strong>Ask {manager} for the latest one only</strong> — the older {count - 1 === 1 ? 'one is' : 'ones are'} closed as history.
                </Radio>
              )}
              <Radio value="close">
                <strong>Keep {many ? 'them' : 'it'} blank</strong> — closed as history; nothing is sent until the next due date.
              </Radio>
              <Radio value="enter">
                <strong>I will enter the ratings myself</strong> — closed for now; open each one and use “Enter ratings”.
              </Radio>
              <Radio value="send_all">
                <strong>Ask {manager} for {many ? `all ${count}` : 'it'}</strong>
              </Radio>
            </Space>
          </Radio.Group>
        </>
      }
    />
  );
}
