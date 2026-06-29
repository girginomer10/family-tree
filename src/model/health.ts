import type { Person, TreeData } from '../types';
import { childRelOf } from '../types';

/**
 * Hereditary-condition overlay.
 *
 *  - 'has'  = the person has the named condition recorded.
 *  - 'risk' = a *blood* descendant of an affected person who is not themselves
 *             affected. Risk only flows through birth children (adopted / step /
 *             foster children do not inherit), and it propagates down every
 *             generation, so grandchildren of a carrier are at-risk too.
 */
export type HealthMark = 'has' | 'risk';

/** Shared overlay palette so every chart view tints consistently. */
export const HEALTH_COLORS: Record<HealthMark, { fill: string; stroke: string }> = {
  has: { fill: '#bfe3dd', stroke: '#2f8f83' },
  risk: { fill: '#e3f2ef', stroke: '#7bb8af' },
};
export const HEALTH_DIM_OPACITY = 0.3;

/** Distinct hereditary condition names in the tree, most common first. */
export function hereditaryConditionNames(data: TreeData): { name: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const p of Object.values(data.persons)) {
    for (const c of p.conditions ?? []) {
      if (c.hereditary) counts.set(c.name, (counts.get(c.name) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

function personHasCondition(p: Person, name: string): boolean {
  return !!p.conditions?.some((c) => c.name === name);
}

export interface HealthOverlay {
  marks: Map<string, HealthMark>;
  affected: number;
  atRisk: number;
}

/** Classify every person for a hereditary condition (see HealthMark). */
export function computeHealthOverlay(data: TreeData, conditionName: string): HealthOverlay {
  const marks = new Map<string, HealthMark>();
  const affectedIds: string[] = [];
  for (const p of Object.values(data.persons)) {
    if (personHasCondition(p, conditionName)) {
      marks.set(p.id, 'has');
      affectedIds.push(p.id);
    }
  }

  // Walk down birth lines from each affected person, flagging descendants.
  const stack = [...affectedIds];
  const visited = new Set<string>(affectedIds);
  while (stack.length) {
    const person = data.persons[stack.pop()!];
    if (!person) continue;
    for (const uid of person.unionsAsPartner) {
      const u = data.unions[uid];
      if (!u) continue;
      for (const cid of u.children) {
        if (childRelOf(u, cid) !== 'birth' || !data.persons[cid]) continue;
        if (!marks.has(cid)) marks.set(cid, 'risk');
        if (!visited.has(cid)) {
          visited.add(cid);
          stack.push(cid);
        }
      }
    }
  }

  let atRisk = 0;
  for (const m of marks.values()) if (m === 'risk') atRisk++;
  return { marks, affected: affectedIds.length, atRisk };
}
