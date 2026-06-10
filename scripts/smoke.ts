/* Smoke test: run with `npx tsx scripts/smoke.ts` */
import { sampleTree } from '../src/data/sample';
import { validate, getParents, getSiblings, getSpouses, getChildren } from '../src/model/queries';
import * as M from '../src/model/mutations';
import { computeLayout, CARD_W, CARD_H } from '../src/layout/layout';
import { computeFan } from '../src/layout/fan';
import { computeTimeline } from '../src/layout/timeline';
import { relate, bloodRelation, bloodTerm } from '../src/model/kinship';
import { computeStats } from '../src/model/stats';
import { exportGedcom, importGedcom } from '../src/gedcom/gedcom';
import { childRelOf, fullName } from '../src/types';

let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) console.log(`  ok  ${name}`);
  else {
    failures++;
    console.error(`FAIL  ${name} ${detail}`);
  }
}

// ---------- 1. sample data integrity ----------
console.log('\n[1] sample data');
const data = sampleTree();
check('sample validates', validate(data).length === 0, validate(data).join('; '));
check('focus is emre', data.focusId === 'emre');
check(
  'emre parents = Ahmet, Elif',
  getParents(data, 'emre')
    .map((p) => p.givenName)
    .sort()
    .join(',') === 'Ahmet,Elif',
);
check(
  'emre siblings incl. half-brother Murat',
  getSiblings(data, 'emre')
    .map((p) => p.givenName)
    .sort()
    .join(',') === 'Murat,Selin',
);
check('deniz has single parent', getParents(data, 'deniz').length === 1);
check('ahmet has two spouses', getSpouses(data, 'ahmet').length === 2);

// ---------- 2. layout ----------
console.log('\n[2] layout');
const layout = computeLayout(data, { ancestorDepth: 2, descendantDepth: 2 });
check('layout has cards', layout.cards.length > 0);
const cardRects = layout.cards.filter((c) => !c.isGhost);
// no two cards overlap
let overlaps = 0;
for (let i = 0; i < cardRects.length; i++) {
  for (let j = i + 1; j < cardRects.length; j++) {
    const a = cardRects[i];
    const b = cardRects[j];
    if (
      a.x < b.x + CARD_W &&
      b.x < a.x + CARD_W &&
      a.y < b.y + CARD_H &&
      b.y < a.y + CARD_H
    ) {
      overlaps++;
      console.error(`        overlap: ${a.personId}@gen${a.gen} vs ${b.personId}@gen${b.gen}`);
    }
  }
}
check('no card overlaps', overlaps === 0);
const ids = new Set(cardRects.map((c) => c.personId));
for (const required of ['emre', 'deniz', 'selin', 'murat', 'ahmet', 'elif', 'zeynep', 'ela', 'aras', 'mehmet', 'fatma', 'hasan', 'ayse']) {
  check(`renders ${required}`, ids.has(required));
}
check(
  'great-grandparents hidden at depth 2',
  !ids.has('ibrahim') && !ids.has('hatice'),
);
const mehmetCard = layout.cards.find((c) => c.personId === 'mehmet');
check('mehmet badge: more ancestors', !!mehmetCard?.hasMoreAncestors);
const gp1Badge = layout.cards.some(
  (c) => (c.personId === 'mehmet' || c.personId === 'fatma') && c.hasMoreDescendants,
);
check('grandparent badge: hidden aunt Hülya', gp1Badge);
const selinCard = layout.cards.find((c) => c.personId === 'selin');
check('selin badge: more descendants (own family hidden)', !!selinCard?.hasMoreDescendants);
const denizCard = layout.cards.find((c) => c.personId === 'deniz');
check('deniz badge: more ancestors (mother Nazlı hidden)', !!denizCard?.hasMoreAncestors);
const focusCard = layout.cards.find((c) => c.isFocus);
check('focus card is emre at gen 0', focusCard?.personId === 'emre' && focusCard.gen === 0);
check('links emitted', layout.links.length > 5);

