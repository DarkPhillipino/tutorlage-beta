// Checks for master items 7aa + 7da + 7db, "keep or swap" (the CEO's principle and answers of 14 Oct 2026).
// Run: npx tsx scripts/dev/keep-or-swap-test.ts
// The database side is tested by supabase/tests/keep_or_swap.sql (rolled back). This file checks the pure helpers, the exact
// wording against the migration's real numbers, and that the screens, the switch, the queries and the migration agree.
// To check the checks, point KEEP_OR_SWAP_LIB at a deliberately broken copy of src/lib/keepOrSwap.ts.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const libPath = process.env.KEEP_OR_SWAP_LIB
  ? pathToFileURL(path.resolve(process.env.KEEP_OR_SWAP_LIB)).href
  : new URL('../../src/lib/keepOrSwap.ts', import.meta.url).href;
const lib: typeof import('../../src/lib/keepOrSwap') = await import(libPath);
const {
  KEEP_WINDOW_HOURS,
  AFTER_START_GRACE_MINUTES,
  KEEP_OR_SWAP_COPY,
  mapMyTutorRow,
  addressedRequestEnd,
  hoursLeft,
  waitingLabel,
  endedLabel,
  windowNote,
  defaultBookAgainSchedule,
  isMissingDatabaseFunction,
  describeKeepOrSwapError,
  sortMyTutors,
  canChooseTutor,
} = lib;

let failures = 0;
function check(name: string, ok: boolean, detail = '') {
  if (ok) console.log(`ok   ${name}`);
  else {
    failures++;
    console.log(`FAIL ${name}${detail ? `  (${detail})` : ''}`);
  }
}

const row = (p: Record<string, unknown> = {}) => ({
  tutor_id: 'T1',
  first_name: 'Alpha',
  choice: null,
  can_book_again: true,
  sessions_together: 2,
  last_session_at: '2026-10-10T12:00:00Z',
  last_subject: 'Mathematics',
  last_grade: 'Grade 11',
  last_level_id: '1A',
  last_institution_id: null,
  request_id: null,
  request_status: null,
  request_expires_at: null,
  request_start: null,
  request_can_resend: null,
  ...p,
});

// ---- mapping a row of my_tutors() --------------------------------------------------------------------------------------------------
{
  const t = mapMyTutorRow(row());
  check('a plain row maps to a tutor with no choice and no request', t.tutorId === 'T1' && t.firstName === 'Alpha' && t.choice === null && t.request === null && t.canBookAgain === true && t.sessionsTogether === 2);
  check('the last subject, grade and level come through', t.lastSubject === 'Mathematics' && t.lastGrade === 'Grade 11' && t.lastLevelId === '1A');
  check('a kept tutor is kept and an avoided tutor is avoided', mapMyTutorRow(row({ choice: 'keep' })).choice === 'keep' && mapMyTutorRow(row({ choice: 'avoid' })).choice === 'avoid');
  check('anything else in the choice column is no choice', mapMyTutorRow(row({ choice: 'maybe' })).choice === null);
  check('a missing first name becomes "Your tutor", never an empty word', mapMyTutorRow(row({ first_name: '  ' })).firstName === 'Your tutor' && mapMyTutorRow(row({ first_name: null })).firstName === 'Your tutor');
  const w = mapMyTutorRow(row({ request_id: 'R1', request_status: 'pending', request_expires_at: '2026-10-16T10:00:00Z', request_start: '2026-10-17T10:00:00Z', request_can_resend: true }));
  check('a waiting request carries its status, end and whether it can be sent on', w.request?.id === 'R1' && w.request.status === 'pending' && w.request.expiresAt === '2026-10-16T10:00:00Z' && w.request.canResend === true);
  check('a request that cannot be sent on says so (null is false)', mapMyTutorRow(row({ request_id: 'R2', request_status: 'expired', request_can_resend: null })).request?.canResend === false);
  check('a tutor who cannot be booked again is mapped as such', mapMyTutorRow(row({ can_book_again: false })).canBookAgain === false);
}

