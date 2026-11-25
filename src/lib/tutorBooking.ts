// ONE TUTOR'S BOOKING PAGE (PM line 79 D, 25 Nov 2026): the pure half (no browser, no Supabase), so scripts/dev/tutor-booking-test.ts runs it. Only that tutor's subjects, grades,
// price and times; a request goes to that tutor alone, so nothing here ever offers another tutor.
import { parsePublicPage, type PublicPageClient, type PublicPageSubject, type PublicTutorPage } from './publicTutorPage';
import { AFTER_START_GRACE_MINUTES, KEEP_WINDOW_HOURS } from './keepOrSwap';

export interface BookingPage extends PublicTutorPage { tutorId: string }
export interface DayTimes { date: string; times: string[] }
export interface TutorTimes { nowOk: boolean; days: DayTimes[] }

export function parseBookingPage(data: unknown): BookingPage | null {
  const page = parsePublicPage(data);
  const tutorId = (data as { tutor_id?: unknown } | null)?.tutor_id;
  return page && typeof tutorId === 'string' && tutorId ? { ...page, tutorId } : null;
}

// null: there is no page. Throws when the question could not be asked (the page then offers "Try again").
export async function fetchBookingPage(client: PublicPageClient, code: string): Promise<BookingPage | null> {
  const { data, error } = await client.rpc('tutor_booking_page', { p_code: code });
  if (error) throw new Error(error.message || 'Could not load this page.');
  return parseBookingPage(data);
}

export function parseTimes(data: unknown): TutorTimes {
  const d = (data ?? {}) as { now_ok?: unknown; days?: unknown };
  const days = Array.isArray(d.days)
    ? (d.days as unknown[]).map((x): DayTimes | null => {
        const o = (x ?? {}) as { date?: unknown; times?: unknown };
        const times = Array.isArray(o.times) ? (o.times as unknown[]).filter((t): t is string => typeof t === 'string' && /^\d\d:\d\d$/.test(t)) : [];
        return typeof o.date === 'string' && times.length > 0 ? { date: o.date, times } : null;
      }).filter((x): x is DayTimes => x !== null)
    : [];
  return { nowOk: d.now_ok === true, days };
}

export async function fetchTutorTimes(client: PublicPageClient, code: string, hours: number): Promise<TutorTimes> {
  const { data, error } = await client.rpc('tutor_page_times', { p_code: code, p_hours: hours });
  if (error) throw new Error(error.message || 'Could not load the times.');
  return parseTimes(data);
}

export const subjectNames = (rows: PublicPageSubject[]): string[] => Array.from(new Set(rows.map((r) => r.subject)));

// The grades the tutor covers for a subject, in the order of the grade list.
export function gradesFor(rows: PublicPageSubject[], subject: string, allGrades: string[]): string[] {
  const at = (g: string) => allGrades.findIndex((x) => x.toLowerCase() === g.trim().toLowerCase());
  const mine = rows.filter((r) => r.subject === subject).map((r) => [at(r.minGrade), at(r.maxGrade)]).filter(([a, b]) => a >= 0 && b >= 0);
  return allGrades.filter((_, i) => mine.some(([a, b]) => i >= a && i <= b));
}

export const BOOKING_COPY = {
  title: (name: string) => `Book with ${name}`,
  tutorAccount: 'Lessons are booked from a parent or learner account.',
  tutorAccountMore: (name: string) => `You are signed in with a tutor account. To book ${name}, sign out and sign in as a parent, guardian or learner.`,
  otherAccount: 'Sign out and sign in as a parent, guardian or learner to book a lesson.',
  lessonHeading: 'Your lesson',
  subject: 'Subject',
  chooseSubject: 'Choose a subject',
  grade: 'Grade',
  chooseGrade: 'Choose a grade',
  length: 'How long',
  when: 'When',
  asap: 'As soon as possible',
  pickTime: 'Choose a time',
  day: 'Day',
  time: 'Time (South African time)',
  hours: (name: string, hours: string) => `${name}'s working hours (South African time): ${hours}.`,
  noTimes: (name: string) => `${name} has no open time of this length in the next four weeks. Try a shorter lesson, or come back later.`,
  timesFailed: 'We could not load the times. Check your connection and try again.',
  chooseLearner: 'Add or choose the learner this lesson is for.',
  chooseFirst: 'Choose the subject, grade and time to continue.',
  toHer: (name: string) => `Your request goes to ${name} only.`,
  held: (name: string) => `The price is put on hold in your credit. If ${name} does not accept in time, it goes straight back.`,
  nothingSent: 'Nothing was sent and no credit was held.',
  changeTime: 'Change the time',
  // The waiting-time note. The time limit is the database's: at most 48 hours, never later than 30 minutes after the start.
  waitScheduled: (name: string) =>
    `${name} has up to ${KEEP_WINDOW_HOURS} hours to accept, and never past the session time. If ${name} does not accept, you are not charged: your credit comes back and you decide what happens next.`,
  waitAsap: (name: string) =>
    `"As soon as possible" gives ${name} about ${AFTER_START_GRACE_MINUTES} minutes. Choose a time later than that to give ${name} up to ${KEEP_WINDOW_HOURS} hours.`,
} as const;

// The database's refusals were written for "book again", where another tutor can be offered. On a tutor's own page the same refusal is said about that tutor, and no other tutor is offered.
export function bookingRefusalWords(message: string, name: string): string {
  if (/isn't available at that time/i.test(message)) return `${name} isn't available at that time. Choose another time.`;
  if (/isn't approved for that subject|doesn't teach that subject/i.test(message)) return `${name} cannot take that subject and grade. Choose another subject or grade.`;
  if (/lower price level/i.test(message)) return `${name}'s price has changed. Reload this page and try again.`;
  if (/3 requests waiting/i.test(message)) return `You already have 3 requests waiting for ${name}.`;
  if (/try someone else instead/i.test(message)) return `You chose to try someone else instead of ${name}. Undo that under My tutors on the Sessions page to ask for ${name} again.`;
  if (/can't take this request|only ask for a tutor|different institution/i.test(message)) return `${name} cannot take this request right now.`;
  // Anything else (money, phone number, network) is shown as it is, without any sentence about another tutor.
  return message.split(/(?<=[.!?])\s+/).filter((s) => !/any available tutor/i.test(s)).join(' ') || `${name} cannot take this request right now.`;
}
