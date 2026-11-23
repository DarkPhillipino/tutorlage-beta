// Checks on the tutor's weekly working hours editor (J4, 18 Nov 2026). Run: npx tsx scripts/dev/availability-plan-test.ts
// Proves, on the pure rules in src/lib/availabilityPlan.ts: ticked days all get the one range; the CEO's example (Mon to Fri 17:00 to 23:00, then Sat and Sun
// 19:00 to 23:00) writes seven rows and no more; an end at or before the start is refused in plain words; overlapping and touching ranges on a day join into
// ONE row and the rows they swallow are deleted; a range already inside a stored row writes nothing; rows on other days and other ranges are never touched;
// existing rows are shown joined per day; "change" replaces exactly its own rows; times come in 30-minute steps; the day list reads in words.
// It reads the source to prove the editor and its one query keep their promises (insert BEFORE delete, tutor hours repeat weekly, no old one-slot Add button).
// It does NOT open a browser (tests/browser/availability.spec.ts does) and does not touch the database (nothing in the database changed).
import { readFileSync } from 'node:fs';
import { notificationTarget } from '../../src/lib/notificationTarget';
import {
  END_OPTIONS, EVERY_DAY, START_OPTIONS, WEEKDAYS, WEEKENDS, describeDays, formatRange, idsForDay, planSave, rangesForDay, withValue, type AvailabilityRow,
} from '../../src/lib/availabilityPlan';

