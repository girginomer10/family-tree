import type { TreeData, Union } from '../types';

/**
 * Hourglass layout engine.
 *
 * The chart is centered on a focus person:
 *   - Descendant side: a tree of "blocks" (anchor person + spouse cards);
 *     children of all the anchor's unions become child blocks, grouped per
 *     union. Root block is the focus's parent couple (so the focus's siblings
 *     appear), or the focus itself if parents are unknown.
 *   - Ancestor side: a pedigree tree of couple blocks growing upward from the
 *     parent couple (father's parents left, mother's parents right).
 *
 * The two trees are laid out INDEPENDENTLY with a tidy-tree walk (post-order
 * extent merging with per-level contours, then a pre-order absolute pass) and
 * glued at the shared parent-couple block, which sits at x=0 in both — so they
 * align by construction. Ancestor cards live at generations <= -2, descendant
 * cards at >= 0, the shared couple at -1: no cross-tree card collisions.
 *
 * Connectors are orthogonal "bus" polylines:
 *   marriage point -> drop to a lane between rows -> along the lane -> stub
 *   down into each child card. Spouse links are straight segments between
 *   adjacent cards. Multiple buses in one gap get staggered lanes.
 */

// --- Geometry constants ----------------------------------------------------

export const CARD_W = 124;
export const CARD_H = 146;
const SPOUSE_GAP = 20;
const SIBLING_GAP = 28;
const UNION_GROUP_GAP = 52;
const SUBTREE_GAP = 40;
const GEN_GAP = 86;
const LANE_STEP = 10;

const rowTop = (gen: number) => gen * (CARD_H + GEN_GAP);
const rowBottom = (gen: number) => rowTop(gen) + CARD_H;
const rowCenter = (gen: number) => rowTop(gen) + CARD_H / 2;

// --- Output types ----------------------------------------------------------

export interface PlacedCard {
  key: string;
  personId: string;
  x: number; // left
  y: number; // top
  gen: number;
  isFocus?: boolean;
  isStub?: boolean; // duplicate appearance (pedigree collapse / intermarriage)
  isGhost?: boolean; // "+ add parents" placeholder
  hasMoreAncestors?: boolean;
  hasMoreDescendants?: boolean;
}

export interface PlacedLink {
  key: string;
  d: string;
  kind: 'tree' | 'spouse' | 'ghost';
  dashed?: boolean;
}

export interface LayoutResult {
  cards: PlacedCard[];
  links: PlacedLink[];
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  shownPersons: number;
}

export type TreeViewMode = 'hourglass' | 'pedigree' | 'descendants';

export interface LayoutOptions {
  ancestorDepth: number; // generations above focus (1 = parents)
  descendantDepth: number; // generations below focus (1 = children)
  /**
   * hourglass: ancestors + descendants + (step)siblings (default)
   * pedigree: blood ancestors only (classic pedigree chart)
   * descendants: focus's descendants only
   */
  mode?: TreeViewMode;
}

// --- Internal block model ----------------------------------------------------

interface Slot {
  personId: string;
  dx: number; // card CENTER offset relative to block center
  isStub?: boolean;
  hasMoreAncestors?: boolean;
  hasMoreDescendants?: boolean;
}

/** Group of layout-children that hang off one connection point of this block. */
interface ChildGroup {
  marriageDX: number; // connection x-offset within this block
  coupleDrop: boolean; // drop starts at row center (between a couple) vs card bottom
  childIdx: number[]; // indexes into block.children
  groupGapBoundary: boolean; // first child of a non-first union group
}

interface Block {
  gen: number;
  cards: Slot[];
  width: number;
  anchorDX: number; // connection target when this block is a layout-child
  /** Person id of the block's anchor (blood-line person), for styling lookups. */
  anchorPersonId: string | null;
  children: Block[];
  groups: ChildGroup[];
  // layout fields
  extent: { l: number; r: number }[];
  childX: number[];
  cx: number;
}

function blockOf(gen: number, cards: Slot[]): Block {
  const width = cards.length ? cards.length * CARD_W + (cards.length - 1) * SPOUSE_GAP : CARD_W;
  return {
    gen,
    cards,
    width,
    anchorDX: 0,
    anchorPersonId: null,
    children: [],
    groups: [],
    extent: [],
    childX: [],
    cx: 0,
  };
}

// --- Layout algorithm (extent merging) ----------------------------------------

