// Checks for master item 7cz, "Tell me when a tutor is available" (the CEO agreed on 14 Oct 2026).
// Run: npx tsx scripts/dev/waitlist-test.ts
// The database side is tested by supabase/tests/tutor_waitlist.sql (rolled back). This file checks the pure helpers,
// the admin grouping, and that the screen, the switch, the queries and the migration agree with each other.
import fs from 'node:fs';
import { WAITLIST_COPY, describeWaitlistError, findOpenEntry, normalise, type WaitlistEntry } from '../../src/lib/waitlist';
import { groupWaitlistDemand } from '../../admin/src/lib/waitlistDemand';

let failures = 0;
function check(name: string, ok: boolean, detail = '') {
  if (ok) console.log(`ok   ${name}`);
  else {
    failures++;
    console.log(`FAIL ${name}${detail ? `  (${detail})` : ''}`);
  }
}

// ---- matching an existing entry ---------------------------------------------------------------------------------------------
const entry = (p: Partial<WaitlistEntry> & { id: string }): WaitlistEntry => ({
  studentId: 'L1',
  subject: 'Astronomy',
  gradeLevel: 'Grade 11',
  institutionId: null,
  createdAt: '2026-10-14T10:00:00Z',
  ...p,
});
const search = { studentId: 'L1', subject: 'Astronomy', gradeLevel: 'Grade 11', institutionId: null as string | null };

check('normalise ignores case and spaces', normalise('  Grade 11 ') === 'grade 11' && normalise(null) === '' && normalise(undefined) === '');
check('an exact entry is found', findOpenEntry([entry({ id: 'a' })], search)?.id === 'a');
check('case and spaces do not matter', findOpenEntry([entry({ id: 'a', subject: ' astronomy ', gradeLevel: 'GRADE 11' })], search)?.id === 'a');
check('a different learner is not a match', findOpenEntry([entry({ id: 'a', studentId: 'L2' })], search) === null);
check('a different subject is not a match', findOpenEntry([entry({ id: 'a', subject: 'Chess' })], search) === null);
check('a different grade is not a match', findOpenEntry([entry({ id: 'a', gradeLevel: 'Grade 10' })], search) === null);
check('a different school is not a match', findOpenEntry([entry({ id: 'a', institutionId: 'S1' })], search) === null);
check('no grade on either side matches', findOpenEntry([entry({ id: 'a', gradeLevel: null })], { ...search, gradeLevel: null })?.id === 'a');
check('a grade on one side only is not a match', findOpenEntry([entry({ id: 'a', gradeLevel: null })], search) === null);
check('the right one is picked from several', findOpenEntry([entry({ id: 'a', subject: 'Chess' }), entry({ id: 'b' })], search)?.id === 'b');
check('nothing to find in an empty list', findOpenEntry([], search) === null);

// ---- the words for what the database refuses --------------------------------------------------------------------------------
check('55000 (a tutor is already available) says to search again', /search again/i.test(describeWaitlistError({ code: '55000' })));
check('54000 (10 open entries) says remove one', /remove one/i.test(describeWaitlistError({ code: '54000' })));
check('42501 (not your learner) explains who you can ask for', /yourself or for a learner you look after/.test(describeWaitlistError({ code: '42501' })));
check('22023 asks for a subject', /subject/i.test(describeWaitlistError({ code: '22023' })));
check('anything else is a plain, safe message (no raw database text)', describeWaitlistError({ code: 'XX000', message: 'relation "tutor_waitlist" does not exist' }) === 'Something went wrong. Please try again.' && describeWaitlistError(null) === 'Something went wrong. Please try again.');

