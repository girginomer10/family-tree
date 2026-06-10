import type { ChildRelType, Gender, Person, TreeData, Union, UnionStatus } from '../types';
import { newId } from '../types';

/**
 * All mutations are pure: they take a TreeData and return a NEW TreeData
 * (structuredClone snapshot), which makes undo/redo trivial.
 * Every mutation maintains bidirectional person<->union consistency.
 */

export interface PersonDraft {
  givenName: string;
  surname: string;
  gender: Gender;
  birth?: Person['birth'];
  death?: Person['death'];
  isDeceased?: boolean;
  occupation?: string;
  notes?: string;
  photoUrl?: string;
}

function clone(data: TreeData): TreeData {
  return structuredClone(data);
}

function makePerson(draft: PersonDraft): Person {
  return {
    id: newId('I'),
    unionsAsPartner: [],
    ...draft,
  };
}

function makeUnion(partners: string[], status: UnionStatus = 'unknown'): Union {
  return { id: newId('F'), partners, status, children: [] };
}

function attachPartner(data: TreeData, union: Union, personId: string) {
  if (!union.partners.includes(personId)) union.partners.push(personId);
  const p = data.persons[personId];
  if (p && !p.unionsAsPartner.includes(union.id)) p.unionsAsPartner.push(union.id);
}

function attachChild(data: TreeData, union: Union, childId: string) {
  if (!union.children.includes(childId)) union.children.push(childId);
  const c = data.persons[childId];
  if (c) c.unionAsChild = union.id;
}

// ---------------------------------------------------------------------------
// Person creation in context

/** Add the very first person of an empty tree (or an unconnected person). */
export function addUnconnectedPerson(data: TreeData, draft: PersonDraft): { data: TreeData; id: string } {
  const next = clone(data);
  const p = makePerson(draft);
  next.persons[p.id] = p;
  if (!next.focusId) next.focusId = p.id;
  return { data: next, id: p.id };
}

/** Add a new person as spouse of `targetId` (creates a new union). */
export function addSpouse(data: TreeData, targetId: string, draft: PersonDraft): { data: TreeData; id: string } {
  const next = clone(data);
  const spouse = makePerson(draft);
  next.persons[spouse.id] = spouse;
  const union = makeUnion([], 'married');
  next.unions[union.id] = union;
  attachPartner(next, union, targetId);
  attachPartner(next, union, spouse.id);
  return { data: next, id: spouse.id };
}

/** Link two EXISTING persons as partners (new union between them). */
export function linkSpouses(data: TreeData, aId: string, bId: string): { data: TreeData; id: string } {
  const next = clone(data);
  const existing = Object.values(next.unions).find(
    (u) => u.partners.includes(aId) && u.partners.includes(bId),
  );
  if (existing) return { data, id: existing.id };
  const union = makeUnion([], 'married');
  next.unions[union.id] = union;
  attachPartner(next, union, aId);
  attachPartner(next, union, bId);
  return { data: next, id: union.id };
}

/**
 * Add a new child to `parentId`.
 * - unionId given: child joins that union.
 * - unionId null: a new single-partner union is created (other parent unknown).
 */
export function addChild(
  data: TreeData,
  parentId: string,
  unionId: string | null,
  draft: PersonDraft,
): { data: TreeData; id: string } {
  const next = clone(data);
  const child = makePerson(draft);
  next.persons[child.id] = child;
  let union = unionId ? next.unions[unionId] : undefined;
  if (!union) {
    union = makeUnion([], 'unknown');
    next.unions[union.id] = union;
    attachPartner(next, union, parentId);
  }
  attachChild(next, union, child.id);
  return { data: next, id: child.id };
}

/**
 * Add a new parent to `childId`.
 * Joins the child's existing parent-union if it has a free partner slot,
 * otherwise creates the union.
 */
export function addParent(data: TreeData, childId: string, draft: PersonDraft): { data: TreeData; id: string } {
  const next = clone(data);
  const parent = makePerson(draft);
  next.persons[parent.id] = parent;
  const child = next.persons[childId];
  let union = child.unionAsChild ? next.unions[child.unionAsChild] : undefined;
  if (union && union.partners.length >= 2) union = undefined; // already two parents
  if (!union && child.unionAsChild) {
    // child has a full parent union; shouldn't happen via UI — bail out safely
    return { data, id: '' };
  }
  if (!union) {
    union = makeUnion([], 'unknown');
    next.unions[union.id] = union;
    attachChild(next, union, childId);
  }
  attachPartner(next, union, parent.id);
  if (union.partners.length === 2) union.status = 'married';
  return { data: next, id: parent.id };
}

/** Add a new sibling of `targetId` (same parent union; creates one if missing). */
export function addSibling(data: TreeData, targetId: string, draft: PersonDraft): { data: TreeData; id: string } {
  const next = clone(data);
  const sibling = makePerson(draft);
  next.persons[sibling.id] = sibling;
  const target = next.persons[targetId];
  let union = target.unionAsChild ? next.unions[target.unionAsChild] : undefined;
  if (!union) {
    // create a parentless union holding both siblings (parents unknown)
    union = makeUnion([], 'unknown');
    next.unions[union.id] = union;
    attachChild(next, union, targetId);
  }
  attachChild(next, union, sibling.id);
  return { data: next, id: sibling.id };
}