function requiredShift(
  merged: { l: number; r: number }[],
  ext: { l: number; r: number }[],
  level0Gap: number,
): number {
  let shift = -Infinity;
  const depth = Math.min(merged.length, ext.length);
  for (let l = 0; l < depth; l++) {
    const gap = l === 0 ? level0Gap : SUBTREE_GAP;
    shift = Math.max(shift, merged[l].r + gap - ext[l].l);
  }
  return shift === -Infinity ? 0 : shift;
}

function firstWalk(b: Block) {
  for (const c of b.children) firstWalk(c);

  if (b.children.length === 0) {
    b.extent = [{ l: -b.width / 2, r: b.width / 2 }];
    b.childX = [];
    return;
  }

  // place children left-to-right, resolving subtree overlaps
  let merged: { l: number; r: number }[] | null = null;
  const offsets: number[] = [];
  const boundary = new Set<number>();
  for (const g of b.groups) {
    if (g.groupGapBoundary && g.childIdx.length) boundary.add(g.childIdx[0]);
  }
  b.children.forEach((c, i) => {
    const gap = boundary.has(i) ? UNION_GROUP_GAP : SIBLING_GAP;
    const shift = merged ? requiredShift(merged, c.extent, gap) : 0;
    offsets.push(shift);
    const shifted = c.extent.map((e) => ({ l: e.l + shift, r: e.r + shift }));
    if (!merged) merged = shifted;
    else {
      const len = Math.max(merged.length, shifted.length);
      const m: { l: number; r: number }[] = [];
      for (let l = 0; l < len; l++) {
        const a = merged[l];
        const s = shifted[l];
        if (a && s) m.push({ l: Math.min(a.l, s.l), r: Math.max(a.r, s.r) });
        else m.push((a ?? s)!);
      }
      merged = m;
    }
  });

  // Decide which point inside THIS block should sit over the children:
  // midpoint of the connection anchors of the first and last child should
  // align with the midpoint of the corresponding marriage points here.
  const first = 0;
  const last = b.children.length - 1;
  const childConnMid =
    (offsets[first] + b.children[first].anchorDX + offsets[last] + b.children[last].anchorDX) / 2;
  const parentAnchorOf = (childIdx: number): number => {
    for (const g of b.groups) if (g.childIdx.includes(childIdx)) return g.marriageDX;
    return 0;
  };
  const ownAnchorMid = (parentAnchorOf(first) + parentAnchorOf(last)) / 2;

  const delta = ownAnchorMid - childConnMid;
  b.childX = offsets.map((o) => o + delta);
  const mergedShifted = (merged! as { l: number; r: number }[]).map((e) => ({
    l: e.l + delta,
    r: e.r + delta,
  }));
  b.extent = [{ l: -b.width / 2, r: b.width / 2 }, ...mergedShifted];
}

function secondWalk(b: Block, cx: number) {
  b.cx = cx;
  b.children.forEach((c, i) => secondWalk(c, cx + b.childX[i]));
}

// --- Block construction -------------------------------------------------------

interface BuildCtx {
  data: TreeData;
  visited: Set<string>;
}

function unionsOf(ctx: BuildCtx, personId: string): Union[] {
  const p = ctx.data.persons[personId];
  if (!p) return [];
  return p.unionsAsPartner.map((id) => ctx.data.unions[id]).filter(Boolean) as Union[];
}

function hasChildrenAnywhere(ctx: BuildCtx, personId: string): boolean {
  return unionsOf(ctx, personId).some((u) => u.children.length > 0);
}

function hasParents(ctx: BuildCtx, personId: string): boolean {
  const p = ctx.data.persons[personId];
  if (!p?.unionAsChild) return false;
  const u = ctx.data.unions[p.unionAsChild];
  return !!u && u.partners.length > 0;
}

/** Does this person have child-bearing unions other than `exceptUnionId`? */
function hasOtherFamilies(ctx: BuildCtx, personId: string, exceptUnionId: string): boolean {
  return unionsOf(ctx, personId).some((u) => u.id !== exceptUnionId && u.children.length > 0);
}

/**
 * Build a descendant block: anchor + spouse cards, child blocks per union.
 * `depthLeft` = how many more descendant generations may be rendered below.
 * `buildChild` overrides how child blocks are constructed (used for the root,
 * where only the focus expands and siblings stay leaves).
 */
