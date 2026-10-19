// The date, time and length of a tutoring request (CEO, 19 Oct 2026: the date and the length decide which tutors are free).
// No browser or Supabase code, so scripts/dev/request-schedule-test.ts runs it directly.
import { describeDate, toIsoDate } from './format';
import type { BookingFormState, SchoolCurriculum } from '../types';

// A session lasts 1 to 3 hours in half-hours (the database refuses anything else).
export const SESSION_LENGTHS = [1, 1.5, 2, 2.5, 3] as const;
export const DEFAULT_SESSION_HOURS = 1;

export function describeLength(hours: number): string {
  return hours === 1 ? '1 hour' : `${hours} hours`;
}

// Tutors set their weekly hours in South African time and the database judges a request in that time, so a time chosen on the
// request page is always read as South African time (+02:00, no daylight saving), whatever zone the browser is in. The ONE place
// that turns a chosen date and time into a moment: the price counts and the request itself both use it.
export const SA_UTC_OFFSET = '+02:00';

export function southAfricanStartIso(date: string, time: string): string {
  return new Date(`${date}T${time}:00${SA_UTC_OFFSET}`).toISOString();
}

// "As soon as possible" starts now; a scheduled request starts at the chosen South African time.
export function requestStartIso(scheduleType: 'now' | 'scheduled', date: string, time: string, now: Date = new Date()): string {
  return scheduleType === 'now' ? now.toISOString() : southAfricanStartIso(date, time);
}

// The wall clock in South Africa right now, as the date ("YYYY-MM-DD") and time ("HH:MM") the calendar compares against.
export function southAfricaClock(now: Date = new Date()): { date: string; time: string } {
  const sa = new Date(now.getTime() + 2 * 3_600_000);
  const iso = sa.toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 16) };
}

// ---- the month calendar ----------------------------------------------------------------------------------------------------------
export interface CalendarDay {
  iso: string;
  day: number;
  inMonth: boolean;
  isPast: boolean;
}

// The weeks (Monday first) that show one month; days before today are marked past. A week with no day of the month is left out.
export function monthGrid(year: number, month: number, now: Date = new Date()): CalendarDay[][] {
  const today = southAfricaClock(now).date;
  const offset = (new Date(year, month, 1).getDay() + 6) % 7;
  const weeks: CalendarDay[][] = [];
  for (let w = 0; w < 6; w += 1) {
    const week: CalendarDay[] = [];
    for (let d = 0; d < 7; d += 1) {
      const date = new Date(year, month, 1 - offset + w * 7 + d);
      const iso = toIsoDate(date);
      week.push({ iso, day: date.getDate(), inMonth: date.getMonth() === month, isPast: iso < today });
    }
    if (week.some((x) => x.inMonth)) weeks.push(week);
  }
  return weeks;
}

export function shiftMonth(year: number, month: number, by: number): { year: number; month: number } {
  const d = new Date(year, month + by, 1);
  return { year: d.getFullYear(), month: d.getMonth() };
}

export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const WEEKDAY_HEADINGS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

// ---- the times in half-hours -----------------------------------------------------------------------------------------------------
export function timeSlots(from = '06:00', to = '22:00'): string[] {
  const toMinutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const slots: string[] = [];
  for (let m = toMinutes(from); m <= toMinutes(to); m += 30) {
    slots.push(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
  }
  return slots;
}

// A time that has already gone (in South African time) cannot be chosen.
export function isPastSlot(date: string, time: string, now: Date = new Date()): boolean {
  const clock = southAfricaClock(now);
  return date < clock.date || (date === clock.date && time <= clock.time);
}

export function firstOpenSlot(date: string, now: Date = new Date()): string | null {
  return timeSlots().find((t) => !isPastSlot(date, t, now)) ?? null;
}

// ---- the words on the request page -----------------------------------------------------------------------------------------------
// The line on the schedule button: when and for how long.
export function describeSchedule(state: Pick<BookingFormState, 'scheduleType' | 'scheduledDate' | 'scheduledTime' | 'durationHours'>): string {
  const length = describeLength(state.durationHours || DEFAULT_SESSION_HOURS);
  return state.scheduleType === 'now'
    ? `As soon as possible · ${length}`
    : `Scheduled: ${describeDate(state.scheduledDate)}, ${state.scheduledTime || '14:00'} · ${length}`;
}

// The curriculum question is asked only of a learner whose school follows more than one.
export function curriculumQuestionNeeded(curricula: SchoolCurriculum[]): boolean {
  return curricula.length > 1;
}

// What the request page says when tutors teach this but none is free at the chosen time and length (no waiting-list offer: a
// tutor exists, so waiting for one would be wrong). Shown as a heading and a line under it.
export const NO_TUTOR_FREE_TITLE = 'No tutor is free at that time';
export const NO_TUTOR_FREE_HINT = 'Choose another day or time.';
export const NO_TUTOR_FREE_AT_TIME = `${NO_TUTOR_FREE_TITLE}. ${NO_TUTOR_FREE_HINT}`;

// The red-border message when the curriculum question has not been answered.
export const CURRICULUM_QUESTION = 'Which curriculum are you following?';
export const CURRICULUM_REQUIRED = 'Choose the curriculum you are following.';
