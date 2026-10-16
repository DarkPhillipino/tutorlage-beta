// Keep or swap (master 7aa + 7da + 7db; the CEO's principle of 14 Oct 2026). Pure helpers and the exact wording; the
// database side is migration 20261014200000 (tested rolled back by supabase/tests/keep_or_swap.sql), the screens are
// MyTutorsPanel, KeepOrSwapChoice, LearnersITaughtPanel and the changes to AvailableRequestsQueue and PricesPage.
// Shown only while FEATURES.keepOrSwap is on (on since 16 Oct 2026).
//
// The idea in plain words: the first match stays anonymous. After a session the learner (or the parent who looks after
// them) can KEEP the tutor ("book again": a request addressed to that tutor) or TRY SOMEONE ELSE (that tutor never sees
// their requests again; the tutor is not told). A request addressed to a tutor waits at most 48 hours and never past 30
// minutes after its session time; if the tutor does not accept, nothing is charged and the learner can send it on to any
// available tutor in one tap.

export const KEEP_WINDOW_HOURS = 48;
export const AFTER_START_GRACE_MINUTES = 30;

export type TutorChoice = 'keep' | 'avoid';

export interface MyTutorRequest {
  id: string;
  status: string; // pending | expired | declined | cancelled | accepted
  expiresAt: string | null;
  requestedStart: string | null;
  canResend: boolean; // can be sent on to any available tutor in one tap
}

export interface MyTutor {
  tutorId: string;
  firstName: string;
  choice: TutorChoice | null;
  canBookAgain: boolean;
  sessionsTogether: number;
  lastSessionAt: string | null;
  lastSubject: string | null;
  lastGrade: string | null;
  lastLevelId: string | null;
  lastInstitutionId: string | null;
  request: MyTutorRequest | null;
}

// A row of the database function my_tutors(p_learner).
export function mapMyTutorRow(row: any): MyTutor {
  const hasRequest = !!row.request_id;
  return {
    tutorId: row.tutor_id,
    firstName: (row.first_name ?? '').trim() || 'Your tutor',
    choice: row.choice === 'keep' || row.choice === 'avoid' ? row.choice : null,
    canBookAgain: !!row.can_book_again,
    sessionsTogether: Number(row.sessions_together ?? 0),
    lastSessionAt: row.last_session_at ?? null,
    lastSubject: row.last_subject ?? null,
    lastGrade: row.last_grade ?? null,
    lastLevelId: row.last_level_id ?? null,
    lastInstitutionId: row.last_institution_id ?? null,
    request: hasRequest
      ? {
          id: row.request_id,
          status: String(row.request_status ?? ''),
          expiresAt: row.request_expires_at ?? null,
          requestedStart: row.request_start ?? null,
          canResend: !!row.request_can_resend,
        }
      : null,
  };
}

export const KEEP_OR_SWAP_COPY = {
  heading: 'My tutors',
  intro:
    'Tutors you have had a session with. You can keep one and book them again, or try someone else. Trying someone else is private: they are not told, and they will not see your requests unless you undo it.',
  keep: (name: string) => `Keep ${name}`,
  kept: (name: string) => `You are keeping ${name}`,
  swap: 'Try someone else',
  swapped: (name: string) => `You chose to try someone else instead of ${name}`,
  undoSwap: 'Undo',
  bookAgain: (name: string) => `Book ${name} again`,
  bookAgainBlocked: 'Not available to book again right now. You can still send a request to any available tutor.',
  sendToAnyone: 'Send it to any available tutor instead',
  sentToAnyone: 'Sent to any available tutor.',
  chooseNewTime: 'That time has passed. Choose a new time and send a new request.',
  ratingPrompt: (name: string) => `Would you like to keep ${name}?`,
  ratingNote: 'Rating is separate: trying someone else is not a bad rating.',
  notYours: 'Only the learner (if an adult) or the person who looks after them can choose.',
  bannerBookAgain: (name: string) => `Booking ${name} again`,
  bannerNote: (name: string) =>
    `${name} has up to ${KEEP_WINDOW_HOURS} hours to accept, and never past the session time. If ${name} does not accept, you are not charged and you can send the request to any available tutor in one tap.`,
  bannerAsap: (name: string) =>
    `"As soon as possible" gives ${name} about ${AFTER_START_GRACE_MINUTES} minutes. Choose a time later than that to give ${name} up to ${KEEP_WINDOW_HOURS} hours.`,
  bannerClear: (name: string) => `Not ${name}? Send it to any available tutor`,
  tutorSentToYou: 'Sent to you',
  tutorDecline: "Can't take this one",
  tutorDeclineConfirm: 'Tell the learner you cannot take this request? They will not be charged and can send it to someone else.',
  tutorEnd: (name: string) => `I can't keep tutoring ${name}`,
  tutorEndConfirm: (name: string) =>
    `${name} will be told, neutrally, that you cannot carry on, and will not be able to send you requests. You can undo this later.`,
  tutorEnded: 'You told Tutorlage you cannot continue with this learner.',
  tutorResume: 'Undo',
  tutorHeading: 'Learners you have taught',
  tutorIntro: 'If you cannot carry on with a learner, say so here. It is private: the learner is only told, in neutral words, that you cannot continue.',
};