// ---- when an addressed request ends: the same rule as the database (least of 48 hours after sending and 30 minutes after the start) ----
{
  const sent = new Date('2026-10-14T12:00:00Z');
  const farOff = new Date('2026-10-20T12:00:00Z');
  const soon = new Date('2026-10-14T14:00:00Z'); // in 2 hours
  check('the window is 48 hours and the grace is 30 minutes', KEEP_WINDOW_HOURS === 48 && AFTER_START_GRACE_MINUTES === 30);
  check('a session far away: it ends 48 hours after sending', addressedRequestEnd(sent, farOff).toISOString() === '2026-10-16T12:00:00.000Z');
  check('a session in 2 hours: it ends 30 minutes after the start, not 48 hours after sending', addressedRequestEnd(sent, soon).toISOString() === '2026-10-14T14:30:00.000Z');
  check('an instant request (start = now): 30 minutes', addressedRequestEnd(sent, sent).toISOString() === '2026-10-14T12:30:00.000Z');
  check('never later than 48 hours, whatever the start', addressedRequestEnd(sent, new Date('2027-01-01T00:00:00Z')).getTime() - sent.getTime() === 48 * 3600_000);
}

// ---- what the learner is told while waiting, and after ----------------------------------------------------------------------------------
{
  const now = new Date('2026-10-14T12:00:00Z');
  const pending = (hoursAhead: number | null) => ({ id: 'R', status: 'pending', expiresAt: hoursAhead === null ? null : new Date(now.getTime() + hoursAhead * 3600_000).toISOString(), requestedStart: null, canResend: true });
  check('just sent: "Waiting for Alpha, up to 48 hours"', waitingLabel(pending(48), 'Alpha', now) === 'Waiting for Alpha, up to 48 hours');
  check('a little after sending still reads "up to 48 hours" (a few minutes of drift)', waitingLabel(pending(47.7), 'Alpha', now) === 'Waiting for Alpha, up to 48 hours');
  check('later: hours left', waitingLabel(pending(30), 'Alpha', now) === 'Waiting for Alpha, about 30 hours left');
  check('close to the end: minutes left', waitingLabel(pending(0.5), 'Alpha', now) === 'Waiting for Alpha, about 30 minutes left');
  check('one minute left is singular', waitingLabel(pending(1 / 60), 'Alpha', now) === 'Waiting for Alpha, about 1 minute left');
  check('past the end but not yet cleared by the job: "ending now"', waitingLabel(pending(-0.1), 'Alpha', now) === 'Waiting for Alpha (ending now)');
  check('no end time (should not happen): still says who it waits for', waitingLabel(pending(null), 'Alpha', now) === 'Waiting for Alpha');
  check('a request that is not waiting has no waiting line', waitingLabel({ id: 'R', status: 'expired', expiresAt: null, requestedStart: null, canResend: true }, 'Alpha', now) === null && waitingLabel(null, 'Alpha', now) === null);
  check('hoursLeft is null without an end and negative after it', hoursLeft(null, now) === null && (hoursLeft('2026-10-14T11:00:00Z', now) ?? 0) < 0);
  const ended = (status: string) => ({ id: 'R', status, expiresAt: null, requestedStart: null, canResend: true });
  check('expired: says nobody was charged', /did not accept in time/.test(endedLabel(ended('expired'), 'Alpha') ?? '') && /not charged/.test(endedLabel(ended('expired'), 'Alpha') ?? ''));
  check('declined: says nobody was charged', /could not take this one/.test(endedLabel(ended('declined'), 'Alpha') ?? '') && /not charged/.test(endedLabel(ended('declined'), 'Alpha') ?? ''));
  check('a cancelled or accepted request has no "ended" line', endedLabel(ended('cancelled'), 'Alpha') === null && endedLabel(ended('accepted'), 'Alpha') === null && endedLabel(null, 'Alpha') === null);
}

