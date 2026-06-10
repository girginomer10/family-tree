# Family Tree

A from-scratch, fully client-side family tree application. React + TypeScript + Vite, with a
custom SVG layout engine — no chart library.

```bash
npm install
npm run dev        # start the app
npm run build      # type-check + production build
npx tsx scripts/smoke.ts   # logic smoke tests (model, layout, GEDCOM round-trip)
```

## Features

- **Five chart views** (toolbar switcher): **Hourglass** (ancestors + descendants +
  siblings), **Pedigree** (blood ancestors only), **Descendants**, a **Fan chart**
  (240° ancestor fan, branch-colored, with "+" sectors to add unknown ancestors in
  place), and a **Timeline** (lifespan bars over a decade grid with marriage markers).
- **Hourglass chart** centered on a focus person: ancestors above (pedigree), descendants
  below, the focus's siblings and half-siblings on the focus row. Click a card to select,
  double-click (or use the side panel) to re-center the tree on that person.
- **Relationship calculator** (⇄): proper kinship terms — "half-brother",
  "great-grandmother", "first cousin once removed", in-law composition ("husband of
  sister") — plus a clickable link chain for distant connections. The side panel shows
  every selected person's relation to the focus automatically.
- **Statistics dashboard** (◫): totals, living/deceased, average lifespan, longest life,
  births-per-decade histogram, top surnames/given names/birth places.
- **Multiple trees**: the ▾ menu next to the tree name switches, creates, and deletes
  independent trees; file imports land in a new tree instead of overwriting.
- **Adoption/step/foster children**: per-union child relationship types (cycle the ☉/◌
  toggle on a child row); non-birth links draw as dashed connectors and round-trip
  through GEDCOM as `PEDI`.
- **Couples drawn side by side**; children hang off the *union* (marriage), not an
  individual. Multiple marriages, half-siblings, and unknown parents all render correctly;
  divorced/separated unions get a dashed spouse line.
- **Badges** (`▲`/`▼`) on cards mark relatives that exist but are outside the rendered
  scope (hidden ancestors, other families, aunts/uncles); clicking a badge re-centers.
- **Editing**: add parent / spouse (new or link an existing person) / child (choosing the
  other parent) / sibling; edit person facts (fuzzy dates with `abt./bef./aft.`, places,
  occupation, notes, deceased); photo upload (auto-downscaled to a portable data URL) or
  photo URL; edit relationship status & marriage info; unlink partners/children; reorder
  siblings; delete people. All edits are undoable (⌘Z / ⇧⌘Z).
- **Search** (`/` to jump to the box), generation depth selectors (↑ ancestors, ↓
  descendants, 1–5 or All), pan/zoom canvas with fit-to-screen.
- **Persistence**: autosaves to `localStorage`. **Import/Export**: JSON (full fidelity),
  GEDCOM 5.5.1 (interops with Gramps/webtrees/Ancestry/etc.), and the chart as SVG or PNG.
- Ships with a 22-person, 4-generation sample family covering the tricky cases.

## Architecture

```
src/
  types.ts               Data model: Person + Union (GEDCOM INDI/FAM style) + helpers
  model/
    mutations.ts         Pure edit operations; every one keeps person<->union refs bidirectional
    queries.ts           Traversals (parents/spouses/children/siblings), search, validate()
    kinship.ts           Relationship calculator (common-ancestor terms, in-law composition, BFS chain)
    stats.ts             Tree statistics (lifespans, decades, top names/places)
  layout/
    layout.ts            Tree layout engine, 3 modes: hourglass / pedigree / descendants
    fan.ts               Ancestor fan chart geometry (ahnentafel slots -> SVG sectors)
    timeline.ts          Lifespan-bar timeline layout (decade grid, marriage markers)
  gedcom/gedcom.ts       GEDCOM 5.5.1 import (FAM records authoritative) and export
  store/useTreeStore.ts  Multi-tree store: tree index + per-tree localStorage autosave,
                         per-session undo/redo history
  data/sample.ts         Demo family
  utils/files.ts         Download/read files, SVG serialization, SVG->PNG, photo downscaling
  components/            Toolbar, ZoomCanvas (shared pan/zoom), TreeCanvas, FanChartView,
                         TimelineView, PersonCard, Sidebar, person/union/relationship/stats modals
scripts/smoke.ts         Headless checks: model invariants, layout overlap tests, GEDCOM round-trip
```

### Data model

Two entities, mirroring GEDCOM's INDI/FAM — the only model that cleanly expresses
remarriage, half-siblings, and unknown parents:

- `Person` — names, gender, fuzzy birth/death events, plus back-references
  `unionsAsPartner[]` (~FAMS) and `unionAsChild` (~FAMC).
- `Union` — up to 2 `partners`, ordered `children`, status (married/divorced/…),
  marriage/divorce events. A union with one partner = the other parent is unknown.

`validate()` checks referential integrity; every mutation and import maintains it.

### Layout engine (src/layout/layout.ts)

A tidy-tree variant over "blocks" (anchor person + spouse cards laid side by side):

1. The root row is the focus's parents — anchored on the parent with the most unions so
   step-parents and half-siblings appear. Only the focus expands downward; siblings stay
   leaf cards.
2. Descendant side: post-order walk computes per-level `[left,right]` extents; subtrees
   are merged with per-level contour collision shifts; parents are centered over their
   children's connection points (union marriage midpoints).
3. Ancestor side: a pedigree tree of couple blocks hangs over each parent card, laid out
   independently with the same walk and glued at x=0 (shared root block).
4. Connectors are orthogonal buses: marriage midpoint → drop to a lane between the
   generation rows → horizontal bus → stubs into each child's card top. Multiple
   child-bearing unions get staggered lanes. People reached twice (pedigree collapse)
   render once plus dashed "see elsewhere" stub cards.

The engine is a pure function returning `{cards, links, bounds}`, so it is unit-testable
and renderer-agnostic.

### GEDCOM

Import parses the line/level structure into a node tree, folds `CONC/CONT`, builds
persons from `INDI` and unions from `FAM`, then rebuilds all person-side pointers from
the FAM records (authoritative), collecting warnings instead of throwing. Export writes
GEDCOM 5.5.1 with `CHAR UTF-8`, sequential `@I#@/@F#@` xrefs, and HUSB/WIFE slots
assigned by gender. Round-trip is covered in `scripts/smoke.ts`.

## Notes for future work

- Aunts/uncles/cousins are intentionally out of hourglass scope (badges + refocus reach
  them). A "descendants of ancestors" toggle would widen the view.
- Possible next features: map of life events, fan-chart data-completeness overlay,
  PDF export, drag-to-reorder siblings, merge/duplicate-person detection across imports.
- `newId()` is timestamp+random based; collisions across import/merge are not handled
  (GEDCOM import keeps file xrefs, JSON import keeps stored ids).
- PNG export rasterizes the live SVG; photos from remote URLs taint the canvas and make
  it fail (uploaded data-URL photos are safe) — the app shows a hint when that happens.
