// FREE SESSIONS (CEO, 2 Nov 2026): while payments are not open, a learner can send a request with no card check, a tutor can accept it and
// the session can be held and completed with no money. The switch is a database setting (system_settings.free_sessions_enabled, edited in
// the admin app), OFF by default; the booking page asks the database whether it is on. This file holds the words and the questions (it takes the
// database client as an argument so a test can hand in a fake); freeSessionsHooks.ts binds them to the app's own client. Everything here is tolerant of a database that has
// not had migration 20261102100000 applied: every question then simply answers "no" and nothing about booking changes.

// What the learner is told (CEO's words).
export const FREE_FOR_NOW_NOTICE = "Free for now: you won't be charged.";
export const FREE_FOR_NOW_DETAIL =
  'This request is sent without a card. Nobody is charged for the session, now or later.';
// What the tutor is told, before accepting and on the session (CEO's words).
export const FREE_SESSION_TUTOR_NOTICE = "Free session, you won't be paid for this one";
export const FREE_SESSION_LEARNER_BADGE = 'Free session';
// A FREE session's cancel confirmation (found 2 Nov 2026: it said the payment is "refunded to the card"). Nothing was paid, so nothing is refunded.
export const FREE_CANCEL_NOTE = 'Cancel this session? It was free, so nothing was charged and there is nothing to refund.';
export const FREE_TUTOR_CANCEL_NOTE = 'Cancel this session? It was free, so nothing is refunded or paid.';
export const FREE_WAITING_NOTE = "Your request is waiting for a tutor to accept it. It is free: you won't be charged. If nobody accepts in time it ends.";

// The few things of the Supabase client used here, so a test can hand in a fake.
interface DbError { code?: string; message?: string }
export interface FreeSessionsClient {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: DbError | null }>;
}

// Is the switch on? Any error (including "function not found" on a database without the migration) means no.
export async function fetchFreeSessionsOpen(db: FreeSessionsClient): Promise<boolean> {
  try {
    const { data, error } = await db.rpc('free_sessions_open');
    return !error && data === true;
  } catch {
    return false;
  }
}

// Sends the learner's OWN new request without a card check. Throws the database's reason when it refuses (switch off, not theirs, already sent).
export async function sendRequestFree(requestId: string, db: FreeSessionsClient): Promise<void> {
  const { error } = await db.rpc('send_request_free', { p_request_id: requestId });
  if (error) throw new Error(error.message ?? 'Could not send the request.');
}

// Which of these requests (or sessions) are free. Any error means "none are", so a screen never claims something it could not check.
async function freeIdsOf(fn: 'free_request_ids' | 'free_session_ids', ids: string[], db: FreeSessionsClient): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  try {
    const { data, error } = await db.rpc(fn, { p_ids: ids });
    if (error || !Array.isArray(data)) return new Set();
    return new Set(data.filter((x): x is string => typeof x === 'string'));
  } catch {
    return new Set();
  }
}
export const fetchFreeRequestIds = (ids: string[], db: FreeSessionsClient) => freeIdsOf('free_request_ids', ids, db);
export const fetchFreeSessionIds = (ids: string[], db: FreeSessionsClient) => freeIdsOf('free_session_ids', ids, db);
