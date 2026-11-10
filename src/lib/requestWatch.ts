import { formatSaDateTime } from './saTime';
import { FREE_CANCEL_NOTE, FREE_FOR_NOW_NOTICE } from './freeSessions';
import { WALLET_COPY, rand0 } from './wallet';

// THE WAITING SCREEN after a lesson request is sent (the CEO, 9 Nov 2026). /payment/callback used to say "Request sent" and "Back to Tutorlage" and never look at
// the request again. Now the payer's OWN request is read every few seconds (the database's policy "Students view own session requests" decides who may), and the
// page shows what that row says: still waiting for a tutor, booked (with the tutor's name), or ended. This file is the logic and the words, with no screen and no
// database client of its own (the client is passed in, so the script test can use a pretend one). It only READS here; cancelling goes through the existing
// cancelWaitingRequest / cancelSession doors (src/lib/queries.ts), never from this file.

export type WatchMode = 'wallet' | 'free' | 'card';

export interface WatchClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from(table: string): any;
}

export interface WatchRequest {
  id: string;
  status: string;
  paymentStatus: string;
  tutorId: string | null;
  sessionId: string | null;
  requestedStart: string;
  durationHours: number;
  chargedAmount: number;
  // What the wallet put on hold (whole rand), kept on the row after the hold is returned. Null when no wallet paid.
  holdRand: number | null;
  paidFromWallet: boolean;
  subjectName: string | null;
}

export interface WatchSession {
  id: string;
  status: string;
  scheduledStart: string;
  durationHours: number;
  tutorName: string;
  subjectName: string | null;
  walletPaid: boolean;
}

export type EndedWhy = 'expired' | 'declined' | 'cancelled';

export type WatchView =
  // The first look has not come back yet.
  | { kind: 'reading' }
  // Show today's page unchanged: no id, not the payer's, or not a request that is "sent" (and `retry` when the look failed rather than found nothing).
  | { kind: 'fallback'; retry: boolean }
  // Waiting for a tutor. `confirming`: a tutor has said yes and the booking is being finished.
  | { kind: 'waiting'; request: WatchRequest; confirming: boolean }
  | { kind: 'booked'; request: WatchRequest; session: WatchSession }
  // A tutor accepted but the booking cannot be read here (not the learner's own, or not there yet).
  | { kind: 'booked_unseen'; request: WatchRequest }
  | { kind: 'session_over'; request: WatchRequest; session: WatchSession | null; why: 'cancelled_by_you' | 'cancelled_by_tutor' | 'cancelled' | 'completed' }
  | { kind: 'ended'; request: WatchRequest; why: EndedWhy };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isRequestId = (value: unknown): value is string => typeof value === 'string' && UUID.test(value);

// ---- the state --------------------------------------------------------------------------------------------------------------------------------

// What a request row (and, once a tutor has accepted, the booked session) means for the person looking. `request` is null when the database returned
// nothing (no such id, or not theirs); `session` is null when the booking cannot be read, undefined when it has not been looked for.
export function decideView(request: WatchRequest | null, session: WatchSession | null | undefined): WatchView {
  if (!request) return { kind: 'fallback', retry: false };
  const status = request.status;
  if (status === 'pending') {
    // card_verified = sent and waiting (free and wallet requests use it too); paid = the old card-first flow; charging = a tutor said yes and the card is being charged.
    if (request.paymentStatus === 'charging' || (request.tutorId && ['card_verified', 'paid'].includes(request.paymentStatus))) return { kind: 'waiting', request, confirming: true };
    if (request.paymentStatus === 'card_verified' || request.paymentStatus === 'paid') return { kind: 'waiting', request, confirming: false };
    // Anything else (the card check not finished, a failed charge) is not "sent and waiting": today's page, unchanged.
    return { kind: 'fallback', retry: false };
  }
  if (status === 'accepted') {
    if (!request.sessionId) return { kind: 'waiting', request, confirming: true };
    if (!session) return { kind: 'booked_unseen', request };
    if (session.status === 'scheduled') return { kind: 'booked', request, session };
    if (session.status === 'completed') return { kind: 'session_over', request, session, why: 'completed' };
    if (session.status === 'cancelled_by_tutor') return { kind: 'session_over', request, session, why: 'cancelled_by_tutor' };
    if (session.status === 'cancelled_by_student') return { kind: 'session_over', request, session, why: 'cancelled_by_you' };
    return { kind: 'booked_unseen', request };
  }
  if (status === 'cancelled') {
    // cancel_session marks the request cancelled too, so a cancelled request that had a tutor is a cancelled SESSION, not a request that nobody took.
    if (request.sessionId || request.tutorId) {
      const why = session?.status === 'cancelled_by_tutor' ? 'cancelled_by_tutor' : session?.status === 'cancelled_by_student' ? 'cancelled_by_you' : 'cancelled';
      return { kind: 'session_over', request, session: session ?? null, why };
    }
    return { kind: 'ended', request, why: 'cancelled' };
  }
  if (status === 'expired' || status === 'declined') return { kind: 'ended', request, why: status };
  return { kind: 'fallback', retry: false };
}

