// Checks on error tracking (release gate OPS-ERRORS-01, 20 Oct 2026): the app's cleaning, limits and quiet failure
// (src/lib/errorLog.ts), the boundary and global handlers feeding it, the admin page's helpers, and the wiring in the source.
// The database half is proven by supabase/tests/client_errors.sql. Run: npx tsx scripts/dev/error-log-test.ts
import fs from 'node:fs';
import React from 'react';
import { ErrorBoundary } from '../../src/components/ErrorBoundary';
import {
  MAX_REPORTS_PER_PAGE_LOAD, buildReport, createRpcSender, describeBrowser, installGlobalErrorLogging, isNoise, logClientError,
  maskScreenPath, resetErrorLogForTests, scrubText, setErrorScreen, setErrorSender, type ErrorReport,
} from '../../src/lib/errorLog';
import {
  describeAgo, describeWho, isMissingTable, mapClientError, summariseClientErrors,
} from '../../admin/src/lib/clientErrors';

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
};
const root = new URL('../../', import.meta.url);
const read = (p: string) => fs.readFileSync(new URL(p, root), 'utf8');
const sent: ErrorReport[] = [];
const collect = (r: ErrorReport) => { sent.push(r); };
const reset = () => { resetErrorLogForTests(); sent.length = 0; };

let strayRejections = 0;
process.on('unhandledRejection', () => { strayRejections += 1; });

// ---- cleaning -------------------------------------------------------------------------------------------------------------
const dirty = 'Failed for jane.doe@example.com token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcDEF123 id 3f2a1b4c-1111-2222-3333-444455556666'
  + ' phone 082 123 4567 key ' + 'sk_' + 'live_' + 'a'.repeat(36) + ' at https://tutorlage.example/pay?reference=SECRET123&email=x#frag end';
const clean = scrubText(dirty, 300);
check('personal data is removed from text (email, token, id, phone, key, address query)',
  !/jane\.doe|eyJ|3f2a1b4c|082 123|sk_live|SECRET123|frag/.test(clean) && ['[email]', '[token]', '[id]', '[number]'].every((m) => clean.includes(m)) && clean.includes('https://tutorlage.example/pay end'), clean);
const ordinary = "Cannot read properties of undefined (reading 'map')";
check('an ordinary message is left alone', scrubText(ordinary, 300) === ordinary);
check('text is cut to the limit', scrubText('x '.repeat(5000), 300).length <= 300 && scrubText('x '.repeat(5000), 300).length >= 299);
check('screens: the /room/ code, ids, long pieces and the query are masked',
  maskScreenPath('/tutorlage-beta/room/AB12-CD34') === '/tutorlage-beta/room/:code'
  && maskScreenPath('/x/3f2a1b4c-1111-2222-3333-444455556666/edit') === '/x/:id/edit'
  && maskScreenPath('/payment/callback?reference=SECRET123') === '/payment/callback'
  && maskScreenPath('/a/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/b') === '/a/:id/b'
  && maskScreenPath('/signup/tutor') === '/signup/tutor');
check('browser label is coarse (no versions) and tells apps from browsers',
  describeBrowser('Mozilla/5.0 (Linux; Android 13; SM-A135F) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36') === 'Chrome on Android'
  && describeBrowser('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1') === 'Safari on iOS'
  && describeBrowser('Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36 Instagram 300.0') === 'Instagram app on Android'
  && describeBrowser('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36 Edg/120') === 'Edge on Windows'
  && describeBrowser('') === null);