// ---------------------------------------------------------------------------
// Edits

export function updatePerson(data: TreeData, id: string, draft: Partial<PersonDraft>): TreeData {
  const next = clone(data);
  const p = next.persons[id];
  if (!p) return data;
  Object.assign(p, draft);
  return next;
}

export function updateUnion(
  data: TreeData,
  id: string,
  fields: Partial<Pick<Union, 'status' | 'marriage' | 'divorce'>>,
): TreeData {
  const next = clone(data);
  const u = next.unions[id];
  if (!u) return data;
  Object.assign(u, fields);
  return next;
}

/** Set how a child relates to its parent union (birth/adopted/step/foster). */
export function setChildRel(
  data: TreeData,
  unionId: string,
  childId: string,
  rel: ChildRelType,
): TreeData {
  const next = clone(data);
  const u = next.unions[unionId];
  if (!u || !u.children.includes(childId)) return data;
  if (rel === 'birth') {
    if (u.childRels) {
      delete u.childRels[childId];
      if (Object.keys(u.childRels).length === 0) delete u.childRels;
    }
  } else {
    u.childRels = { ...u.childRels, [childId]: rel };
  }
  return next;
}

/** Move a child one position earlier/later among its siblings. */
export function reorderChild(data: TreeData, childId: string, dir: -1 | 1): TreeData {
  const next = clone(data);
  const child = next.persons[childId];
  const union = child?.unionAsChild ? next.unions[child.unionAsChild] : undefined;
  if (!union) return data;
  const i = union.children.indexOf(childId);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= union.children.length) return data;
  [union.children[i], union.children[j]] = [union.children[j], union.children[i]];
  return next;
}

// ---------------------------------------------------------------------------
// Unlinking / deletion

function pruneUnionIfEmpty(data: TreeData, unionId: string) {
  const u = data.unions[unionId];
  if (!u) return;
  // A union still carries meaning if it links 2+ people (a couple, a parent
  // with children, or a parentless sibling group). Anything smaller is a shell.
  if (u.partners.length + u.children.length >= 2) return;
  for (const cid of u.children) {
    const c = data.persons[cid];
    if (c && c.unionAsChild === unionId) delete c.unionAsChild;
  }
  for (const pid of u.partners) {
    const p = data.persons[pid];
    if (p) p.unionsAsPartner = p.unionsAsPartner.filter((x) => x !== unionId);
  }
  delete data.unions[unionId];
}

/** Remove a partner from a union (e.g. wrong link). Children stay in the union. */
export function unlinkPartner(data: TreeData, unionId: string, personId: string): TreeData {
  const next = clone(data);
  const u = next.unions[unionId];
  const p = next.persons[personId];
  if (!u || !p) return data;
  u.partners = u.partners.filter((x) => x !== personId);
  p.unionsAsPartner = p.unionsAsPartner.filter((x) => x !== unionId);
  pruneUnionIfEmpty(next, unionId);
  return next;
}

/** Detach a child from its parent union. */
export function unlinkChild(data: TreeData, childId: string): TreeData {
  const next = clone(data);
  const c = next.persons[childId];
  if (!c?.unionAsChild) return data;
  const u = next.unions[c.unionAsChild];
  if (u) {
    u.children = u.children.filter((x) => x !== childId);
    if (u.childRels) delete u.childRels[childId];
  }
  const unionId = c.unionAsChild;
  delete c.unionAsChild;
  pruneUnionIfEmpty(next, unionId);
  return next;
}

/** Delete a person and clean every reference to them. */
export function deletePerson(data: TreeData, id: string): TreeData {
  const next = clone(data);
  const p = next.persons[id];
  if (!p) return data;

  for (const uid of [...p.unionsAsPartner]) {
    const u = next.unions[uid];
    if (!u) continue;
    u.partners = u.partners.filter((x) => x !== id);
    pruneUnionIfEmpty(next, uid);
  }
  if (p.unionAsChild) {
    const u = next.unions[p.unionAsChild];
    if (u) {
      u.children = u.children.filter((x) => x !== id);
      if (u.childRels) delete u.childRels[id];
    }
    pruneUnionIfEmpty(next, p.unionAsChild);
  }
  delete next.persons[id];

  if (next.focusId === id) {
    // move focus to any related person, else any person, else null
    const fallback =
      Object.values(next.unions).flatMap((u) => [...u.partners, ...u.children])[0] ??
      Object.keys(next.persons)[0] ??
      null;
    next.focusId = fallback;
  }
  return next;
}

export function setFocus(data: TreeData, id: string): TreeData {
  if (!data.persons[id] || data.focusId === id) return data;
  const next = clone(data);
  next.focusId = id;
  return next;
}

export function renameTree(data: TreeData, name: string): TreeData {
  const next = clone(data);
  next.name = name;
  return next;
}
