// Checks on the stalled-read timeout (release gate rows SA-NETWORK-01 and FUNC-STATES-01, 1 Nov 2026). Run:  npx tsx scripts/dev/read-timeout-test.ts
// Proves: which calls are cut short and which never are; that every database function in the list is STABLE (the database itself refuses a
// write inside a STABLE function) in the newest migration that defines it; that a stalled read is abandoned with the plain sentence, a quick
// one is untouched, and a write is never given a timer. The browser proof (a panel leaves "Loading…" and offers "Try again") is in
// tests/browser/signed-in.spec.ts.
import fs from 'node:fs';
import { READ_ONLY_FUNCTIONS, READ_TIMEOUT_MS, STALLED_READ_MESSAGE, isTimedRead, withReadTimeout } from '../../src/lib/readTimeout';
import { getErrorMessage } from '../../src/lib/errors';

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
};
const root = new URL('../../', import.meta.url);
const base = 'https://example-project.supabase.co';

// ---- which calls get a timer ----
check('the cap is 30 seconds', READ_TIMEOUT_MS === 30_000);
check('table reads (GET and HEAD) are timed', isTimedRead('GET', `${base}/rest/v1/notifications?select=id`) && isTimedRead('HEAD', `${base}/rest/v1/parent_student_links?select=id`));
check('every listed read-only function call is timed', READ_ONLY_FUNCTIONS.every((n) => isTimedRead('POST', `${base}/rest/v1/rpc/${n}`)));
check('a read-only function call with a query string is timed too', isTimedRead('post', `${base}/rest/v1/rpc/my_tutors?x=1`));
const writes = ['complete_session', 'cancel_session', 'set_session_meeting_link', 'request_account_closure', 'give_school_results_consent', 'add_school_result', 'tier1_start_test', 'tier1_submit_test', 'accept_current_policies', 'log_client_error', 'decline_session_request', 'set_my_date_of_birth'];
check('NO write function is timed (a write the browser abandons may still have happened)', writes.every((n) => !isTimedRead('POST', `${base}/rest/v1/rpc/${n}`)), writes.filter((n) => isTimedRead('POST', `${base}/rest/v1/rpc/${n}`)).join(', '));
check('inserts, updates, deletes and upserts on tables are never timed', ['POST', 'PATCH', 'PUT', 'DELETE'].every((m) => !isTimedRead(m, `${base}/rest/v1/session_requests`)));
check('sign-in, token refresh, storage and realtime are never timed', !isTimedRead('POST', `${base}/auth/v1/token?grant_type=password`) && !isTimedRead('GET', `${base}/auth/v1/user`) && !isTimedRead('GET', `${base}/storage/v1/object/sign/x`) && !isTimedRead('POST', `${base}/storage/v1/object/x`) && !isTimedRead('GET', `${base}/realtime/v1/websocket`));
check('the payments/rooms API (another host) is never timed', !isTimedRead('GET', 'https://tutorlage-api.example.workers.dev/api/banks'));
check('a function whose name merely starts with a listed name is not timed', !isTimedRead('POST', `${base}/rest/v1/rpc/my_tutors_remove_all`));

// ---- every listed function is STABLE in the migration that last defines it ----
const dir = new URL('supabase/migrations/', root);
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
for (const name of READ_ONLY_FUNCTIONS) {
  let header: string | null = null;
  let where = '';
  for (const f of files) {
    const text = fs.readFileSync(new URL(f, dir), 'utf8');
    for (const m of text.matchAll(new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${name}\\s*\\(([\\s\\S]*?)\\bas\\s+\\$`, 'gi'))) {
      header = m[0];
      where = f;
    }
  }
  check(`${name} is declared STABLE in its newest migration`, header !== null && /\bstable\b/i.test(header) && !/\bvolatile\b/i.test(header), header === null ? 'definition not found' : where);
}

// ---- the behaviour of the wrapper ----
type Fake = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
const stalls: Fake = (_input, init) =>
  new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal!.reason), { once: true }));

const startedAt = Date.now();
let stalled: unknown;
try {
  await withReadTimeout(stalls as typeof fetch, 60)(`${base}/rest/v1/rpc/school_results_overview`, { method: 'POST', body: '{}' });
} catch (e) {
  stalled = e;
}
const took = Date.now() - startedAt;
check('a stalled read is abandoned after the timeout, as an abort the database client does not retry', stalled instanceof DOMException && (stalled as DOMException).name === 'AbortError' && took >= 50 && took < 1000, `${took} ms`);
check('the abandoned read carries the plain sentence', (stalled as DOMException).message === STALLED_READ_MESSAGE);

let quickCalls = 0;
const quick: Fake = async () => { quickCalls += 1; return new Response('[]', { status: 200 }); };
const quickResponse = await withReadTimeout(quick as typeof fetch, 60)(`${base}/rest/v1/notifications`, { method: 'GET' });
await new Promise((r) => setTimeout(r, 120));
check('a read that answers in time is returned untouched, and no timer fires afterwards', quickResponse.status === 200 && quickCalls === 1);

let writeInit: RequestInit | undefined;
const slowWrite: Fake = (_input, init) => { writeInit = init; return new Promise((resolve) => setTimeout(() => resolve(new Response('{}', { status: 200 })), 150)); };
const sent: RequestInit = { method: 'POST', body: '{"x":1}' };
const writeResponse = await withReadTimeout(slowWrite as typeof fetch, 50)(`${base}/rest/v1/rpc/complete_session`, sent);
check('a slow WRITE is waited for: no timer, no signal added, same request object', writeResponse.status === 200 && writeInit === sent && writeInit.signal === undefined);

const outer = new AbortController();
let outerError: unknown;
const pending = withReadTimeout(stalls as typeof fetch, 5000)(`${base}/rest/v1/notifications`, { method: 'GET', signal: outer.signal }).catch((e) => { outerError = e; });
outer.abort(new DOMException('left the page', 'AbortError'));
await pending;
check('a caller that cancels its own read still cancels it', outerError instanceof DOMException && (outerError as DOMException).message === 'left the page');

// ---- the words ----
check('the database client\'s "AbortError: <sentence>" is shown as the plain sentence alone', getErrorMessage({ message: `AbortError: ${STALLED_READ_MESSAGE}` }, 'x') === STALLED_READ_MESSAGE);
check('every other error message is unchanged', getErrorMessage({ message: 'boom' }, 'x') === 'boom' && getErrorMessage(new Error('plain'), 'x') === 'plain' && getErrorMessage(42, 'fallback') === 'fallback');
check('the sentence is plain: no jargon, ends with what to do', /connection/.test(STALLED_READ_MESSAGE) && /try again/i.test(STALLED_READ_MESSAGE) && !/abort|timeout|fetch|error/i.test(STALLED_READ_MESSAGE));

// ---- wiring ----
const client = fs.readFileSync(new URL('src/lib/supabaseClient.ts', root), 'utf8');
check('the database client is built with the wrapped fetch', /global: \{ fetch: withReadTimeout\(/.test(client));

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
