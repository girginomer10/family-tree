import { useEffect, useMemo, useRef, useState } from 'react';
import type { FuzzyDate, Gender, Person, TreeData } from '../types';
import { fullName, lifespan } from '../types';
import type { PersonDraft } from '../model/mutations';
import { searchPersons } from '../model/queries';
import { fileToDataUrl } from '../utils/files';

// ---------------------------------------------------------------------------
// Fuzzy date editor

interface DateState {
  year: string;
  month: string;
  day: string;
  qualifier: string;
}

function toDateState(d?: FuzzyDate): DateState {
  return {
    year: d?.year != null ? String(d.year) : '',
    month: d?.month != null ? String(d.month) : '',
    day: d?.day != null ? String(d.day) : '',
    qualifier: d?.qualifier ?? 'exact',
  };
}

function fromDateState(s: DateState): FuzzyDate | undefined {
  const year = s.year.trim() ? parseInt(s.year, 10) : undefined;
  const month = s.month ? parseInt(s.month, 10) : undefined;
  const day = s.day.trim() ? parseInt(s.day, 10) : undefined;
  if (year == null && month == null && day == null) return undefined;
  const d: FuzzyDate = {};
  if (year != null && !Number.isNaN(year)) d.year = year;
  if (month != null && !Number.isNaN(month)) d.month = month;
  if (day != null && !Number.isNaN(day)) d.day = day;
  if (s.qualifier !== 'exact') d.qualifier = s.qualifier as FuzzyDate['qualifier'];
  return Object.keys(d).length ? d : undefined;
}

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

