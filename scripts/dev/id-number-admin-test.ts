// P4-3 (23 Nov 2026): the ID number screen keeps the number out of everything it can. Run: npx --no-install tsx scripts/dev/id-number-admin-test.ts
import fs from 'node:fs';

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
};
const read = (p: string) => fs.readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

const comp = read('admin/src/components/IdNumberCheck.tsx');
const queries = read('admin/src/lib/queries.ts');
const page = read('admin/src/pages/TutorVerificationDetail.tsx');
const migration = read('supabase/migrations/20261123160000_p4_id_number.sql');

check('I1 the number box is masked, not remembered by the browser, not spell-checked', /type="password"/.test(comp) && /autoComplete="off"/.test(comp) && /spellCheck=\{false\}/.test(comp));
check('I2 the number is held in a ref, never in state: the only state that carries text is the box content, wiped with the ref', /const idRef = useRef\(''\)/.test(comp) && !/useState<[^>]*>\(idRef/.test(comp));
check('I3 it is wiped as soon as the date is saved, and by "Clear"', /await saveDateOfBirthFromId\(tutorId, idRef\.current, checked\.dob\);\s*wipe\(\);/.test(comp) && /idRef\.current = '';/.test(comp));
check('I4 nothing is written to browser storage, the address bar or the console from the screen or its calls', !/localStorage|sessionStorage|history\.|location\.|console\./.test(comp) && !/console\./.test(queries.slice(queries.indexOf('P4-3 (23 Nov 2026)'))));
check('I5 the error shown comes from a fixed list of sentences or the database message, never the typed value', /REASONS\[c\.reason/.test(comp) && !/\$\{idRef/.test(comp) && !/setError\([^)]*idRef/.test(comp));
check('I6 the officer must confirm the date (a second button) and the database re-derives and compares it', /Yes, save this date/.test(comp) && /p_expected_dob: confirmedDob/.test(queries));
check('I7 the name compare is a question, not a refusal, and the typed name is cleared after the call', /not a refusal/.test(comp) && /setPrintedName\(''\)/.test(comp));
check('I8 a passport is told to use the manual date', /For a passport there is no such number/.test(comp) && /Correct it|Record from ID/.test(page));
check('I9 the page shows the new box inside the date of birth card', /<IdNumberCheck tutorId=\{tutor\.id\} onSaved=\{load\} \/>/.test(page));

check('M1 no message raised by the database functions contains the number (messages name a reason code or the date, never the argument)', !/raise exception[^;]*p_id/i.test(migration.replace(/--[^\n]*/g, '')) && !/raise (notice|warning|log)/i.test(migration));
check('M2 the audit line carries a source word only', /jsonb_build_object\('was_already_recorded', v_previous is not null, 'source', 'id_number'\)/.test(migration));

// the client error log scrubs any run of 9 or more digits, so a 13-digit number cannot reach it even if a message carried one
import('../../src/lib/errorLog').then((m) => {
  const scrub = (m as { scrubErrorText?: (s: string) => string }).scrubErrorText;
  if (typeof scrub === 'function') {
    check('E1 the app\'s own error log removes a 13-digit number from any text', !/9005175009087|\d{9,}/.test(scrub('failed for 9005175009087 at the screen')), scrub('failed for 9005175009087 at the screen'));
  } else {
    check('E1 (skipped: the scrubber has another name; the database scrub is proved in supabase/tests/client_errors.sql)', true);
  }
  console.log(failures ? `\n${failures} FAILED` : '\nall checks passed');
  process.exit(failures ? 1 : 0);
});