// hourglass scope: focus's ancestors + their other spouses/children-as-leaves +
// focus descendants. Aunts/uncles/cousins stay behind badges by design.
const deep = computeLayout(data, { ancestorDepth: 99, descendantDepth: 99 });
const deepIds = new Set(deep.cards.filter((c) => !c.isGhost).map((c) => c.personId));
check('deep layout includes great-grandparents', deepIds.has('ibrahim') && deepIds.has('hatice'));
check('deep layout person count', deep.shownPersons >= 15, `shown=${deep.shownPersons}`);
// no overlaps at deep depth either
let deepOverlaps = 0;
const dc = deep.cards.filter((c) => !c.isGhost);
for (let i = 0; i < dc.length; i++) {
  for (let j = i + 1; j < dc.length; j++) {
    if (
      dc[i].x < dc[j].x + CARD_W &&
      dc[j].x < dc[i].x + CARD_W &&
      dc[i].y < dc[j].y + CARD_H &&
      dc[j].y < dc[i].y + CARD_H
    )
      deepOverlaps++;
  }
}
check('no overlaps at deep depth', deepOverlaps === 0);

// focus on someone else
const data2 = M.setFocus(data, 'deniz');
const layout2 = computeLayout(data2, { ancestorDepth: 2, descendantDepth: 2 });
check('refocus on deniz works (single parent)', layout2.cards.some((c) => c.isFocus && c.personId === 'deniz'));

// ---------- 2b. view modes ----------
console.log('\n[2b] view modes');
const ped = computeLayout(data, { ancestorDepth: 3, descendantDepth: 2, mode: 'pedigree' });
const pedIds = new Set(ped.cards.filter((c) => !c.isGhost).map((c) => c.personId));
check('pedigree: blood ancestors only', pedIds.has('ahmet') && pedIds.has('elif') && pedIds.has('ibrahim'));
check('pedigree: no step-mother / siblings / spouse / children',
  !pedIds.has('zeynep') && !pedIds.has('selin') && !pedIds.has('deniz') && !pedIds.has('ela'));
check('pedigree: focus badge for hidden family',
  !!ped.cards.find((c) => c.isFocus)?.hasMoreDescendants);
const desc = computeLayout(data, { ancestorDepth: 2, descendantDepth: 2, mode: 'descendants' });
const descIds = new Set(desc.cards.filter((c) => !c.isGhost).map((c) => c.personId));
check('descendants: no ancestors', !descIds.has('ahmet') && !descIds.has('mehmet'));
check('descendants: spouse + children render', descIds.has('deniz') && descIds.has('ela') && descIds.has('aras'));
check('descendants: focus badge for hidden parents', !!desc.cards.find((c) => c.isFocus)?.hasMoreAncestors);
check('descendants: no ghost card', !desc.cards.some((c) => c.isGhost));

// ---------- 2c. fan chart ----------
console.log('\n[2c] fan chart');
const fan = computeFan(data, 'emre', 3);
check('fan has sectors', fan.sectors.length > 0);
const fanIds = new Set(fan.sectors.map((s) => s.personId).filter(Boolean));
check('fan ring1 = parents', fanIds.has('ahmet') && fanIds.has('elif'));
check('fan ring2 = grandparents', fanIds.has('mehmet') && fanIds.has('fatma') && fanIds.has('hasan') && fanIds.has('ayse'));
check('fan ring3 includes great-grandparents', fanIds.has('ibrahim') && fanIds.has('hatice'));
check('fan: no spouse/children in ancestor fan', !fanIds.has('deniz') && !fanIds.has('zeynep'));
const emptySlots = fan.sectors.filter((s) => !s.personId);
check('fan: empty add-parent slots exist (unknown ancestors)', emptySlots.length > 0);
check('fan: empty slots carry childId', emptySlots.every((s) => !!s.childId));
const fanDeniz = computeFan(data, 'deniz', 3);
check('fan from deniz: mother + her empty father slot',
  fanDeniz.sectors.some((s) => s.personId === 'nazli') &&
  fanDeniz.sectors.some((s) => !s.personId && s.childId === 'deniz'));