// ---- building a report ----------------------------------------------------------------------------------------------------------
resetErrorLogForTests();
setErrorScreen('prices');
const err = new TypeError("Cannot read properties of undefined (reading 'map') for bob@example.com");
err.stack = ['TypeError: boom', ...Array.from({ length: 20 }, (_, i) => `    at fn${i} (https://tutorlage.example/assets/index.js:1:${i + 100})`)].join('\n');
const rep = buildReport(err, 'render', { componentStack: '\n    at Prices\n    at App\n    at ErrorBoundary' }, { pathname: '/tutorlage-beta/', userAgent: 'Mozilla/5.0 (Linux; Android 13) Chrome/120 Mobile Safari/537.36' });
check('a report has the kind, a cleaned message with the error name, and the screen with the app\'s own view name',
  rep.kind === 'render' && rep.message.startsWith('TypeError: Cannot read properties') && !rep.message.includes('bob@') && rep.screen === '/tutorlage-beta/ [prices]', JSON.stringify([rep.message, rep.screen]));
check('details hold only the top 6 stack lines plus the component names, within 1500 characters',
  rep.details !== null && rep.details.length <= 1500 && (rep.details.match(/at fn/g) ?? []).length === 6 && rep.details.includes('Components:') && rep.details.includes('at Prices') && !rep.details.includes('fn7'));
check('browser is the coarse label', rep.browser === 'Chrome on Android');
check('a Supabase-style error object, a plain string and nonsense all become messages',
  buildReport({ message: 'duplicate key for x@y.co' }, 'logged').message === 'duplicate key for [email]'
  && buildReport('plain text', 'logged').message === 'plain text'
  && buildReport(undefined, 'logged').message === 'Unknown error'
  && buildReport(new Error(''), 'logged').message === 'Unknown error');
const huge = buildReport(new Error('y '.repeat(9000)), 'logged', { componentStack: 'c '.repeat(9000) }, { pathname: `/${'p'.repeat(9000)}`, userAgent: 'u '.repeat(900) });
check('huge inputs are cut to the database limits (300, 120, 1500, 80)', huge.message.length <= 300 && huge.screen.length <= 120 && (huge.details ?? '').length <= 1500 && (huge.browser ?? '').length <= 80);

// ---- logging: limits, quiet failure ---------------------------------------------------------------------------------------------
reset();
check('with no sender nothing is sent and nothing throws', logClientError(new Error('a'), 'render') === false);
setErrorSender(collect);
check('with a sender a crash is handed over once', logClientError(new Error('crash one'), 'render') === true && sent.length === 1 && sent[0].kind === 'render');
check('the same error again on the same screen is not sent again', logClientError(new Error('crash one'), 'render') === false && sent.length === 1);
for (let i = 2; i <= MAX_REPORTS_PER_PAGE_LOAD + 3; i += 1) logClientError(new Error(`crash ${i}`), 'unhandled');
check(`no more than ${MAX_REPORTS_PER_PAGE_LOAD} reports per page load, however many errors there are`, sent.length === MAX_REPORTS_PER_PAGE_LOAD, `sent ${sent.length}`);

reset();
setErrorSender(() => { throw new Error('sender broke'); });
let threw = false;
let result: boolean | null = null;
try { result = logClientError(new Error('x'), 'render'); } catch { threw = true; }
check('a sender that throws never throws out of the logger', !threw && result === false);

reset();
setErrorSender(() => Promise.reject(new Error('network down')));
logClientError(new Error('y'), 'render');
await new Promise((resolve) => setTimeout(resolve, 20));
check('a sender whose promise fails leaves no unhandled rejection', strayRejections === 0, `stray ${strayRejections}`);

reset();
setErrorSender(collect);
check('connection and browser noise is not logged from the global handlers',
  isNoise('Script error.') && isNoise('ResizeObserver loop completed with undelivered notifications.') && isNoise('TypeError: Failed to fetch') && isNoise('Load failed') && isNoise('AbortError: signal is aborted')
  && !isNoise("TypeError: Cannot read properties of undefined (reading 'x')"));
logClientError(new TypeError('Failed to fetch'), 'rejection');
check('...so a lost connection reported as a rejection is skipped', sent.length === 0);
logClientError(new TypeError('Failed to fetch'), 'render');
check('...but a screen that crashed is always logged', sent.length === 1);

