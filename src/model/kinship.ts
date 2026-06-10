import type { Gender, Person, TreeData, Union } from '../types';
import { fullName } from '../types';

/**
 * Kinship calculator.
 *
 * Blood relations are derived from the closest common ancestor(s): with
 * `a` = A's generations up to the common ancestor and `b` = B's,
 *   a=0 -> ancestor, b=0 -> descendant, a=b=1 -> sibling,
 *   a=1 -> uncle/aunt line, b=1 -> nephew/niece line,
 *   else cousins of degree min(a,b)-1, |a-b| removed.
 * Affinal (in-law) relations are reported compositionally through the
 * connecting spouse ("the husband of X, who is the first cousin of B").
 * As a last resort a BFS over the whole family graph yields a step chain.
 */

// --- ancestor maps -----------------------------------------------------------

/** Minimal up-distance to every ancestor (including self at 0). */
export function ancestorDepths(data: TreeData, id: string): Map<string, number> {
  const depths = new Map<string, number>();
  const queue: [string, number][] = [[id, 0]];
  while (queue.length) {
    const [pid, d] = queue.shift()!;
    const known = depths.get(pid);
    if (known != null && known <= d) continue;
    depths.set(pid, d);
    const p = data.persons[pid];
    const u = p?.unionAsChild ? data.unions[p.unionAsChild] : undefined;
    for (const parent of u?.partners ?? []) {
      if (data.persons[parent]) queue.push([parent, d + 1]);
    }
  }
  return depths;
}

export interface BloodRelation {
  a: number; // A's generations up to the common ancestor(s)
  b: number; // B's generations up
  commonAncestors: string[]; // 1 = half/single line, 2 = full couple
}

export function bloodRelation(data: TreeData, aId: string, bId: string): BloodRelation | null {
  if (aId === bId) return { a: 0, b: 0, commonAncestors: [aId] };
  const da = ancestorDepths(data, aId);
  const db = ancestorDepths(data, bId);
  let best: BloodRelation | null = null;
  for (const [id, a] of da) {
    const b = db.get(id);
    if (b == null) continue;
    if (
      !best ||
      a + b < best.a + best.b ||
      (a + b === best.a + best.b && Math.abs(a - b) < Math.abs(best.a - best.b))
    ) {
      best = { a, b, commonAncestors: [id] };
    } else if (a === best.a && b === best.b && a + b === best.a + best.b) {
      if (!best.commonAncestors.includes(id)) best.commonAncestors.push(id);
    }
  }
  return best;
}

// --- term building -----------------------------------------------------------

const g3 = (g: Gender, m: string, f: string, n: string) => (g === 'M' ? m : g === 'F' ? f : n);
const greats = (n: number) => 'great-'.repeat(Math.max(0, n));
const ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth'];
const ordinal = (n: number) => ORDINALS[n - 1] ?? `${n}th`;
const removedText = (n: number) =>
  n === 1 ? 'once removed' : n === 2 ? 'twice removed' : `${n} times removed`;

/** Blood kinship term for "A is the ___ of B". */
export function bloodTerm(rel: BloodRelation, genderOfA: Gender): string {
  const { a, b } = rel;
  if (a === 0 && b === 0) return 'same person';
  if (a === 0) {
    // A is an ancestor of B
    if (b === 1) return g3(genderOfA, 'father', 'mother', 'parent');
    return greats(b - 2) + g3(genderOfA, 'grandfather', 'grandmother', 'grandparent');
  }
  if (b === 0) {
    if (a === 1) return g3(genderOfA, 'son', 'daughter', 'child');
    return greats(a - 2) + g3(genderOfA, 'grandson', 'granddaughter', 'grandchild');
  }
  if (a === 1 && b === 1) {
    const full = rel.commonAncestors.length >= 2;
    return (full ? '' : 'half-') + g3(genderOfA, 'brother', 'sister', 'sibling');
  }
  if (a === 1) return greats(b - 2) + g3(genderOfA, 'uncle', 'aunt', 'uncle/aunt');
  if (b === 1) return greats(a - 2) + g3(genderOfA, 'nephew', 'niece', 'nephew/niece');
  const degree = Math.min(a, b) - 1;
  const removed = Math.abs(a - b);
  return `${ordinal(degree)} cousin${removed ? ` ${removedText(removed)}` : ''}`;
}

function spouseTerm(u: Union, genderOfA: Gender): string {
  const ex = u.status === 'divorced' || u.status === 'separated' ? 'ex-' : '';
  return ex + g3(genderOfA, 'husband', 'wife', 'partner');
}

function unionBetween(data: TreeData, aId: string, bId: string): Union | undefined {
  return Object.values(data.unions).find(
    (u) => u.partners.includes(aId) && u.partners.includes(bId),
  );
}

// --- full relation -----------------------------------------------------------

export interface ChainStep {
  personId: string;
  /** Term describing this person relative to the PREVIOUS person in the chain. */
  label?: string;
}

export interface RelationResult {
  /** Compact term, e.g. "first cousin", "wife of half-brother". */
  short: string | null;
  /** Full sentence, e.g. "Ali is the husband of X, who is the niece of Y." */
  sentence: string | null;
  /** Step-by-step chain (always present when any connection exists). */
  chain: ChainStep[] | null;
}

