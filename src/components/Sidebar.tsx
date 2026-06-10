import { useMemo, useState } from 'react';
import type { ChildRelType, Person, TreeData, Union } from '../types';
import { childRelOf, formatDate, fullName, lifespan } from '../types';
import { getParents, getSiblings, getUnionsOf } from '../model/queries';
import { relate } from '../model/kinship';

const CHILD_REL_CYCLE: ChildRelType[] = ['birth', 'adopted', 'step', 'foster'];

const STATUS_LABEL: Record<string, string> = {
  married: 'married',
  partners: 'partners',
  divorced: 'divorced',
  separated: 'separated',
  widowed: 'widowed',
  unknown: '',
};

interface Props {
  data: TreeData;
  person: Person;
  onSelect: (id: string) => void;
  onCenter: (id: string) => void;
  onEdit: () => void;
  onAddParent: () => void;
  onAddSpouse: () => void;
  onAddChild: () => void;
  onAddSibling: () => void;
  onEditUnion: (union: Union) => void;
  onUnlinkPartner: (unionId: string, personId: string) => void;
  onUnlinkChild: (childId: string) => void;
  onSetChildRel: (unionId: string, childId: string, rel: ChildRelType) => void;
  onReorderChild: (childId: string, dir: -1 | 1) => void;
  onOpenRelationship: () => void;
  onDelete: () => void;
  onClose: () => void;
}

function PersonRow({
  person,
  hint,
  onSelect,
  action,
}: {
  person: Person;
  hint?: string;
  onSelect: (id: string) => void;
  action?: React.ReactNode;
}) {
  return (
    <div className="rel-row">
      <button className="rel-link" onClick={() => onSelect(person.id)}>
        <span className={`dot g-${person.gender}`} />
        <span className="rel-name">{fullName(person)}</span>
        <span className="rel-hint">{hint ?? lifespan(person)}</span>
      </button>
      {action}
    </div>
  );
}

/** Small destructive button that asks for a second click to confirm. */
function TwoStep({
  label,
  confirmLabel,
  className,
  onConfirm,
  title,
}: {
  label: string;
  confirmLabel: string;
  className?: string;
  onConfirm: () => void;
  title?: string;
}) {
  const [armed, setArmed] = useState(false);
  return (
    <button
      className={`${className ?? ''} ${armed ? 'armed' : ''}`}
      title={title}
      onClick={() => {
        if (armed) {
          setArmed(false);
          onConfirm();
        } else {
          setArmed(true);
          setTimeout(() => setArmed(false), 2500);
        }
      }}
    >
      {armed ? confirmLabel : label}
    </button>
  );
}