// ---- when a request addressed to a tutor ends ------------------------------------------------------------------------------
// The database sets expires_at = the earlier of "48 hours after sending" and "30 minutes after the session's start".
// This computes the same, only to explain it before sending (the database's value is the one that counts).
export function addressedRequestEnd(sentAt: Date, requestedStart: Date): Date {
  const byWindow = sentAt.getTime() + KEEP_WINDOW_HOURS * 3600_000;
  const byStart = requestedStart.getTime() + AFTER_START_GRACE_MINUTES * 60_000;
  return new Date(Math.min(byWindow, byStart));
}

export function hoursLeft(expiresAt: string | null, now: Date): number | null {
  if (!expiresAt) return null;
  return (new Date(expiresAt).getTime() - now.getTime()) / 3600_000;
}

// "Waiting for Alpha, up to 48 hours" when it was just sent; "about 5 hours left" later; "ended" once it has.
export function waitingLabel(request: MyTutorRequest | null, firstName: string, now: Date): string | null {
  if (!request || request.status !== 'pending') return null;
  const left = hoursLeft(request.expiresAt, now);
  if (left === null) return `Waiting for ${firstName}`;
  if (left <= 0) return `Waiting for ${firstName} (ending now)`;
  if (left >= KEEP_WINDOW_HOURS - 0.5) return `Waiting for ${firstName}, up to ${KEEP_WINDOW_HOURS} hours`;
  if (left >= 2) return `Waiting for ${firstName}, about ${Math.round(left)} hours left`;
  const minutes = Math.max(1, Math.round(left * 60));
  return `Waiting for ${firstName}, about ${minutes} minute${minutes === 1 ? '' : 's'} left`;
}

// What to tell the learner about a request that is no longer waiting.
export function endedLabel(request: MyTutorRequest | null, firstName: string): string | null {
  if (!request) return null;
  if (request.status === 'expired') return `${firstName} did not accept in time. You were not charged.`;
  if (request.status === 'declined') return `${firstName} could not take this one. You were not charged.`;
  return null;
}

// ---- the explanation shown before sending, depending on the chosen time ----------------------------------------------------------
export function windowNote(name: string, scheduleType: 'now' | 'scheduled'): string {
  return scheduleType === 'now' ? KEEP_OR_SWAP_COPY.bannerAsap(name) : KEEP_OR_SWAP_COPY.bannerNote(name);
}

// A default time for a "book again": tomorrow afternoon, in the browser's own time, so the tutor has the whole window.
export function defaultBookAgainSchedule(now: Date): { date: string; time: string } {
  const d = new Date(now.getTime());
  d.setDate(d.getDate() + 1);
  const pad = (n: number) => String(n).padStart(2, '0');
  return { date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: '15:00' };
}

// ---- errors -----------------------------------------------------------------------------------------------------------------------------
// True when the database function does not exist (the migration is not applied yet).
export function isMissingDatabaseFunction(e: unknown): boolean {
  const code = (e as { code?: string } | null)?.code;
  const message = String((e as { message?: string } | null)?.message ?? '');
  return code === 'PGRST202' || code === '42883' || /could not find the function|function .* does not exist/i.test(message);
}

// The database's own sentences are already plain (they are written for the learner, the parent and the tutor), so they are
// shown as they are. A missing function or an unknown failure becomes a short, safe message with no database text in it.
export function describeKeepOrSwapError(e: unknown): string {
  if (isMissingDatabaseFunction(e)) return 'This is not switched on yet. Please try again later.';
  const code = (e as { code?: string } | null)?.code;
  const message = String((e as { message?: string } | null)?.message ?? '').trim();
  const plain = message && !/^(PGRST|relation |column |function |syntax |permission denied|new row|duplicate key|null value|violates)/i.test(message);
  if (plain && (code === 'P0001' || code === '42501' || code === '22023' || code === undefined)) return message;
  return 'Something went wrong. Please try again.';
}

// ---- which tutors to list first ---------------------------------------------------------------------------------------------------
export function sortMyTutors(tutors: MyTutor[]): MyTutor[] {
  const rank = (t: MyTutor) => (t.request?.status === 'pending' ? 0 : t.choice === 'keep' ? 1 : t.choice === 'avoid' ? 3 : 2);
  return [...tutors].sort((a, b) => rank(a) - rank(b) || (b.lastSessionAt ?? '').localeCompare(a.lastSessionAt ?? ''));
}

// Keep or swap is offered to a learner who is an adult, and to the person who looks after a learner; a learner under 18
// with their own sign-in cannot choose. The database decides (can_book_for); this only avoids showing buttons that would
// be refused.
export function canChooseTutor(params: { isViewOnlyLearner: boolean }): boolean {
  return !params.isViewOnlyLearner;
}