// ---- the request page's words ----------------------------------------------------------------------------------------------------------
{
  const scheduled = windowNote('Alpha', 'scheduled');
  const asap = windowNote('Alpha', 'now');
  check('a scheduled booking promises 48 hours and no charge if not accepted', /48 hours/.test(scheduled) && /not charged/.test(scheduled) && /one tap/.test(scheduled));
  check('"as soon as possible" is honest that it gives only about 30 minutes', /about 30 minutes/.test(asap) && !/up to 48 hours to accept, and never/.test(asap));
  check('both name the tutor', /Alpha/.test(scheduled) && /Alpha/.test(asap));
  const d = defaultBookAgainSchedule(new Date(2026, 9, 14, 20, 11)); // local time: 14 Oct 2026, 20:11
  check('the default time for booking again is tomorrow at 15:00', d.date === '2026-10-15' && d.time === '15:00', `${d.date} ${d.time}`);
  const eom = defaultBookAgainSchedule(new Date(2026, 9, 31, 10, 0));
  check('across a month end it is 1 November', eom.date === '2026-11-01', eom.date);
}

// ---- the wording must not promise what the code does not do ----------------------------------------------------------------------------------
{
  const all = JSON.stringify(Object.values(KEEP_OR_SWAP_COPY).map((v) => (typeof v === 'function' ? (v as (n: string) => string)('Alpha') : v)));
  check('the intro says trying someone else is private (the tutor is not told)', /not told/.test(KEEP_OR_SWAP_COPY.intro));
  check('rating is separate from trying someone else', /not a bad rating/.test(KEEP_OR_SWAP_COPY.ratingNote));
  check('the tutor is told their decline is private and neutral', /neutral/.test(KEEP_OR_SWAP_COPY.tutorIntro) && /neutrally/.test(KEEP_OR_SWAP_COPY.tutorEndConfirm('Pat')));
  check('nothing promises e-mail, SMS or WhatsApp (the bell is the only channel)', !/e-?mail|sms|whatsapp/i.test(all));
  check('nothing says a tutor is "blocked", "banned" or "penalised"', !/blocked|banned|penalis|penaliz/i.test(all));
}

// ---- errors -----------------------------------------------------------------------------------------------------------------------------------
{
  check('a missing function (PostgREST) is recognised', isMissingDatabaseFunction({ code: 'PGRST202', message: 'Could not find the function public.my_tutors' }));
  check('a missing function (Postgres 42883) is recognised', isMissingDatabaseFunction({ code: '42883', message: 'function public.my_tutors(uuid) does not exist' }));
  check('...by its code alone (PGRST202, 42883)', isMissingDatabaseFunction({ code: 'PGRST202' }) && isMissingDatabaseFunction({ code: '42883' }));
  check('...and by its message alone', isMissingDatabaseFunction({ message: 'Could not find the function public.my_tutors(p_learner) in the schema cache' }) && isMissingDatabaseFunction({ message: 'function public.my_tutors(uuid) does not exist' }));
  check('an ordinary refusal is not a missing function', !isMissingDatabaseFunction({ code: 'P0001', message: 'That request is no longer available.' }) && !isMissingDatabaseFunction(null));
  check('a plain database sentence is shown as it is', describeKeepOrSwapError({ code: 'P0001', message: 'You already have 3 requests waiting for this tutor.' }) === 'You already have 3 requests waiting for this tutor.');
  check('a missing function says "not switched on yet", with no database text', /not switched on yet/.test(describeKeepOrSwapError({ code: 'PGRST202', message: 'Could not find the function public.my_tutors in the schema cache' })) && !/PGRST|schema cache/.test(describeKeepOrSwapError({ code: 'PGRST202', message: 'Could not find the function public.my_tutors in the schema cache' })));
  check('raw database text never reaches a person', describeKeepOrSwapError({ code: 'XX000', message: 'relation "learner_tutor_choices" does not exist' }) === 'Something went wrong. Please try again.' && describeKeepOrSwapError({ code: '42501', message: 'permission denied for table learner_tutor_choices' }) === 'Something went wrong. Please try again.' && describeKeepOrSwapError(null) === 'Something went wrong. Please try again.');
}