// ---------- 2d. kinship ----------
console.log('\n[2d] kinship');
const term = (a: string, b: string) => relate(data, a, b).short;
check('father', term('ahmet', 'emre') === 'father', term('ahmet', 'emre') ?? '');
check('son', term('emre', 'ahmet') === 'son', term('emre', 'ahmet') ?? '');
check('grandmother', term('fatma', 'emre') === 'grandmother', term('fatma', 'emre') ?? '');
check('great-grandfather', term('ibrahim', 'emre') === 'great-grandfather', term('ibrahim', 'emre') ?? '');
check('full sister', term('selin', 'emre') === 'sister', term('selin', 'emre') ?? '');
check('half-brother', term('murat', 'emre') === 'half-brother', term('murat', 'emre') ?? '');
check('uncle', term('mustafa', 'emre') === 'uncle', term('mustafa', 'emre') ?? '');
check('aunt', term('hulya', 'emre') === 'aunt', term('hulya', 'emre') ?? '');
check('nephew', term('emre', 'hulya') === 'nephew', term('emre', 'hulya') ?? '');
check('first cousin', term('cem', 'emre') === 'first cousin', term('cem', 'emre') ?? '');
check('first cousin once removed', term('cem', 'ela') === 'first cousin once removed', term('cem', 'ela') ?? '');
check('wife', term('deniz', 'emre') === 'wife', term('deniz', 'emre') ?? '');
check('ex-wife', term('zeynep', 'ahmet') === 'ex-wife', term('zeynep', 'ahmet') ?? '');
check('granddaughter', term('ela', 'ahmet') === 'granddaughter', term('ela', 'ahmet') ?? '');
const inLaw = relate(data, 'can', 'emre');
check('brother-in-law via spouse composition', inLaw.short === 'husband of sister', inLaw.short ?? '');
const viaB = relate(data, 'nazli', 'emre');
check("mother of spouse", viaB.short === "mother of Emre Yılmaz's wife", viaB.short ?? '');
const chain = relate(data, 'nazli', 'mehmet').chain;
check('distant chain exists', !!chain && chain.length >= 4);
check('unrelated blood is null', bloodRelation(data, 'can', 'deniz') === null);
check('bloodTerm second cousin', bloodTerm({ a: 3, b: 3, commonAncestors: ['x'] }, 'F') === 'second cousin');

// ---------- 2e. child relationship types ----------
console.log('\n[2e] child relationship types (adopted/step/foster)');
let dRel = sampleTree();
dRel = M.setChildRel(dRel, 'u_ae', 'selin', 'adopted');
check('setChildRel validates', validate(dRel).length === 0);
check('childRelOf reads back', childRelOf(dRel.unions['u_ae'], 'selin') === 'adopted');
check('default is birth', childRelOf(dRel.unions['u_ae'], 'emre') === 'birth');
const relLayout = computeLayout(dRel, { ancestorDepth: 2, descendantDepth: 2 });
check('adopted child stub is dashed', relLayout.links.some((l) => l.kind === 'tree' && l.dashed));
const gedRel = exportGedcom(dRel);
check('GEDCOM emits PEDI adopted', /1 FAMC @F\d+@\n2 PEDI adopted/.test(gedRel));
const reRel = importGedcom(gedRel);
const selin2 = Object.values(reRel.data.persons).find((p) => p.givenName === 'Selin' && p.surname === 'Yılmaz');
check(
  'PEDI survives round-trip',
  !!selin2?.unionAsChild && childRelOf(reRel.data.unions[selin2.unionAsChild], selin2.id) === 'adopted',
);
dRel = M.setChildRel(dRel, 'u_ae', 'selin', 'birth');
check('reset to birth removes childRels', dRel.unions['u_ae'].childRels === undefined);

// ---------- 2f. timeline ----------
console.log('\n[2f] timeline');
const tl = computeTimeline(data, 2026);
check('timeline rows for all dated persons', tl.rows.length === 22, `rows=${tl.rows.length}`);
check('timeline sorted by birth', tl.rows[0].personId === 'ibrahim');
const emreRow = tl.rows.find((r) => r.personId === 'emre');
check('living bar extends to now', !!emreRow && emreRow.living && emreRow.years === '1985–');
const mehmetRow = tl.rows.find((r) => r.personId === 'mehmet');
check('deceased bar ends at death', !!mehmetRow && !mehmetRow.living && mehmetRow.years === '1928–1995');
check('marriage markers present', tl.rows.some((r) => r.markers.length > 0));
check('decade ticks span range', tl.ticks[0].year === 1900 && tl.ticks[tl.ticks.length - 1].year === 2030);

