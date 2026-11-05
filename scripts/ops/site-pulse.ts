// SITE PULSE (burst-readiness, 4 Nov 2026): "is the public site answering?" in one command, read-only, no secrets, no account.
//
//   npx tsx scripts/ops/site-pulse.ts            (or: npm run pulse)       exit code 0 = all OK, 1 = something is wrong
//   npx tsx scripts/ops/site-pulse.ts https://tutorlage.com   (another site address, e.g. a preview)
//
// It does what a visitor's browser does in the first second, using only public addresses:
//  1. the home page loads and holds the app's root element;
//  2. every script and style file the home page lists really exists (a half-finished publish, or a republish that removed a file a visitor's
//     cached page still wants, shows up here);
//  3. a sign-up address (/signup/tutor) opens the same app;
//  4. the database answers (the sign-in service's health route, and the same public read the app makes at start-up: the currency list);
//  5. the payments/rooms Worker answers (/healthz).
// The database and Worker addresses and the public (publishable) key are READ FROM THE LIVE PAGE ITSELF, exactly what every visitor's browser
// is given, so there is nothing to configure and nothing secret is touched. The key is never printed.
//
// What it CANNOT see (say so, do not guess): whether a sign-up confirmation email arrives, whether a signed-in screen works, whether a payment or
// a tutor's approval succeeds. Those need the admin app's alerts (browser crashes) and the Supabase and Resend dashboards (email).
// A failed check is tried once more after a short wait, so one dropped packet is not reported as an outage.

export interface PulseCheck { name: string; ok: boolean; ms: number; detail: string }
export interface PulseResult { ok: boolean; checks: PulseCheck[] }
export interface PulseOptions {
  site?: string;
  fetchFn?: typeof fetch;
  timeoutMs?: number;       // per request
  retryWaitMs?: number;     // wait before the one retry
  slowMs?: number;          // an answer slower than this is flagged "slow" in the detail (still OK)
}

const DEFAULT_SITE = 'https://tutorlage.com';

async function once(fetchFn: typeof fetch, url: string, init: RequestInit, timeoutMs: number): Promise<{ status: number; text: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchFn(url, { ...init, signal: controller.signal });
    const text = await res.text();
    return { status: res.status, text };
  } finally {
    clearTimeout(timer);
  }
}

