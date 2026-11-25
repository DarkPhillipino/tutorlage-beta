// Checks on the tutor's weekly working hours editor (J4, 18 Nov 2026). Run: npx tsx scripts/dev/availability-plan-test.ts
// Proves, on the pure rules in src/lib/availabilityPlan.ts: ticked days all get the one range; the CEO's example (Mon to Fri 17:00 to 23:00, then Sat and Sun
// 19:00 to 23:00) writes seven rows and no more; an end at or before the start is refused in plain words; Save REPLACES the hours of the ticked days (narrowing
// stores the narrow hours); a second time on a day is its own choice and is refused when it overlaps or touches; rows on unticked days are never touched;
// existing rows are shown joined per day; "change" replaces exactly its own rows; times come in 30-minute steps; the day list reads in words.
// It reads the source to prove the editor and its one query keep their promises (insert BEFORE delete, tutor hours repeat weekly, no old one-slot Add button).
// It does NOT open a browser (tests/browser/availability.spec.ts does) and does not touch the database (nothing in the database changed).
import { readFileSync } from 'node:fs';
import { notificationTarget } from '../../src/lib/notificationTarget';
import {
  END_OPTIONS, EVERY_DAY, START_OPTIONS, WEEKDAYS, WEEKENDS, describeDays, describeHours, formatRange, idsForDay, planSave, rangesForDay, withValue, type AvailabilityRow,
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

// ---- Save replaces; a second time is its own choice ----
const stored = [row('m1', 1, '09:00:00', '12:00:00'), row('m2', 1, '14:00:00', '16:00:00'), row('t1', 2, '09:00:00', '12:00:00')];
const apply = (rows: AvailabilityRow[], p: { inserts: { dayOfWeek: number; startTime: string; endTime: string }[]; deleteIds: string[] }) =>
  [...rows.filter((r) => !p.deleteIds.includes(r.id)), ...p.inserts.map((r, i) => row(`n${i}`, r.dayOfWeek, `${r.startTime}:00`, `${r.endTime}:00`))];
const dayWords = (rows: AvailabilityRow[], d: number) => rangesForDay(rows, d).map(formatRange).join(' and ');
// the fault of 25 Nov: weekdays 17:00 to 23:00, the tutor picks 16:00 to 20:00 and must get exactly that
const evenings = [1, 2, 3, 4, 5].map((d) => row(`e${d}`, d, '17:00:00', '23:00:00'));
const narrowed = apply(evenings, plan(evenings, WEEKDAYS, '16:00', '20:00'));
check('narrowing weekday hours stores the narrow hours on every ticked day (16:00 to 20:00, five rows)', narrowed.length === 5 && WEEKDAYS.every((d) => dayWords(narrowed, d) === '16:00 to 20:00'), j(narrowed));
check('and the words read back say so', describeHours(narrowed, WEEKDAYS) === 'Monday to Friday: 16:00 to 20:00', describeHours(narrowed, WEEKDAYS));
const replaced = apply(stored, plan(stored, [1], '11:00', '15:00'));
check('Save on a day with two times leaves exactly the picked one; Tuesday is not touched', dayWords(replaced, 1) === '11:00 to 15:00' && dayWords(replaced, 2) === '09:00 to 12:00');
const smaller = apply(stored, plan(stored, [2], '09:30', '11:30'));
check('a time inside the stored one replaces it (Save narrows)', dayWords(smaller, 2) === '09:30 to 11:30' && smaller.filter((r) => r.dayOfWeek === 2).length === 1);
const mixed = plan(stored, [1, 2, 3], '09:00', '12:00');
check('ticking Mon, Tue and Wed: Tuesday already is exactly it, Monday loses only its other time, Wednesday is added', mixed.inserts.length === 1 && mixed.inserts[0].dayOfWeek === 3 && j(mixed.deleteIds) === j(['m2']) && j(mixed.changedDays) === j([1, 3]), j(mixed));
const second2 = apply(stored, plan(stored, [2], '18:00', '20:00', [], ));
check('Save never keeps the old time beside the new one', dayWords(second2, 2) === '18:00 to 20:00');
const added = planSave(stored, [2], '18:00', '20:00', [], 'add');
check('"Add as a second time" keeps what is there and adds the new time', added.message === null && added.deleteIds.length === 0 && dayWords(apply(stored, added), 2) === '09:00 to 12:00 and 18:00 to 20:00');
const clash = planSave(stored, [2], '11:00', '13:00', [], 'add');
const touch = planSave(stored, [2], '12:00', '13:00', [], 'add');
check('a second time that overlaps or touches is refused in words and writes nothing', !!clash.message && /Tuesday already has 09:00 to 12:00/.test(clash.message) && clash.inserts.length === 0 && clash.deleteIds.length === 0 && !!touch.message);
check('words for a day with two times and a day with none', describeHours(stored, [1, 3]) === 'Monday: 09:00 to 12:00 and 14:00 to 16:00; Wednesday: not available', describeHours(stored, [1, 3]));

// ---- the week view ----
const messy = [row('x1', 4, '13:00:00', '15:00:00'), row('x2', 4, '09:00:00', '10:00:00'), row('x3', 4, '09:30:00', '11:00:00'), row('x4', 5, '08:00:00', '09:00:00')];
const thu = rangesForDay(messy, 4);
check('stored rows show joined and sorted per day (09:00 to 11:00 and 13:00 to 15:00 on Thursday)', thu.length === 2 && formatRange(thu[0]) === '09:00 to 11:00' && formatRange(thu[1]) === '13:00 to 15:00' && j(thu[0].ids.sort()) === j(['x2', 'x3']));
check('a day with no rows has no ranges, and "clear a day" finds exactly that day\'s rows', rangesForDay(messy, 0).length === 0 && j(idsForDay(messy, 4).sort()) === j(['x1', 'x2', 'x3']));

// ---- change one range ----
const changed = apply(stored, plan(stored, [1], '10:00', '13:00', ['m1']));
check('changing 09:00 to 12:00 on Monday into 10:00 to 13:00 gives that, and Monday 14:00 to 16:00 stays', dayWords(changed, 1) === '10:00 to 13:00 and 14:00 to 16:00');
const swallow = apply(stored, plan(stored, [1], '10:00', '15:00', ['m1']));
check('a changed time that runs into the other time replaces it and is never joined to it', dayWords(swallow, 1) === '10:00 to 15:00');
const more = apply(stored, plan(stored, [1, 2], '10:00', '11:00', ['m1']));
check('change with more days ticked: the other ticked day is replaced too', dayWords(more, 1) === '10:00 to 11:00 and 14:00 to 16:00' && dayWords(more, 2) === '10:00 to 11:00', dayWords(more, 2));
const movedPlan = plan(stored, [2], '10:00', '13:00', ['m1']);
const moved = apply(stored, movedPlan);
check('a changed range can be moved to another day: the old row goes, the new day holds only the new time', dayWords(moved, 1) === '14:00 to 16:00' && dayWords(moved, 2) === '10:00 to 13:00' && movedPlan.changedDays.includes(1));

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
