// Checks on the site pulse (scripts/ops/site-pulse.ts, burst-readiness 4 Nov 2026). Run:  npx tsx scripts/dev/site-pulse-test.ts
// A fake internet, no real request. Proves: all good = OK; a missing script file, a failing database, a failing Worker and a hanging
// server are each reported by name; one dropped answer is retried and not reported; the public key is used but never printed; a page
// with no key still checks the gateway; the exit-code summary lines read plainly.
import { formatPulse, runPulse } from '../ops/site-pulse';

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
};

const SITE = 'https://site.test';
const DB = 'https://abcdefgh.supabase.co';
const API = 'https://api-worker.example.workers.dev';
const KEY = 'sb_publishable_ABCDEFGHIJKLMNOP0123456789';
const HOME = `<html><head><meta http-equiv="Content-Security-Policy" content="default-src 'self'; connect-src 'self' ${DB} wss://abcdefgh.supabase.co ${API}" />
<script type="module" src="/assets/index-AAA.js"></script><link rel="modulepreload" href="/assets/vendor-react-BBB.js"><link rel="modulepreload" href="/assets/vendor-supabase-CCC.js">
<link rel="stylesheet" href="/assets/index-DDD.css"></head><body><div id="root"></div></body></html>`;

type Reply = { status: number; body?: string } | 'hang' | 'drop';
type Route = Reply | (() => Reply);
function fakeInternet(overrides: Record<string, Route> = {}, opts: { noKey?: boolean } = {}) {
  const calls: { url: string; apikey: string | null }[] = [];
  const table: Record<string, Route> = {
    [`${SITE}/`]: { status: 200, body: HOME },
    [`${SITE}/assets/index-AAA.js`]: { status: 200, body: opts.noKey ? 'console.log(1)' : `const k="${KEY}";` },
    [`${SITE}/assets/vendor-react-BBB.js`]: { status: 200, body: 'react' },
    [`${SITE}/assets/vendor-supabase-CCC.js`]: { status: 200, body: 'supabase' },
    [`${SITE}/assets/index-DDD.css`]: { status: 200, body: 'css' },
    [`${SITE}/signup/tutor`]: { status: 200, body: HOME },
    [`${DB}/auth/v1/health`]: { status: 200, body: '{"name":"GoTrue"}' },
    [`${DB}/rest/v1/currencies?select=code&limit=1`]: { status: 200, body: '[{"code":"ZAR"}]' },
    [`${API}/healthz`]: { status: 200, body: '{"ok":true}' },
    ...overrides,
  };
  const fetchFn = (async (url: string, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ url, apikey: headers.apikey ?? null });
    const route = table[url];
    if (!route) return new Response('not found', { status: 404 });
    const reply = typeof route === 'function' ? route() : route;
    if (reply === 'drop') throw new TypeError('fetch failed');
    if (reply === 'hang') {
      return new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
    }
    // Without a key the database gateway answers 401, as the real one does.
    if (url === `${DB}/auth/v1/health` && !headers.apikey) return new Response('{"message":"No API key found in request"}', { status: 401 });
    return new Response(reply.body ?? '', { status: reply.status });
  }) as unknown as typeof fetch;
  return { fetchFn, calls };
}
const run = (fetchFn: typeof fetch) => runPulse({ site: SITE, fetchFn, timeoutMs: 60, retryWaitMs: 1 });
const failedNames = (r: Awaited<ReturnType<typeof run>>) => r.checks.filter((c) => !c.ok).map((c) => c.name);