// ---------- 2g. stats ----------
console.log('\n[2g] stats');
const st = computeStats(data, 2026);
check('stats total', st.total === 22);
check('stats unions', st.unions === 9);
check('stats deceased', st.deceased === 5, `deceased=${st.deceased}`);
check('stats avg lifespan computed', st.avgLifespan != null && st.avgLifespan > 60);
check('stats top surname Yılmaz', st.topSurnames[0]?.name === 'Yılmaz');
check('stats longest life', st.longestLife?.name === 'Fatma Yılmaz', st.longestLife?.name ?? '');
check('stats earliest birth İbrahim', st.earliestBirth?.year === 1900);
check('stats decades histogram', st.birthsPerDecade.length > 5);

// ---------- 3. mutations ----------
console.log('\n[3] mutations');
let d = sampleTree();
const addedSpouse = M.addSpouse(d, 'murat', { givenName: 'Aylin', surname: 'Yılmaz', gender: 'F' });
d = addedSpouse.data;
check('addSpouse validates', validate(d).length === 0, validate(d).join('; '));
check('murat now has spouse', getSpouses(d, 'murat').length === 1);

const addedChild = M.addChild(d, 'murat', d.persons['murat'].unionsAsPartner[0], {
  givenName: 'Kerem',
  surname: 'Yılmaz',
  gender: 'M',
});
d = addedChild.data;
check('addChild validates', validate(d).length === 0);
check('kerem has 2 parents', getParents(d, addedChild.id).length === 2);

const addedChildUnknown = M.addChild(d, 'hulya', null, {
  givenName: 'Pelin',
  surname: 'Yılmaz',
  gender: 'F',
});
d = addedChildUnknown.data;
check('addChild w/ unknown partner validates', validate(d).length === 0);
check('pelin has 1 parent', getParents(d, addedChildUnknown.id).length === 1);

const addedParent = M.addParent(d, 'nazli', { givenName: 'Saim', surname: 'Aksoy', gender: 'M' });
d = addedParent.data;
check('addParent validates', validate(d).length === 0);
check('nazli has 1 parent now', getParents(d, 'nazli').length === 1);

const addedSibling = M.addSibling(d, 'nazli', { givenName: 'Sevim', surname: 'Aksoy', gender: 'F' });
d = addedSibling.data;
check('addSibling validates', validate(d).length === 0);
check('nazli has sibling', getSiblings(d, 'nazli').length === 1);

const linked = M.linkSpouses(d, 'hulya', 'can');
check('linkSpouses validates', validate(linked.data).length === 0);

d = M.unlinkPartner(d, d.persons['murat'].unionsAsPartner[0], addedSpouse.id);
check('unlinkPartner validates', validate(d).length === 0);
check('murat union kept (has child)', getChildren(d, 'murat').length === 1);

d = M.deletePerson(d, 'ahmet');
check('deletePerson validates', validate(d).length === 0, validate(d).join('; '));
check('ahmet gone', !d.persons['ahmet']);
check('emre still has mother', getParents(d, 'emre').map((p) => p.givenName).join(',') === 'Elif');

// delete focus person -> focus moves
let d3 = sampleTree();
d3 = M.deletePerson(d3, 'emre');
check('deleting focus reassigns focusId', !!d3.focusId && d3.focusId !== 'emre' && !!d3.persons[d3.focusId]);
check('post-delete validates', validate(d3).length === 0);

// ---------- 4. GEDCOM round-trip (sample) ----------
console.log('\n[4] GEDCOM round-trip');
const ged = exportGedcom(sampleTree());
check('export contains INDI records', (ged.match(/ INDI$/gm) ?? []).length === 22);
check('export contains FAM records', (ged.match(/ FAM$/gm) ?? []).length === 9);
check('export ends with TRLR', ged.trimEnd().endsWith('0 TRLR'));

