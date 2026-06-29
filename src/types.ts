/**
 * Core data model: Person + Union (GEDCOM INDI/FAM style).
 *
 * A Union is a partnership (marriage or otherwise) between up to two people,
 * and it owns the list of children born/adopted into it. This is the only
 * model that cleanly expresses multiple spouses, half-siblings and unknown
 * parents without special cases.
 *
 * Referential integrity rules (enforced by mutations, checked by validate):
 *  - person.unionsAsPartner[u] <=> u.partners includes person.id
 *  - person.unionAsChild = u   <=> u.children includes person.id
 */

export type Gender = 'M' | 'F' | 'U';

export type DateQualifier = 'exact' | 'about' | 'before' | 'after';

export interface FuzzyDate {
  year?: number;
  month?: number; // 1-12
  day?: number; // 1-31
  qualifier?: DateQualifier;
}

export interface LifeEvent {
  date?: FuzzyDate;
  place?: string;
}

/** Clinical status of a recorded condition. */
export type ConditionStatus = 'active' | 'managed' | 'resolved' | 'cause-of-death';

/**
 * A health condition / illness recorded for a person. `hereditary` marks
 * heritable conditions so they can be traced through bloodlines.
 */
export interface HealthCondition {
  name: string;
  hereditary?: boolean;
  status?: ConditionStatus;
  /** Age (years) at onset / diagnosis, if known. */
  ageAtOnset?: number;
  notes?: string;
}

export const CONDITION_STATUS_LABEL: Record<ConditionStatus, string> = {
  active: 'active',
  managed: 'managed',
  resolved: 'resolved',
  'cause-of-death': 'cause of death',
};

export interface Person {
  id: string;
  givenName: string;
  surname: string;
  gender: Gender;
  birth?: LifeEvent;
  death?: LifeEvent;
  isDeceased?: boolean; // a death event also implies deceased
  occupation?: string;
  notes?: string;
  /** Recorded illnesses / health conditions. */
  conditions?: HealthCondition[];
  photoUrl?: string;
  /** Unions in which this person is a partner (~GEDCOM FAMS). */
  unionsAsPartner: string[];
  /** Union in which this person is a child (~GEDCOM FAMC). */
  unionAsChild?: string;
}

export type UnionStatus =
  | 'married'
  | 'partners'
  | 'divorced'
  | 'separated'
  | 'widowed'
  | 'unknown';

/** How a child is related to the union's partners (default: birth). */
export type ChildRelType = 'birth' | 'adopted' | 'step' | 'foster';

export interface Union {
  id: string;
  /** 1 or 2 person ids. A single partner means the other parent is unknown. */
  partners: string[];
  status: UnionStatus;
  marriage?: LifeEvent; // marriage date/place
  divorce?: LifeEvent;
  /** Child person ids, in sibling display order. */
  children: string[];
  /** Non-birth child relationships, keyed by child id (absent = birth). */
  childRels?: Record<string, ChildRelType>;
}

export function childRelOf(u: Union, childId: string): ChildRelType {
  return u.childRels?.[childId] ?? 'birth';
}

export interface TreeData {
  persons: Record<string, Person>;
  unions: Record<string, Union>;
  /** Person the tree view is centered on. */
  focusId: string | null;
  /** Display name of this tree/file. */
  name: string;
}

// ---------------------------------------------------------------------------
// Helpers

export function emptyTree(name = 'My Family Tree'): TreeData {
  return { persons: {}, unions: {}, focusId: null, name };
}

let idCounter = 0;
export function newId(prefix: string): string {
  idCounter = (idCounter + 1) % 1296;
  return `${prefix}_${Date.now().toString(36)}${idCounter
    .toString(36)
    .padStart(2, '0')}${Math.floor(Math.random() * 1296)
    .toString(36)
    .padStart(2, '0')}`;
}

export function fullName(p: Person): string {
  const name = [p.givenName, p.surname].filter(Boolean).join(' ').trim();
  return name || 'Unnamed';
}

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

export function formatDate(d?: FuzzyDate): string {
  if (!d || (d.year == null && d.month == null && d.day == null)) return '';
  const parts: string[] = [];
  if (d.day != null) parts.push(String(d.day));
  if (d.month != null && d.month >= 1 && d.month <= 12) parts.push(MONTHS[d.month - 1]);
  if (d.year != null) parts.push(String(d.year));
  const core = parts.join(' ');
  switch (d.qualifier) {
    case 'about': return `abt. ${core}`;
    case 'before': return `bef. ${core}`;
    case 'after': return `aft. ${core}`;
    default: return core;
  }
}

/** "1932–2001", "b. 1932", "1932–" (deceased, death date unknown) or "". */
export function lifespan(p: Person): string {
  const b = p.birth?.date?.year;
  const d = p.death?.date?.year;
  const deceased = p.isDeceased || !!p.death;
  if (b != null && d != null) return `${b}–${d}`;
  if (b != null) return deceased ? `${b}–` : `b. ${b}`;
  if (d != null) return `d. ${d}`;
  return '';
}

export function isAlive(p: Person): boolean {
  return !p.isDeceased && !p.death;
}

/** True if the person carries at least one condition flagged hereditary. */
export function hasHereditaryCondition(p: Person): boolean {
  return !!p.conditions?.some((c) => c.hereditary);
}

/** Compact one-line summary of a condition, e.g. "Diabetes · managed · onset 45". */
export function conditionSummary(c: HealthCondition): string {
  return [
    c.name,
    c.status ? CONDITION_STATUS_LABEL[c.status] : '',
    c.ageAtOnset != null ? `onset ${c.ageAtOnset}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
}