// Does the page need to keep looking? Only while the answer can still change by itself.
export function shouldKeepLooking(view: WatchView): boolean {
  return view.kind === 'reading' || view.kind === 'waiting' || (view.kind === 'fallback' && view.retry);
}

// How the money was paid: the row's own flag beats the address.
export function payModeOf(request: WatchRequest, fromAddress: WatchMode): WatchMode {
  return request.paidFromWallet ? 'wallet' : fromAddress;
}

// ---- how often to look ------------------------------------------------------------------------------------------------------------------------
export const WATCH_FAST_MS = 4_000;
export const WATCH_FAST_UNTIL_MS = 2 * 60_000;
export const WATCH_SLOW_MS = 15_000;
export const WATCH_HIDDEN_MS = 60_000;
export const WATCH_STOP_AFTER_MS = 30 * 60_000;

// The wait before the next look, or null to stop. Quick for the first two minutes (a tutor often says yes fast), slower after, once a minute when the tab is
// hidden, and it always stops after 30 minutes (the page then offers "Check now").
export function nextLookDelayMs(elapsedMs: number, hidden: boolean): number | null {
  if (elapsedMs >= WATCH_STOP_AFTER_MS) return null;
  if (hidden) return WATCH_HIDDEN_MS;
  return elapsedMs < WATCH_FAST_UNTIL_MS ? WATCH_FAST_MS : WATCH_SLOW_MS;
}

// ---- the reads --------------------------------------------------------------------------------------------------------------------------------
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const strOrNull = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

function subjectOf(r: Record<string, unknown>): string | null {
  const e = r.student_subject_enrollments as { subject_name?: unknown } | null | undefined;
  return e && typeof e.subject_name === 'string' && e.subject_name ? e.subject_name : null;
}

