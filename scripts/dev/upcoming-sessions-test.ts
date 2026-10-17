// Checks on "upcoming sessions" (CEO, 17 Oct 2026): a tutor is told when a session is booked, the "You have N upcoming sessions" line
// counts a session that has just started and a tutor's own sessions, a tutor sees their upcoming sessions with "Start video call"
// on the Teach screen, and the notice and the line appear within seconds. Run: npx tsx scripts/dev/upcoming-sessions-test.ts
import fs from 'node:fs';
import { describeWhen, isUpcomingSession, roomOpensAt, sessionHasEnded, upcomingLookbackIso, UPCOMING_LOOKBACK_HOURS } from '../../src/lib/sessionTiming';
import { notificationTarget } from '../../src/lib/notificationTarget';

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
};
const root = new URL('../../', import.meta.url);
const read = (p: string) => fs.readFileSync(new URL(p, root), 'utf8');

// ---- what counts as upcoming ------------------------------------------------------------------------------------------------------
const now = new Date(2026, 9, 17, 22, 37, 44).getTime(); // 17 Oct 2026, 22:37:44 local time
const at = (offsetMinutes: number) => new Date(now + offsetMinutes * 60_000).toISOString();
const sess = (status: string, startOffsetMin: number, hours = 1) => ({ status, scheduledStart: at(startOffsetMin), durationHours: hours });

check('a session in the future is upcoming', isUpcomingSession(sess('scheduled', 90), now));
check('a session that started 48 seconds ago (an "as soon as possible" one, booked a moment after it was asked for) is upcoming: this is the case that read "no upcoming sessions"', isUpcomingSession({ status: 'scheduled', scheduledStart: new Date(now - 48_000).toISOString(), durationHours: 1 }, now));
check('a session that started 59 minutes ago, one hour long, is still upcoming (under way)', isUpcomingSession(sess('scheduled', -59), now));
check('a session that ended a minute ago is not', !isUpcomingSession(sess('scheduled', -61), now) && sessionHasEnded(at(-61), 1, now));
check('a session that ends exactly now is over', sessionHasEnded(at(-60), 1, now));
check('a half-hour or two-hour session uses its own length', isUpcomingSession(sess('scheduled', -100, 2), now) && !isUpcomingSession(sess('scheduled', -40, 0.5), now));
check('a cancelled or completed session is never upcoming, however soon it is', !isUpcomingSession(sess('cancelled_by_student', 30), now) && !isUpcomingSession(sess('cancelled_by_tutor', 30), now) && !isUpcomingSession(sess('completed', -10), now));
check('a date nobody can read is treated as over, not upcoming', !isUpcomingSession({ status: 'scheduled', scheduledStart: 'nonsense', durationHours: 1 }, now));
check('reads only need sessions that started in the last day', UPCOMING_LOOKBACK_HOURS === 24 && upcomingLookbackIso(now) === new Date(now - 24 * 3_600_000).toISOString());

// ---- the words --------------------------------------------------------------------------------------------------------------------
const local = (y: number, m: number, d: number, h: number, min: number) => new Date(y, m, d, h, min).toISOString();
const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
check('"Today, 22:36" for a session today', describeWhen(local(2026, 9, 17, 22, 36), now) === `Today, ${time(local(2026, 9, 17, 22, 36))}`);
check('"Tomorrow, ..." for the next day, even just after midnight', describeWhen(local(2026, 9, 18, 0, 5), now) === `Tomorrow, ${time(local(2026, 9, 18, 0, 5))}`);
check('a later day gets its weekday and date', /Tue/.test(describeWhen(local(2026, 9, 20, 14, 0), now)) && /20/.test(describeWhen(local(2026, 9, 20, 14, 0), now)) && /Oct/.test(describeWhen(local(2026, 9, 20, 14, 0), now)));
check('an unreadable date gives nothing rather than "Invalid Date"', describeWhen('nonsense', now) === '');
check('the video call opens 15 minutes before the start', roomOpensAt(at(60)) === new Date(now + 45 * 60_000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));

// ---- notices go where the tutor can act --------------------------------------------------------------------------------------------
check('tapping "You have an upcoming session" opens the Teach screen (where the tutor starts the call); the learner\'s notices still open Sessions', notificationTarget('session_booked') === 'teach' && notificationTarget('request_accepted') === 'sessions' && notificationTarget('request_for_you') === 'teach' && notificationTarget('terms_updated') === 'terms');

// ---- the database sends the tutor's notice -------------------------------------------------------------------------------------------
const migration = read('supabase/migrations/20261017224500_tutor_session_booked_notice.sql');
check('one trigger, after a session is inserted, for each row, replacing nothing that exists', /create trigger trg_notify_tutor_session_booked\s+after insert on public\.sessions\s+for each row execute function public\.notify_tutor_session_booked\(\)/.test(migration) && (migration.match(/create or replace function/g) ?? []).length === 1 && !/drop function|alter table/i.test(migration));
check('the notice is for the tutor, of type session_booked, titled "You have an upcoming session", and tied to the session', /new\.tutor_id,\s*'session_booked',\s*'You have an upcoming session'/.test(migration) && /\s+new\.id\s+\);/.test(migration));
check('it names the learner, the subject and the time in South African time', /split_part\(trim\(full_name\), ' ', 1\)/.test(migration) && /subject_name/.test(migration) && /Africa\/Johannesburg/.test(migration));
check('browsers cannot call the function', /revoke all on function public\.notify_tutor_session_booked\(\) from public, anon, authenticated;/.test(migration));

