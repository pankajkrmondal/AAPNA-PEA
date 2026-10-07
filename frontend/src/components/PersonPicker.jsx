/**
 * PersonPicker — choose someone from Microsoft 365 by typing their name. U8.
 *
 * A reporting manager and a project leader used to be typed: a name in one box
 * and an email address in another, with nothing checking that the two were the
 * same person or that the address was real. A mistyped address meant an
 * evaluation that never arrived, found out a month later.
 *
 * This is still a text box. What is typed is kept exactly as typed, so when
 * Microsoft 365 cannot be reached — or the person is simply not in it — HR
 * carries on as before. Picking a suggestion is a shortcut, never a gate.
 *
 * It works as the child of a Form.Item, which supplies `value`, `onChange`
 * and `id`:
 *
 *   <Form.Item name="rm_name" …>
 *     <PersonPicker onPick={(p) => form.setFieldsValue({ rm_email: p.email })} />
 *   </Form.Item>
 *
 *   field="name"   (default) the box holds the person's name
 *   field="email"  the box holds their address — search by name, keep the address
 */
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AutoComplete } from 'antd';
import api, { unwrap } from '../api.js';

/** Typing has to pause this long before the directory is asked. */
const SETTLE_MS = 300;

/**
 * @param {object} props
 * @param {string} [props.value] @param {(v: string) => void} [props.onChange] - from Form.Item
 * @param {'name'|'email'} [props.field='name'] - which of the two the box holds
 * @param {(person: {name: string, email: string}) => void} [props.onPick] - a suggestion was chosen
 * @param {string} [props.placeholder]
 */
export default function PersonPicker({ value, onChange, onPick, field = 'name', placeholder, ...rest }) {
  const [term, setTerm] = useState('');
  const [settled, setSettled] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setSettled(term.trim()), SETTLE_MS);
    return () => clearTimeout(t);
  }, [term]);

  const asking = settled.length >= 2;

  const { data } = useQuery({
    queryKey: ['directory-people', settled.toLowerCase()],
    queryFn: () => api.get('/directory/people', { params: { q: settled } }).then(unwrap),
    enabled: asking,
    staleTime: 5 * 60_000,
    // A picker that cannot reach the directory is a plain text box, not an error.
    retry: false,
  });

  // Keyed by address, which is unique; two people can share a name.
  const options = (data?.people || []).map((p) => ({
    value: p.email,
    person: p,
    label: (
      <div className="pea-person-option">
        <span>{p.name}</span>
        <span className="pea-muted pea-small">{p.email}</span>
      </div>
    ),
  }));

  const nothing = !asking || !data
    ? null
    : data.available === false
      ? data.reason || 'Microsoft 365 could not be reached — type it in instead.'
      : 'Nobody in Microsoft 365 matches — what you typed is kept.';

  return (
    <AutoComplete
      {...rest}
      value={value}
      options={options}
      // The server has already matched and ranked; filtering again here would
      // compare what was typed with the address and hide the name matches.
      filterOption={false}
      onSearch={setTerm}
      onChange={(v, option) => onChange?.(option?.person ? option.person[field] : v)}
      onSelect={(_, option) => {
        onChange?.(option.person[field]);
        onPick?.(option.person);
      }}
      placeholder={placeholder}
      notFoundContent={nothing && <span className="pea-muted pea-small">{nothing}</span>}
      popupMatchSelectWidth={false}
    />
  );
}

/**
 * What choosing a reporting manager fills in on a form that has `rm_name`,
 * `rm_email` and `pl_email`: the manager's address, and the project leader PEA
 * would suggest for them — the first person on the Leaders list at or above
 * that manager. The Leaders list is the only source (decided 02-10-2026).
 *
 * When nobody up the chain is on the list, nothing is guessed at: the field is
 * left alone and the note says to choose.
 *
 * @param {import('antd').FormInstance} form
 * @returns {{onPickManager: (person: {name: string, email: string}) => Promise<void>,
 *   plNote: string|null, clearPlNote: () => void}}
 */
export function useManagerPick(form) {
  const [plNote, setPlNote] = useState(null);

  const onPickManager = async (person) => {
    form.setFieldsValue({ rm_email: person.email });
    setPlNote(null);

    try {
      const pl = await api.get('/directory/project-leader', { params: { rm_email: person.email } }).then(unwrap);
      /* U8 (decided 02-10-2026) — the Leaders list is the only source. The notes
         for the two cases that came from the manager's other Commandos, kept
         for reference:
      if (pl.pl_email) {
        form.setFieldsValue({ pl_email: pl.pl_email });
        setPlNote(
          pl.source === 'leaders_list'
            ? `Filled in from the Leaders list: the first leader at or above ${person.name}. Check it.`
            : `Filled in from ${person.name}’s other Commandos. Check it.`
        );
      } else if (pl.ambiguous) {
        setPlNote(`${person.name} has more than one project leader, so none was filled in — choose the right one.`);
      }
      */
      if (pl.pl_email) {
        form.setFieldsValue({ pl_email: pl.pl_email });
        setPlNote(`Filled in from the Leaders list: the first leader at or above ${person.name}. Check it.`);
      } else {
        setPlNote(`Nobody on the Leaders list is at or above ${person.name}, so none was filled in — choose the project leader.`);
      }
    } catch {
      // The suggestion is a convenience. Without it the box is simply typed in.
    }
  };

  return { onPickManager, plNote, clearPlNote: () => setPlNote(null) };
}
