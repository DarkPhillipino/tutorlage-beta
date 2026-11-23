// P4-5 (23 Nov 2026): the one exceptions line on the Verification page. Run: npx --no-install tsx scripts/dev/exceptions-line-test.ts
import fs from 'node:fs';

let failures = 0;
const check = (name: string, ok: boolean) => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`);
};
const read = (p: string) => fs.readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const line = read('admin/src/components/ExceptionsLine.tsx');
const page = read('admin/src/pages/TutorVerificationQueue.tsx');
const mig = read('supabase/migrations/20261123200000_p4_exceptions_report.sql');

check('X1 the line asks ONE database function and writes nothing', /rpc\('admin_exceptions_report'\)/.test(line) && !/\.insert\(|\.update\(|\.delete\(|\.upsert\(/.test(line));
check('X2 any error or a missing function shows nothing at all (the page works before the migration)', /if \(!report\) return null;/.test(line) && /catch/.test(line));
check('X3 the four exceptions are named in words, and each tutor opens that tutor\'s page', /Level set by hand/.test(line) && /Hours taught elsewhere/.test(line) && /Module 7 exemption/.test(line) && /Approved, no longer ready/.test(line) && /\/verification\/\$\{r\.tutor_id\}/.test(line));
check('X4 the line is on the Verification page', /<ExceptionsLine \/>/.test(page));
check('X5 the function is read only (STABLE), for verification officers and super admins, and quotes no document', /stable/.test(mig) && /admin_role_in\(array\['verification_officer', 'super_admin'\]\)/.test(mig) && !/document_url/.test(mig));

console.log(failures ? `\n${failures} FAILED` : '\nall checks passed');
process.exit(failures ? 1 : 0);
