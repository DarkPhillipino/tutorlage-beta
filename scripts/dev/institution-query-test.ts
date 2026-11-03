// Guards the two reads that join an institution to its curriculum (src/lib/queries.ts: the picker's list and a learner's saved institution).
// Since the 20 Oct 2026 migration "curriculum_and_availability_matching" there are TWO ways from schools_institutions to curricula (the
// curriculum_id column and the institution_curricula join table), so an embed written as `curricula ( name )` is ambiguous: PostgREST answers
// HTTP 300 (PGRST201) and the picker shows "Couldn't load institutions" for everyone (found 3 Nov 2026 on production). Run:
// npx tsx scripts/dev/institution-query-test.ts
import fs from 'node:fs';

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
};

const source = fs.readFileSync(new URL('../../src/lib/queries.ts', import.meta.url), 'utf8');
const migration = fs.readFileSync(new URL('../../supabase/migrations/20261019090000_curriculum_and_availability_matching.sql', import.meta.url), 'utf8');

const ambiguous = [...source.matchAll(/\bcurricula\s*\(/g)].length;
const hinted = [...source.matchAll(/\bcurricula!schools_institutions_curriculum_id_fkey\s*\(\s*name\s*\)/g)].length;

check('the join table that makes the embed ambiguous exists in the migrations (so this guard is still needed)', /create table[^;]*institution_curricula/i.test(migration));
check('no embed of curricula without a relationship hint in queries.ts', ambiguous === 0, `${ambiguous} found`);
check('both reads (the picker list and the learner\'s saved institution) name the column relationship', hinted === 2, `${hinted} found`);

if (failures > 0) {
  console.log(`${failures} FAILED`);
  process.exitCode = 1;
} else {
  console.log('all ok');
}
