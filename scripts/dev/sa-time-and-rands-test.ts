// Checks on how times and money are written (release gate row SA-LOCALE-01; CEO, 1 Nov 2026): every session time is South African time and
// says SAST; every rand amount is in whole rands (R150, not R150.00). Run:  npx tsx scripts/dev/sa-time-and-rands-test.ts
// Proves: the words are the same whatever zone this computer is in, a late-night session is on the right South African day, an amount with
// real cents is never rounded on screen, and no screen is left writing a session time in the browser's own zone or money with a fixed
// ".00". It does NOT prove which amounts can have cents (that is the rounding decision, in the 1 Nov report).
import fs from 'node:fs';
import { SA_ZONE_LABEL, describeSaWhen, formatSaClock, formatSaDate, formatSaDateTime, formatSaTime } from '../../src/lib/saTime';
import { formatRate, formatRateRange } from '../../src/lib/format';
import { formatAmount, formatSessionTime } from '../../src/lib/closeAccount';
import { describeSchedule } from '../../src/lib/requestSchedule';
import { formatRand } from '../../admin/src/lib/rand';

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
};
const root = new URL('../../', import.meta.url);
const read = (p: string) => fs.readFileSync(new URL(p, root), 'utf8');
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// ---- times ----
const iso = '2026-10-20T12:00:00.000Z'; // 14:00 in South Africa
check('the zone is named SAST', SA_ZONE_LABEL === 'SAST');
check('14:00 SAST is 12:00 UTC', formatSaTime(iso) === '14:00 SAST' && formatSaClock(iso) === '14:00');
check('the same moment given as a number or a Date reads the same', formatSaTime(Date.parse(iso)) === '14:00 SAST' && formatSaTime(new Date(iso)) === '14:00 SAST');
check('a session at 22:30 UTC is already the NEXT day in South Africa (00:30 SAST), and says so', formatSaDateTime('2026-10-20T22:30:00.000Z', Date.parse('2026-10-20T12:00:00Z')) === 'Wed 21 Oct, 00:30 SAST');
check('midnight and the minute before it are written 00:00 and 23:59 (24-hour clock, never "12:00 AM")', formatSaClock('2026-10-20T22:00:00.000Z') === '00:00' && formatSaClock('2026-10-20T21:59:00.000Z') === '23:59');
check('a date reads "Tue 20 Oct", and gains the year only when it is not this year', formatSaDate(iso, Date.parse('2026-11-01T10:00:00Z')) === 'Tue 20 Oct' && formatSaDate('2027-01-05T10:00:00Z', Date.parse('2026-11-01T10:00:00Z')) === 'Tue 5 Jan 2027');
check('a date and time read "Tue 20 Oct, 14:00 SAST"', formatSaDateTime(iso, Date.parse('2026-11-01T10:00:00Z')) === 'Tue 20 Oct, 14:00 SAST');
const lateNow = Date.parse('2026-10-17T21:59:00Z'); // 23:59 SAST on the 17th
check('"Today" and "Tomorrow" are South African days: at 23:59 SAST, 00:05 SAST is Tomorrow, 23:00 SAST is Today', describeSaWhen('2026-10-17T21:00:00Z', lateNow) === 'Today, 23:00 SAST' && describeSaWhen('2026-10-17T22:05:00Z', lateNow) === 'Tomorrow, 00:05 SAST');
check('anything unreadable gives nothing, never "Invalid Date" or "NaN"', [null, undefined, '', 'nonsense'].every((x) => formatSaTime(x) === '' && formatSaDateTime(x) === '' && describeSaWhen(x) === '') && formatSessionTime('nonsense') === 'nonsense');
check('the close-account list uses it', formatSessionTime('2026-10-17T12:00:00Z') === 'Sat 17 Oct, 14:00 SAST');
check('the schedule button says the zone', /14:00 SAST · 1 hour$/.test(describeSchedule({ scheduleType: 'scheduled', scheduledDate: '2026-10-20', scheduledTime: '14:00', durationHours: 1 })));
// The fixed two-hour shift must agree with the real zone database for every half hour of a year (South Africa has no daylight saving).
const real = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Johannesburg', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
let disagreements = 0;
for (let t = Date.UTC(2026, 0, 1); t < Date.UTC(2027, 0, 1); t += 30 * 60_000) if (real.format(t) !== formatSaClock(t)) disagreements += 1;
check('for every half hour of 2026 it agrees with the Africa/Johannesburg zone database', disagreements === 0, `${disagreements} differ`);