function DateFields({
  label,
  value,
  onChange,
}: {
  label: string;
  value: DateState;
  onChange: (v: DateState) => void;
}) {
  return (
    <div className="form-row date-row">
      <span className="date-label">{label}</span>
      <select
        value={value.qualifier}
        onChange={(e) => onChange({ ...value, qualifier: e.target.value })}
        title="Date precision"
      >
        <option value="exact">on</option>
        <option value="about">abt.</option>
        <option value="before">bef.</option>
        <option value="after">aft.</option>
      </select>
      <input
        type="number"
        placeholder="Day"
        min={1}
        max={31}
        value={value.day}
        onChange={(e) => onChange({ ...value, day: e.target.value })}
        style={{ width: 58 }}
      />
      <select value={value.month} onChange={(e) => onChange({ ...value, month: e.target.value })}>
        <option value="">Month</option>
        {MONTH_NAMES.map((m, i) => (
          <option key={m} value={i + 1}>
            {m}
          </option>
        ))}
      </select>
      <input
        type="number"
        placeholder="Year"
        value={value.year}
        onChange={(e) => onChange({ ...value, year: e.target.value })}
        style={{ width: 76 }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Person form modal

export interface PersonFormResult {
  draft: PersonDraft;
  /** Chosen value from `unionOptions` (e.g. which union a child joins). */
  unionChoice?: string | null;
}

export interface UnionOption {
  id: string | null;
  label: string;
}

interface Props {
  title: string;
  submitLabel: string;
  initial?: Person;
  defaultGender?: Gender;
  defaultSurname?: string;
  /** Offered as a "with …" select (add-child: which union the child joins). */
  unionOptions?: UnionOption[];
  /** When set, the form offers an "existing person" picker (for spouse links). */
  allowExisting?: { data: TreeData; excludeIds: string[] };
  onSubmit: (result: PersonFormResult) => void;
  onLinkExisting?: (personId: string) => void;
  onCancel: () => void;
}

export function PersonFormModal({
  title,
  submitLabel,
  initial,
  defaultGender,
  defaultSurname,
  unionOptions,
  allowExisting,
  onSubmit,
  onLinkExisting,
  onCancel,
}: Props) {
  const [mode, setMode] = useState<'new' | 'existing'>('new');
  const [unionChoice, setUnionChoice] = useState<string>(
    unionOptions?.[0]?.id ?? '__none__',
  );
  const [givenName, setGivenName] = useState(initial?.givenName ?? '');
  const [surname, setSurname] = useState(initial?.surname ?? defaultSurname ?? '');
  const [gender, setGender] = useState<Gender>(initial?.gender ?? defaultGender ?? 'U');
  const [birthDate, setBirthDate] = useState<DateState>(toDateState(initial?.birth?.date));
  const [birthPlace, setBirthPlace] = useState(initial?.birth?.place ?? '');
  const [deceased, setDeceased] = useState(!!(initial?.isDeceased || initial?.death));
  const [deathDate, setDeathDate] = useState<DateState>(toDateState(initial?.death?.date));
  const [deathPlace, setDeathPlace] = useState(initial?.death?.place ?? '');
  const [occupation, setOccupation] = useState(initial?.occupation ?? '');
  const [photoUrl, setPhotoUrl] = useState(initial?.photoUrl ?? '');
  const [photoError, setPhotoError] = useState('');
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [query, setQuery] = useState('');
  const photoFileRef = useRef<HTMLInputElement>(null);

  const handlePhotoFile = async (file: File) => {
    try {
      setPhotoError('');
      setPhotoUrl(await fileToDataUrl(file));
    } catch (e) {
      setPhotoError(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const existingResults = useMemo(() => {
    if (!allowExisting || mode !== 'existing') return [];
    return searchPersons(allowExisting.data, query).filter(
      (p) => !allowExisting.excludeIds.includes(p.id),
    );
  }, [allowExisting, mode, query]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const bd = fromDateState(birthDate);
    const dd = fromDateState(deathDate);
    const draft: PersonDraft = {
      givenName: givenName.trim(),
      surname: surname.trim(),
      gender,
      birth:
        bd || birthPlace.trim()
          ? { ...(bd ? { date: bd } : {}), ...(birthPlace.trim() ? { place: birthPlace.trim() } : {}) }
          : undefined,
      death:
        deceased && (dd || deathPlace.trim())
          ? { ...(dd ? { date: dd } : {}), ...(deathPlace.trim() ? { place: deathPlace.trim() } : {}) }
          : undefined,
      isDeceased: deceased,
      occupation: occupation.trim() || undefined,
      photoUrl: photoUrl.trim() || undefined,
      notes: notes.trim() || undefined,
    };
    onSubmit({
      draft,
      unionChoice: unionOptions ? (unionChoice === '__none__' ? null : unionChoice) : undefined,
    });
  };

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{title}</h2>

        {allowExisting && (
          <div className="tabs">
            <button
              type="button"
              className={mode === 'new' ? 'active' : ''}
              onClick={() => setMode('new')}
            >
              New person
            </button>
            <button
              type="button"
              className={mode === 'existing' ? 'active' : ''}
              onClick={() => setMode('existing')}
            >
              Existing person
            </button>
          </div>
        )}

        {mode === 'existing' && allowExisting ? (
          <div className="existing-picker">
            <input
              autoFocus
              type="text"
              placeholder="Search by name…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <ul className="search-results static">
              {existingResults.map((p) => (
                <li key={p.id}>
                  <button type="button" onClick={() => onLinkExisting?.(p.id)}>
                    <strong>{fullName(p)}</strong>
                    <span>{lifespan(p)}</span>
                  </button>
                </li>
              ))}
              {query.trim() && existingResults.length === 0 && (
                <li className="empty">No matches</li>
              )}
            </ul>
            <div className="modal-actions">
              <button type="button" className="btn" onClick={onCancel}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={submit}>
            {unionOptions && unionOptions.length > 0 && (
              <div className="form-row">
                <label className="select-label">
                  Other parent
                  <select
                    value={unionChoice}
                    onChange={(e) => setUnionChoice(e.target.value)}
                  >
                    {unionOptions.map((o) => (
                      <option key={o.id ?? '__none__'} value={o.id ?? '__none__'}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )}
            <div className="form-row">
              <input
                autoFocus
                type="text"
                placeholder="Given name"
                value={givenName}
                onChange={(e) => setGivenName(e.target.value)}
              />
              <input
                type="text"
                placeholder="Surname"
                value={surname}
                onChange={(e) => setSurname(e.target.value)}
              />
            </div>

            <div className="form-row gender-row">
              {(
                [
                  ['M', 'Male'],
                  ['F', 'Female'],
                  ['U', 'Unknown'],
                ] as [Gender, string][]
              ).map(([g, label]) => (
                <label key={g} className={gender === g ? 'chip active' : 'chip'}>
                  <input
                    type="radio"
                    name="gender"
                    checked={gender === g}
                    onChange={() => setGender(g)}
                  />
                  {label}
                </label>
              ))}
            </div>

            <DateFields label="Born" value={birthDate} onChange={setBirthDate} />
            <div className="form-row">
              <input
                type="text"
                placeholder="Birth place"
                value={birthPlace}
                onChange={(e) => setBirthPlace(e.target.value)}
              />
            </div>

            <div className="form-row">
              <label className="check">
                <input
                  type="checkbox"
                  checked={deceased}
                  onChange={(e) => setDeceased(e.target.checked)}
                />
                Deceased
              </label>
            </div>
            {deceased && (
              <>
                <DateFields label="Died" value={deathDate} onChange={setDeathDate} />
                <div className="form-row">
                  <input
                    type="text"
                    placeholder="Death place"
                    value={deathPlace}
                    onChange={(e) => setDeathPlace(e.target.value)}
                  />
                </div>
              </>
            )}

            <div className="form-row">
              <input
                type="text"
                placeholder="Occupation"
                value={occupation}
                onChange={(e) => setOccupation(e.target.value)}
              />
            </div>
            <div className="form-row photo-row">
              {photoUrl && <img className="photo-preview" src={photoUrl} alt="" />}
              <button
                type="button"
                className="btn small"
                onClick={() => photoFileRef.current?.click()}
              >
                {photoUrl ? 'Change photo…' : 'Upload photo…'}
              </button>
              {photoUrl && (
                <button type="button" className="btn small" onClick={() => setPhotoUrl('')}>
                  Remove
                </button>
              )}
              <input
                ref={photoFileRef}
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handlePhotoFile(f);
                  e.target.value = '';
                }}
              />
            </div>
            {photoError && <p className="form-error">{photoError}</p>}
            {!photoUrl.startsWith('data:') && (
              <div className="form-row">
                <input
                  type="url"
                  placeholder="…or photo URL"
                  value={photoUrl}
                  onChange={(e) => setPhotoUrl(e.target.value)}
                />
              </div>
            )}
            <div className="form-row">
              <textarea
                placeholder="Notes"
                rows={3}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>

            <div className="modal-actions">
              <button type="button" className="btn" onClick={onCancel}>
                Cancel
              </button>
              <button type="submit" className="btn primary">
                {submitLabel}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
