// Checks on the admin app's Subject umbrellas page (CEO, 24 Nov 2026; migration 20261124100000). Run: npx tsx scripts/dev/subject-umbrellas-admin-test.ts
// The database half (matching, the coverage view, rights, audit) is proved by supabase/tests/subject_umbrellas.sql; this reads the sources to prove the page calls only the three
// super-admin functions the migration defines, with their parameter names, writes no table itself, and is in the nav for a super admin only.
import { readFileSync } from 'node:fs';

let failed = 0;
const check = (label: string, ok: boolean) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`);
  if (!ok) failed += 1;
};
const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const page = read('admin/src/pages/SubjectUmbrellas.tsx');
const mig = read('supabase/migrations/20261124100000_subject_umbrellas.sql');
const layout = read('admin/src/components/AdminLayout.tsx');
const app = read('admin/src/App.tsx');
const code = page.replace(/\/\/.*$/gm, '');

check('the page uses the three admin functions and nothing else of the database for the rows', ['admin_list_subject_umbrellas', 'admin_set_subject_umbrella', 'admin_remove_subject_umbrella'].every((f) => code.includes(`'${f}'`) && mig.includes(`function public.${f}(`)));
check('the page writes no table itself (no insert, update, delete or upsert call)', !/\.(insert|update|delete|upsert)\(/.test(code) && (code.match(/supabase\.from\(/g) || []).length === 1 && /from\('grade_levels'\)\.select\('name'\)/.test(code));
check('the parameter names match the migration (p_umbrella, p_part, p_last_grade)', /p_umbrella: u, p_part: p, p_last_grade: g/.test(code) && /admin_set_subject_umbrella\(p_umbrella text, p_part text, p_last_grade text\)/.test(mig) && /admin_remove_subject_umbrella\(p_umbrella text, p_part text\)/.test(mig));
check('the three functions are for a super admin only, inside the database', (mig.match(/a\.admin_role = 'super_admin'/g) || []).length === 3);
check('the route and the nav item exist, the nav item for a super admin only', /path="subject-umbrellas"/.test(app) && /to: '\/subject-umbrellas'[^}]*roles: \['super_admin'\]/.test(layout));
check('the page says what a row does in plain words (later grades need the part itself)', /For later grades she must be approved for the part itself/.test(page));

console.log(failed === 0 ? '\nAll subject-umbrella admin checks passed.' : `\n${failed} check(s) FAILED.`);
process.exit(failed === 0 ? 0 : 1);
