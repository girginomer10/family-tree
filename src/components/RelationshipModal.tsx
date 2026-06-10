import { useEffect, useMemo, useState } from 'react';
import type { TreeData } from '../types';
import { fullName, lifespan } from '../types';
import { searchPersons } from '../model/queries';
import { relate } from '../model/kinship';

interface Props {
  data: TreeData;
  initialA: string | null;
  initialB: string | null;
  onSelect: (id: string) => void;
  onClose: () => void;
}

function PersonPicker({
  data,
  value,
  placeholder,
  onChange,
}: {
  data: TreeData;
  value: string | null;
  placeholder: string;
  onChange: (id: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const results = useMemo(() => searchPersons(data, query), [data, query]);
  const person = value ? data.persons[value] : undefined;

  return (
    <div className="picker">
      {person && !open ? (
        <button className="picker-value" onClick={() => setOpen(true)} title="Change person">
          <strong>{fullName(person)}</strong>
          <span>{lifespan(person)}</span>
        </button>
      ) : (
        <>
          <input
            autoFocus={open}
            type="text"
            placeholder={placeholder}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query.trim() && (
            <ul className="search-results static compact">
              {results.map((p) => (
                <li key={p.id}>
                  <button
                    onClick={() => {
                      onChange(p.id);
                      setQuery('');
                      setOpen(false);
                    }}
                  >
                    <strong>{fullName(p)}</strong>
                    <span>{lifespan(p)}</span>
                  </button>
                </li>
              ))}
              {results.length === 0 && <li className="empty">No matches</li>}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

export function RelationshipModal({ data, initialA, initialB, onSelect, onClose }: Props) {
  const [aId, setAId] = useState<string | null>(initialA);
  const [bId, setBId] = useState<string | null>(initialB);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const result = useMemo(
    () => (aId && bId && aId !== bId ? relate(data, aId, bId) : null),
    [data, aId, bId],
  );

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Relationship calculator</h2>
        <div className="rel-pickers">
          <PersonPicker data={data} value={aId} placeholder="First person…" onChange={setAId} />
          <span className="rel-arrow">→</span>
          <PersonPicker data={data} value={bId} placeholder="Second person…" onChange={setBId} />
        </div>

        {aId && bId && aId === bId && <p className="rel-sentence">That is the same person.</p>}

        {result && (
          <>
            {result.sentence ? (
              <p className="rel-sentence">{result.sentence}</p>
            ) : result.chain ? (
              <p className="rel-sentence muted">
                No direct kinship term — connected through {result.chain.length - 1} links:
              </p>
            ) : (
              <p className="rel-sentence muted">
                These two people are not connected in this tree.
              </p>
            )}

            {result.chain && (
              <ol className="chain">
                {result.chain.map((step, i) => {
                  const p = data.persons[step.personId];
                  if (!p) return null;
                  return (
                    <li key={`${step.personId}-${i}`}>
                      <button className="rel-link" onClick={() => onSelect(step.personId)}>
                        <span className={`dot g-${p.gender}`} />
                        <span className="rel-name">{fullName(p)}</span>
                        <span className="rel-hint">{step.label ?? ''}</span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            )}
          </>
        )}

        <div className="modal-actions">
          <button className="btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
