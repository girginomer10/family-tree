import type {
  ChildRelType,
  FuzzyDate,
  Gender,
  LifeEvent,
  Person,
  TreeData,
  Union,
  UnionStatus,
} from '../types';
import { childRelOf, emptyTree } from '../types';

/**
 * GEDCOM 5.5.1 import/export (UTF-8), minimal-but-correct subset:
 *   INDI: NAME (+GIVN/SURN), SEX, BIRT/DEAT (DATE, PLAC), OCCU, NOTE, FAMC, FAMS
 *   FAM:  HUSB, WIFE, CHIL (file order = birth order), MARR/DIV (DATE, PLAC)
 * On import, FAM records are authoritative for all links; INDI-side pointers
 * are rebuilt from them (real-world files are often inconsistent).
 */

// --- Line / node parsing -----------------------------------------------------

interface GNode {
  level: number;
  xref?: string;
  tag: string;
  value: string;
  children: GNode[];
}

const LINE_RE = /^(\d+)\s+(?:(@[^@]+@)\s+)?(\w+)(?:\s(.*))?$/;

function parseNodes(text: string): GNode[] {
  const roots: GNode[] = [];
  const stack: GNode[] = [];
  const lines = text.replace(/^﻿/, '').split(/\r\n|\n|\r/);
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;
    const m = LINE_RE.exec(line.trimStart());
    if (!m) continue; // tolerate junk lines
    const node: GNode = {
      level: parseInt(m[1], 10),
      xref: m[2]?.replace(/@/g, ''),
      tag: m[3].toUpperCase(),
      value: m[4] ?? '',
      children: [],
    };
    // CONC/CONT fold into the parent value
    if (node.tag === 'CONC' || node.tag === 'CONT') {
      const parent = stack[node.level - 1];
      if (parent) parent.value += (node.tag === 'CONT' ? '\n' : '') + node.value;
      continue;
    }
    while (stack.length > node.level) stack.pop();
    if (node.level === 0) roots.push(node);
    else stack[node.level - 1]?.children.push(node);
    stack[node.level] = node;
  }
  return roots;
}

function child(n: GNode, tag: string): GNode | undefined {
  return n.children.find((c) => c.tag === tag);
}
function childValue(n: GNode, tag: string): string | undefined {
  return child(n, tag)?.value || undefined;
}

// --- Dates ---------------------------------------------------------------------

const MONTH_TO_NUM: Record<string, number> = {
  JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6,
  JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12,
};
const NUM_TO_MONTH = Object.keys(MONTH_TO_NUM);

export function parseGedcomDate(s?: string): FuzzyDate | undefined {
  if (!s) return undefined;
  let str = s.trim().toUpperCase();
  let qualifier: FuzzyDate['qualifier'];
  const qm = /^(ABT|EST|CAL|BEF|AFT|FROM|TO|BET)\s+/.exec(str);
  if (qm) {
    qualifier =
      qm[1] === 'BEF' ? 'before' : qm[1] === 'AFT' ? 'after' : 'about';
    str = str.slice(qm[0].length);
    if (qm[1] === 'BET') str = str.split(/\s+AND\s+/)[0]; // "BET 1900 AND 1905" -> 1900, about
  }
  const parts = str.split(/\s+/).filter(Boolean);
  const d: FuzzyDate = { qualifier };
  for (const p of parts) {
    if (MONTH_TO_NUM[p]) d.month = MONTH_TO_NUM[p];
    else if (/^\d{1,2}$/.test(p) && d.day == null && d.month == null) d.day = parseInt(p, 10);
    else if (/^\d{3,4}$/.test(p)) d.year = parseInt(p, 10);
  }
  if (d.year == null && d.month == null && d.day == null) return undefined;
  if (!d.qualifier) delete d.qualifier;
  return d;
}

export function formatGedcomDate(d?: FuzzyDate): string | undefined {
  if (!d || (d.year == null && d.month == null && d.day == null)) return undefined;
  const core = [
    d.day != null && d.month != null ? String(d.day) : undefined,
    d.month != null ? NUM_TO_MONTH[d.month - 1] : undefined,
    d.year != null ? String(d.year) : undefined,
  ]
    .filter(Boolean)
    .join(' ');
  switch (d.qualifier) {
    case 'about': return `ABT ${core}`;
    case 'before': return `BEF ${core}`;
    case 'after': return `AFT ${core}`;
    default: return core;
  }
}

