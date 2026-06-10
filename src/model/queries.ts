import type { Person, TreeData, Union } from '../types';
import { fullName } from '../types';

export function getPerson(data: TreeData, id: string): Person | undefined {
  return data.persons[id];
}

export function getUnion(data: TreeData, id: string): Union | undefined {
  return data.unions[id];
}

/** Parents of a person (0, 1 or 2), via their child-union. */
export function getParents(data: TreeData, personId: string): Person[] {
  const p = data.persons[personId];
  if (!p?.unionAsChild) return [];
  const u = data.unions[p.unionAsChild];
  if (!u) return [];
  return u.partners.map((id) => data.persons[id]).filter(Boolean) as Person[];
}

/** All unions where the person is a partner, in stored order. */
export function getUnionsOf(data: TreeData, personId: string): Union[] {
  const p = data.persons[personId];
  if (!p) return [];
  return p.unionsAsPartner.map((id) => data.unions[id]).filter(Boolean) as Union[];
}

/** Spouses/partners of a person across all their unions. */
export function getSpouses(data: TreeData, personId: string): Person[] {
  const out: Person[] = [];
  for (const u of getUnionsOf(data, personId)) {
    for (const pid of u.partners) {
      if (pid !== personId && data.persons[pid]) out.push(data.persons[pid]);
    }
  }
  return out;
}

/** Children of a person across all their unions. */
export function getChildren(data: TreeData, personId: string): Person[] {
  const out: Person[] = [];
  for (const u of getUnionsOf(data, personId)) {
    for (const cid of u.children) {
      if (data.persons[cid]) out.push(data.persons[cid]);
    }
  }
  return out;
}

/** Siblings (incl. half-siblings, which share only one parent). */
export function getSiblings(data: TreeData, personId: string): Person[] {
  const seen = new Set<string>([personId]);
  const out: Person[] = [];
  for (const parent of getParents(data, personId)) {
    for (const child of getChildren(data, parent.id)) {
      if (!seen.has(child.id)) {
        seen.add(child.id);
        out.push(child);
      }
    }
  }
  return out;
}

export function getOtherPartner(u: Union, personId: string): string | undefined {
  return u.partners.find((id) => id !== personId);
}

export function searchPersons(data: TreeData, query: string): Person[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const terms = q.split(/\s+/);
  return Object.values(data.persons)
    .filter((p) => {
      const name = fullName(p).toLowerCase();
      return terms.every((t) => name.includes(t));
    })
    .sort((a, b) => fullName(a).localeCompare(fullName(b)))
    .slice(0, 12);
}

export function personCount(data: TreeData): number {
  return Object.keys(data.persons).length;
}

/**
 * Referential-integrity check. Returns human-readable problem list
 * (empty = consistent). Used after import and in dev.
 */
export function validate(data: TreeData): string[] {
  const problems: string[] = [];
  for (const p of Object.values(data.persons)) {
    for (const uid of p.unionsAsPartner) {
      const u = data.unions[uid];
      if (!u) problems.push(`${p.id}: unionsAsPartner references missing union ${uid}`);
      else if (!u.partners.includes(p.id))
        problems.push(`${p.id}: not listed as partner in union ${uid}`);
    }
    if (p.unionAsChild) {
      const u = data.unions[p.unionAsChild];
      if (!u) problems.push(`${p.id}: unionAsChild references missing union ${p.unionAsChild}`);
      else if (!u.children.includes(p.id))
        problems.push(`${p.id}: not listed as child in union ${p.unionAsChild}`);
    }
  }
  for (const u of Object.values(data.unions)) {
    if (u.partners.length === 0 && u.children.length === 0)
      problems.push(`${u.id}: empty union`);
    for (const pid of u.partners) {
      const p = data.persons[pid];
      if (!p) problems.push(`${u.id}: partner ${pid} missing`);
      else if (!p.unionsAsPartner.includes(u.id))
        problems.push(`${u.id}: partner ${pid} lacks back-reference`);
    }
    for (const cid of u.children) {
      const c = data.persons[cid];
      if (!c) problems.push(`${u.id}: child ${cid} missing`);
      else if (c.unionAsChild !== u.id)
        problems.push(`${u.id}: child ${cid} lacks back-reference`);
    }
  }
  if (data.focusId && !data.persons[data.focusId])
    problems.push(`focusId ${data.focusId} missing`);
  return problems;
}