// ---- money ----
check('a whole amount has no decimals: R150, R30, R1250', ['150', '30', '1250'].every((s) => formatRate(Number(s)) === s) && formatRate(150.0) === '150' && formatRate(0) === '0');
check('a rate that arrives as 150.00 (a database numeric) reads 150', formatRate(Number('150.00')) === '150');
check('floating-point dust does not show: 150.0000001 and 149.9999999 read 150', formatRate(150.0000001) === '150' && formatRate(149.9999999) === '150');
check('an amount with real cents is NEVER rounded on screen (R187.50 stays R187.50, never R188 or R187.5)', formatRate(187.5) === '187.50' && formatRate(46.88) === '46.88' && formatRate(112.5) === '112.50');
check('a price range is in whole rands, and the uncapped top is still "R120+"', formatRateRange(120, 150) === 'R120 - R150' && formatRateRange(120, 10_000_000) === 'R120+');
check('the close-account amounts are in whole rands', formatAmount(500, 'ZAR', (c) => (c === 'ZAR' ? 'R' : c)) === 'R500' && formatAmount(187.5, 'ZAR') === 'R187.50');

const samples = [0, 30, 150, 150.5, 187.5, 46.88, 112.5, 1250, 149.9999999, 150.0000001, 0.1 + 0.2];
check('the admin app writes rands exactly as the app does (the two copies agree on every sample)', samples.every((n) => formatRand(n) === formatRate(n)));
check('the admin payments screen writes no fixed two-decimal amount', !/(amount|totalAmountPaid|platformCommissionRetained)\w*\.toFixed\(2\)/.test(code('admin/src/pages/Payouts.tsx')) && /formatRand\(/.test(read('admin/src/pages/Payouts.tsx')));

// ---- no screen is left behind ----
const sessionScreens = [
  'src/components/AvailableRequestsQueue.tsx', 'src/components/UpcomingSessionsPanel.tsx', 'src/components/TutorSessionsPanel.tsx',
  'src/components/TutorCalendar.tsx', 'src/components/NotificationsBell.tsx', 'src/components/TutorNextSessions.tsx', 'src/pages/RoomPage.tsx',
  'src/components/CloseAccountView.tsx', 'src/components/LearnersITaughtPanel.tsx', 'src/components/MyTutorsPanel.tsx', 'src/components/TeachingProfilePanel.tsx', 'src/lib/sessionTiming.ts', 'src/lib/closeAccount.ts', 'src/lib/requestSchedule.ts',
];
for (const f of sessionScreens) {
  const text = code(f);
  check(`${f} writes no time or date in the browser's own zone`, !/toLocale(Time|Date)?String\((?![^)]*Africa\/Johannesburg)/.test(text));
}
const moneyScreens = [
  'src/components/AvailableRequestsQueue.tsx', 'src/components/LevelSelectionPage.tsx', 'src/components/PriceLadder.tsx', 'src/components/PricesPage.tsx',
  'src/components/UpcomingSessionsPanel.tsx', 'src/components/CloseAccountView.tsx', 'src/lib/closeAccount.ts', 'src/lib/format.ts',
];
for (const f of moneyScreens) {
  check(`${f} writes no fixed two-decimal amount`, !/(amount|price|rate|payout|owed)\w*\.toFixed\(2\)/i.test(code(f)));
}
check('every screen that shows a booked or requested time imports the South African helpers', ['AvailableRequestsQueue', 'UpcomingSessionsPanel', 'TutorSessionsPanel', 'TutorCalendar', 'NotificationsBell'].every((n) => /lib\/saTime'/.test(read(`src/components/${n}.tsx`))) && /lib\/saTime'/.test(read('src/pages/RoomPage.tsx')));
check('the time slot picker says South African time', /Select Slot \(South African time, SAST\)/.test(read('src/components/ScheduleModal.tsx')));

// ---- the one time the database writes into a notice ----
const migration = read('supabase/migrations/20261101200000_session_booked_notice_names_sast.sql');
check('the tutor\'s "upcoming session" notice names the zone: one function replaced, nothing dropped, nothing else changed', (migration.match(/create or replace function/g) ?? []).length === 1 && !/drop |alter table|update |delete |insert into public\.(?!notifications)/i.test(migration.replace(/--.*$/gm, '')) && /'FMDy FMDD FMMon HH24:MI'\) \|\| ' SAST'/.test(migration) && /revoke all on function public\.notify_tutor_session_booked\(\) from public, anon, authenticated;/.test(migration));
check('every time the database writes into a notice is the one above (no other to_char of a time in a notice)', (() => {
  const dir = new URL('supabase/migrations/', root);
  const hits = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).filter((f) => /to_char\([^)]*(scheduled_start|requested_start|expires_at)[^)]*HH24/i.test(fs.readFileSync(new URL(f, dir), 'utf8')));
  return hits.every((f) => f === '20261017224500_tutor_session_booked_notice.sql' || f === '20261101200000_session_booked_notice_names_sast.sql');
})());

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
