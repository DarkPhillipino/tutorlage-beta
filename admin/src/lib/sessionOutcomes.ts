// "A successful session" and the numbers around it (master item 7cy; the CEO agreed on 14 Oct 2026).
//
// DEFINITION (the CEO's, from the Steam-report review): a session is SUCCESSFUL when it
//   1. was completed,
//   2. was rated 4 or more, and
//   3. the same learner and tutor booked another session within 14 days of its completion.
// A payment alone is not a success: the point is whether the match worked well enough to continue.
//
// This file is pure (no database, no browser) so scripts/dev/session-outcomes-test.ts can check it exactly.
// fetchSessionOutcomes() in queries.ts feeds it; Phase1Numbers.tsx shows it. Nothing here writes anything.

export const REBOOK_WINDOW_DAYS = 14;
const DAY_MS = 86_400_000;

export interface OutcomeSession {
  id: string;
  student_id: string;
  tutor_id: string;
  status: string;                 // scheduled | completed | cancelled_by_student | cancelled_by_tutor | ...
  created_at: string;             // when it was booked
  scheduled_start: string;
  completed_at: string | null;
  duration_hours: number | string;
}

export interface OutcomeReview {
  session_id: string;
  rating: number | string;
}

export interface SessionOutcomes {
  completedSessions: number;
  ratedSessions: number;            // completed and rated
  ratedFourPlus: number;            // completed and rated 4 or more
  successfulSessions: number;       // completed, rated 4+, rebooked within 14 days (whether or not the window has closed)
  decidedSessions: number;          // completed, and the 14-day window has closed: the fair denominator
  successfulDecided: number;        // successful among the decided
  successRatePct: number | null;    // successfulDecided / decidedSessions
  stillOpenSessions: number;        // completed, window open, not yet successful: too early to tell
  pairsWithACompletedSession: number;
  pairsBookedAgain: number;         // pairs with two or more non-cancelled sessions
  leakageSignals: number;           // learners who stopped while their last tutor kept working: a signal, not proof
  hoursBookedLast28Days: number;    // non-cancelled sessions that started in the last 28 days
  tutorsWorkedLast28Days: number;
}

const isCancelled = (status: string) => status.startsWith('cancelled');
const ms = (iso: string) => new Date(iso).getTime();

export function computeSessionOutcomes(
  sessions: OutcomeSession[],
  reviews: OutcomeReview[],
  now: Date = new Date(),
): SessionOutcomes {
  const nowMs = now.getTime();
  const windowMs = REBOOK_WINDOW_DAYS * DAY_MS;

  const ratingBySession = new Map<string, number>();
  for (const r of reviews) {
    const n = Number(r.rating);
    if (Number.isFinite(n)) ratingBySession.set(r.session_id, n);
  }

  const live = sessions.filter((s) => !isCancelled(s.status));
  const completed = sessions.filter((s) => s.status === 'completed' && s.completed_at);

  const pairKey = (s: OutcomeSession) => `${s.student_id}|${s.tutor_id}`;
  const livePairs = new Map<string, OutcomeSession[]>();
  for (const s of live) {
    const key = pairKey(s);
    const list = livePairs.get(key);
    if (list) list.push(s);
    else livePairs.set(key, [s]);
  }

  // Rebooked: another non-cancelled session of the same pair, booked after this one was booked and no later than
  // 14 days after this one was completed.
  const rebooked = (s: OutcomeSession): boolean => {
    const completedAt = ms(s.completed_at as string);
    return (livePairs.get(pairKey(s)) ?? []).some(
      (other) => other.id !== s.id && ms(other.created_at) > ms(s.created_at) && ms(other.created_at) <= completedAt + windowMs,
    );
  };

  let rated = 0;
  let fourPlus = 0;
  let successful = 0;
  let decided = 0;
  let successfulDecided = 0;
  let stillOpen = 0;
  for (const s of completed) {
    const rating = ratingBySession.get(s.id);
    if (rating !== undefined) rated++;
    if (rating !== undefined && rating >= 4) fourPlus++;
    const windowClosed = ms(s.completed_at as string) + windowMs <= nowMs;
    const isSuccess = rating !== undefined && rating >= 4 && rebooked(s);
    if (isSuccess) successful++;
    if (windowClosed) {
      decided++;
      if (isSuccess) successfulDecided++;
    } else if (!isSuccess) {
      stillOpen++;
    }
  }

  const completedPairs = new Set(completed.map(pairKey));
  let booked2 = 0;
  for (const list of livePairs.values()) if (list.length >= 2) booked2++;

  // Leakage signal: a learner with at least one completed session whose latest booking of any kind is more than
  // 14 days old, while the tutor of their latest completed session has had a booking created since.
  const byLearner = new Map<string, OutcomeSession[]>();
  for (const s of live) {
    const list = byLearner.get(s.student_id);
    if (list) list.push(s);
    else byLearner.set(s.student_id, [s]);
  }
  let leakage = 0;
  for (const [learner, list] of byLearner) {
    const done = list.filter((s) => s.status === 'completed' && s.completed_at);
    if (done.length === 0) continue;
    const lastDone = done.reduce((a, b) => (ms(a.completed_at as string) >= ms(b.completed_at as string) ? a : b));
    const latestBooking = Math.max(...list.map((s) => ms(s.created_at)));
    if (latestBooking + windowMs > nowMs) continue; // still booking, or booked recently
    if (ms(lastDone.completed_at as string) + windowMs > nowMs) continue; // the window has not closed
    const tutorStillWorking = live.some(
      (s) => s.tutor_id === lastDone.tutor_id && s.student_id !== learner && ms(s.created_at) > ms(lastDone.completed_at as string),
    );
    if (tutorStillWorking) leakage++;
  }

  const since = nowMs - 28 * DAY_MS;
  const recent = live.filter((s) => ms(s.scheduled_start) >= since && ms(s.scheduled_start) <= nowMs);
  const hours = recent.reduce((sum, s) => sum + (Number(s.duration_hours) || 0), 0);

  return {
    completedSessions: completed.length,
    ratedSessions: rated,
    ratedFourPlus: fourPlus,
    successfulSessions: successful,
    decidedSessions: decided,
    successfulDecided,
    successRatePct: decided > 0 ? Math.round((successfulDecided / decided) * 100) : null,
    stillOpenSessions: stillOpen,
    pairsWithACompletedSession: completedPairs.size,
    pairsBookedAgain: booked2,
    leakageSignals: leakage,
    hoursBookedLast28Days: Math.round(hours * 10) / 10,
    tutorsWorkedLast28Days: new Set(recent.map((s) => s.tutor_id)).size,
  };
}