// ---- what the page promises must be true ---------------------------------------------------------------------------------------
const promise = `${WAITLIST_COPY.joinedBody} ${WAITLIST_COPY.keptFor}`;
check('the page promises the bell only (no email, SMS, WhatsApp or phone)', /bell/i.test(promise) && !/e-?mail|sms|whatsapp|phone|call you/i.test(promise.replace(/We don't contact you anywhere else\./, '')));
check('it says we do not contact them anywhere else', /don't contact you anywhere else/.test(WAITLIST_COPY.joinedBody));
check('it says how long the request is kept (60 days), as the migration does', /60 days/.test(WAITLIST_COPY.keptFor));

// ---- the admin grouping ---------------------------------------------------------------------------------------------------
{
  const d = groupWaitlistDemand([
    { subject: 'Astronomy', grade_level: 'Grade 11', notified_at: null },
    { subject: ' astronomy ', grade_level: 'grade 11', notified_at: null },
    { subject: 'Astronomy', grade_level: 'Grade 11', notified_at: '2026-10-10T00:00:00Z' },
    { subject: 'Chess', grade_level: null, notified_at: null },
    { subject: 'Latin', grade_level: 'Grade 9', notified_at: '2026-10-01T00:00:00Z' },
  ]);
  check('totals: 3 waiting, 2 told', d.waiting === 3 && d.told === 2, `${d.waiting}/${d.told}`);
  check('case and spaces are grouped together', d.lines.length === 3);
  const astro = d.lines.find((l) => l.subject.toLowerCase() === 'astronomy');
  check('Astronomy Grade 11: 2 waiting, 1 told', astro?.waiting === 2 && astro?.told === 1);
  check('no grade shows as "Any grade"', d.lines.some((l) => l.subject === 'Chess' && l.gradeLevel === 'Any grade'));
  check('most waiting first', d.lines[0].subject.toLowerCase() === 'astronomy' && d.lines[0].waiting === 2);
  const empty = groupWaitlistDemand([]);
  check('empty list: zero everything', empty.waiting === 0 && empty.told === 0 && empty.lines.length === 0);
}

// ---- wiring and promises, read from the source -----------------------------------------------------------------------------------
{
  const root = new URL('../../', import.meta.url);
  const read = (p: string) => fs.readFileSync(new URL(p, root), 'utf8');
  const features = read('src/lib/features.ts');
  const level = read('src/components/LevelSelectionPage.tsx');
  const app = read('src/App.tsx');
  const queries = read('src/lib/queries.ts');
  const prompt = read('src/components/WaitlistPrompt.tsx');
  const adminQueries = read('admin/src/lib/queries.ts');
  const adminPage = read('admin/src/pages/Phase1Numbers.tsx');
  const migration = read('supabase/migrations/20261014090000_tutor_waitlist.sql');

  check('the switch is OFF unless VITE_TUTOR_WAITLIST=1 is set', /tutorWaitlist:\s*import\.meta\.env\?\.VITE_TUTOR_WAITLIST\s*===\s*'1'/.test(features));
  check('the dead-end screen shows the prompt only with the switch, a learner and a subject', /FEATURES\.tutorWaitlist\s*&&\s*waitlistLearnerId\s*&&\s*formState\.subject\.trim\(\)\s*!==\s*''/.test(level));
  check('a view-only learner, or a parent with no learner chosen, gets no prompt', /waitlistLearnerId=\{isViewOnlyLearner\s*\?\s*null\s*:\s*isGuardian\s*\?\s*\(bookingFor\?\.id\s*\?\?\s*null\)/.test(app));
  check('the queries call the two database functions with the migration\'s parameter names',
    /rpc\('join_tutor_waitlist',\s*\{\s*p_student:[^}]*p_subject:[^}]*p_grade:[^}]*p_institution:/.test(queries) &&
      /rpc\('leave_tutor_waitlist',\s*\{\s*p_id:/.test(queries));
  check('the migration defines those functions with those parameter names',
    /function public\.join_tutor_waitlist\(\s*p_student uuid,\s*p_subject text,\s*p_grade text default null,\s*p_institution uuid default null\s*\)/.test(migration) &&
      /function public\.leave_tutor_waitlist\(p_id uuid\)/.test(migration));
  check('the app only ever reads the table directly (no insert, update, delete or upsert on it)', !/from\('tutor_waitlist'\)\s*\.\s*(insert|update|delete|upsert)/.test(queries) && !/from\('tutor_waitlist'\)\s*\n?\s*\.\s*(insert|update|delete|upsert)/.test(queries));
  check('the prompt tells people nothing it does not do (uses only the bell wording from waitlist.ts)', /WAITLIST_COPY/.test(prompt) && !/e-?mail|sms|whatsapp/i.test(prompt.replace(/\/\/.*$/gm, '')));
  check('a failure to look does not hide the button (joining again returns the same entry)', /Not being able to look is not a reason to hide the button/.test(prompt));

  check('the admin read returns null on any error, so the page works before the migration', /fetchWaitlistDemand[\s\S]{0,400}if \(error\) return null/.test(adminQueries));
  check('the admin page hides the section when there is no table', /\{demand && \(/.test(adminPage) && /fetchWaitlistDemand\(\)\s*\n?\s*\.then\(setDemand\)\s*\n?\s*\.catch\(\(\) => setDemand\(null\)\)/.test(adminPage));

  // The migration's promises
  const tableDef = migration.slice(migration.indexOf('create table if not exists public.tutor_waitlist'), migration.indexOf(');', migration.indexOf('create table if not exists public.tutor_waitlist')));
  check('the table stores no contact details (no phone, email or address column)', !/phone|e-?mail|address|whatsapp/i.test(tableDef));
  check('clients can only read the table (all rights revoked, then select only)', /revoke all on public\.tutor_waitlist from anon, authenticated;\s*grant select on public\.tutor_waitlist to authenticated;/.test(migration) && !/grant (insert|update|delete)[^;]*tutor_waitlist/i.test(migration));
  check('every function is security definer with a fixed search path', (migration.match(/security definer\s*\n\s*set search_path = public/g) ?? []).length === 4);
  check('the notifier and the purge cannot be called by clients', /revoke all on function public\.notify_tutor_waitlist\(\) from public, anon, authenticated;/.test(migration) && /revoke all on function public\.purge_old_tutor_waitlist\(\) from public, anon, authenticated;/.test(migration));
  check('joining is refused when a tutor is already available (the same rule the app uses)', /available_price_levels\(v_subject, v_grade, p_institution\)/.test(migration) && /errcode = '55000'/.test(migration));
  check('telling someone uses the same rule (available_price_levels), not a second copy of it', /available_price_levels\(r\.subject, r\.grade_level, r\.institution_id\)/.test(migration));
  check('the limits are in the migration: 10 open entries, 60 days to be told, 90 days to purge', /v_open >= 10/.test(migration) && /interval '60 days'/.test(migration) && /interval '90 days'/.test(migration));
  check('it adds triggers only (no existing function or trigger is replaced)', !/create or replace function public\.(handle_new_user|guard_tutor_profiles|enforce_tutor_age_on_verify|available_price_levels|can_book_for)/.test(migration));
  check('two triggers: a tutor approved, and a subject verified', /after update of is_verified on public\.tutor_profiles/.test(migration) && /after insert or update of verification_status on public\.tutor_subject_competencies/.test(migration));
}

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