async function main() {
  // ---- everything fine ----
  {
    const net = fakeInternet();
    const r = await run(net.fetchFn);
    check('all good: OK, 6 checks', r.ok && r.checks.length === 6, r.checks.map((c) => `${c.name}:${c.ok}`).join(' '));
    check('the database address and the Worker address were read from the page, not typed in', net.calls.some((c) => c.url === `${DB}/auth/v1/health`) && net.calls.some((c) => c.url === `${API}/healthz`));
    check('the public key from the page was used for the database', net.calls.filter((c) => c.url.startsWith(DB)).every((c) => c.apikey === KEY));
    const text = formatPulse(r, new Date('2026-11-04T10:00:00Z'));
    check('the key is never printed', !text.includes(KEY) && !text.includes('sb_publishable_'));
    check('the summary line says OK and what is not covered', /PULSE OK at .*6 checks passed\. Not covered: sign-up emails/.test(text), text.split('\n').pop());
    check('the time is shown in South African time', /12:00:00 \(SAST\)/.test(text));
  }

  // ---- a half-finished publish: the page names a file that is not there ----
  {
    const r = await run(fakeInternet({ [`${SITE}/assets/vendor-react-BBB.js`]: { status: 404 } }).fetchFn);
    const f = r.checks.find((c) => !c.ok);
    check('a missing script file is reported by file name', !r.ok && !!f && /vendor-react-BBB\.js \(404\)/.test(f.detail), f?.detail);
  }

  // ---- the database fails ----
  {
    const r = await run(fakeInternet({ [`${DB}/auth/v1/health`]: { status: 503 } }).fetchFn);
    check('a failing database sign-in service is reported', !r.ok && failedNames(r).includes('database: sign-in service'));
    const r2 = await run(fakeInternet({ [`${DB}/rest/v1/currencies?select=code&limit=1`]: { status: 500 } }).fetchFn);
    check('a failing public read is reported', !r2.ok && failedNames(r2).includes('database: public read (currency list)'));
  }

  // ---- the Worker fails or hangs ----
  {
    const r = await run(fakeInternet({ [`${API}/healthz`]: { status: 502 } }).fetchFn);
    check('a failing Worker is reported', !r.ok && failedNames(r).join() === 'payments and rooms Worker (/healthz)');
    const r2 = await run(fakeInternet({ [`${API}/healthz`]: 'hang' }).fetchFn);
    const f2 = r2.checks.find((c) => !c.ok);
    check('a Worker that never answers is cut off and reported as no answer', !r2.ok && /no answer within/.test(f2?.detail ?? ''), f2?.detail);
    const r3 = await run(fakeInternet({ [`${SITE}/`]: 'drop' }).fetchFn);
    check('a home page that cannot be reached is reported, and the rest says it was not tried', !r3.ok && failedNames(r3)[0] === 'home page' && r3.checks.some((c) => /not tried: the home page did not load/.test(c.detail)));
  }

  // ---- one dropped answer is not an outage ----
  {
    let n = 0;
    const r = await run(fakeInternet({ [`${API}/healthz`]: () => (++n === 1 ? 'drop' : { status: 200, body: '{"ok":true}' }) }).fetchFn);
    check('one dropped answer is retried and the check passes', r.ok && n === 2, `answers asked for: ${n}`);
    let m = 0;
    const r2 = await run(fakeInternet({ [`${API}/healthz`]: () => { m += 1; return 'drop'; } }).fetchFn);
    check('two dropped answers in a row are reported (tried exactly twice)', !r2.ok && m === 2, `answers asked for: ${m}`);
  }

  // ---- a page with no public key in its scripts ----
  {
    const net = fakeInternet({}, { noKey: true });
    const r = await run(net.fetchFn);
    check('no key found: the gateway answering 401 still counts, and no read is tried', r.ok && r.checks.length === 5 && /no public key found/.test(r.checks.find((c) => c.name === 'database: sign-in service')?.detail ?? ''));
    check('no key found: nothing was sent with a key', net.calls.every((c) => c.apikey === null));
  }

  // ---- slow answers are flagged but not failed ----
  {
    const slow = (async (url: string, init?: RequestInit) => {
      if (url === `${API}/healthz`) await new Promise((r) => setTimeout(r, 25));
      return fakeInternet().fetchFn(url, init);
    }) as unknown as typeof fetch;
    const r = await runPulse({ site: SITE, fetchFn: slow, timeoutMs: 500, retryWaitMs: 1, slowMs: 10 });
    check('a slow answer is flagged SLOW but still OK', r.ok && /SLOW/.test(r.checks.find((c) => c.name.startsWith('payments'))?.detail ?? ''));
  }

  // ---- the problem summary ----
  {
    const r = await run(fakeInternet({ [`${API}/healthz`]: { status: 502 }, [`${DB}/auth/v1/health`]: { status: 503 } }).fetchFn);
    const text = formatPulse(r);
    check('the problem line names how many failed and which', /PULSE PROBLEM at .*2 of 6 checks failed: database: sign-in service; payments and rooms Worker/.test(text), text.split('\n').pop());
  }

  console.log(failures === 0 ? '\nall checks passed' : `\n${failures} FAIL`);
  process.exit(failures === 0 ? 0 : 1);
}
main();
