import type { TreeData } from '../types';
import { lifespan } from '../types';

/**
 * Ancestor fan chart layout (FamilySearch style).
 *
 * The focus sits in a center disc; ring k holds the 2^k ancestors of
 * generation k as annular sectors over a 240° fan opening upward, father's
 * line on the left. Slots are addressed by ahnentafel number (focus = 1,
 * father of n = 2n, mother = 2n+1). Sectors are colored by grandparent
 * branch. Empty slots whose child IS known render as "+ add parent" targets.
 */

export interface FanLabelLine {
  text: string;
  dy: number;
  size: number;
  weight?: number;
}

export interface FanSector {
  key: string;
  personId?: string; // undefined => empty slot (add-parent target)
  childId?: string; // person whose parent this slot is
  ring: number;
  d: string;
  fill: string;
  stroke: string;
  textFill: string;
  label?: {
    x: number;
    y: number;
    rotate: number;
    anchor: 'start' | 'middle' | 'end';
    lines: FanLabelLine[];
  };
}

export interface FanLayout {
  sectors: FanSector[];
  centerR: number;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  shownPersons: number;
}

const FAN_ANGLE = 240; // degrees, centered on 12 o'clock
const CENTER_R = 78;
const RING_W = [0, 78, 78, 72, 64, 56, 52]; // by ring index

// branch palette: father's father, father's mother, mother's father, mother's mother
const BRANCH = [
  { fill: '#dbe8f3', stroke: '#a7c2d8', text: '#35628a' },
  { fill: '#dceee5', stroke: '#a8cfbc', text: '#2e6e52' },
  { fill: '#f6ecd5', stroke: '#dbc28e', text: '#8a6a1f' },
  { fill: '#f6e1e6', stroke: '#dcabb7', text: '#92485c' },
];
const GENDERED = {
  M: { fill: '#e3eef7', stroke: '#a9c4da', text: '#2f5a82' },
  F: { fill: '#f8e7ec', stroke: '#ddb2c0', text: '#94455c' },
  U: { fill: '#eeece6', stroke: '#c5c0b4', text: '#6c675e' },
};
const EMPTY = { fill: '#f1eee6', stroke: '#c9c3b4', text: '#9a948a' };

/** Point at radius r, angle θ in degrees measured clockwise from 12 o'clock. */
function pt(r: number, deg: number): [number, number] {
  const rad = (deg * Math.PI) / 180;
  return [r * Math.sin(rad), -r * Math.cos(rad)];
}

function sectorPath(rIn: number, rOut: number, a1: number, a2: number): string {
  const [x1, y1] = pt(rIn, a1);
  const [x2, y2] = pt(rOut, a1);
  const [x3, y3] = pt(rOut, a2);
  const [x4, y4] = pt(rIn, a2);
  const large = a2 - a1 > 180 ? 1 : 0;
  return [
    `M ${x1.toFixed(2)} ${y1.toFixed(2)}`,
    `L ${x2.toFixed(2)} ${y2.toFixed(2)}`,
    `A ${rOut} ${rOut} 0 ${large} 1 ${x3.toFixed(2)} ${y3.toFixed(2)}`,
    `L ${x4.toFixed(2)} ${y4.toFixed(2)}`,
    `A ${rIn} ${rIn} 0 ${large} 0 ${x1.toFixed(2)} ${y1.toFixed(2)}`,
    'Z',
  ].join(' ');
}

