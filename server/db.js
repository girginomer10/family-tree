// SQLite persistence for the family tree, using Node's built-in node:sqlite
// (no native dependency). The DB file is a real file on disk:
//   server/data/family_tree.db  (override with FAMILY_TREE_DB)
//
// The schema is fully normalized so the data is genuine, queryable SQL — e.g.
//   SELECT given_name, surname FROM persons WHERE surname = 'Yılmaz';
//   SELECT name, COUNT(*) FROM conditions GROUP BY name ORDER BY 2 DESC;
// Ordered arrays (a person's unions, a union's partners/children) keep their
// order via an `ord` column, so a tree round-trips byte-for-byte.

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.FAMILY_TREE_DB || join(here, 'data', 'family_tree.db');
mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');
db.exec(`
  CREATE TABLE IF NOT EXISTS trees (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    focus_id   TEXT,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS persons (
    tree_id TEXT NOT NULL, id TEXT NOT NULL,
    given_name TEXT NOT NULL DEFAULT '', surname TEXT NOT NULL DEFAULT '',
    gender TEXT NOT NULL DEFAULT 'U', is_deceased INTEGER NOT NULL DEFAULT 0,
    occupation TEXT, notes TEXT, photo_url TEXT, union_as_child TEXT,
    birth_year INTEGER, birth_month INTEGER, birth_day INTEGER, birth_qualifier TEXT, birth_place TEXT,
    death_year INTEGER, death_month INTEGER, death_day INTEGER, death_qualifier TEXT, death_place TEXT,
    PRIMARY KEY (tree_id, id)
  );
  CREATE TABLE IF NOT EXISTS person_partner_unions (
    tree_id TEXT NOT NULL, person_id TEXT NOT NULL, union_id TEXT NOT NULL, ord INTEGER NOT NULL,
    PRIMARY KEY (tree_id, person_id, union_id)
  );
  CREATE TABLE IF NOT EXISTS conditions (
    tree_id TEXT NOT NULL, person_id TEXT NOT NULL, ord INTEGER NOT NULL,
    name TEXT NOT NULL, hereditary INTEGER NOT NULL DEFAULT 0,
    status TEXT, age_at_onset INTEGER, notes TEXT
  );
  CREATE TABLE IF NOT EXISTS unions (
    tree_id TEXT NOT NULL, id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'unknown',
    marr_year INTEGER, marr_month INTEGER, marr_day INTEGER, marr_qualifier TEXT, marr_place TEXT,
    div_year INTEGER, div_month INTEGER, div_day INTEGER, div_qualifier TEXT, div_place TEXT,
    PRIMARY KEY (tree_id, id)
  );
  CREATE TABLE IF NOT EXISTS union_partners (
    tree_id TEXT NOT NULL, union_id TEXT NOT NULL, person_id TEXT NOT NULL, ord INTEGER NOT NULL,
    PRIMARY KEY (tree_id, union_id, person_id)
  );
  CREATE TABLE IF NOT EXISTS union_children (
    tree_id TEXT NOT NULL, union_id TEXT NOT NULL, person_id TEXT NOT NULL, ord INTEGER NOT NULL, rel TEXT,
    PRIMARY KEY (tree_id, union_id, person_id)
  );
  CREATE INDEX IF NOT EXISTS idx_persons_tree ON persons(tree_id);
  CREATE INDEX IF NOT EXISTS idx_unions_tree ON unions(tree_id);
`);

// --- value-object helpers (FuzzyDate + place <-> columns) --------------------

function eventToCols(ev) {
  const d = (ev && ev.date) || {};
  return {
    year: d.year ?? null,
    month: d.month ?? null,
    day: d.day ?? null,
    qualifier: d.qualifier ?? null,
    place: (ev && ev.place) || null,
  };
}

function colsToEvent(row, prefix) {
  const date = {};
  if (row[`${prefix}_year`] != null) date.year = row[`${prefix}_year`];
  if (row[`${prefix}_month`] != null) date.month = row[`${prefix}_month`];
  if (row[`${prefix}_day`] != null) date.day = row[`${prefix}_day`];
  if (row[`${prefix}_qualifier`]) date.qualifier = row[`${prefix}_qualifier`];
  const ev = {};
  if (Object.keys(date).length) ev.date = date;
  if (row[`${prefix}_place`]) ev.place = row[`${prefix}_place`];
  return Object.keys(ev).length ? ev : undefined;
}

// --- reads -------------------------------------------------------------------

export function listTrees() {
  return db.prepare('SELECT id, name FROM trees ORDER BY name COLLATE NOCASE').all();
}