// ---- the line in the dark banner ------------------------------------------------------------------------------------------------------
const queries = read('src/lib/queries.ts');
const app = read('src/App.tsx');
const bell = read('src/components/NotificationsBell.tsx');
const upcomingStudent = queries.slice(queries.indexOf('export async function fetchUpcomingStudentSessions'), queries.indexOf('// --- Session lifecycle'));
const upcomingTutor = queries.slice(queries.indexOf('export async function fetchUpcomingTutorSessions'), queries.indexOf('// Updates the signed-in tutor'));
check('both counts only look at booked (scheduled) sessions, from the last day on, and then keep what is not over', [upcomingStudent, upcomingTutor].every((q) => /\.eq\('status', 'scheduled'\)/.test(q) && /\.gte\('scheduled_start', upcomingLookbackIso\(\)\)/.test(q) && /\.filter\(\(s\) => isUpcomingSession\(s\)\)/.test(q)) && !/new Date\(\)\.toISOString\(\)/.test(upcomingStudent + upcomingTutor));
check('a tutor\'s line counts the tutor\'s own sessions (it used to read the learner side with the tutor\'s id: always 0)', /role === 'tutor'\s*\?\s*fetchUpcomingTutorSessions\(user\.id\)/.test(app));
check('a guardian\'s line still counts their learners\' sessions, a learner\'s their own', /fetchMyLearners\(user\.id\)\.then\(\(learners\) => learners\.map\(\(l\) => l\.id\)\)/.test(app) && /Promise\.resolve\(\[user\.id\]\)/.test(app) && /\.then\(fetchUpcomingStudentSessions\)/.test(app));
check('the line is read again every 30 seconds while the page is visible, and the moment the person comes back', /window\.setInterval\(\(\) => \{\s*if \(document\.visibilityState === 'visible'\) refreshUpcoming\(\);\s*\}, 30_000\)/.test(app) && /addEventListener\('focus', onBack\)/.test(app) && /addEventListener\('visibilitychange', onBack\)/.test(app));
check('the bell looks for new notices every 20 seconds while visible (it was every two minutes) and on coming back, and shows its spinner for the first load only', /\}, 20_000\);/.test(bell) && !/120_000/.test(bell) && /addEventListener\('focus', onBack\)/.test(bell) && /if \(!loadedOnce\.current\) setIsLoading\(true\)/.test(bell));
check('the pill still opens the Sessions page, which shows a tutor their own sessions', /onOpenSessions=\{openSessionsPage\}/.test(app) && /isTutor \? \(\s*<TutorSessionsPanel tutorId=\{userId\} \/>/.test(read('src/components/SessionsHistoryPage.tsx')));

// ---- the tutor can see where the session is and start the call --------------------------------------------------------------------
const panel = read('src/components/TutorSessionsPanel.tsx');
const teach = read('src/components/TeachGoScreen.tsx');
const queue = read('src/components/AvailableRequestsQueue.tsx');
const next = read('src/components/TutorNextSessions.tsx');
const room = read('src/components/UpcomingSessionsPanel.tsx');
check('the Teach screen lists the tutor\'s upcoming sessions, above the tier progress and the request list', /<TutorNextSessions tutorId=\{tutorId\} refreshKey=\{sessionsVersion\} onOpenSessions=\{onOpenSessions\} \/>/.test(teach) && teach.indexOf('<TutorNextSessions') < teach.indexOf('{/* Tier progress */}') && teach.indexOf('<TutorNextSessions') < teach.indexOf('<AvailableRequestsQueue'));
check('each one has "Start video call" for the tutor ("Join video call" for a learner), and says when the call opens until then', /isTutor \? 'Start video call' : 'Join video call'/.test(room) && /The video call opens at \{roomOpensAt\(scheduledStart\)\}/.test(room) && /<SessionRoomControl[^>]*isTutor \/>/.test(next));
check('the card shows nothing when the tutor has no upcoming sessions, and reloads when a request is accepted and every 30 seconds', /if \(sessions\.length === 0\) return null;/.test(next) && /\[tutorId, refreshKey\]/.test(next) && /30_000/.test(next));
check('accepting a request refreshes that card and the notice says where the session is', /if \(result\.status === 'booked'\) onAccepted\?\.\(\);/.test(queue) && /under "Your upcoming sessions" on this page/.test(queue) && /onAccepted=\{\(\) => setSessionsVersion\(\(v\) => v \+ 1\)\}/.test(teach) && !/Your Sessions — add the meeting link there/.test(queue));
check('the Sessions list puts sessions that are coming up or under way FIRST, soonest first, and the finished ones after it', /const current = sessions\.filter\(\(s\) => !sessionHasEnded/.test(panel) && /const ended = sessions\.filter\(\(s\) => sessionHasEnded/.test(panel) && panel.indexOf('{current.map(renderSession)}') < panel.indexOf('{ended.map(renderSession)}'));
check('on a session that has not ended, the video call button comes BEFORE the optional meeting link box', panel.indexOf('SessionRoomControl sessionId={s.id} scheduledStart={s.scheduledStart} durationHours={s.durationHours} isTutor />') < panel.indexOf('aria-label="Meeting link"') && /Or use your own meeting link \(optional\)/.test(panel));
check('the "add a link or they cannot reach you" warning only shows when there is no video call to use', /!hasEnded && !s\.meetingUrl && !FEATURES\.videoRooms/.test(panel));
check('"Mark session complete" is only on a session that has ended', /hasEnded \? \(\s*<>\s*<button\s+onClick=\{\(\) => run\(s\.id, \(\) => completeSession\(s\.id\)\)\}/.test(panel));
check('the tutor tips no longer tell the tutor to add a link as the first step', !/Add your meeting link as soon as you accept/.test(teach) && /Start the video call from "Your upcoming sessions"/.test(teach));

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
