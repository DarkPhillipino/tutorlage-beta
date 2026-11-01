// Stalled reads (release gate rows SA-NETWORK-01 and FUNC-STATES-01; found 1 Nov 2026): on a mobile connection that stalls, a read that never
// answers left a panel on "Loading…" for ever, with no error and no "Try again". Every READ the app makes to the database now gives up after
// READ_TIMEOUT_MS; the screen then shows its own error line and its "Try again" button, which every one of them already had for a failed read.
//
// What is cut short, and what never is:
//  - cut short: GET and HEAD calls to the database's table interface (/rest/v1/<table>), and POST calls to the database FUNCTIONS listed in
//    READ_ONLY_FUNCTIONS below (a function call is a POST, but these only read);
//  - never cut short: every other POST, PATCH, PUT and DELETE (inserts, updates, uploads, closing an account, accepting a request...), sign-in
//    and token refresh, storage, realtime. A write that the browser abandons may still have happened on the server, so the app must wait for
//    its answer. Adding a function here needs proof that it only reads: every name below is declared STABLE in its migration (the database
//    refuses to write inside a STABLE function), and `scripts/dev/read-timeout-test.ts` checks that against the migration files.

export const READ_TIMEOUT_MS = 30_000;

// The plain sentence a person sees (the database client puts "AbortError: " in front of it; getErrorMessage in errors.ts removes that).
export { STALLED_READ_MESSAGE } from './errors';
import { STALLED_READ_MESSAGE } from './errors';

// The Learn and Teach tabs' read-only function calls (and the account gate's questions). Each is STABLE in its migration.
export const READ_ONLY_FUNCTIONS = [
  'school_curricula',
  'current_policy_versions',
  'my_date_of_birth',
  'my_pending_acceptances',
  'public_tutor_reviews',
  'available_requests_for_tutor',
  'my_session_guardian_contacts',
  'my_tutors',
  'school_results_overview',
  'tier1_status',
  'tier1_module_check_questions',
  'my_police_clearance_status',
  'preview_account_closure',
] as const;

const FUNCTION_CALL = /\/rest\/v1\/rpc\/([a-z0-9_]+)(?:[?#]|$)/;

export function isTimedRead(method: string, url: string): boolean {
  const verb = method.toUpperCase();
  if (!/\/rest\/v1\//.test(url)) return false;
  if (verb === 'GET' || verb === 'HEAD') return true;
  if (verb !== 'POST') return false;
  const name = FUNCTION_CALL.exec(url)?.[1];
  return name !== undefined && (READ_ONLY_FUNCTIONS as readonly string[]).includes(name);
}

// Wraps a fetch so that the reads above are abandoned after `timeoutMs`. The database client sees an ordinary aborted request and turns it
// into the error the screen already handles (it does not retry an abort).
export function withReadTimeout(baseFetch: typeof fetch, timeoutMs: number = READ_TIMEOUT_MS): typeof fetch {
  return (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? (typeof input === 'object' && 'method' in input ? input.method : 'GET');
    if (!isTimedRead(method, url)) return baseFetch(input, init);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new DOMException(STALLED_READ_MESSAGE, 'AbortError')), timeoutMs);
    const outer = init?.signal;
    if (outer) {
      if (outer.aborted) controller.abort(outer.reason);
      else outer.addEventListener('abort', () => controller.abort(outer.reason), { once: true });
    }
    // The timer stops when the answer's headers arrive (or the call fails): a body that is slow to finish is not a stalled call.
    return baseFetch(input, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
  };
}
