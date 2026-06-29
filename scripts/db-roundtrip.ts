// Round-trip the sample tree through the SQLite layer and assert it is identical.
// Run: NODE_OPTIONS='--experimental-sqlite' npx tsx scripts/db-roundtrip.ts
import { sampleTree } from '../src/data/sample';
// @ts-expect-error - plain JS module, no types
import { saveTree, getTree, deleteTree } from '../server/db.js';

function canon(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === 'object') {
    return Object.fromEntries(
      Object.keys(v as Record<string, unknown>)
        .sort()
        .map((k) => [k, canon((v as Record<string, unknown>)[k])]),
    );
  }
  return v;
}

let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) console.log(`  ok  ${name}`);
  else {
    failures++;
    console.error(`FAIL  ${name} ${detail}`);
  }
}

const original = sampleTree();
// inject a non-birth child relationship to exercise childRels round-trip
original.unions['u_ae'].childRels = { emre: 'adopted' };

const id = 'roundtrip-test';
deleteTree(id);
saveTree(id, original);
const back = getTree(id);

check('tree exists after save', !!back);
check('name preserved', back!.name === original.name);
check('focusId preserved', back!.focusId === original.focusId);
check(
  'person count preserved',
  Object.keys(back!.persons).length === Object.keys(original.persons).length,
);
check(
  'union count preserved',
  Object.keys(back!.unions).length === Object.keys(original.unions).length,
);

const a = JSON.stringify(canon({ persons: original.persons, unions: original.unions }));
const b = JSON.stringify(canon({ persons: back!.persons, unions: back!.unions }));
check('persons + unions identical after round-trip', a === b);
if (a !== b) {
  // show first divergence to debug
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i]) {
      console.error('  diverge near:', JSON.stringify(a.slice(i - 60, i + 60)));
      console.error('         vs   :', JSON.stringify(b.slice(i - 60, i + 60)));
      break;
    }
  }
}

// spot checks on tricky cases
check('conditions survive', back!.persons['ibrahim'].conditions?.[0]?.name === 'Type 2 Diabetes');
check('hereditary flag survives', back!.persons['ibrahim'].conditions?.[0]?.hereditary === true);
check('divorce survives', back!.unions['u_az'].divorce?.date?.year === 1981);
check('single-parent union survives', back!.unions['u_n'].partners.length === 1);
check('childRel survives', back!.unions['u_ae'].childRels?.emre === 'adopted');
check(
  'sibling order preserved',
  back!.unions['u_gp1'].children.join(',') === original.unions['u_gp1'].children.join(','),
);

deleteTree(id);
console.log(failures === 0 ? '\nALL DB ROUND-TRIP CHECKS PASSED' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
