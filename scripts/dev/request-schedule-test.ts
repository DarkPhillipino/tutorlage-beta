// Checks on the request page's calendar, length and curriculum question, and on the price-count call (CEO, 19 Oct 2026: the date and
// length decide which tutors are free; a school that follows several curricula is asked which one). Run: npx tsx scripts/dev/request-schedule-test.ts
import fs from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ScheduleModal } from '../../src/components/ScheduleModal';
import {
  CURRICULUM_QUESTION,
  CURRICULUM_REQUIRED,
  NO_TUTOR_FREE_AT_TIME,
  SESSION_LENGTHS,
  curriculumQuestionNeeded,
  describeLength,
  describeSchedule,
  firstOpenSlot,
  isPastSlot,
  monthGrid,
  requestStartIso,
  shiftMonth,
  southAfricaClock,
  southAfricanStartIso,
  timeSlots,
} from '../../src/lib/requestSchedule';
import { askAvailablePriceLevels, type PriceLevelRpc } from '../../src/lib/priceLevelCall';
import type { BookingFormState, SchoolCurriculum } from '../../src/types';

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
};
const root = new URL('../../', import.meta.url);
const read = (p: string) => fs.readFileSync(new URL(p, root), 'utf8');

async function main() {
  // Monday 19 Oct 2026, 10:00 in South Africa (08:00 UTC).
  const now = new Date('2026-10-19T08:00:00Z');

  // ---- South African time -------------------------------------------------------------------------------------------------------------
  check('a chosen time is read as South African time (14:00 is 12:00 UTC), whatever the browser zone', southAfricanStartIso('2026-10-20', '14:00') === '2026-10-20T12:00:00.000Z');
  check('an "as soon as possible" request starts now; a scheduled one at the chosen time (one helper for both)', requestStartIso('now', '2026-10-20', '14:00', now) === now.toISOString() && requestStartIso('scheduled', '2026-10-20', '14:00', now) === '2026-10-20T12:00:00.000Z');
  check('the South African clock is two hours ahead of UTC and rolls the date over', southAfricaClock(now).date === '2026-10-19' && southAfricaClock(now).time === '10:00' && southAfricaClock(new Date('2026-10-19T22:30:00Z')).date === '2026-10-20');

  // ---- the calendar -------------------------------------------------------------------------------------------------------------------
  const oct = monthGrid(2026, 9, now);
  check('October 2026 starts on a Thursday: five weeks, Monday first, three blank days before the 1st', oct.length === 5 && oct[0].map((d) => d.inMonth).join() === 'false,false,false,true,true,true,true' && oct[0][3].day === 1);
  check('every week has seven days and the month ends on the 31st', oct.every((w) => w.length === 7) && oct.flat().filter((d) => d.inMonth).length === 31);
  check('days before today are off, today and later are on', oct.flat().filter((d) => d.inMonth && d.isPast).length === 18 && !oct.flat().find((d) => d.iso === '2026-10-19')!.isPast && oct.flat().find((d) => d.iso === '2026-10-18')!.isPast);
  check('a month that needs six weeks gets six, one that fits in four gets four', monthGrid(2026, 10, now).length === 6 && monthGrid(2027, 1, now).length === 4);
  check('next and previous month roll the year', JSON.stringify(shiftMonth(2026, 11, 1)) === '{"year":2027,"month":0}' && JSON.stringify(shiftMonth(2026, 0, -1)) === '{"year":2025,"month":11}');
  check('a month wholly in the past is all off', monthGrid(2026, 8, now).flat().filter((d) => d.inMonth).every((d) => d.isPast));

  // ---- the times and the length ------------------------------------------------------------------------------------------------------
  const slots = timeSlots();
  check('times run in half-hours from 06:00 to 22:00', slots[0] === '06:00' && slots.at(-1) === '22:00' && slots.length === 33 && slots.includes('14:30') && !slots.includes('14:15'));
  check('on the same day a time that has gone (or is now) is off, a later one is on', isPastSlot('2026-10-19', '10:00', now) && isPastSlot('2026-10-19', '09:30', now) && !isPastSlot('2026-10-19', '10:30', now));
  check('an earlier day is all off, a later day is all on', isPastSlot('2026-10-18', '21:00', now) && !isPastSlot('2026-10-20', '06:00', now));
  check('the first open time is the next half-hour today, 06:00 tomorrow, and nothing late in the evening', firstOpenSlot('2026-10-19', now) === '10:30' && firstOpenSlot('2026-10-20', now) === '06:00' && firstOpenSlot('2026-10-19', new Date('2026-10-19T20:30:00Z')) === null);
  check('a session lasts 1, 1.5, 2, 2.5 or 3 hours', JSON.stringify(SESSION_LENGTHS) === '[1,1.5,2,2.5,3]' && describeLength(1) === '1 hour' && describeLength(1.5) === '1.5 hours' && describeLength(3) === '3 hours');

  const base: BookingFormState = { institution: 'School', institutionId: 'i1', subject: 'Maths', scheduleType: 'scheduled', scheduledDate: '2026-10-25', scheduledTime: '14:00', durationHours: 2.5, curriculumId: null };
  check('the schedule button line gives the date, the time and the length', /^Scheduled: .+, 14:00 · 2\.5 hours$/.test(describeSchedule(base)));
  check('an instant request says as soon as possible and the length', describeSchedule({ ...base, scheduleType: 'now', durationHours: 1 }) === 'As soon as possible · 1 hour');

  // ---- the window itself --------------------------------------------------------------------------------------------------------------
  const modal = (scheduleType: 'now' | 'scheduled') => renderToStaticMarkup(React.createElement(ScheduleModal, { isOpen: true, onClose: () => undefined, onUpdateSchedule: () => undefined, formState: { ...base, scheduleType, scheduledDate: '2099-01-15', durationHours: 2 } }));
  const scheduled = modal('scheduled');
  const instant = modal('now');
  check('"Schedule in Advance" shows a month calendar (previous and next month, weekday headings) and the half-hour times', /aria-label="Calendar"/.test(scheduled) && /aria-label="Previous month"/.test(scheduled) && /aria-label="Next month"/.test(scheduled) && /January 2099/.test(scheduled) && />Mo</.test(scheduled) && scheduled.includes('>06:00<') && scheduled.includes('>22:00<'));
  check('the length picker (1 to 3 hours) is on the "Schedule in Advance" tab, with the current length chosen', SESSION_LENGTHS.every((h) => scheduled.includes(`aria-label="${describeLength(h)}"`)) && /aria-pressed="true" aria-label="2 hours"/.test(scheduled));
  check('the length picker is on the "Book Instant Tutor" tab too, and the calendar is not', SESSION_LENGTHS.every((h) => instant.includes(`aria-label="${describeLength(h)}"`)) && !/aria-label="Calendar"/.test(instant) && /Instant Match Active/.test(instant));
  const modalSource = read('src/components/ScheduleModal.tsx');
  check('the old five-days-only date buttons are gone and the window hands back date, time and length', !/getUpcomingDateOptions/.test(modalSource) && /onUpdateSchedule\(activeOption, selectedDate, selectedTime, selectedHours\)/.test(modalSource));
  check('a time that has gone cannot be confirmed', /disabled=\{timeHasGone\}/.test(modalSource) && /if \(timeHasGone\) return;/.test(modalSource));

  // ---- the curriculum question --------------------------------------------------------------------------------------------------------
  const cur = (n: number): SchoolCurriculum[] => Array.from({ length: n }, (_, i) => ({ id: `c${i}`, code: `C${i}`, name: `Curriculum ${i}` }));
  check('the question is asked only when the school follows more than one curriculum', !curriculumQuestionNeeded(cur(0)) && !curriculumQuestionNeeded(cur(1)) && curriculumQuestionNeeded(cur(2)) && curriculumQuestionNeeded(cur(3)));
  const prices = read('src/components/PricesPage.tsx');
  const app = read('src/App.tsx');
  const queries = read('src/lib/queries.ts');
  check('the page shows the question only for such a school, with the red-border pattern, and blocks Search and Send until it is answered',
    /\{needsCurriculum && \(/.test(prices) && /missingField === 'curriculum' \? 'border-rose-400 ring-2 ring-rose-200'/.test(prices) && /if \(curriculumUnanswered\) \{\s*setMissingField\('curriculum'\);\s*return;/.test(prices) &&
      /if \(curriculumUnanswered\) \{\s*setMissingField\('curriculum'\);\s*setSendError\(CURRICULUM_REQUIRED\)/.test(prices) && CURRICULUM_QUESTION === 'Which curriculum are you following?' && CURRICULUM_REQUIRED.length > 10);
  check('an answer that is not one of the school\'s curricula is ignored, and App clears it when the school changes', /curricula\.some\(\(c\) => c\.id === formState\.curriculumId\)/.test(prices) && /curriculumId: null \}\)\);\s*setUserAccount\(prev => \(\{ \.\.\.prev, institution: '' \}\)\)/.test(app) && /curriculumId: prev\.institutionId === institution\.id \? prev\.curriculumId : null/.test(app));
  check('the school\'s curricula come from the database function, and a missing function means no question rather than an error', /rpc\('school_curricula', \{ p_institution: institutionId \}\)/.test(queries) && /if \(isMissingDatabaseFunction\(error\)\) return \[\];/.test(queries) && /if \(!institutionId\) return \[\];/.test(queries));
  check('the request carries the curriculum only when one was chosen (so it still works before the migration)', /\.\.\.\(curriculumId \? \{ curriculum_id: curriculumId \} : \{\}\)/.test(queries) && /curriculumId: answeredCurriculumId,/.test(prices));

  // ---- the request and the counts use one time rule and the chosen length ----------------------------------------------------------
  check('the request start and the price counts use the same start-time helper; the old browser-zone conversion is gone', /requestStartIso\(scheduleType, scheduledDate, scheduledTime\)/.test(queries) && /start: requestStartIso\(formState\.scheduleType, formState\.scheduledDate, formState\.scheduledTime\)/.test(prices) && !/new Date\(`\$\{scheduledDate\}T\$\{scheduledTime\}:00`\)/.test(queries));
  check('the request page uses the chosen length (not a fixed one hour) for the price and the request', !/const durationHours = 1;/.test(prices) && /const durationHours = formState\.durationHours;/.test(prices) && /hours: formState\.durationHours/.test(prices));
  check('the heading and the empty state come from the largest count, with the plain tutor search only as the fallback', /counts\.levels\.reduce\(\(most, l\) => Math\.max\(most, l\.tutors\), 0\)/.test(prices) && /const tutorCount = countedTutors \?\? fallbackCount;/.test(prices));
  check('with nobody free the counts are asked again without the time; if that has tutors the page says no tutor is free at that time, and offers no waiting list',
    /fetchAvailablePriceLevels\(search\)\)\.length > 0/.test(prices) && /noTutorFreeAtThatTime \? NO_TUTOR_FREE_TITLE/.test(prices) && /!noTutorFreeAtThatTime && FEATURES\.tutorWaitlist/.test(prices) && NO_TUTOR_FREE_AT_TIME === 'No tutor is free at that time. Choose another day or time.');
  check('the schedule button on the request page and on the home page shows the date, time and length', /describeSchedule\(formState\)/.test(prices) && /describeSchedule\(formState\)/.test(read('src/components/BookingForm.tsx')));
  check('the form state starts at one hour with no curriculum chosen', /durationHours: DEFAULT_SESSION_HOURS,\s*curriculumId: null,/.test(app));

  // ---- the price-count call, before and after the migration ---------------------------------------------------------------------------
  const calls: Record<string, unknown>[] = [];
  const rows = [{ level_id: '1A', tutors: 2 }];
  const answering = (first: { error: unknown } | null): PriceLevelRpc => async (_fn, args) => {
    calls.push(args);
    if (calls.length === 1 && first) return { data: null, error: first.error };
    return { data: rows, error: null };
  };
  calls.length = 0;
  await askAvailablePriceLevels(answering(null), { subject: 'Maths', gradeLevel: 'Grade 10', institutionId: 'i1' });
  check('with no time, length or curriculum the call sends only the three old values', calls.length === 1 && Object.keys(calls[0]).join() === 'p_subject,p_grade,p_institution');
  calls.length = 0;
  const fresh = await askAvailablePriceLevels(answering(null), { subject: 'Maths', gradeLevel: 'Grade 10', institutionId: 'i1', start: '2026-10-20T12:00:00.000Z', hours: 1.5, curriculumId: 'c1' });
  check('with a time, a length and a curriculum it sends the start, the hours and the curriculum', calls.length === 1 && calls[0].p_start === '2026-10-20T12:00:00.000Z' && calls[0].p_hours === 1.5 && calls[0].p_curriculum === 'c1' && fresh.length === 1);
  calls.length = 0;
  const fallback = await askAvailablePriceLevels(answering({ error: { code: 'PGRST202', message: 'Could not find the function public.available_price_levels(p_curriculum, p_grade, p_hours, p_institution, p_start, p_subject) in the schema cache' } }), { subject: 'Maths', gradeLevel: 'Grade 10', institutionId: 'i1', start: '2026-10-20T12:00:00.000Z', hours: 1 });
  check('when the database does not have the six-value function yet, it asks again with the three old values and returns that answer', calls.length === 2 && 'p_start' in calls[0] && Object.keys(calls[1]).join() === 'p_subject,p_grade,p_institution' && fallback.length === 1);
  calls.length = 0;
  let thrown: unknown = null;
  try {
    await askAvailablePriceLevels(answering({ error: { code: '57014', message: 'canceling statement due to statement timeout' } }), { subject: 'Maths', gradeLevel: 'Grade 10', institutionId: 'i1', start: '2026-10-20T12:00:00.000Z', hours: 1 });
  } catch (e) {
    thrown = e;
  }
  check('any other error is not retried (one call) and reaches the page, which then falls back to the plain tutor search', calls.length === 1 && (thrown as { code?: string } | null)?.code === '57014');
  calls.length = 0;
  let noRetry = false;
  try {
    await askAvailablePriceLevels(answering({ error: { code: 'PGRST202', message: 'x' } }), { subject: 'Maths', gradeLevel: 'Grade 10', institutionId: 'i1' });
  } catch {
    noRetry = calls.length === 1;
  }
  check('a three-value call that finds no function is not retried with the same three values', noRetry);

  console.log(failures === 0 ? '\nall checks passed' : `\n${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