function parseEvent(n?: GNode): LifeEvent | undefined {
  if (!n) return undefined;
  const date = parseGedcomDate(childValue(n, 'DATE'));
  const place = childValue(n, 'PLAC');
  if (!date && !place) return undefined;
  return { ...(date ? { date } : {}), ...(place ? { place } : {}) };
}

// --- Import ----------------------------------------------------------------------

export interface GedcomImportResult {
  data: TreeData;
  warnings: string[];
}

export function importGedcom(text: string, name = 'Imported Tree'): GedcomImportResult {
  const warnings: string[] = [];
  const roots = parseNodes(text);
  const data = emptyTree(name);
  const pedi = new Map<string, ChildRelType>();

  // Pass 1: INDI -> Person
  for (const r of roots) {
    if (r.tag !== 'INDI' || !r.xref) continue;
    const nameNode = child(r, 'NAME');
    let givenName = '';
    let surname = '';
    if (nameNode) {
      const givn = childValue(nameNode, 'GIVN');
      const surn = childValue(nameNode, 'SURN');
      const m = /^([^/]*)(?:\/([^/]*)\/)?\s*(.*)$/.exec(nameNode.value.trim());
      givenName = (givn ?? m?.[1] ?? '').trim();
      surname = (surn ?? m?.[2] ?? '').trim();
    }
    const sexRaw = (childValue(r, 'SEX') ?? 'U').charAt(0).toUpperCase();
    const gender: Gender = sexRaw === 'M' || sexRaw === 'F' ? sexRaw : 'U';
    const birth = parseEvent(child(r, 'BIRT'));
    const deatNode = child(r, 'DEAT');
    const death = parseEvent(deatNode);
    const person: Person = {
      id: r.xref,
      givenName,
      surname,
      gender,
      unionsAsPartner: [],
      ...(birth ? { birth } : {}),
      ...(death ? { death } : {}),
      ...(deatNode ? { isDeceased: true } : {}),
    };
    const occu = childValue(r, 'OCCU');
    if (occu) person.occupation = occu;
    const note = childValue(r, 'NOTE');
    if (note) person.notes = note;
    const famcNode = child(r, 'FAMC');
    const pediVal = famcNode ? childValue(famcNode, 'PEDI')?.toLowerCase() : undefined;
    if (pediVal === 'adopted' || pediVal === 'foster' || pediVal === 'step') {
      pedi.set(r.xref, pediVal as ChildRelType);
    }
    if (data.persons[person.id]) warnings.push(`Duplicate INDI @${person.id}@ — kept first`);
    else data.persons[person.id] = person;
  }

  // Pass 2: FAM -> Union (authoritative for links)
  for (const r of roots) {
    if (r.tag !== 'FAM' || !r.xref) continue;
    const partners: string[] = [];
    for (const tag of ['HUSB', 'WIFE']) {
      const v = childValue(r, tag)?.replace(/@/g, '');
      if (!v) continue;
      if (data.persons[v]) partners.push(v);
      else warnings.push(`FAM @${r.xref}@: ${tag} @${v}@ not found — dropped`);
    }
    const children: string[] = [];
    for (const c of r.children.filter((c) => c.tag === 'CHIL')) {
      const v = c.value.replace(/@/g, '');
      if (data.persons[v]) children.push(v);
      else warnings.push(`FAM @${r.xref}@: CHIL @${v}@ not found — dropped`);
    }
    const marriage = parseEvent(child(r, 'MARR'));
    const divorce = parseEvent(child(r, 'DIV'));
    const status: UnionStatus = divorce
      ? 'divorced'
      : child(r, 'MARR')
        ? 'married'
        : 'unknown';
    const union: Union = {
      id: r.xref,
      partners,
      status,
      children,
      ...(marriage ? { marriage } : {}),
      ...(divorce ? { divorce } : {}),
    };
    if (partners.length === 0 && children.length === 0) {
      warnings.push(`FAM @${r.xref}@ is empty — skipped`);
      continue;
    }
    data.unions[union.id] = union;
  }

  // Pass 3: rebuild person-side pointers from FAM records
  for (const u of Object.values(data.unions)) {
    for (const pid of u.partners) {
      const p = data.persons[pid];
      if (p && !p.unionsAsPartner.includes(u.id)) p.unionsAsPartner.push(u.id);
    }
    for (const cid of u.children) {
      const c = data.persons[cid];
      if (!c) continue;
      if (c.unionAsChild && c.unionAsChild !== u.id) {
        warnings.push(`@${cid}@ is a child in multiple families — kept @${c.unionAsChild}@`);
        u.children = u.children.filter((x) => x !== cid);
      } else {
        c.unionAsChild = u.id;
        const rel = pedi.get(cid);
        if (rel) u.childRels = { ...u.childRels, [cid]: rel };
      }
    }
  }

  const first = Object.keys(data.persons)[0] ?? null;
  data.focusId = first;
  return { data, warnings };
}

