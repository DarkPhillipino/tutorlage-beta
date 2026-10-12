// Run: npx tsx scripts/dev/institution-memory-test.ts
// Master 7cq: the per-guardian, per-learner institution memory used when a guardian books for a learner.
import { rememberInstitution, recallInstitution } from '../../src/lib/institutionMemory';

let failed = 0;
function check(name: string, ok: boolean) {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`);
  if (!ok) failed += 1;
}

function installStorage(impl: Partial<Storage> & { data?: Map<string, string> }) {
  (globalThis as unknown as { window: unknown }).window = { localStorage: impl };
}

const data = new Map<string, string>();
installStorage({
  data,
  getItem: (k: string) => (data.has(k) ? data.get(k)! : null),
  setItem: (k: string, v: string) => void data.set(k, v),
});

const school = { id: 'a1b2c3d4-0000-4000-8000-000000000001', name: 'Test High School', curriculum: 'CAPS', institutionType: 'School' };

check('nothing remembered at first', recallInstitution('g1', 'l1') === null);
rememberInstitution('g1', 'l1', school);
const back = recallInstitution('g1', 'l1');
check('round trip returns the same institution', JSON.stringify(back) === JSON.stringify(school));
check('another learner of the same guardian is separate', recallInstitution('g1', 'l2') === null);
check('another guardian is separate', recallInstitution('g2', 'l1') === null);

rememberInstitution('g1', 'l2', { ...school, id: 'a1b2c3d4-0000-4000-8000-000000000002', name: 'Other School' });
check('two learners keep their own', recallInstitution('g1', 'l1')?.name === 'Test High School' && recallInstitution('g1', 'l2')?.name === 'Other School');

data.set('tutorlage.institution.g1.l3', '{not json');
check('corrupt data is treated as nothing remembered', recallInstitution('g1', 'l3') === null);
data.set('tutorlage.institution.g1.l4', JSON.stringify({ id: 5, name: 'x' }));
check('wrong shape is treated as nothing remembered', recallInstitution('g1', 'l4') === null);
data.set('tutorlage.institution.g1.l5', JSON.stringify({ id: '', name: 'x' }));
check('an empty id is treated as nothing remembered', recallInstitution('g1', 'l5') === null);
data.set('tutorlage.institution.g1.l6', JSON.stringify({ id: 'abc', name: 'Partial' }));
const partial = recallInstitution('g1', 'l6');
check('missing optional fields get defaults', partial?.curriculum === 'Other' && partial?.institutionType === '');

installStorage({
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('blocked');
  },
});
let threw = false;
try {
  rememberInstitution('g1', 'l1', school);
  check('blocked storage on write does not throw', true);
  check('blocked storage on read returns nothing', recallInstitution('g1', 'l1') === null);
} catch {
  threw = true;
}
check('no exception escaped from blocked storage', !threw);

console.log(failed === 0 ? '\nall checks passed' : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