export function Sidebar(props: Props) {
  const { data, person, onSelect } = props;
  const parents = getParents(data, person.id);
  const unions = getUnionsOf(data, person.id);
  const siblings = getSiblings(data, person.id);
  const isFocus = data.focusId === person.id;

  // kinship chip: how this person relates to the focus person
  const relationChip = useMemo(() => {
    if (isFocus || !data.focusId || !data.persons[data.focusId]) return null;
    const r = relate(data, person.id, data.focusId);
    if (!r.short) return null;
    return `${r.short} of ${data.persons[data.focusId].givenName || 'focus'}`;
  }, [data, person.id, isFocus]);

  const facts: [string, string][] = [];
  if (person.birth?.date || person.birth?.place) {
    facts.push([
      'Born',
      [formatDate(person.birth?.date), person.birth?.place].filter(Boolean).join(' · '),
    ]);
  }
  if (person.death?.date || person.death?.place) {
    facts.push([
      'Died',
      [formatDate(person.death?.date), person.death?.place].filter(Boolean).join(' · '),
    ]);
  } else if (person.isDeceased) {
    facts.push(['Died', 'date unknown']);
  }
  if (person.occupation) facts.push(['Occupation', person.occupation]);

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <div className={`avatar g-${person.gender}`}>
          {person.photoUrl ? (
            <img src={person.photoUrl} alt="" />
          ) : (
            <span>
              {(person.givenName.charAt(0) + person.surname.charAt(0)).toUpperCase() || '?'}
            </span>
          )}
        </div>
        <div className="sidebar-title">
          <h2>{fullName(person)}</h2>
          <p>{lifespan(person) || ' '}</p>
        </div>
        <button className="icon-btn" title="Close" onClick={props.onClose}>
          ✕
        </button>
      </div>

      {relationChip && (
        <button
          className="relation-chip"
          title="Open relationship calculator"
          onClick={props.onOpenRelationship}
        >
          ✦ {relationChip}
        </button>
      )}

      <div className="sidebar-actions">
        {!isFocus && (
          <button className="btn small" onClick={() => props.onCenter(person.id)}>
            ⌖ Center tree
          </button>
        )}
        <button className="btn small" onClick={props.onEdit}>
          ✎ Edit
        </button>
      </div>

      {facts.length > 0 && (
        <section>
          <h3>Facts</h3>
          <dl className="facts">
            {facts.map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {person.notes && (
        <section>
          <h3>Notes</h3>
          <p className="notes">{person.notes}</p>
        </section>
      )}

      <section>
        <div className="section-head">
          <h3>Parents</h3>
          {parents.length < 2 && (
            <button className="icon-btn add" title="Add parent" onClick={props.onAddParent}>
              +
            </button>
          )}
        </div>
        {parents.length === 0 && <p className="empty-hint">Unknown</p>}
        {parents.map((p) => (
          <PersonRow key={p.id} person={p} onSelect={onSelect} />
        ))}
      </section>

      <section>
        <div className="section-head">
          <h3>Spouses & children</h3>
          <button
            className="icon-btn add"
            title="Add spouse / partner"
            onClick={props.onAddSpouse}
          >
            +
          </button>
        </div>
        {unions.length === 0 && <p className="empty-hint">No partners recorded</p>}
        {unions.map((u) => {
          const partner = u.partners
            .filter((id) => id !== person.id)
            .map((id) => data.persons[id])
            .filter(Boolean)[0];
          const statusBits = [
            STATUS_LABEL[u.status],
            u.marriage?.date ? `m. ${formatDate(u.marriage.date)}` : '',
            u.divorce?.date ? `div. ${formatDate(u.divorce.date)}` : '',
          ]
            .filter(Boolean)
            .join(' · ');
          return (
            <div key={u.id} className="union-group">
              {partner ? (
                <PersonRow
                  person={partner}
                  hint={statusBits || lifespan(partner)}
                  onSelect={onSelect}
                  action={
                    <span className="row-actions">
                      <button
                        className="icon-btn"
                        title="Edit relationship"
                        onClick={() => props.onEditUnion(u)}
                      >
                        ⚭
                      </button>
                      <TwoStep
                        label="✕"
                        confirmLabel="unlink?"
                        className="icon-btn danger"
                        title="Unlink this partner (children stay)"
                        onConfirm={() => props.onUnlinkPartner(u.id, partner.id)}
                      />
                    </span>
                  }
                />
              ) : (
                <div className="rel-row">
                  <span className="rel-link unknown-partner">
                    <span className="dot g-U" />
                    <span className="rel-name">Unknown partner</span>
                  </span>
                </div>
              )}
              {u.children.length > 0 && (
                <div className="children-list">
                  {u.children
                    .map((id) => data.persons[id])
                    .filter(Boolean)
                    .map((c, ci, arr) => (
                      <PersonRow
                        key={c!.id}
                        person={c!}
                        hint={
                          childRelOf(u, c!.id) !== 'birth' ? childRelOf(u, c!.id) : lifespan(c!)
                        }
                        onSelect={onSelect}
                        action={
                          <span className="row-actions">
                            <button
                              className={`icon-btn rel-type ${
                                childRelOf(u, c!.id) !== 'birth' ? 'set' : ''
                              }`}
                              title={`Child relationship: ${childRelOf(u, c!.id)} — click to change`}
                              onClick={() => {
                                const cur = CHILD_REL_CYCLE.indexOf(childRelOf(u, c!.id));
                                props.onSetChildRel(
                                  u.id,
                                  c!.id,
                                  CHILD_REL_CYCLE[(cur + 1) % CHILD_REL_CYCLE.length],
                                );
                              }}
                            >
                              {childRelOf(u, c!.id) === 'birth' ? '☉' : '◌'}
                            </button>
                            {arr.length > 1 && (
                              <>
                                <button
                                  className="icon-btn order"
                                  title="Move up among siblings"
                                  disabled={ci === 0}
                                  onClick={() => props.onReorderChild(c!.id, -1)}
                                >
                                  ↑
                                </button>
                                <button
                                  className="icon-btn order"
                                  title="Move down among siblings"
                                  disabled={ci === arr.length - 1}
                                  onClick={() => props.onReorderChild(c!.id, 1)}
                                >
                                  ↓
                                </button>
                              </>
                            )}
                            <TwoStep
                              label="✕"
                              confirmLabel="unlink?"
                              className="icon-btn danger"
                              title="Detach this child from these parents"
                              onConfirm={() => props.onUnlinkChild(c!.id)}
                            />
                          </span>
                        }
                      />
                    ))}
                </div>
              )}
            </div>
          );
        })}
        <button className="btn small ghost" onClick={props.onAddChild}>
          + Add child
        </button>
      </section>

      <section>
        <div className="section-head">
          <h3>Siblings</h3>
          <button className="icon-btn add" title="Add sibling" onClick={props.onAddSibling}>
            +
          </button>
        </div>
        {siblings.length === 0 && <p className="empty-hint">None recorded</p>}
        {siblings.map((s) => (
          <PersonRow key={s.id} person={s} onSelect={onSelect} />
        ))}
      </section>

      <div className="sidebar-footer">
        <TwoStep
          label="Delete person"
          confirmLabel="Click again to delete"
          className="btn small danger-btn"
          onConfirm={props.onDelete}
        />
      </div>
    </aside>
  );
}