function ringRadii(ring: number): { rIn: number; rOut: number } {
  let rIn = CENTER_R;
  for (let k = 1; k < ring; k++) rIn += RING_W[Math.min(k, RING_W.length - 1)];
  return { rIn, rOut: rIn + RING_W[Math.min(ring, RING_W.length - 1)] };
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

export function computeFan(data: TreeData, focusId: string, rings: number): FanLayout {
  const sectors: FanSector[] = [];
  const shown = new Set<string>();

  // ahnentafel slots
  const slot = new Map<number, string>();
  slot.set(1, focusId);
  const maxIdx = 2 ** (rings + 1);
  for (let i = 1; i < maxIdx / 2; i++) {
    const pid = slot.get(i);
    if (!pid) continue;
    const p = data.persons[pid];
    const u = p?.unionAsChild ? data.unions[p.unionAsChild] : undefined;
    if (!u) continue;
    const partners = u.partners.filter((x) => data.persons[x]);
    if (!partners.length) continue;
    const father =
      partners.find((x) => data.persons[x].gender === 'M') ??
      partners.find((x) => data.persons[x].gender === 'U') ??
      partners[0];
    const mother = partners.find((x) => x !== father);
    if (father) slot.set(2 * i, father);
    if (mother) slot.set(2 * i + 1, mother);
  }

  shown.add(focusId);

  for (let ring = 1; ring <= rings; ring++) {
    const slots = 2 ** ring;
    const span = FAN_ANGLE / slots;
    const { rIn, rOut } = ringRadii(ring);
    for (let j = 0; j < slots; j++) {
      const idx = slots + j;
      const pid = slot.get(idx);
      const childId = slot.get(idx >> 1);
      if (!pid && !childId) continue; // nothing to attach to
      const a1 = -FAN_ANGLE / 2 + j * span;
      const a2 = a1 + span;
      const mid = (a1 + a2) / 2;
      const d = sectorPath(rIn + 1, rOut - 1, a1 + 0.4, a2 - 0.4);

      const palette = !pid
        ? EMPTY
        : ring === 1
          ? GENDERED[data.persons[pid].gender]
          : BRANCH[Math.min(3, Math.floor(j / 2 ** (ring - 2)))];

      const sector: FanSector = {
        key: `fan-${idx}`,
        personId: pid,
        childId,
        ring,
        d,
        fill: palette.fill,
        stroke: palette.stroke,
        textFill: palette.text,
      };

      // ----- label
      if (pid) {
        shown.add(pid);
        const p = data.persons[pid];
        const years = lifespan(p);
        if (ring <= 2) {
          // tangent text (reads along the arc); parents' big sectors stay horizontal
          const r = (rIn + rOut) / 2;
          const [x, y] = pt(r, mid);
          let rotate = ring === 1 ? 0 : mid;
          if (rotate > 90) rotate -= 180;
          if (rotate < -90) rotate += 180;
          const maxChars = ring === 1 ? 18 : 14;
          sector.label = {
            x,
            y,
            rotate,
            anchor: 'middle',
            lines: [
              { text: truncate(p.givenName, maxChars), dy: -12, size: 13, weight: 650 },
              { text: truncate(p.surname, maxChars), dy: 3, size: 12.5 },
              { text: years, dy: 18, size: 10.5 },
            ].filter((l) => l.text),
          };
        } else {
          // radial text
          const name = truncate(`${p.givenName} ${p.surname}`.trim(), ring >= 5 ? 16 : 20);
          const onRight = mid >= 0;
          const pad = 8;
          const [x, y] = pt(onRight ? rIn + pad : rOut - pad, mid);
          const rotate = onRight ? mid - 90 : mid + 90;
          const size = ring === 3 ? 11 : ring === 4 ? 10 : 9;
          const lines: FanLabelLine[] = [{ text: name, dy: years && ring <= 4 ? -3 : 3, size, weight: 600 }];
          if (years && ring <= 4) lines.push({ text: years, dy: 10, size: size - 1.5 });
          sector.label = { x, y, rotate, anchor: 'start', lines };
        }
      } else {
        // empty slot with a known child: "+" target
        const r = (rIn + rOut) / 2;
        const [x, y] = pt(r, mid);
        let rotate = mid;
        if (rotate > 90) rotate -= 180;
        if (rotate < -90) rotate += 180;
        sector.label = {
          x,
          y,
          rotate: ring <= 2 ? rotate : 0,
          anchor: 'middle',
          lines: [{ text: '+', dy: 5, size: ring <= 2 ? 17 : 13, weight: 600 }],
        };
      }
      sectors.push(sector);
    }
  }

  const R = ringRadii(rings).rOut;
  const yBottom = Math.max(CENTER_R, -pt(R, FAN_ANGLE / 2)[1]) + 16;
  return {
    sectors,
    centerR: CENTER_R,
    bounds: { minX: -R - 16, minY: -R - 16, maxX: R + 16, maxY: yBottom },
    shownPersons: shown.size,
  };
}