// ---- the error boundary feeds it --------------------------------------------------------------------------------------------------
reset();
setErrorSender(collect);
setErrorScreen('sessions');
const originalConsole = console.error;
console.error = () => undefined;
new ErrorBoundary({ children: null }).componentDidCatch(new Error('render blew up'), { componentStack: '\n    at Sessions\n    at App' } as React.ErrorInfo);
console.error = originalConsole;
check('a crashed screen is reported with kind "render", its screen and its component names',
  sent.length === 1 && sent[0].kind === 'render' && sent[0].message === 'render blew up' && sent[0].screen.endsWith('[sessions]') && (sent[0].details ?? '').includes('at Sessions'), JSON.stringify(sent[0]?.screen));

// ---- global handlers -------------------------------------------------------------------------------------------------------------
reset();
setErrorSender(collect);
const listeners = new Map<string, (e: Event) => void>();
const fakeWindow = {
  addEventListener: (type: string, fn: (e: Event) => void) => { listeners.set(type, fn); },
  removeEventListener: (type: string) => { listeners.delete(type); },
} as unknown as Pick<Window, 'addEventListener' | 'removeEventListener'>;
const uninstall = installGlobalErrorLogging(fakeWindow);
check('both global listeners are installed', listeners.has('error') && listeners.has('unhandledrejection'));
listeners.get('error')!({ error: new Error('click handler failed'), message: 'x', filename: 'https://tutorlage.example/assets/index.js' } as unknown as Event);
listeners.get('unhandledrejection')!({ reason: { message: 'promise failed' } } as unknown as Event);
listeners.get('error')!({ error: new Error('from an extension'), message: 'x', filename: 'chrome-extension://abc/content.js' } as unknown as Event);
check('an uncaught error and an unhandled rejection are logged; a browser extension\'s error is not',
  sent.length === 2 && sent[0].kind === 'unhandled' && sent[1].kind === 'rejection' && sent[1].message === 'promise failed', JSON.stringify(sent.map((s) => s.kind)));
uninstall();
check('uninstalling removes both listeners', listeners.size === 0);
check('with no window the installer does nothing and does not throw', typeof installGlobalErrorLogging(null) === 'function');

// ---- the sender -----------------------------------------------------------------------------------------------------------------------
const calls: { fn: string; args: Record<string, unknown> }[] = [];
let mode: 'ok' | 'refuse' | 'throw' = 'ok';
const sender = createRpcSender(async (fn, args) => {
  calls.push({ fn, args });
  if (mode === 'throw') throw new Error('network');
  return { error: mode === 'refuse' ? { code: 'PGRST202', message: 'function not found' } : null };
});
const one: ErrorReport = { kind: 'render', message: 'm', screen: '/', details: null, browser: null };
await sender(one);
await sender(one);
check('the sender calls log_client_error with the five parameters and keeps going while it works',
  calls.length === 2 && calls[0].fn === 'log_client_error' && Object.keys(calls[0].args).sort().join() === 'p_browser,p_details,p_kind,p_message,p_screen');
mode = 'refuse';
await sender(one);
await sender(one);
await sender(one);
check('the first refusal (the migration is not applied) switches sending off for the page load', calls.length === 3, `calls ${calls.length}`);
const sender2 = createRpcSender(async (fn, args) => { calls.push({ fn, args }); throw new Error('offline'); });
calls.length = 0;
await sender2(one);
await sender2(one);
check('a network failure also switches it off, and nothing throws', calls.length === 1);