// ---- the order of the list, and who may choose ---------------------------------------------------------------------------------------------
{
  const mk = (id: string, p: Record<string, unknown>) => mapMyTutorRow(row({ tutor_id: id, ...p }));
  const sorted = sortMyTutors([
    mk('avoid', { choice: 'avoid', last_session_at: '2026-10-13T00:00:00Z' }),
    mk('plain-old', { last_session_at: '2026-09-01T00:00:00Z' }),
    mk('keep', { choice: 'keep', last_session_at: '2026-09-10T00:00:00Z' }),
    mk('waiting', { request_id: 'R', request_status: 'pending', last_session_at: '2026-08-01T00:00:00Z' }),
    mk('plain-new', { last_session_at: '2026-10-01T00:00:00Z' }),
  ]).map((t) => t.tutorId);
  check('waiting first, then kept, then undecided (newest first), then those tried-someone-else-instead-of', sorted.join(',') === 'waiting,keep,plain-new,plain-old,avoid', sorted.join(','));
  check('a learner under 18 with their own sign-in is not offered the buttons; others are', canChooseTutor({ isViewOnlyLearner: true }) === false && canChooseTutor({ isViewOnlyLearner: false }) === true);
}

// ---- the admin counts --------------------------------------------------------------------------------------------------------------------------------
{
  const { countKeepOrSwap } = await import('../../admin/src/lib/keepOrSwapCounts.ts');
  const names = new Map([['T1', 'Alpha Tutor'], ['T2', 'Bravo Tutor']]);
  const c = countKeepOrSwap(
    [
      { tutor_id: 'T1', choice: 'keep' },
      { tutor_id: 'T1', choice: 'keep' },
      { tutor_id: 'T1', choice: 'avoid' },
      { tutor_id: 'T2', choice: 'avoid' },
      { tutor_id: 'T2', choice: 'avoid' },
      { tutor_id: 'T3', choice: 'keep' },
      { tutor_id: 'T3', choice: 'something else' },
    ],
    [{ tutor_id: 'T2' }, { tutor_id: 'T3' }],
    names,
  );
  check('totals: 3 kept, 3 tried someone else, 2 ended', c.kept === 3 && c.avoided === 3 && c.ended === 2, `${c.kept}/${c.avoided}/${c.ended}`);
  check('an unknown choice value is ignored, not counted', c.kept + c.avoided === 6);
  check('most "tried someone else" first', c.lines[0].name === 'Bravo Tutor' && c.lines[0].avoided === 2 && c.lines[0].ended === 1);
  check('a tutor with no readable name is shown as a short id, never blank', c.lines.some((l) => l.tutorId === 'T3' && l.name === 'Tutor T3'));
  check('one line per tutor', c.lines.length === 3);
  const empty = countKeepOrSwap([], [], new Map());
  check('nothing yet: zero everything', empty.kept === 0 && empty.avoided === 0 && empty.ended === 0 && empty.lines.length === 0);
}

