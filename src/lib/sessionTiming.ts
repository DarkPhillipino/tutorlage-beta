// When is a session "upcoming"? (CEO, 17 Oct 2026: after a request was accepted the "You have no upcoming sessions" line did not change
// for the learner or the parent, and a tutor was never told.) A session is upcoming from the moment it is booked until it is over:
// that includes one that has already started (a request for "as soon as possible" is booked at the time it was MADE, a moment
// before the tutor accepts, so by the time it is booked its start is already behind us). Cancelled and completed sessions are not
// upcoming. No browser or Supabase code, so scripts/dev/upcoming-sessions-test.ts runs it directly.
import { describeSaWhen, formatSaTime } from './saTime';

// Nothing is longer than this, so a read only needs sessions that started within it.
export const UPCOMING_LOOKBACK_HOURS = 24;

export const upcomingLookbackIso = (now: number = Date.now()): string => new Date(now - UPCOMING_LOOKBACK_HOURS * 3_600_000).toISOString();

export function sessionHasEnded(scheduledStart: string, durationHours: number, now: number = Date.now()): boolean {
  const start = new Date(scheduledStart).getTime();
  if (Number.isNaN(start)) return true;
  return start + durationHours * 3_600_000 <= now;
}

export function isUpcomingSession(
  session: { status: string | null; scheduledStart: string; durationHours: number },
  now: number = Date.now(),
): boolean {
  return session.status === 'scheduled' && !sessionHasEnded(session.scheduledStart, session.durationHours, now);
}

// When a session is, in words, in South African time, and says so: "Today, 22:36 SAST", "Tomorrow, 14:00 SAST", "Sat 17 Oct, 14:00 SAST"
// (CEO, 1 Nov 2026; lib/saTime.ts).
export function describeWhen(scheduledStart: string, now: number = Date.now()): string {
  return describeSaWhen(scheduledStart, now);
}

// "22:36 SAST": when the video call opens, which is 15 minutes before the start.
export function roomOpensAt(scheduledStart: string): string {
  return formatSaTime(new Date(scheduledStart).getTime() - 15 * 60_000);
}