export function getTree(id) {
  const t = db.prepare('SELECT id, name, focus_id FROM trees WHERE id = ?').get(id);
  if (!t) return null;

  const partnerOf = db.prepare(
    'SELECT union_id FROM person_partner_unions WHERE tree_id = ? AND person_id = ? ORDER BY ord',
  );
  const condsOf = db.prepare(
    'SELECT name, hereditary, status, age_at_onset, notes FROM conditions WHERE tree_id = ? AND person_id = ? ORDER BY ord',
  );
  const persons = {};
  for (const r of db.prepare('SELECT * FROM persons WHERE tree_id = ?').all(id)) {
    const p = {
      id: r.id,
      givenName: r.given_name,
      surname: r.surname,
      gender: r.gender,
      unionsAsPartner: partnerOf.all(id, r.id).map((x) => x.union_id),
    };
    if (r.union_as_child) p.unionAsChild = r.union_as_child;
    if (r.is_deceased) p.isDeceased = true;
    if (r.occupation) p.occupation = r.occupation;
    if (r.notes) p.notes = r.notes;
    if (r.photo_url) p.photoUrl = r.photo_url;
    const birth = colsToEvent(r, 'birth');
    if (birth) p.birth = birth;
    const death = colsToEvent(r, 'death');
    if (death) p.death = death;
    const conditions = condsOf.all(id, r.id).map((c) => {
      const o = { name: c.name };
      if (c.hereditary) o.hereditary = true;
      if (c.status) o.status = c.status;
      if (c.age_at_onset != null) o.ageAtOnset = c.age_at_onset;
      if (c.notes) o.notes = c.notes;
      return o;
    });
    if (conditions.length) p.conditions = conditions;
    persons[r.id] = p;
  }

  const partnersOf = db.prepare(
    'SELECT person_id FROM union_partners WHERE tree_id = ? AND union_id = ? ORDER BY ord',
  );
  const childrenOf = db.prepare(
    'SELECT person_id, rel FROM union_children WHERE tree_id = ? AND union_id = ? ORDER BY ord',
  );
  const unions = {};
  for (const r of db.prepare('SELECT * FROM unions WHERE tree_id = ?').all(id)) {
    const u = {
      id: r.id,
      status: r.status,
      partners: partnersOf.all(id, r.id).map((x) => x.person_id),
      children: [],
    };
    const childRows = childrenOf.all(id, r.id);
    u.children = childRows.map((x) => x.person_id);
    const rels = {};
    for (const x of childRows) if (x.rel && x.rel !== 'birth') rels[x.person_id] = x.rel;
    if (Object.keys(rels).length) u.childRels = rels;
    const marriage = colsToEvent(r, 'marr');
    if (marriage) u.marriage = marriage;
    const divorce = colsToEvent(r, 'div');
    if (divorce) u.divorce = divorce;
    unions[r.id] = u;
  }

  return { name: t.name, focusId: t.focus_id ?? null, persons, unions };
}

// --- writes ------------------------------------------------------------------

const TREE_TABLES = [
  'persons',
  'person_partner_unions',
  'conditions',
  'unions',
  'union_partners',
  'union_children',
];

/** Replace a whole tree's contents atomically. */
export function saveTree(id, data) {
  db.exec('BEGIN');
  try {
    db.prepare(
      `INSERT INTO trees (id, name, focus_id, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, focus_id = excluded.focus_id, updated_at = excluded.updated_at`,
    ).run(id, data.name ?? 'Family Tree', data.focusId ?? null, new Date().toISOString());

    for (const tbl of TREE_TABLES) db.prepare(`DELETE FROM ${tbl} WHERE tree_id = ?`).run(id);

    const insP = db.prepare(
      `INSERT INTO persons (tree_id, id, given_name, surname, gender, is_deceased, occupation, notes, photo_url, union_as_child,
        birth_year, birth_month, birth_day, birth_qualifier, birth_place,
        death_year, death_month, death_day, death_qualifier, death_place)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    );
    const insPU = db.prepare(
      'INSERT INTO person_partner_unions (tree_id, person_id, union_id, ord) VALUES (?,?,?,?)',
    );
    const insC = db.prepare(
      'INSERT INTO conditions (tree_id, person_id, ord, name, hereditary, status, age_at_onset, notes) VALUES (?,?,?,?,?,?,?,?)',
    );
    for (const p of Object.values(data.persons ?? {})) {
      const b = eventToCols(p.birth);
      const d = eventToCols(p.death);
      insP.run(
        id, p.id, p.givenName ?? '', p.surname ?? '', p.gender ?? 'U', p.isDeceased ? 1 : 0,
        p.occupation ?? null, p.notes ?? null, p.photoUrl ?? null, p.unionAsChild ?? null,
        b.year, b.month, b.day, b.qualifier, b.place,
        d.year, d.month, d.day, d.qualifier, d.place,
      );
      (p.unionsAsPartner ?? []).forEach((uid, i) => insPU.run(id, p.id, uid, i));
      (p.conditions ?? []).forEach((c, i) =>
        insC.run(id, p.id, i, c.name, c.hereditary ? 1 : 0, c.status ?? null, c.ageAtOnset ?? null, c.notes ?? null),
      );
    }

    const insU = db.prepare(
      `INSERT INTO unions (tree_id, id, status,
        marr_year, marr_month, marr_day, marr_qualifier, marr_place,
        div_year, div_month, div_day, div_qualifier, div_place)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    );
    const insUP = db.prepare(
      'INSERT INTO union_partners (tree_id, union_id, person_id, ord) VALUES (?,?,?,?)',
    );
    const insUC = db.prepare(
      'INSERT INTO union_children (tree_id, union_id, person_id, ord, rel) VALUES (?,?,?,?,?)',
    );
    for (const u of Object.values(data.unions ?? {})) {
      const m = eventToCols(u.marriage);
      const v = eventToCols(u.divorce);
      insU.run(
        id, u.id, u.status ?? 'unknown',
        m.year, m.month, m.day, m.qualifier, m.place,
        v.year, v.month, v.day, v.qualifier, v.place,
      );
      (u.partners ?? []).forEach((pid, i) => insUP.run(id, u.id, pid, i));
      (u.children ?? []).forEach((cid, i) => {
        const rel = u.childRels?.[cid];
        insUC.run(id, u.id, cid, i, rel && rel !== 'birth' ? rel : null);
      });
    }

    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export function deleteTree(id) {
  db.exec('BEGIN');
  try {
    for (const tbl of TREE_TABLES) db.prepare(`DELETE FROM ${tbl} WHERE tree_id = ?`).run(id);
    db.prepare('DELETE FROM trees WHERE id = ?').run(id);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

let counter = 0;
export function newTreeId() {
  counter = (counter + 1) % 1000;
  return `T_${Date.now().toString(36)}${counter.toString(36)}`;
}