function buildDescBlock(
  ctx: BuildCtx,
  anchorId: string,
  gen: number,
  depthLeft: number,
  buildChild?: (childId: string, gen: number) => Block,
): Block {
  const anchor = ctx.data.persons[anchorId];

  if (ctx.visited.has(anchorId)) {
    const b = blockOf(gen, [{ personId: anchorId, dx: 0, isStub: true }]);
    b.anchorPersonId = anchorId;
    return b;
  }
  ctx.visited.add(anchorId);

  const unions = unionsOf(ctx, anchorId);
  const spouseSide = anchor.gender === 'F' ? -1 : 1;

  // cards: anchor + one card per union that has a second partner
  type TmpCard = { personId: string; isStub?: boolean; unionId?: string };
  const spouseCards: TmpCard[] = [];
  for (const u of unions) {
    const other = u.partners.find((pid) => pid !== anchorId);
    if (!other || !ctx.data.persons[other]) continue;
    const isStub = ctx.visited.has(other);
    if (!isStub) ctx.visited.add(other);
    spouseCards.push({ personId: other, isStub, unionId: u.id });
  }

  const slots: Slot[] = [];
  const n = 1 + spouseCards.length;
  const step = CARD_W + SPOUSE_GAP;
  const leftMost = -((n - 1) * step) / 2;
  // ordering: female anchor -> spouses on the left (… sp2 sp1 anchor)
  const ordered: TmpCard[] =
    spouseSide === 1
      ? [{ personId: anchorId }, ...spouseCards]
      : [...[...spouseCards].reverse(), { personId: anchorId }];
  ordered.forEach((c, i) => {
    slots.push({
      personId: c.personId,
      dx: leftMost + i * step,
      isStub: c.isStub,
      hasMoreAncestors: c.personId !== anchorId && !c.isStub && hasParents(ctx, c.personId),
      hasMoreDescendants:
        c.personId !== anchorId &&
        !c.isStub &&
        !!c.unionId &&
        hasOtherFamilies(ctx, c.personId, c.unionId),
    });
  });
  const anchorSlot = slots.find((s) => s.personId === anchorId)!;

  const b = blockOf(gen, slots);
  b.anchorDX = anchorSlot.dx;
  b.anchorPersonId = anchorId;

  // marriage point per union: midpoint of the gap between the spouse card and
  // its neighbor toward the anchor; the anchor card itself for partnerless unions
  const slotDX = new Map(slots.map((s) => [s.personId, s.dx]));
  const marriageDXOf = (u: Union): { dx: number; couple: boolean } => {
    const other = u.partners.find((pid) => pid !== anchorId && slotDX.has(pid));
    if (!other) return { dx: anchorSlot.dx, couple: false };
    const sdx = slotDX.get(other)!;
    const neighborDX = sdx - Math.sign(sdx - anchorSlot.dx) * step;
    return { dx: (sdx + neighborDX) / 2, couple: true };
  };

  // children, grouped by union
  let firstGroup = true;
  for (const u of unions) {
    if (u.children.length === 0) continue;
    if (depthLeft <= 0) {
      anchorSlot.hasMoreDescendants = true;
      continue;
    }
    const { dx, couple } = marriageDXOf(u);
    const group: ChildGroup = {
      marriageDX: dx,
      coupleDrop: couple,
      childIdx: [],
      groupGapBoundary: !firstGroup,
    };
    for (const childId of u.children) {
      if (!ctx.data.persons[childId]) continue;
      const cb = buildChild
        ? buildChild(childId, gen + 1)
        : buildDescBlock(ctx, childId, gen + 1, depthLeft - 1);
      group.childIdx.push(b.children.length);
      b.children.push(cb);
    }
    if (group.childIdx.length) {
      b.groups.push(group);
      firstGroup = false;
    }
  }
  return b;
}

/** Leaf card for a sibling of the focus (their family hidden behind a badge). */
function buildSiblingLeaf(ctx: BuildCtx, personId: string, gen: number): Block {
  const isStub = ctx.visited.has(personId);
  if (!isStub) ctx.visited.add(personId);
  const b = blockOf(gen, [
    {
      personId,
      dx: 0,
      isStub,
      hasMoreDescendants:
        !isStub && (hasChildrenAnywhere(ctx, personId) || unionsOf(ctx, personId).length > 0),
    },
  ]);
  b.anchorPersonId = personId;
  return b;
}

