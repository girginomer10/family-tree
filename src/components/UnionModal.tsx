import { useEffect, useState } from 'react';
import type { FuzzyDate, TreeData, Union, UnionStatus } from '../types';
import { fullName } from '../types';

interface Props {
  data: TreeData;
  union: Union;
  onSave: (fields: Partial<Pick<Union, 'status' | 'marriage' | 'divorce'>>) => void;
  onCancel: () => void;
}

const STATUSES: [UnionStatus, string][] = [
  ['married', 'Married'],
  ['partners', 'Partners'],
  ['divorced', 'Divorced'],
  ['separated', 'Separated'],
  ['widowed', 'Widowed'],
  ['unknown', 'Unknown'],
];

function yearOf(d?: FuzzyDate): string {
  return d?.year != null ? String(d.year) : '';
}

export function UnionModal({ data, union, onSave, onCancel }: Props) {
  const [status, setStatus] = useState<UnionStatus>(union.status);
  const [marriageYear, setMarriageYear] = useState(yearOf(union.marriage?.date));
  const [marriagePlace, setMarriagePlace] = useState(union.marriage?.place ?? '');
  const [divorceYear, setDivorceYear] = useState(yearOf(union.divorce?.date));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const names = union.partners
    .map((id) => data.persons[id])
    .filter(Boolean)
    .map((p) => fullName(p!))
    .join(' & ');

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const my = marriageYear.trim() ? parseInt(marriageYear, 10) : undefined;
    const dy = divorceYear.trim() ? parseInt(divorceYear, 10) : undefined;
    onSave({
      status,
      marriage:
        my != null || marriagePlace.trim()
          ? {
              ...(my != null && !Number.isNaN(my) ? { date: { year: my } } : {}),
              ...(marriagePlace.trim() ? { place: marriagePlace.trim() } : {}),
            }
          : undefined,
      divorce: dy != null && !Number.isNaN(dy) ? { date: { year: dy } } : undefined,
    });
  };

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Relationship</h2>
        <p className="modal-subtitle">{names || 'Unknown partner'}</p>
        <form onSubmit={submit}>
          <div className="form-row">
            <label className="select-label">
              Status
              <select value={status} onChange={(e) => setStatus(e.target.value as UnionStatus)}>
                {STATUSES.map(([v, label]) => (
                  <option key={v} value={v}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="form-row">
            <input
              type="number"
              placeholder="Marriage year"
              value={marriageYear}
              onChange={(e) => setMarriageYear(e.target.value)}
              style={{ width: 130 }}
            />
            <input
              type="text"
              placeholder="Marriage place"
              value={marriagePlace}
              onChange={(e) => setMarriagePlace(e.target.value)}
            />
          </div>
          {(status === 'divorced' || status === 'separated') && (
            <div className="form-row">
              <input
                type="number"
                placeholder="Divorce year"
                value={divorceYear}
                onChange={(e) => setDivorceYear(e.target.value)}
                style={{ width: 130 }}
              />
            </div>
          )}
          <div className="modal-actions">
            <button type="button" className="btn" onClick={onCancel}>
              Cancel
            </button>
            <button type="submit" className="btn primary">
              Save
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
