// Checks on HOURS TAUGHT OUTSIDE TUTORLAGE (J3, 19 Nov 2026). Run: npx tsx scripts/dev/prior-hours-test.ts
// Proves, without a database: the admin form refuses what the database refuses (no proof, short reason, 0 or more than 5000 hours); the total is always the sum of the
// un-removed entries and is never typed in; the words on the admin screen say the rule plainly (hours count in the HOURS part only; ALL six parts or a credential; a level
// from a credential or an admin-assigned level) and never worry about commission; the screen is wired under the Level section and calls only the three admin functions;
// the tutor's own screens show "Tutorlage hours" and "outside Tutorlage" separately and count both toward the hours step; the migration replaces ONE existing function with the
// old text plus the prior-hours lines only (a line-by-line comparison with the saved old text), and the rollback file holds the old text whose md5 is the one read on
// production on 18 Nov (63cd2be556ebce6c7c095fba001dec67). It does NOT prove the database behaviour: supabase/tests/prior_hours.sql does, rolled back.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { PRIOR_HOURS_RULE, checkPriorHoursForm, totalOf, type PriorHoursEntry } from '../../admin/src/lib/priorHoursRules';

let failed = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) failed += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && detail ? ` [${detail}]` : ''}`);
}
const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const good = { hours: '300', reason: 'About 300 hours at Example High School, 2023 to 2025', proof: 'Principal letter, 12 March 2026' };

check('F1 a complete entry is accepted (300 hours)', checkPriorHoursForm(good).message === null && checkPriorHoursForm(good).hours === 300);
check('F2 no proof, or a proof under 5 characters, is refused', checkPriorHoursForm({ ...good, proof: '' }).message !== null && checkPriorHoursForm({ ...good, proof: 'abc' }).message !== null);
check('F3 a reason under 10 characters is refused', checkPriorHoursForm({ ...good, reason: 'school' }).message !== null);
check('F4 0, negative, empty, text and more than 5000 hours are refused', ['0', '-3', '', 'many', '5001'].every((h) => checkPriorHoursForm({ ...good, hours: h }).message !== null));
check('F5 a comma decimal is understood (12,5 hours) and 5000 is the limit', checkPriorHoursForm({ ...good, hours: '12,5' }).hours === 12.5 && checkPriorHoursForm({ ...good, hours: '5000' }).message === null);

const e = (id: string, hours: number, removedAt: string | null): PriorHoursEntry => ({ id, hours, reason: 'r'.repeat(12), proofReference: 'letter', addedByName: 'Vic Officer', addedAt: '2026-11-19T10:00:00Z', removedAt, removalReason: removedAt ? 'x'.repeat(12) : null });
check('T1 the total is the sum of the entries that are not removed', totalOf([e('a', 300, null), e('b', 50.5, null), e('c', 999, '2026-11-20T00:00:00Z')]) === 350.5 && totalOf([]) === 0);

check('W1 the rule is said plainly: hours count in the HOURS part only, ALL six parts or a credential, and a credential or an assigned level is how to start higher',
  /HOURS part/.test(PRIOR_HOURS_RULE) && /ALL six parts/.test(PRIOR_HOURS_RULE) && /do not raise a level on their own/.test(PRIOR_HOURS_RULE) && /completed practicum starts at 2C/.test(PRIOR_HOURS_RULE) && /assign a level/.test(PRIOR_HOURS_RULE));
const screen = read('admin/src/components/PriorHoursSection.tsx') + read('admin/src/lib/priorHours.ts') + read('admin/src/lib/priorHoursRules.ts');
check('W2 nothing on the screen or in its words worries about commission (CEO, 18 Nov: higher levels are good for Tutorlage)', !/commission/i.test(screen) && !/commission/i.test(PRIOR_HOURS_RULE));
check('W3 the screen is under the Level section and reloads the level when something changes', /<PriorHoursSection tutorId=\{tutorId\} onChanged=\{load\} \/>/.test(read('admin/src/components/TutorLevelCard.tsx')));
check('W4 the screen calls only the three admin functions and never writes the table or a total', /admin_prior_hours_for_tutor/.test(screen) && /admin_add_prior_hours/.test(screen) && /admin_remove_prior_hours/.test(screen) && !/\.from\(/.test(screen) && !/tutor_profiles/.test(screen));
check('W5 the proof reference is required on the form, and an entry cannot be edited (no update call exists)', /Proof reference \(required\)/.test(screen) && !/admin_update_prior_hours|\.update\(/.test(screen));

const tutorPanel = read('src/components/TeachingProfilePanel.tsx');
const goScreen = read('src/components/TeachGoScreen.tsx');
const queries = read('src/lib/queries.ts');
check('S1 the tutor\'s own profile shows "Tutorlage hours" and "+ N outside Tutorlage" separately', /Tutorlage hours/.test(tutorPanel) && /outside Tutorlage/.test(tutorPanel) && /tutor\.totalCompletedHours\}/.test(tutorPanel));
check('S2 the progress step for hours counts Tutorlage plus outside hours and says so', /tutor\.totalCompletedHours \+ tutor\.priorHours >= nextSubTier\.minHours/.test(goScreen) && /Tutorlage and outside/.test(goScreen));
check('S3 the dashboard asks the database for the tutor\'s own total, tolerates a database without it (0), and keeps total_completed_hours as Tutorlage hours', /rpc\('tutor_prior_hours_total'/.test(queries) && /priorHours = 0/.test(queries) && /totalCompletedHours: row\.total_completed_hours \?\? 0/.test(queries));

// the migration against the saved old text of the function
const migration = read('supabase/migrations/20261119010000_tutor_prior_hours.sql');
const rollback = read('Drake/programmer/rollbacks/20261119010000_tutor_prior_hours_ROLLBACK.sql');
const fnStart = (s: string) => s.search(/create or replace function public.fn_recalculate_tutor_tier/i);
const TAG = '$function$';
const take = (s: string) => { const a = fnStart(s); const first = s.indexOf(TAG, a); const second = s.indexOf(TAG, first + TAG.length); return s.slice(a, second + TAG.length + 1); };
const oldText = take(rollback);
const newText = take(migration);
check('M1 the rollback holds the old function text and its md5 is the one read on production on 18 Nov', createHash('md5').update(oldText).digest('hex') === '63cd2be556ebce6c7c095fba001dec67', createHash('md5').update(oldText).digest('hex'));
const oldLines = oldText.split('\n');
const newLines = newText.replace(/^create or replace FUNCTION/i, 'CREATE OR REPLACE FUNCTION').split('\n');
const added = newLines.filter((l) => !oldLines.includes(l));
const removed = oldLines.filter((l) => !newLines.includes(l));
check('M2 the new function is the old text plus the prior-hours lines only: 4 lines added, 1 changed (the min_hours comparison)',
  added.length === 5 && removed.length === 1 && removed[0].trim() === 'where min_hours <= v_completed_hours' && added.some((l) => l.trim() === 'where min_hours <= v_tier_hours') && added.filter((l) => /v_prior|v_tier_hours|tutor_prior_hours/.test(l)).length === 5, `added=${JSON.stringify(added)} removed=${JSON.stringify(removed)}`);
check('M3 total_completed_hours is still set from Tutorlage sessions only', /total_completed_hours = v_completed_hours,/.test(newText) && !/total_completed_hours = v_tier_hours/.test(newText));
check('M4 the table is closed to every API role (RLS on, all rights revoked, no policy) and entries are soft-removed only (no delete or update function)', /enable row level security/.test(migration) && /revoke all on table public\.tutor_prior_hours from public, anon, authenticated, service_role/.test(migration) && !/create policy/.test(migration) && !/delete from public\.tutor_prior_hours/.test(migration));
check('M5 the proof reference is required by the database (5 characters), the reason too (10), and the hours are capped', /char_length\(btrim\(proof_reference\)\) >= 5/.test(migration) && /char_length\(btrim\(reason\)\) >= 10/.test(migration) && /hours <= 5000/.test(migration));
check('M6 only a verification officer or a super admin may record, read or remove (the same roles as recording a credential), and every entry and removal writes one audit event', (migration.match(/admin_role_in\(array\['verification_officer', 'super_admin'\]\)/g) ?? []).length === 3 && (migration.match(/perform public\.log_admin_event\(/g) ?? []).length === 2);
check('M7 the rollback also removes the functions and the table, and is labelled', /drop table if exists public\.tutor_prior_hours/.test(rollback) && /drop function if exists public\.admin_add_prior_hours/.test(rollback));

console.log(failed === 0 ? '\nAll prior-hours checks passed.' : `\n${failed} prior-hours check(s) FAILED.`);
process.exit(failed === 0 ? 0 : 1);
