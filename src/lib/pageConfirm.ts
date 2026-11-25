// A BOOKING FROM A TUTOR'S OWN PAGE THAT IS CONFIRMED WITHOUT THE TUTOR ACCEPTING (PM line 81 C, 25 Nov 2026): the pure half (no browser, no Supabase),
// so scripts/dev/tutor-booking-test.ts runs it. It applies only where the database says so (books_on_confirm: the tutor has accepted the new Terms);
// the database checks everything again in one step (confirm_page_booking) and either books and charges, or does nothing at all.
import { toMinutes, fromMinutes } from './availabilityPlan';

export const BOOKS_ON_CONFIRM_SENTENCE =
  'Families can book any open time in your hours from your page, at least 24 hours ahead, without asking you first. If you cannot teach a booked lesson, cancel it.';

// The first Terms version under which a booking from the page is confirmed without the tutor accepting. The database holds the same value in the setting
// page_confirm_since_terms_version.
export const CONFIRM_TERMS_VERSION = '2026-11-25b';

export const OFFER_COPY = {
  heading: 'New for your page: families book without asking first',
  body: `${BOOKS_ON_CONFIRM_SENTENCE} This starts only after you accept the new Terms of Service. Check your working hours first.`,
  terms: 'Read the Terms of Service',
  privacy: 'Read the Privacy Policy',
  accept: 'I accept the new Terms and Privacy Policy',
  saving: 'Saving…',
  failed: 'We could not save that. Check your connection and try again.',
} as const;

// my_pending_acceptances(): the documents whose current version this person has not accepted. true when the Terms waiting are new enough.
export function offersNewTerms(pending: unknown): boolean {
  return Array.isArray(pending) && pending.some((row) => {
    const r = (row ?? {}) as { document?: unknown; version?: unknown };
    return r.document === 'terms' && typeof r.version === 'string' && r.version >= CONFIRM_TERMS_VERSION;
  });
}

export const CONFIRM_COPY = {
  note: (name: string) => `Open times start 24 hours from now. The lesson is booked when you confirm it; ${name} does not need to accept it.`,
  youBook: (name: string) => `You are booking ${name}.`,
  creditNote: 'You check everything before anything is booked.',
  next: 'Continue',
  heading: 'Check your booking',
  tutor: 'Tutor',
  learner: 'Learner',
  subject: 'Subject',
  grade: 'Grade',
  date: 'Date',
  time: 'Time (South African time)',
  price: 'Price',
  left: 'Credit left afterwards',
  cancelHeading: 'Cancelling',
  // Both sentences are the Terms' own words (Part A, section 8). Change them only together with the Terms.
  cancelSelf: 'Until a session starts, you can cancel it yourself from your sessions list and the full price goes back to your credit at once.',
  cancelTutor: 'We always refund in full when the tutor cancels, or does not turn up.',
  confirm: 'Confirm booking',
  confirming: 'Booking…',
  change: 'Change',
  nothing: 'Nothing was booked and no credit was taken.',
  unknown: 'We did not hear back, so we cannot say yet whether the lesson was booked. Press Confirm booking again: you will not be charged twice.',
  booked: 'Booked',
  bookedMore: (name: string) => `${name} has been told. The lesson is in your sessions list.`,
  paid: 'Taken from your credit',
  creditNow: 'Your credit now',
  sessions: 'Open my sessions',
  another: 'Book another lesson',
} as const;

// "14:00 to 15:30": the end of a lesson from its start and its length in hours.
export function lessonTimes(start: string, hours: number): string {
  return `${start} to ${fromMinutes((toMinutes(start) + Math.round(hours * 60)) % 1440)}`;
}

// "Thursday 28 November 2026" from "2026-11-28".
export function longDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return `${days[date.getUTCDay()]} ${d} ${months[m - 1]} ${y}`;
}

export interface BookedResult { paidRand: number; availableRand: number | null }

// What confirm_page_booking answered. null = not a booking (never treated as one).
export function parseBooked(data: unknown): BookedResult | null {
  const d = (data ?? {}) as { booked?: unknown; session_id?: unknown; paid_rand?: unknown; available_rand?: unknown };
  if (d.booked !== true || typeof d.session_id !== 'string') return null;
  return { paidRand: Number(d.paid_rand) || 0, availableRand: typeof d.available_rand === 'number' ? d.available_rand : null };
}

// true when the database itself refused (it sends a code): then nothing was booked. false = no clear answer (connection lost).
export function wasRefused(e: unknown): boolean {
  const code = (e as { code?: unknown } | null)?.code;
  return typeof code === 'string' && code !== '';
}