let failed = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) failed += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && detail ? ` [${detail}]` : ''}`);
}
const row = (id: string, dayOfWeek: number, startTime: string, endTime: string): AvailabilityRow => ({ id, dayOfWeek, startTime, endTime });
const j = (v: unknown) => JSON.stringify(v);
const plan = (rows: AvailabilityRow[], days: number[], s: string, e: string, rep: string[] = []) => {
  const p = planSave(rows, days, s, e, rep);
  if (p.message) throw new Error(`refused: ${p.message}`);
  return p;
};

// ---- the CEO's example ----
const first = plan([], WEEKDAYS, '17:00', '23:00');
check('Mon to Fri 17:00 to 23:00 on an empty week writes exactly five rows, one per day', first.inserts.length === 5 && first.deleteIds.length === 0 && j(first.inserts.map((r) => r.dayOfWeek)) === j([1, 2, 3, 4, 5]) && first.inserts.every((r) => r.startTime === '17:00' && r.endTime === '23:00'));
const afterFirst = first.inserts.map((r, i) => row(`a${i}`, r.dayOfWeek, `${r.startTime}:00`, `${r.endTime}:00`));
const second = plan(afterFirst, WEEKENDS, '19:00', '23:00');
check('then Sat and Sun 19:00 to 23:00 adds two rows and leaves the five weekday rows alone', second.inserts.length === 2 && second.deleteIds.length === 0 && j(second.inserts.map((r) => r.dayOfWeek).sort()) === j([0, 6]));
check('every day at once writes seven rows', plan([], EVERY_DAY, '09:00', '12:00').inserts.length === 7);

// ---- refusals, in plain words ----
const noDays = planSave([], [], '09:00', '12:00');
const backwards = planSave([], [1], '17:00', '09:00');
const equal = planSave([], [1], '09:00', '09:00');
check('no ticked day is refused with "Tick at least one day."', noDays.message === 'Tick at least one day.');
check('an end before the start is refused in words', backwards.message === 'The end time must be after the start time.');
check('an end equal to the start is refused too', equal.message === 'The end time must be after the start time.');

// ---- merging ----
const stored = [row('m1', 1, '09:00:00', '12:00:00'), row('m2', 1, '14:00:00', '16:00:00'), row('t1', 2, '09:00:00', '12:00:00')];
const overlap = plan(stored, [1], '11:00', '15:00');
check('a range that overlaps two stored ranges joins them into ONE row (09:00 to 16:00) and deletes the two it swallowed', overlap.inserts.length === 1 && overlap.inserts[0].startTime === '09:00' && overlap.inserts[0].endTime === '16:00' && j(overlap.deleteIds.sort()) === j(['m1', 'm2']));
check('the Tuesday row is not touched when only Monday is ticked', !overlap.deleteIds.includes('t1'));
const touching = plan(stored, [1], '12:00', '14:00');
check('ranges that only touch (12:00 meets 12:00) join as well', touching.inserts.length === 1 && touching.inserts[0].startTime === '09:00' && touching.inserts[0].endTime === '16:00' && touching.deleteIds.length === 2);
const apart = plan(stored, [1], '18:00', '20:00');
check('a range apart from the others is a new row and deletes nothing', apart.inserts.length === 1 && apart.deleteIds.length === 0);
const inside = plan(stored, [1], '09:30', '11:30');
check('a range already inside a stored row writes nothing', inside.inserts.length === 0 && inside.deleteIds.length === 0 && inside.changedDays.length === 0);
const dupes = plan([row('d1', 3, '09:00:00', '12:00:00'), row('d2', 3, '10:00:00', '11:00:00')], [3], '09:30', '10:30');
check('a range inside a day that already holds overlapping duplicates tidies them into one row', dupes.inserts.length === 1 && dupes.inserts[0].startTime === '09:00' && dupes.inserts[0].endTime === '12:00' && dupes.deleteIds.length === 2);
const mixed = plan(stored, [1, 2, 3], '09:00', '12:00');
check('ticking Mon, Tue and Wed: Monday and Tuesday already have it (no write), only Wednesday is added', mixed.inserts.length === 1 && mixed.inserts[0].dayOfWeek === 3 && mixed.deleteIds.length === 0);

// ---- the week view ----
const messy = [row('x1', 4, '13:00:00', '15:00:00'), row('x2', 4, '09:00:00', '10:00:00'), row('x3', 4, '09:30:00', '11:00:00'), row('x4', 5, '08:00:00', '09:00:00')];
const thu = rangesForDay(messy, 4);
check('stored rows show joined and sorted per day (09:00 to 11:00 and 13:00 to 15:00 on Thursday)', thu.length === 2 && formatRange(thu[0]) === '09:00 to 11:00' && formatRange(thu[1]) === '13:00 to 15:00' && j(thu[0].ids.sort()) === j(['x2', 'x3']));
check('a day with no rows has no ranges, and "clear a day" finds exactly that day\'s rows', rangesForDay(messy, 0).length === 0 && j(idsForDay(messy, 4).sort()) === j(['x1', 'x2', 'x3']));

// ---- change one range ----
const changed = plan(stored, [1], '10:00', '13:00', ['m1']);
check('changing 09:00 to 12:00 on Monday into 10:00 to 13:00 deletes that row and adds the new one; Monday 14:00 to 16:00 stays', changed.deleteIds.includes('m1') && !changed.deleteIds.includes('m2') && changed.inserts.length === 1 && changed.inserts[0].startTime === '10:00' && changed.inserts[0].endTime === '13:00');
const moved = plan(stored, [2], '10:00', '13:00', ['m1']);
check('a changed range can be moved to another day: the old row goes, the new day gets the range', moved.deleteIds.includes('m1') && moved.inserts.some((r) => r.dayOfWeek === 2));

// ---- times and words ----
check('start times are 00:00 to 23:30 in 30-minute steps, end times 00:30 to 23:30, nothing free-typed', START_OPTIONS[0] === '00:00' && START_OPTIONS[1] === '00:30' && START_OPTIONS.includes('17:30') && END_OPTIONS[0] === '00:30' && END_OPTIONS.includes('23:30') && START_OPTIONS.every((t) => /^\d\d:(00|30)$/.test(t)) && END_OPTIONS.every((t) => /^\d\d:(00|30)$/.test(t)));
check('an old saved time off the list (09:15) is still offered so the screen can show it', withValue(START_OPTIONS, '09:15').includes('09:15') && withValue(START_OPTIONS, '09:00') === START_OPTIONS);
check('days read in words', describeDays(WEEKDAYS) === 'Monday to Friday' && describeDays(WEEKENDS) === 'Saturday and Sunday' && describeDays(EVERY_DAY) === 'every day' && describeDays([1, 3, 5]) === 'Monday, Wednesday and Friday' && describeDays([2]) === 'Tuesday' && describeDays([1, 2, 3, 6]) === 'Monday to Wednesday and Saturday', describeDays([1, 2, 3, 6]));

// ---- the source keeps its promises ----
const editor = readFileSync('src/components/AvailabilityEditor.tsx', 'utf8');
const queries = readFileSync('src/lib/queries.ts', 'utf8');
const saveFn = queries.slice(queries.indexOf('export async function saveTutorAvailabilityChanges'), queries.indexOf('interface TutorSessionRow'));
check('the editor says in words that the hours repeat every week until changed', /repeat every week until you change them/.test(editor));
check('the editor has the three shortcuts and a Save, and no longer the one-slot Add button', /Weekdays/.test(editor) && /Weekends/.test(editor) && /Every day/.test(editor) && /'Save'/.test(editor) && !/addTutorAvailabilitySlot/.test(editor));
check('the one query inserts first, then deletes, then re-reads the rows', saveFn.indexOf('.insert(') > 0 && saveFn.indexOf('.insert(') < saveFn.indexOf('.delete()') && saveFn.indexOf('.delete()') < saveFn.indexOf('fetchTutorAvailability('));
const editorCode = editor.replace(/\/\/.*$/gm, '');
check('the editor writes no table itself (only through the query) and reads no hours table; its one read is the sign-up-autofill record of the tutor, select only', !/\.(insert|update|delete|upsert|rpc)\(/.test(editorCode) && !/from\('tutor_availability'\)/.test(editorCode) && (editorCode.match(/supabase\.from\(/g) || []).length === 1 && /from\('tutor_hours_autofill'\)\.select\('changed_at'\)\.eq\('tutor_id', tutorId\)/.test(editorCode));
check('"Set from your sign-up answer" shows only while the autofilled hours are unchanged and there are hours', /changed_at === null/.test(editorCode) && /setFromSignup && hasAny/.test(editorCode) && /Set from your sign-up answer/.test(editorCode));
check('the bell notice "hours_autofilled" opens the Teaching tab of the account menu, where the editor is; the other targets are unchanged', notificationTarget('hours_autofilled') === 'hours' && notificationTarget('request_for_you') === 'teach' && notificationTarget('terms_updated') === 'terms' && notificationTarget('wallet_topup_added') === 'wallet' && notificationTarget('request_accepted') === 'sessions' && /target === 'hours'\) openManageAccount\('teaching'\)/.test(readFileSync('src/App.tsx', 'utf8')));

console.log(failed === 0 ? '\nAll availability checks passed.' : `\n${failed} availability check(s) FAILED.`);
process.exit(failed === 0 ? 0 : 1);