export async function runPulse(options: PulseOptions = {}): Promise<PulseResult> {
  const site = (options.site ?? DEFAULT_SITE).replace(/\/+$/, '');
  const fetchFn = options.fetchFn ?? fetch;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const retryWaitMs = options.retryWaitMs ?? 2_000;
  const slowMs = options.slowMs ?? 3_000;
  const checks: PulseCheck[] = [];

  // One check = a named question that returns a detail string when fine and throws a plain sentence when not. Tried twice.
  async function check(name: string, question: () => Promise<string>): Promise<boolean> {
    const started = Date.now();
    let failure = '';
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const detail = await question();
        const ms = Date.now() - started;
        checks.push({ name, ok: true, ms, detail: ms > slowMs ? `${detail} (SLOW: ${(ms / 1000).toFixed(1)} s)` : detail });
        return true;
      } catch (e) {
        const err = e as { name?: string; message?: string };
        failure = err?.name === 'AbortError' ? `no answer within ${timeoutMs / 1000} s` : String(err?.message ?? e);
        if (attempt === 1 && retryWaitMs > 0) await new Promise((r) => setTimeout(r, retryWaitMs));
      }
    }
    checks.push({ name, ok: false, ms: Date.now() - started, detail: failure });
    return false;
  }

  let html = '';
  let keyText = '';   // the text of the scripts that can hold the public key
  const homeOk = await check('home page', async () => {
    const r = await once(fetchFn, `${site}/`, {}, timeoutMs);
    if (r.status !== 200) throw new Error(`answered ${r.status}, expected 200`);
    if (!/id="root"/.test(r.text)) throw new Error('answered 200 but the app root is missing');
    html = r.text;
    return 'loads';
  });

  const assets = [...new Set([...html.matchAll(/(?:src|href)="(\/assets\/[^"]+\.(?:js|css))"/g)].map((m) => m[1]))];
  if (homeOk) {
    await check(`script and style files (${assets.length})`, async () => {
      if (assets.length === 0) throw new Error('the home page lists no script or style file');
      const missing: string[] = [];
      let mainScript = '';
      for (const a of assets) {
        const r = await once(fetchFn, `${site}${a}`, {}, timeoutMs);
        if (r.status !== 200) missing.push(`${a.split('/').pop()} (${r.status})`);
        else if (/\/index-[^/]*\.js$/.test(a)) mainScript += r.text;
        else if (/\/vendor-supabase-[^/]*\.js$/.test(a)) mainScript += r.text;
      }
      if (missing.length) throw new Error(`not found: ${missing.join(', ')}`);
      keyText = mainScript;
      return 'all present';
    });
    await check('sign-up address /signup/tutor', async () => {
      const r = await once(fetchFn, `${site}/signup/tutor`, {}, timeoutMs);
      if (r.status !== 200) throw new Error(`answered ${r.status}, expected 200`);
      if (!/id="root"/.test(r.text)) throw new Error('answered 200 but the app root is missing');
      return 'opens the app';
    });
  }

  // The addresses a visitor's browser is allowed to talk to are written on the page itself (its content-security policy).
  const connect = /connect-src ([^;"]*)/.exec(html)?.[1].split(/\s+/) ?? [];
  const supabase = connect.find((c) => /^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(c));
  const worker = connect.find((c) => /^https:\/\/.+/.test(c) && c !== supabase && !c.startsWith('wss:'));
  const key = /sb_publishable_[A-Za-z0-9_-]{10,}/.exec(keyText)?.[0];

  if (!supabase) {
    checks.push({ name: 'database', ok: false, ms: 0, detail: homeOk ? 'the home page does not name a database address' : 'not tried: the home page did not load' });
  } else {
    await check('database: sign-in service', async () => {
      const r = await once(fetchFn, `${supabase}/auth/v1/health`, { headers: key ? { apikey: key } : {} }, timeoutMs);
      if (key) {
        if (r.status !== 200) throw new Error(`answered ${r.status}, expected 200`);
        return 'healthy';
      }
      // No key found in the page's scripts: the gateway answering 401 "No API key" still proves it is up, but nothing was read.
      if (r.status === 401) return 'gateway answers (no public key found on the page, so no read was tried)';
      throw new Error(`answered ${r.status}, expected 401 without a key`);
    });
    if (key) {
      await check('database: public read (currency list)', async () => {
        const r = await once(fetchFn, `${supabase}/rest/v1/currencies?select=code&limit=1`, { headers: { apikey: key, Authorization: `Bearer ${key}` } }, timeoutMs);
        if (r.status !== 200) throw new Error(`answered ${r.status}, expected 200`);
        if (!Array.isArray(JSON.parse(r.text))) throw new Error('answered 200 but not a list');
        return 'reads';
      });
    }
  }

  if (!worker) {
    checks.push({ name: 'payments and rooms Worker', ok: false, ms: 0, detail: homeOk ? 'the home page does not name a Worker address' : 'not tried: the home page did not load' });
  } else {
    await check('payments and rooms Worker (/healthz)', async () => {
      const r = await once(fetchFn, `${worker}/healthz`, {}, timeoutMs);
      if (r.status !== 200) throw new Error(`answered ${r.status}, expected 200`);
      if (!/"ok"\s*:\s*true/.test(r.text)) throw new Error('answered 200 but not {"ok":true}');
      return 'ok';
    });
  }

  return { ok: checks.every((c) => c.ok), checks };
}

export function formatPulse(result: PulseResult, when = new Date()): string {
  const lines = result.checks.map((c) => `${c.ok ? 'OK  ' : 'FAIL'}  ${c.name.padEnd(42)} ${(c.ms / 1000).toFixed(2).padStart(5)} s  ${c.detail}`);
  const bad = result.checks.filter((c) => !c.ok);
  const stamp = new Intl.DateTimeFormat('en-ZA', { timeZone: 'Africa/Johannesburg', dateStyle: 'medium', timeStyle: 'medium' }).format(when);
  lines.push('');
  lines.push(bad.length === 0
    ? `PULSE OK at ${stamp} (SAST): ${result.checks.length} checks passed. Not covered: sign-up emails, signed-in screens, payments.`
    : `PULSE PROBLEM at ${stamp} (SAST): ${bad.length} of ${result.checks.length} checks failed: ${bad.map((c) => c.name).join('; ')}.`);
  return lines.join('\n');
}

// Run directly (not when a test imports it).
const isMain = typeof process !== 'undefined' && process.argv[1] && /site-pulse\.(ts|js|mjs)$/.test(process.argv[1].replace(/\\/g, '/'));
if (isMain) {
  runPulse({ site: process.argv[2] }).then((result) => {
    console.log(formatPulse(result));
    process.exit(result.ok ? 0 : 1);
  });
}
