import type { TreeData } from '../types';
import { fullName, isAlive } from '../types';

/**
 * Timeline (lifespan chart) layout: every dated person becomes a horizontal
 * bar from birth to death (or to today while living), sorted by birth year,
 * over a decade grid. Marriage years appear as ring markers on the bars.
 */

export const PX_PER_YEAR = 6;
export const ROW_H = 30;
export const BAR_H = 18;

export interface TimelineRow {
  personId: string;
  y: number; // row top
  x1: number;
  x2: number;
  living: boolean;
  /** Birth year unknown (bar is a point estimate at death). */
  approxStart: boolean;
  label: string;
  years: string;
  markers: { x: number; year: number }[];
}

export interface TimelineLayout {
  rows: TimelineRow[];
  ticks: { x: number; year: number }[];
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  minYear: number;
  maxYear: number;
  shownPersons: number;
  omittedPersons: number;
}

export function computeTimeline(data: TreeData, currentYear: number): TimelineLayout {
  interface Entry {
    personId: string;
    birth?: number;
    death?: number;
    living: boolean;
  }
  const entries: Entry[] = [];
  let omitted = 0;
  for (const p of Object.values(data.persons)) {
    const birth = p.birth?.date?.year;
    const death = p.death?.date?.year;
    if (birth == null && death == null) {
      omitted++;
      continue;
    }
    entries.push({ personId: p.id, birth, death, living: isAlive(p) });
  }
  if (entries.length === 0) {
    return {
      rows: [],
      ticks: [],
      bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
      minYear: 0,
      maxYear: 0,
      shownPersons: 0,
      omittedPersons: omitted,
    };
  }

  const sortKey = (e: Entry) => e.birth ?? (e.death != null ? e.death - 40 : currentYear);
  entries.sort(
    (a, b) =>
      sortKey(a) - sortKey(b) ||
      fullName(data.persons[a.personId]).localeCompare(fullName(data.persons[b.personId])),
  );

  let minYear = Infinity;
  let maxYear = -Infinity;
  for (const e of entries) {
    minYear = Math.min(minYear, e.birth ?? (e.death != null ? e.death - 1 : currentYear));
    maxYear = Math.max(maxYear, e.death ?? (e.living ? currentYear : e.birth! + 1));
  }
  minYear = Math.floor(minYear / 10) * 10;
  maxYear = Math.ceil(maxYear / 10) * 10;

  const X = (year: number) => (year - minYear) * PX_PER_YEAR;

  // marriage markers per person
  const marriagesOf = (pid: string): { x: number; year: number }[] => {
    const p = data.persons[pid];
    const out: { x: number; year: number }[] = [];
    for (const uid of p.unionsAsPartner) {
      const y = data.unions[uid]?.marriage?.date?.year;
      if (y != null) out.push({ x: X(y), year: y });
    }
    return out;
  };

  const rows: TimelineRow[] = entries.map((e, i) => {
    const p = data.persons[e.personId];
    const start = e.birth ?? e.death! - 1;
    const end = e.death ?? (e.living ? currentYear : e.birth! + 1);
    const by = e.birth != null ? String(e.birth) : '?';
    const dy = e.death != null ? String(e.death) : e.living ? '' : '?';
    return {
      personId: e.personId,
      y: i * ROW_H,
      x1: X(start),
      x2: Math.max(X(end), X(start) + 3),
      living: e.living && e.death == null,
      approxStart: e.birth == null,
      label: fullName(p),
      years: dy ? `${by}–${dy}` : `${by}–`,
      markers: marriagesOf(e.personId).filter((m) => m.x >= X(start) && m.x <= X(end)),
    };
  });

  const ticks: { x: number; year: number }[] = [];
  for (let y = minYear; y <= maxYear; y += 10) ticks.push({ x: X(y), year: y });

  const height = rows.length * ROW_H;
  return {
    rows,
    ticks,
    bounds: {
      minX: -210, // room for left-hand name labels
      minY: -34, // room for the axis header
      maxX: X(maxYear) + 90,
      maxY: height + 10,
    },
    minYear,
    maxYear,
    shownPersons: rows.length,
    omittedPersons: omitted,
  };
}