// ---- the admin page's helpers ---------------------------------------------------------------------------------------------------------
const row = mapClientError({
  id: 1, kind: 'render', message: 'm', screen: '/', details: null, browser: null, occurrences: 5, signed_in_occurrences: 2,
  first_seen: '2026-10-01T10:00:00Z', last_seen: '2026-10-20T10:00:00Z',
});
check('a row shows signed in and signed out counts in plain words', row.signedOut === 3 && describeWho(row) === '2 signed in, 3 signed out' && describeWho({ signedIn: 0, signedOut: 1 }) === '1 signed out');
const now = new Date('2026-10-20T12:00:00Z');
const summary = summariseClientErrors([row, { ...row, id: 2, occurrences: 1, signedIn: 0, signedOut: 1, firstSeen: '2026-10-19T10:00:00Z', lastSeen: '2026-10-19T11:00:00Z' }], now);
check('the summary counts kinds, times, kinds seen in the last day and kinds new this week', summary.kinds === 2 && summary.occurrences === 6 && summary.lastDay === 1 && summary.newThisWeek === 1, JSON.stringify(summary));
check('times read plainly', describeAgo('2026-10-20T11:59:50Z', now) === 'just now' && describeAgo('2026-10-20T11:30:00Z', now) === '30 min ago' && describeAgo('2026-10-20T07:00:00Z', now) === '5 h ago' && describeAgo('2026-10-10T12:00:00Z', now) === '10 days ago');
check('a missing table is recognised (by PostgREST, by Postgres, by message) and another error is not',
  isMissingTable({ code: 'PGRST205', message: "Could not find the table 'public.client_errors' in the schema cache" }) && isMissingTable({ code: '42P01', message: 'x' })
  && isMissingTable({ message: 'relation "client_errors" does not exist' }) && !isMissingTable({ code: '42501', message: 'permission denied for table client_errors' }) && !isMissingTable(null));

// ---- the wiring in the source ---------------------------------------------------------------------------------------------------------------
const main = read('src/main.tsx');
const boundary = read('src/components/ErrorBoundary.tsx');
const log = read('src/lib/errorLog.ts');
const senderSource = read('src/lib/errorLogSender.ts');
const queries = read('admin/src/lib/queries.ts');
const adminApp = read('admin/src/App.tsx');
const layout = read('admin/src/components/AdminLayout.tsx');
const page = read('admin/src/pages/ClientErrors.tsx');
const migration = read('supabase/migrations/20261020160000_client_errors.sql');
const code = (s: string) => s.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
check('main.tsx hands the sender over and installs the global handlers before the first render',
  /setErrorSender\(sendClientError\);\s*installGlobalErrorLogging\(\);[\s\S]*createRoot/.test(main) && main.indexOf('setErrorSender(sendClientError)') < main.indexOf('createRoot('));
check('the boundary logs through errorLog and still uses no Supabase, auth or translation', /logClientError\(error, 'render'/.test(boundary) && !/i18n|useAuth|AuthContext|supabase/i.test(code(boundary)));
check('errorLog.ts itself uses no Supabase, auth or translation (it must work when one of them broke)', !/supabase|useAuth|AuthContext|i18n/i.test(code(log)));
check('the sender is a thin wrapper on supabase.rpc', /createRpcSender\(\(fn, args\) => supabase\.rpc\(fn, args\)\)/.test(senderSource));
check('every parameter the sender sends is one the migration function takes',
  ['p_kind', 'p_message', 'p_screen', 'p_details', 'p_browser'].every((p) => migration.includes(`${p} text`) && log.includes(`${p}: report.`)));
check('the migration allows signed-out and signed-in callers to log, nothing else to write, and reads for admins only',
  /grant execute on function public\.log_client_error\(text, text, text, text, text\) to anon, authenticated/.test(migration)
  && /grant select on public\.client_errors to authenticated/.test(migration) && /is_active_admin\(\)/.test(migration) && !/for (insert|update|delete)/i.test(migration));
check('the admin app has the page, the route and the menu entry, and reads through queries.ts tolerant of the missing table',
  /path="errors"/.test(adminApp) && /to: '\/errors'/.test(layout) && /from\('client_errors'\)/.test(queries) && /isMissingTable\(error\)/.test(queries) && /not_set_up/.test(page));

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