const re = importGedcom(ged);
check('reimport: no warnings', re.warnings.length === 0, re.warnings.join('; '));
check('reimport validates', validate(re.data).length === 0, validate(re.data).join('; '));
check('reimport person count', Object.keys(re.data.persons).length === 22);
check('reimport union count', Object.keys(re.data.unions).length === 9);
const emre2 = Object.values(re.data.persons).find((p) => p.givenName === 'Emre');
check('emre survives round-trip', !!emre2 && emre2.surname === 'Yılmaz');
check(
  'emre parents survive round-trip',
  !!emre2 &&
    getParents(re.data, emre2.id)
      .map((p) => p.givenName)
      .sort()
      .join(',') === 'Ahmet,Elif',
);
const ahmet2 = Object.values(re.data.persons).find((p) => p.givenName === 'Ahmet');
check('ahmet keeps 2 unions', !!ahmet2 && ahmet2.unionsAsPartner.length === 2);
const divorced = Object.values(re.data.unions).find((u) => u.status === 'divorced');
check('divorce survives round-trip', !!divorced && divorced.divorce?.date?.year === 1981);
const mehmet2 = Object.values(re.data.persons).find((p) => p.givenName === 'Mehmet');
check('birth place survives', mehmet2?.birth?.place === 'Konya');
check('death year survives', mehmet2?.death?.date?.year === 1995);

// ---------- 5. GEDCOM import (external file from spec example) ----------
console.log('\n[5] external GEDCOM');
const externalGed = `0 HEAD
1 SOUR MYFAMILYTREEAPP
2 VERS 1.0
1 GEDC
2 VERS 5.5.1
2 FORM LINEAGE-LINKED
1 CHAR UTF-8
1 SUBM @U1@
0 @U1@ SUBM
1 NAME Omer
0 @I1@ INDI
1 NAME John /Smith/
1 SEX M
1 BIRT
2 DATE 12 MAR 1930
2 PLAC Boston, Massachusetts, USA
1 DEAT
2 DATE 4 JUL 1998
1 FAMS @F1@
0 @I2@ INDI
1 NAME Mary /Brown/
1 SEX F
1 BIRT
2 DATE ABT 1934
1 FAMS @F1@
0 @I3@ INDI
1 NAME Robert /Smith/
1 SEX M
1 BIRT
2 DATE 23 SEP 1958
1 FAMC @F1@
1 FAMS @F2@
0 @I4@ INDI
1 NAME Anna /Jones/
1 SEX F
1 FAMS @F2@
0 @I5@ INDI
1 NAME Emily /Smith/
1 SEX F
1 BIRT
2 DATE 15 MAY 1988
1 FAMC @F2@
0 @I6@ INDI
1 NAME David /Smith/
1 SEX M
1 FAMC @F2@
0 @F1@ FAM
1 HUSB @I1@
1 WIFE @I2@
1 MARR
2 DATE 6 JUN 1956
1 CHIL @I3@
0 @F2@ FAM
1 HUSB @I3@
1 WIFE @I4@
1 CHIL @I5@
1 CHIL @I6@
0 TRLR
`;
const ext = importGedcom(externalGed);
check('external import: no warnings', ext.warnings.length === 0, ext.warnings.join('; '));
check('external import validates', validate(ext.data).length === 0, validate(ext.data).join('; '));
check('6 persons imported', Object.keys(ext.data.persons).length === 6);
const john = ext.data.persons['I1'];
check('john parsed', !!john && john.givenName === 'John' && john.surname === 'Smith');
check('john birth full date', john?.birth?.date?.year === 1930 && john?.birth?.date?.month === 3 && john?.birth?.date?.day === 12);
check('john deceased', !!john?.isDeceased);
check('mary fuzzy date', ext.data.persons['I2']?.birth?.date?.qualifier === 'about');
check('robert in two fams', ext.data.persons['I3']?.unionsAsPartner.length === 1 && ext.data.persons['I3']?.unionAsChild === 'F1');
check(
  'layout works on imported tree',
  computeLayout({ ...ext.data, focusId: 'I3' }, { ancestorDepth: 2, descendantDepth: 2 }).cards.length === 6,
);

// ---------- summary ----------
console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