/**
 * Couple block for a union, used on the ancestor (pedigree) side.
 * `lineChildId` is the child whose line we descended from — if the couple has
 * other children (the focus's aunts/uncles), the block gets a "more" badge.
 */
function buildAncBlock(
  ctx: BuildCtx,
  union: Union,
  gen: number,
  depthLeft: number,
  lineChildId: string,
): Block {
  const partners = union.partners
    .filter((pid) => ctx.data.persons[pid])
    .sort((a, b2) => {
      // male / unknown left, female right (stable for same gender)
      const ga = ctx.data.persons[a].gender;
      const gb = ctx.data.persons[b2].gender;
      return (ga === 'F' ? 1 : 0) - (gb === 'F' ? 1 : 0);
    });

  const slots: Slot[] = [];
  const step = CARD_W + SPOUSE_GAP;
  const leftMost = -((partners.length - 1) * step) / 2;
  partners.forEach((pid, i) => {
    const isStub = ctx.visited.has(pid);
    if (!isStub) ctx.visited.add(pid);
    slots.push({ personId: pid, dx: leftMost + i * step, isStub });
  });
  const b = blockOf(gen, slots);

  // hidden children (aunts/uncles of the line below) -> badge on first card
  const hasHiddenKids =
    union.children.some((cid) => cid !== lineChildId && ctx.data.persons[cid]) ||
    slots.some((s) => !s.isStub && hasOtherFamilies(ctx, s.personId, union.id));
  if (hasHiddenKids && slots[0]) slots[0].hasMoreDescendants = true;

  // recurse upward: each partner's parent union becomes a layout-child,
  // connecting down into that partner's card
  for (const slot of slots) {
    if (slot.isStub) continue;
    const p = ctx.data.persons[slot.personId];
    const pu = p.unionAsChild ? ctx.data.unions[p.unionAsChild] : undefined;
    if (!pu || pu.partners.length === 0) continue;
    if (depthLeft <= 0) {
      slot.hasMoreAncestors = true;
      continue;
    }
    const parentBlock = buildAncBlock(ctx, pu, gen - 1, depthLeft - 1, slot.personId);
    b.groups.push({
      marriageDX: slot.dx, // connection point inside THIS block = the partner card
      coupleDrop: false,
      childIdx: [b.children.length],
      groupGapBoundary: false,
    });
    b.children.push(parentBlock);
  }
  return b;
}

// --- Link emission -----------------------------------------------------------

function emitDropBus(
  upperX: number,
  upperStartY: number,
  laneY: number,
  lowers: { x: number; topY: number }[],
): string {
  let d = `M ${upperX} ${upperStartY} L ${upperX} ${laneY}`;
  const xs = [upperX, ...lowers.map((l) => l.x)];
  const busL = Math.min(...xs);
  const busR = Math.max(...xs);
  if (busR - busL > 0.5) d += ` M ${busL} ${laneY} L ${busR} ${laneY}`;
  for (const l of lowers) d += ` M ${l.x} ${laneY} L ${l.x} ${l.topY}`;
  return d;
}

// --- Main entry ----------------------------------------------------------------