export function relate(data: TreeData, aId: string, bId: string): RelationResult {
  const A = data.persons[aId];
  const B = data.persons[bId];
  if (!A || !B) return { short: null, sentence: null, chain: null };
  const nameA = fullName(A);
  const nameB = fullName(B);

  if (aId === bId) return { short: 'same person', sentence: null, chain: null };

  // direct spouse
  const direct = unionBetween(data, aId, bId);
  if (direct) {
    const t = spouseTerm(direct, A.gender);
    return {
      short: t,
      sentence: `${nameA} is the ${t} of ${nameB}.`,
      chain: chainBetween(data, aId, bId),
    };
  }

  // blood
  const blood = bloodRelation(data, aId, bId);
  if (blood) {
    const t = bloodTerm(blood, A.gender);
    return {
      short: t,
      sentence: `${nameA} is the ${t} of ${nameB}.`,
      chain: chainBetween(data, aId, bId),
    };
  }

  // affinal: through A's spouse
  let bestVia: { via: Person; viaUnion: Union; rel: BloodRelation; viaSide: 'A' | 'B' } | null =
    null;
  for (const u of A.unionsAsPartner.map((id) => data.unions[id]).filter(Boolean)) {
    for (const pid of u!.partners) {
      if (pid === aId) continue;
      const rel = bloodRelation(data, pid, bId);
      if (rel && (!bestVia || rel.a + rel.b < bestVia.rel.a + bestVia.rel.b)) {
        bestVia = { via: data.persons[pid], viaUnion: u!, rel, viaSide: 'A' };
      }
    }
  }
  // through B's spouse
  for (const u of B.unionsAsPartner.map((id) => data.unions[id]).filter(Boolean)) {
    for (const pid of u!.partners) {
      if (pid === bId) continue;
      const rel = bloodRelation(data, aId, pid);
      if (rel && (!bestVia || rel.a + rel.b < bestVia.rel.a + bestVia.rel.b)) {
        bestVia = { via: data.persons[pid], viaUnion: u!, rel, viaSide: 'B' };
      }
    }
  }
  if (bestVia) {
    const viaName = fullName(bestVia.via);
    if (bestVia.viaSide === 'A') {
      const st = spouseTerm(bestVia.viaUnion, A.gender);
      const bt = bloodTerm(bestVia.rel, bestVia.via.gender);
      return {
        short: `${st} of ${bt}`,
        sentence: `${nameA} is the ${st} of ${viaName}, who is the ${bt} of ${nameB}.`,
        chain: chainBetween(data, aId, bId),
      };
    }
    const bt = bloodTerm(bestVia.rel, A.gender);
    const st = spouseTerm(bestVia.viaUnion, bestVia.via.gender);
    return {
      short: `${bt} of ${nameB}'s ${st}`,
      sentence: `${nameA} is the ${bt} of ${viaName}, the ${st} of ${nameB}.`,
      chain: chainBetween(data, aId, bId),
    };
  }

  // fallback: shortest chain through the whole graph
  const chain = chainBetween(data, aId, bId);
  return { short: null, sentence: null, chain };
}

// --- BFS chain ----------------------------------------------------------------

type EdgeKind = 'parent' | 'child' | 'partner';

function neighbors(data: TreeData, id: string): { id: string; kind: EdgeKind }[] {
  const p = data.persons[id];
  if (!p) return [];
  const out: { id: string; kind: EdgeKind }[] = [];
  const u = p.unionAsChild ? data.unions[p.unionAsChild] : undefined;
  for (const parent of u?.partners ?? []) out.push({ id: parent, kind: 'parent' });
  for (const uid of p.unionsAsPartner) {
    const un = data.unions[uid];
    if (!un) continue;
    for (const pid of un.partners) if (pid !== id) out.push({ id: pid, kind: 'partner' });
    for (const cid of un.children) out.push({ id: cid, kind: 'child' });
  }
  return out;
}

export function chainBetween(data: TreeData, aId: string, bId: string): ChainStep[] | null {
  if (aId === bId) return [{ personId: aId }];
  const prev = new Map<string, { from: string; kind: EdgeKind }>();
  const queue = [aId];
  const seen = new Set([aId]);
  while (queue.length) {
    const cur = queue.shift()!;
    for (const n of neighbors(data, cur)) {
      if (seen.has(n.id) || !data.persons[n.id]) continue;
      seen.add(n.id);
      prev.set(n.id, { from: cur, kind: n.kind });
      if (n.id === bId) {
        // reconstruct
        const steps: ChainStep[] = [];
        let at = bId;
        while (at !== aId) {
          const e = prev.get(at)!;
          const person = data.persons[at];
          steps.unshift({ personId: at, label: edgeLabel(e.kind, person.gender) });
          at = e.from;
        }
        steps.unshift({ personId: aId });
        return steps;
      }
      queue.push(n.id);
    }
  }
  return null;
}

function edgeLabel(kind: EdgeKind, g: Gender): string {
  switch (kind) {
    case 'parent':
      return g3(g, 'father', 'mother', 'parent') + ' of the above';
    case 'child':
      return g3(g, 'son', 'daughter', 'child') + ' of the above';
    case 'partner':
      return g3(g, 'husband', 'wife', 'partner') + ' of the above';
  }
}