// ---- wiring, read from the source ---------------------------------------------------------------------------------------------------------------
{
  // KEEP_OR_SWAP_ROOT points at a copy of the project (with some files deliberately broken) when checking the checks.
  const root = process.env.KEEP_OR_SWAP_ROOT
    ? pathToFileURL(path.resolve(process.env.KEEP_OR_SWAP_ROOT) + path.sep)
    : new URL('../../', import.meta.url);
  const read = (p: string) => fs.readFileSync(new URL(p, root), 'utf8');
  const features = read('src/lib/features.ts');
  const queries = read('src/lib/queries.ts');
  const types = read('src/types.ts');
  const app = read('src/App.tsx');
  const prices = read('src/components/PricesPage.tsx');
  const sessionsPanel = read('src/components/UpcomingSessionsPanel.tsx');
  const tutorSessions = read('src/components/TutorSessionsPanel.tsx');
  const queue = read('src/components/AvailableRequestsQueue.tsx');
  const myTutors = read('src/components/MyTutorsPanel.tsx');
  const choice = read('src/components/KeepOrSwapChoice.tsx');
  const taught = read('src/components/LearnersITaughtPanel.tsx');
  const migration = read('supabase/migrations/20261014200000_keep_or_swap.sql');
  const adminQueries = read('admin/src/lib/queries.ts');
  const adminPage = read('admin/src/pages/Phase1Numbers.tsx');

  // The admin app works before the migration
  check('the admin read returns null on any error, so the page works before the migration', /fetchKeepOrSwapCounts[\s\S]{0,700}if \(choices\.error \|\| ended\.error\) return null/.test(adminQueries));
  check('the admin page hides the section when there is nothing to show', /\{keepOrSwap && \(/.test(adminPage) && /fetchKeepOrSwapCounts\(\)\s*\n?\s*\.then\(setKeepOrSwap\)\s*\n?\s*\.catch\(\(\) => setKeepOrSwap\(null\)\)/.test(adminPage));
  check('the admin page says it is private and penalises no one', /a tutor never sees\s+these numbers/.test(adminPage) && /nothing here penalises anyone automatically/.test(adminPage));

  // The switch
  check('the switch is ON (the CEO switched all seven built features on, 16 Oct 2026)', /keepOrSwap:\s*true\b/.test(features));
  check('My tutors and the choice on a completed session are shown only with the switch', /FEATURES\.keepOrSwap\s*&&\s*onBookAgain/.test(sessionsPanel) && (sessionsPanel.match(/FEATURES\.keepOrSwap\s*&&\s*<KeepOrSwapChoice/g) ?? []).length === 2);
  check('the tutor\'s "Learners you have taught" is shown only with the switch', /FEATURES\.keepOrSwap\s*&&\s*<LearnersITaughtPanel/.test(tutorSessions));
  check('"Book again" reaches the request page only with the switch', /onBookAgain=\{FEATURES\.keepOrSwap \? handleBookAgain : undefined\}/.test(app) && /bookAgain=\{FEATURES\.keepOrSwap \? bookAgain : null\}/.test(app));

  // The queries use the migration's names
  const rpcWith = (name: string, params: string[]) => new RegExp(`rpc\\('${name}',\\s*\\{[^}]*${params.map((p) => `${p}:`).join('[^}]*')}`).test(queries);
  const defined = (name: string, args: string) => new RegExp(`function public\\.${name}\\(${args}\\)`).test(migration);
  check('set_tutor_choice: the app and the migration agree on the parameters', rpcWith('set_tutor_choice', ['p_learner', 'p_tutor', 'p_choice']) && defined('set_tutor_choice', 'p_learner uuid, p_tutor uuid, p_choice text'));
  check('clear_tutor_choice: the app and the migration agree', rpcWith('clear_tutor_choice', ['p_learner', 'p_tutor']) && defined('clear_tutor_choice', 'p_learner uuid, p_tutor uuid'));
  check('resend_request_to_anyone: the app and the migration agree', rpcWith('resend_request_to_anyone', ['p_request_id']) && defined('resend_request_to_anyone', 'p_request_id uuid'));
  check('decline_session_request: the app and the migration agree', rpcWith('decline_session_request', ['p_request_id']) && defined('decline_session_request', 'p_request_id uuid'));
  check('end_tutor_pairing and resume_tutor_pairing: the app and the migration agree', rpcWith('end_tutor_pairing', ['p_learner']) && rpcWith('resume_tutor_pairing', ['p_learner']) && defined('end_tutor_pairing', 'p_learner uuid') && defined('resume_tutor_pairing', 'p_learner uuid'));
  check('my_tutors: the app and the migration agree', rpcWith('my_tutors', ['p_learner']) && defined('my_tutors', 'p_learner uuid'));
  check('available_requests_for_tutor takes no arguments in both', /rpc\('available_requests_for_tutor'\)/.test(queries) && /function public\.available_requests_for_tutor\(\)/.test(migration));
  // Every column the app reads from my_tutors is one the function returns
  const mapSrc = read('src/lib/keepOrSwap.ts');
  const wanted = [...mapSrc.matchAll(/row\.([a-z_]+)/g)].map((m) => m[1]);
  const returnsBlock = migration.slice(migration.indexOf('create or replace function public.my_tutors'), migration.indexOf('language plpgsql', migration.indexOf('create or replace function public.my_tutors')));
  check('every column the app reads from my_tutors() is returned by the function', wanted.length >= 14 && wanted.every((c) => new RegExp(`\\b${c}\\b`).test(returnsBlock)), wanted.filter((c) => !new RegExp(`\\b${c}\\b`).test(returnsBlock)).join(','));

  // Before the migration is applied
  check('the tutor\'s list tries the new function first, then falls back to the old read only when the function is missing', /rpc\('available_requests_for_tutor'\)[\s\S]{0,1800}if \(!isMissingDatabaseFunction\(inbox\.error\)\) throw inbox\.error;\s*return fetchAvailableRequestsFromTable\(tutorId\)/.test(queries));
  check('My tutors is an empty list, not an error, before the migration', /fetchMyTutors[\s\S]{0,300}if \(isMissingDatabaseFunction\(error\)\) return \[\]/.test(queries));
  check('an ordinary request does not send the new column (so it works before the migration)', /\.\.\.\(requestedTutorId \? \{ requested_tutor_id: requestedTutorId \} : \{\}\)/.test(queries));
  check('the request page sends the tutor only when a "book again" is active', /requestedTutorId:\s*bookAgain\?\.tutorId\s*\?\?\s*null/.test(prices));

  // Privacy (7db): what reaches a tutor's browser
  check('the tutor\'s request type no longer carries the learner\'s id', !/studentId/.test(types.slice(types.indexOf('export interface AvailableSessionRequest'), types.indexOf('export interface PayoutAccount'))));
  const inboxRow = queries.slice(queries.indexOf('interface TutorInboxRow'), queries.indexOf('// Since keep-or-swap (master 7db'));
  check('the new function\'s row (in the app) holds no learner id, payer id, Paystack reference or card record', !/student_id|requested_by|paystack|card/i.test(inboxRow));
  const fnBlock = migration.slice(migration.indexOf('create or replace function public.available_requests_for_tutor'), migration.indexOf('language plpgsql', migration.indexOf('create or replace function public.available_requests_for_tutor')));
  check('the migration\'s tutor function returns none of those either', !/student_id|requested_by|paystack|card/i.test(fnBlock));
  check('the migration drops the open policy that let any signed-in account read waiting requests', /drop policy if exists "Tutors view unclaimed pending requests" on public\.session_requests;/.test(migration));

  // The screens
  check('declining asks first, then tells the learner and charges no one', /confirmDeclineId/.test(queue) && /declineSessionRequest\(request\.id\)/.test(queue) && /was not charged/.test(queue));
  check('an ordinary request still has the old local "Not for me" (no database write)', /setDismissedIds\(\(prev\) => new Set\(prev\)\.add\(r\.id\)\)/.test(queue));
  check('requests sent to this tutor come first in their list', /Number\(b\.sentToYou\) - Number\(a\.sentToYou\)/.test(queue));
  check('the one-tap button is offered for a waiting request and for one that can be sent on', /requestId && \(pending \|\| t\.request\?\.canResend\)/.test(myTutors));
  check('"Book again" is not offered while a request is already waiting, or for a tutor tried-someone-else-instead-of', /!pending && t\.canBookAgain && t\.choice !== 'avoid'/.test(myTutors));
  check('the choice buttons are hidden from a learner under 18 with their own sign-in', /isViewOnlyLearner \|\| choice === undefined\) return null/.test(choice));
  check('a tutor ending a pairing is asked to confirm, and can undo it', /confirmId === l\.learnerId/.test(taught) && /resumeTutorPairing\(l\.learnerId\)/.test(taught));
  check('the request page does not show "no tutor can take this" for a tutor the learner already has', /tutorCount === 0 && !addressed/.test(prices) && /isLoading && !addressed/.test(prices) && /loadError && !addressed/.test(prices));
  check('leaving the request page or the nav clears a pending "book again"', /setBookAgain\(null\)/.test(app) && (app.match(/setBookAgain\(null\)/g) ?? []).length >= 3);

  // The migration's promises, with the numbers the screens quote
  check('the migration ends a request at the earlier of 48 hours after sending and 30 minutes after the start', /least\(now\(\) \+ interval '48 hours', new\.requested_start \+ interval '30 minutes'\)/.test(migration));
  check('the tutor is reminded once, after 24 hours', /interval '24 hours'/.test(migration) && /reminder_sent_at is null/.test(migration));
  check('at most 3 requests may wait for the same tutor from the same learner', />= 3/.test(migration) && /You already have 3 requests waiting for this tutor/.test(migration));
  check('a request can be sent on to anyone only once (unique index)', /create unique index if not exists session_requests_resent_once/.test(migration));
  check('clients can only read the two new tables (all rights revoked, then select only)', /revoke all on public\.learner_tutor_choices from anon, authenticated;[\s\S]*revoke all on public\.tutor_ended_pairings from anon, authenticated;[\s\S]*grant select on public\.learner_tutor_choices to authenticated;[\s\S]*grant select on public\.tutor_ended_pairings to authenticated;/.test(migration) && !/grant (insert|update|delete)[^;]*(learner_tutor_choices|tutor_ended_pairings)/i.test(migration));
  check('no policy lets a tutor read learner choices, and none lets a learner read ended pairings', !/on public\.learner_tutor_choices[\s\S]{0,120}tutor_id = auth\.uid\(\)/.test(migration.replace(/--.*$/gm, '')) && !/on public\.tutor_ended_pairings[\s\S]{0,120}learner_id = auth\.uid\(\)/.test(migration.replace(/--.*$/gm, '')));
  check('the internal rule (pairing_blocked) and the notifier cannot be called by clients', /revoke all on function public\.pairing_blocked\(uuid, uuid\) from public, anon, authenticated;/.test(migration) && /revoke all on function public\.notify_tutor_of_addressed_request\(\) from public, anon, authenticated;/.test(migration));
  check('every new function is security definer with a fixed search path', (migration.match(/security definer\s*\n\s*set search_path (=|to) '?public'?/g) ?? []).length >= 12, String((migration.match(/security definer\s*\n\s*set search_path (=|to) '?public'?/g) ?? []).length));
  check('the claim step refuses with the same sentence whatever the reason (addressed to another, ended, parted)', (migration.match(/Another tutor already accepted this request, or it is no longer available\./g) ?? []).length >= 4);
  check('the checking function tells a stranger nothing about other people\'s learners and tutors', /auth\.uid\(\) is distinct from p_requested_by[\s\S]{0,200}can_book_for\(p_student\)/.test(migration));
  check('it replaces exactly the three functions and the one policy it says it replaces', ['guard_session_request_insert', 'claim_session_request', 'expire_stale_paid_requests'].every((f) => new RegExp(`create or replace function public\\.${f}\\(`).test(migration)) && (migration.match(/drop policy if exists "Tutors view unclaimed pending requests"/g) ?? []).length === 1);
  check('it does not touch the card check, refunds or the price ladder', !/create or replace function public\.(record_card_verification|poll_queued_refunds|finalize_session_charge|release_session_charge|cancel_session|apply_refund_webhook|request_commission_pct)/.test(migration) && !/alter table public\.(sub_tier_definitions|tier_definitions|payment_cards)/.test(migration));
}

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