export function computeLayout(data: TreeData, opts: LayoutOptions): LayoutResult {
  const cards: PlacedCard[] = [];
  const links: PlacedLink[] = [];
  const empty: LayoutResult = {
    cards,
    links,
    bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
    shownPersons: 0,
  };
  const focus = data.focusId ? data.persons[data.focusId] : undefined;
  if (!focus) return empty;

  const ctx: BuildCtx = { data, visited: new Set() };
  const mode = opts.mode ?? 'hourglass';

  const parentUnion =
    mode !== 'descendants' &&
    opts.ancestorDepth >= 1 &&
    focus.unionAsChild &&
    data.unions[focus.unionAsChild]?.partners.length
      ? data.unions[focus.unionAsChild]
      : undefined;

  // ----- build the two trees, glued at the parents row.
  //
  // The root (gen -1) is a descendant block anchored on the parent with the
  // most unions — so step-parents and half-siblings of the focus render too.
  // Only the focus expands downward; its (half-)siblings stay leaf cards.
  // A separate ancestor root shares the same card slots and hangs a pedigree
  // tree over each parent card that has known parents.
  let ancRoot: Block | undefined;
  let descRoot: Block;

  if (parentUnion && mode === 'pedigree') {
    // classic pedigree: blood ancestors only, focus as a single card below
    ancRoot = buildAncBlock(ctx, parentUnion, -1, opts.ancestorDepth - 1, focus.id);
    descRoot = blockOf(-1, ancRoot.cards);
    descRoot.anchorPersonId = ancRoot.anchorPersonId;
    ctx.visited.add(focus.id);
    const fb = blockOf(0, [
      {
        personId: focus.id,
        dx: 0,
        hasMoreDescendants:
          hasChildrenAnywhere(ctx, focus.id) || unionsOf(ctx, focus.id).length > 0,
      },
    ]);
    fb.anchorPersonId = focus.id;
    descRoot.groups.push({
      marriageDX: descRoot.cards.length >= 2 ? 0 : descRoot.cards[0]?.dx ?? 0,
      coupleDrop: descRoot.cards.length >= 2,
      childIdx: [0],
      groupGapBoundary: false,
    });
    descRoot.children.push(fb);
  } else if (parentUnion) {
    const partners = parentUnion.partners
      .map((id) => data.persons[id])
      .filter(Boolean);
    const anchorParent = [...partners].sort(
      (a, b) =>
        b.unionsAsPartner.length - a.unionsAsPartner.length ||
        (a.gender === 'F' ? 1 : 0) - (b.gender === 'F' ? 1 : 0),
    )[0]!;

    descRoot = buildDescBlock(ctx, anchorParent.id, -1, 1, (childId, gen) =>
      childId === focus.id
        ? buildDescBlock(ctx, childId, gen, opts.descendantDepth)
        : buildSiblingLeaf(ctx, childId, gen),
    );

    ancRoot = blockOf(-1, descRoot.cards);
    ancRoot.anchorPersonId = descRoot.anchorPersonId;
    for (const slot of descRoot.cards) {
      if (slot.isStub) continue;
      const p = data.persons[slot.personId];
      const pu = p.unionAsChild ? data.unions[p.unionAsChild] : undefined;
      if (!pu || pu.partners.length === 0) {
        slot.hasMoreAncestors = false;
        continue;
      }
      if (opts.ancestorDepth >= 2) {
        slot.hasMoreAncestors = false;
        const gb = buildAncBlock(ctx, pu, -2, opts.ancestorDepth - 2, slot.personId);
        ancRoot.groups.push({
          marriageDX: slot.dx,
          coupleDrop: false,
          childIdx: [ancRoot.children.length],
          groupGapBoundary: false,
        });
        ancRoot.children.push(gb);
      } else {
        slot.hasMoreAncestors = true;
      }
    }
  } else {
    descRoot = buildDescBlock(ctx, focus.id, 0, opts.descendantDepth);
  }

  // ----- independent tidy walks, glued at x=0
  firstWalk(descRoot);
  secondWalk(descRoot, 0);
  if (ancRoot) {
    firstWalk(ancRoot);
    secondWalk(ancRoot, 0);
  }

  // ----- emit cards
  let keyCounter = 0;
  const shown = new Set<string>();

  const emitBlockCards = (b: Block) => {
    for (const s of b.cards) {
      shown.add(s.personId);
      cards.push({
        key: `${s.personId}@${keyCounter++}`,
        personId: s.personId,
        x: b.cx + s.dx - CARD_W / 2,
        y: rowTop(b.gen),
        gen: b.gen,
        isFocus: s.personId === focus.id,
        isStub: s.isStub,
        hasMoreAncestors: s.hasMoreAncestors,
        hasMoreDescendants: s.hasMoreDescendants,
      });
    }
  };
  const walkCards = (b: Block, skipOwnCards = false) => {
    if (!skipOwnCards) emitBlockCards(b);
    for (const c of b.children) walkCards(c);
  };
  walkCards(descRoot);
  if (ancRoot) walkCards(ancRoot, true); // root couple cards already emitted via descRoot

  // descendants-only mode: parents exist but are out of scope -> badge on focus
  if (mode === 'descendants' && hasParents(ctx, focus.id)) {
    const fc = cards.find((c) => c.isFocus);
    if (fc) fc.hasMoreAncestors = true;
  }

  // ghost "+ add parents" card above a parentless focus
  if (!parentUnion && mode !== 'descendants' && opts.ancestorDepth >= 1) {
    const gx = descRoot.cx + descRoot.anchorDX;
    cards.push({
      key: 'ghost-parents',
      personId: focus.id,
      x: gx - CARD_W / 2,
      y: rowTop(-1),
      gen: -1,
      isGhost: true,
    });
    links.push({
      key: 'ghost-link',
      d: `M ${gx} ${rowBottom(-1)} L ${gx} ${rowTop(0)}`,
      kind: 'ghost',
      dashed: true,
    });
  }

  // ----- emit links
  const emitSpouseSegs = (b: Block) => {
    for (let i = 0; i + 1 < b.cards.length; i++) {
      const a = b.cards[i];
      const c = b.cards[i + 1];
      const y = rowCenter(b.gen);
      // union joining this pair: prefer anchor<->outer-card (multi-spouse rows),
      // fall back to the pair itself (ancestor couple blocks)
      const anchorId = b.anchorPersonId;
      const outer = Math.abs(a.dx - b.anchorDX) > Math.abs(c.dx - b.anchorDX) ? a : c;
      const u =
        (anchorId && findUnionBetween(data, anchorId, outer.personId)) ||
        findUnionBetween(data, a.personId, c.personId);
      links.push({
        key: `sp-${keyCounter++}`,
        d: `M ${b.cx + a.dx + CARD_W / 2} ${y} L ${b.cx + c.dx - CARD_W / 2} ${y}`,
        kind: 'spouse',
        dashed: u ? u.status === 'divorced' || u.status === 'separated' : false,
      });
    }
  };

  const walkLinks = (b: Block, skipSpouseSegs = false) => {
    if (!skipSpouseSegs) emitSpouseSegs(b);

    const downGroups = b.groups.filter((g) =>
      g.childIdx.some((i) => b.children[i].gen > b.gen),
    );
    const upGroups = b.groups.filter((g) => g.childIdx.some((i) => b.children[i].gen < b.gen));

    // descendant buses: marriage point here -> lane -> child anchors below
    downGroups.forEach((g, gi) => {
      const mx = b.cx + g.marriageDX;
      const startY = g.coupleDrop ? rowCenter(b.gen) : rowBottom(b.gen);
      const lane =
        rowBottom(b.gen) + GEN_GAP / 2 + (gi - (downGroups.length - 1) / 2) * LANE_STEP;
      const lowers = g.childIdx.map((i) => {
        const c = b.children[i];
        return { x: c.cx + c.anchorDX, topY: rowTop(c.gen) };
      });
      links.push({
        key: `bus-${keyCounter++}`,
        d: emitDropBus(mx, startY, lane, lowers),
        kind: 'tree',
      });
    });

    // ancestor buses: the layout-child is the PARENT couple drawn above;
    // drop goes from that couple down into this block's partner card
    upGroups.forEach((g, gi) => {
      const upper = b.children[g.childIdx[0]];
      const upperIsCouple = upper.cards.length >= 2;
      const mx = upper.cx + (upperIsCouple ? 0 : upper.cards[0]?.dx ?? 0);
      const startY = upperIsCouple ? rowCenter(upper.gen) : rowBottom(upper.gen);
      const lane =
        rowBottom(upper.gen) + GEN_GAP / 2 + (gi - (upGroups.length - 1) / 2) * LANE_STEP;
      links.push({
        key: `abus-${keyCounter++}`,
        d: emitDropBus(mx, startY, lane, [{ x: b.cx + g.marriageDX, topY: rowTop(b.gen) }]),
        kind: 'tree',
      });
    });

    for (const c of b.children) walkLinks(c);
  };
  walkLinks(descRoot);
  if (ancRoot) walkLinks(ancRoot, true); // spouse segs of the shared couple already emitted

  // ----- bounds
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const c of cards) {
    minX = Math.min(minX, c.x);
    minY = Math.min(minY, c.y);
    maxX = Math.max(maxX, c.x + CARD_W);
    maxY = Math.max(maxY, c.y + CARD_H);
  }
  if (!cards.length) return empty;

  return {
    cards,
    links,
    bounds: { minX, minY, maxX, maxY },
    shownPersons: shown.size,
  };
}

function findUnionBetween(data: TreeData, aId: string, bId: string): Union | undefined {
  return Object.values(data.unions).find(
    (u) => u.partners.includes(aId) && u.partners.includes(bId),
  );
}