// --- Export -----------------------------------------------------------------------

export function exportGedcom(data: TreeData): string {
  const lines: string[] = [];
  const out = (lvl: number, tag: string, val?: string) =>
    lines.push(`${lvl} ${tag}${val ? ` ${val}` : ''}`);

  // remap ids to clean sequential xrefs
  const pid = new Map<string, string>();
  Object.keys(data.persons).forEach((id, i) => pid.set(id, `I${i + 1}`));
  const fid = new Map<string, string>();
  Object.keys(data.unions).forEach((id, i) => fid.set(id, `F${i + 1}`));

  out(0, 'HEAD');
  out(1, 'SOUR', 'FAMILY_TREE_APP');
  out(2, 'NAME', 'Family Tree App');
  out(1, 'GEDC');
  out(2, 'VERS', '5.5.1');
  out(2, 'FORM', 'LINEAGE-LINKED');
  out(1, 'CHAR', 'UTF-8');
  out(1, 'SUBM', '@U1@');
  out(0, '@U1@ SUBM');
  out(1, 'NAME', 'Family Tree App User');

  const emitEvent = (tag: string, ev?: LifeEvent, force = false) => {
    const date = formatGedcomDate(ev?.date);
    if (!date && !ev?.place && !force) return;
    out(1, tag, !date && !ev?.place ? 'Y' : undefined);
    if (date) out(2, 'DATE', date);
    if (ev?.place) out(2, 'PLAC', ev.place);
  };

  for (const p of Object.values(data.persons)) {
    lines.push(`0 @${pid.get(p.id)}@ INDI`);
    out(1, 'NAME', `${p.givenName} /${p.surname}/`.trim());
    if (p.givenName) out(2, 'GIVN', p.givenName);
    if (p.surname) out(2, 'SURN', p.surname);
    if (p.gender !== 'U') out(1, 'SEX', p.gender);
    emitEvent('BIRT', p.birth);
    if (p.death || p.isDeceased) emitEvent('DEAT', p.death, true);
    if (p.occupation) out(1, 'OCCU', p.occupation);
    if (p.notes) {
      const [head, ...rest] = p.notes.split('\n');
      out(1, 'NOTE', head);
      for (const r of rest) out(2, 'CONT', r);
    }
    if (p.unionAsChild && fid.has(p.unionAsChild)) {
      out(1, 'FAMC', `@${fid.get(p.unionAsChild)}@`);
      const rel = childRelOf(data.unions[p.unionAsChild], p.id);
      if (rel !== 'birth') out(2, 'PEDI', rel);
    }
    for (const f of p.unionsAsPartner) {
      if (fid.has(f)) out(1, 'FAMS', `@${fid.get(f)}@`);
    }
  }

  for (const u of Object.values(data.unions)) {
    lines.push(`0 @${fid.get(u.id)}@ FAM`);
    // assign HUSB/WIFE slots by gender; fall back to order
    const persons = u.partners.map((id) => data.persons[id]).filter(Boolean) as Person[];
    const husb = persons.find((p) => p.gender === 'M') ?? persons.find((p) => p.gender === 'U');
    const wife = persons.find((p) => p !== husb);
    if (husb) out(1, 'HUSB', `@${pid.get(husb.id)}@`);
    if (wife) out(1, 'WIFE', `@${pid.get(wife.id)}@`);
    emitEvent('MARR', u.marriage, u.status === 'married' && !u.marriage);
    emitEvent('DIV', u.divorce, u.status === 'divorced' && !u.divorce);
    for (const c of u.children) {
      if (pid.has(c)) out(1, 'CHIL', `@${pid.get(c)}@`);
    }
  }

  out(0, 'TRLR');
  return lines.join('\n') + '\n';
}