// The payer's own request. Null when the database returns nothing (no such id, or not theirs); a failed read throws.
export async function fetchWatchRequest(db: WatchClient, userId: string, requestId: string): Promise<WatchRequest | null> {
  if (!isRequestId(requestId)) return null;
  const { data, error } = await db
    .from('session_requests')
    .select(
      'id, status, payment_status, tutor_id, resulting_session_id, requested_start, duration_hours, charged_amount, wallet_hold_rand, paid_from_wallet, student_subject_enrollments ( subject_name )',
    )
    .eq('id', requestId)
    .eq('requested_by_profile_id', userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const r = data as Record<string, unknown>;
  const hold = Number(r.wallet_hold_rand);
  return {
    id: str(r.id),
    status: str(r.status),
    paymentStatus: str(r.payment_status),
    tutorId: strOrNull(r.tutor_id),
    sessionId: strOrNull(r.resulting_session_id),
    requestedStart: str(r.requested_start),
    durationHours: Number(r.duration_hours),
    chargedAmount: Number(r.charged_amount),
    holdRand: r.paid_from_wallet === true && Number.isFinite(hold) && hold >= 1 ? hold : null,
    paidFromWallet: r.paid_from_wallet === true,
    subjectName: subjectOf(r),
  };
}

// The booked session, read only after a tutor has accepted (before that no session row exists, so a tutor's name can never appear early). The tutor's name
// is read the same way the Sessions page reads it. Null when the database returns nothing; a failed read throws.
export async function fetchWatchSession(db: WatchClient, sessionId: string): Promise<WatchSession | null> {
  if (!isRequestId(sessionId)) return null;
  const { data, error } = await db
    .from('sessions')
    .select(
      `id, status, scheduled_start, duration_hours, wallet_paid,
       tutor_profiles!sessions_tutor_id_fkey ( profiles!tutor_profiles_id_fkey ( full_name ) ),
       student_subject_enrollments ( subject_name )`,
    )
    .eq('id', sessionId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const r = data as Record<string, unknown>;
  const tutor = r.tutor_profiles as { profiles?: { full_name?: unknown } | null } | null | undefined;
  const name = tutor?.profiles?.full_name;
  return {
    id: str(r.id),
    status: str(r.status),
    scheduledStart: str(r.scheduled_start),
    durationHours: Number(r.duration_hours),
    tutorName: typeof name === 'string' && name.trim() ? name.trim() : 'Your tutor',
    subjectName: subjectOf(r),
    walletPaid: r.wallet_paid === true,
  };
}

// One look: the request, then (when a tutor has accepted) the booking. A booking that cannot be read does not hide the fact that a tutor accepted.
export async function lookAtRequest(db: WatchClient, userId: string, requestId: string): Promise<WatchView> {
  const request = await fetchWatchRequest(db, userId, requestId);
  let session: WatchSession | null | undefined;
  if (request && request.sessionId && (request.status === 'accepted' || request.status === 'cancelled')) {
    try {
      session = await fetchWatchSession(db, request.sessionId);
    } catch {
      session = null;
    }
  }
  return decideView(request, session);
}

// Card path only: the request that a card reference belongs to (the person's own). Null when there is none.
export async function fetchRequestIdByReference(db: WatchClient, userId: string, reference: string): Promise<string | null> {
  if (!isRequestId(reference)) return null;
  const { data, error } = await db
    .from('session_requests')
    .select('id')
    .eq('paystack_reference', reference)
    .eq('requested_by_profile_id', userId)
    .maybeSingle();
  if (error || !data) return null;
  const id = (data as Record<string, unknown>).id;
  return isRequestId(id) ? id : null;
}

// ---- the words --------------------------------------------------------------------------------------------------------------------------------
export const WATCH_COPY = {
  sentTitle: 'Request sent',
  waitingTitle: 'Waiting for a tutor to accept',
  confirmingTitle: 'A tutor said yes',
  confirmingBody: 'We are finishing your booking. This page will show it in a moment.',
  waitingLead: 'Your request is sent. This page updates by itself when a tutor accepts, so you can leave it open.',
  // One line per way of paying.
  waitingWallet: 'The price is on hold in your wallet. If nobody accepts in time, it goes straight back.',
  waitingFree: `${FREE_FOR_NOW_NOTICE} If nobody accepts in time, the request ends.`,
  waitingCard: 'Your request is waiting for a tutor to accept it.',
  bookedTitle: 'Your session is booked',
  bookedLead: (tutorName: string) => `${tutorName} accepted your request.`,
  bookedMeeting: 'Open My sessions for your tutor and, closer to the time, the meeting link.',
  bookedUnseenBody: 'A tutor accepted your request. Open My sessions to see who and when.',
  paidFromWallet: WALLET_COPY.sessionBadge,
  requestCancelledTitle: 'Request cancelled',
  endedTitle: 'Your request has ended',
  sessionCancelledTitle: 'This session was cancelled',
  sessionDoneTitle: 'This session is complete',
  sessionDoneBody: 'Open My sessions to rate your tutor.',
  cancelRequest: 'Cancel request',
  cancelSession: 'Cancel session',
  viewSessions: 'View my sessions',
  newRequest: 'Send a new request',
  checkNow: 'Check now',
  checking: 'Checking…',
  stopped: 'We stopped checking automatically. Press Check now, or open My sessions at any time. We will also tell you in your bell when a tutor accepts.',
  lookFailed: 'We could not check just now. We will keep trying.',
  // Confirm lines: the same sentences the Sessions page uses for a request or a session.
  cancelRequestNote: { wallet: WALLET_COPY.cancelRequestNote, free: 'Cancel this request? It is a free session, so nothing is charged.', card: 'Cancel this request? You have not been charged.' },
  cancelSessionNote: {
    wallet: WALLET_COPY.cancelNote,
    free: FREE_CANCEL_NOTE,
    card: 'Cancel this session? The payment is refunded in full to the card — once Paystack has processed it, it can take up to 10 business days to reach the account.',
  },
} as const;

export function waitingLine(mode: WatchMode): string {
  return mode === 'wallet' ? WATCH_COPY.waitingWallet : mode === 'free' ? WATCH_COPY.waitingFree : WATCH_COPY.waitingCard;
}

// "Maths · Sat 17 Oct, 14:00 SAST · 1h".
export function detailsLine(subjectName: string | null, start: string, hours: number): string {
  const when = formatSaDateTime(start);
  return [subjectName ?? 'Tutoring session', when, Number.isFinite(hours) && hours > 0 ? `${hours}h` : ''].filter(Boolean).join(' · ');
}

// "Your R240 is back in your wallet." for a wallet request; otherwise nothing was charged.
export function moneyBackSentence(request: WatchRequest): string {
  return request.paidFromWallet && request.holdRand ? `Your ${rand0(request.holdRand)} is back in your wallet.` : 'You were not charged.';
}

export function endedTitle(why: EndedWhy): string {
  return why === 'cancelled' ? WATCH_COPY.requestCancelledTitle : WATCH_COPY.endedTitle;
}

export function endedSentence(why: EndedWhy, request: WatchRequest): string {
  const lead = why === 'expired' ? 'No tutor accepted in time.' : why === 'declined' ? 'The tutor could not take this request.' : 'Your request was cancelled.';
  return `${lead} ${moneyBackSentence(request)}`;
}

// A cancelled session: who cancelled, and where the money went.
export function sessionOverSentence(view: Extract<WatchView, { kind: 'session_over' }>, mode: WatchMode): string {
  if (view.why === 'completed') return WATCH_COPY.sessionDoneBody;
  const lead = view.why === 'cancelled_by_tutor' ? 'Your tutor cancelled this session.' : 'This session was cancelled.';
  const m = payModeOf(view.request, mode);
  if (m === 'wallet' && view.request.holdRand) return `${lead} Your ${rand0(view.request.holdRand)} went back into your wallet as credit.`;
  if (m === 'free') return `${lead} It was free, so nothing was charged.`;
  return `${lead} Your payment is refunded in full.`;
}
