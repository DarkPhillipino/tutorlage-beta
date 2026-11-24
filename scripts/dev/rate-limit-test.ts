// Checks on the Worker's shared rate limit (server/rateLimit.ts and server/rateLimitCounter.ts, job P, 21 Nov 2026). Run:  npx tsx scripts/dev/rate-limit-test.ts
// No Cloudflare, no network: a fake Durable Object namespace (real RateLimitCounter objects over fake storage) stands in for the binding.
// Proves: the counting rule; the 11th call in a minute is refused even when the calls land on TWO different Worker copies; a different
// address or route has its own count; the window slides; a refused call is not counted; a counter that errors or is slow lets the call through
// (and logs) while the in-memory limit still holds; the counter wipes itself after the window; the limit numbers in index.ts did not change;
// and the Worker entry exports the class and the config carries the binding and the SQLite migration.
import { readFileSync } from 'node:fs';
import type { NextFunction, Request, Response } from 'express';
import { createRateLimit, durableObjectLimiter, slidingWindowDecide, type CounterNamespaceLike, type SharedLimiter } from '../../server/rateLimit';
import { RateLimitCounter, type CounterStorageLike } from '../../server/rateLimitCounter';

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
};

// ---- the counting rule
{
  let hits: number[] = [];
  const results: boolean[] = [];
  for (let i = 0; i < 12; i++) {
    const d = slidingWindowDecide(hits, 1000 + i, 10, 60_000);
    hits = d.hits;
    results.push(d.allowed);
  }
  check('rule: the first 10 calls pass, the 11th and 12th are refused', results.slice(0, 10).every(Boolean) && !results[10] && !results[11]);
  check('rule: refused calls are not counted', hits.length === 10);
  check('rule: a call after the window passes again', slidingWindowDecide(hits, 1000 + 60_000, 10, 60_000).allowed);
  check('rule: still refused one millisecond before the oldest call leaves', !slidingWindowDecide(hits, 1000 + 59_999, 10, 60_000).allowed);
}

// ---- fake Durable Object namespace: one real RateLimitCounter per name, over a fake storage
class FakeStorage implements CounterStorageLike {
  data = new Map<string, unknown>();
  alarmAt: number | null = null;
  async get(k: string) { return this.data.get(k); }
  async put(k: string, v: unknown) { this.data.set(k, v); }
  async deleteAll() { this.data.clear(); this.alarmAt = null; }
  async setAlarm(t: number) { this.alarmAt = t; }
}
function fakeNamespace(clock: { t: number }) {
  const objects = new Map<string, { storage: FakeStorage; counter: RateLimitCounter }>();
  let calls = 0;
  const ns: CounterNamespaceLike = {
    idFromName: (name) => name,
    get: (id) => {
      const name = String(id);
      let o = objects.get(name);
      if (!o) {
        const storage = new FakeStorage();
        o = { storage, counter: new RateLimitCounter({ storage }, undefined, () => clock.t) };
        objects.set(name, o);
      }
      const obj = o;
      return { fetch: async (request: Request | string) => { calls += 1; return obj.counter.fetch({ url: typeof request === 'string' ? request : request.url }); } };
    },
  };
  return { ns, objects, calls: () => calls };
}

// ---- a tiny Express-shaped request/response, so the real middleware runs
function call(handler: ReturnType<ReturnType<typeof createRateLimit>>, ip: string, route = '/api/payments/initialize', method = 'POST') {
  return new Promise<number>((resolve) => {
    const req = { headers: { 'cf-connecting-ip': ip }, ip: '10.0.0.1', method, path: route, route: { path: route } } as unknown as Request;
    const res = { status(code: number) { resolve(code); return { json: () => undefined }; } } as unknown as Response;
    const next: NextFunction = () => resolve(200);
    void handler(req, res, next);
  });
}
async function burst(handlers: ReturnType<ReturnType<typeof createRateLimit>>[], ip: string, n: number, route?: string) {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(await call(handlers[i % handlers.length], ip, route));
  return out;
}

(async () => {
  // Two Worker copies = two separate createRateLimit() factories (each with its own in-memory maps) sharing ONE namespace.
  {
    const clock = { t: 1_000_000 };
    const world = fakeNamespace(clock);
    const limiter = durableObjectLimiter(world.ns);
    const copyA = createRateLimit({ ipHeader: 'cf-connecting-ip', now: () => clock.t, getShared: () => limiter, log: () => undefined })(10, 60_000);
    const copyB = createRateLimit({ ipHeader: 'cf-connecting-ip', now: () => clock.t, getShared: () => limiter, log: () => undefined })(10, 60_000);
    // calls alternate A, B, A, B ...: each copy only sees 5 of them, so the old per-copy limit would have let 20 through
    const codes = await burst([copyA, copyB], '41.1.1.1', 12);
    check('two copies: calls 1 to 10 pass', codes.slice(0, 10).every((c) => c === 200), codes.join(','));
    check('two copies: the 11th call in the minute is refused (429) although each copy saw only 5', codes[10] === 429, codes.join(','));
    check('two copies: the 12th is refused too', codes[11] === 429);
    const other = await call(copyA, '41.2.2.2');
    check('a different address has its own count', other === 200);
    const otherRoute = await call(copyB, '41.1.1.1', '/api/banks', 'GET');
    check('a different route has its own count for the same address', otherRoute === 200);
    clock.t += 60_001;
    const later = await burst([copyA, copyB], '41.1.1.1', 3);
    check('a minute later the address may call again (sliding window)', later.every((c) => c === 200), later.join(','));
    check('one counter object per address + route + limit', world.objects.size === 3, `objects=${world.objects.size}`);
  }

  // Same, but with the in-memory check proven to be only a subset: copy A alone cannot refuse early.
  {
    const clock = { t: 5_000_000 };
    const world = fakeNamespace(clock);
    const limiter = durableObjectLimiter(world.ns);
    const copies = [1, 2, 3].map(() => createRateLimit({ ipHeader: 'cf-connecting-ip', now: () => clock.t, getShared: () => limiter, log: () => undefined })(5, 60_000));
    const codes = await burst(copies, '41.3.3.3', 7);
    check('three copies: exactly 5 pass, then refused', codes.filter((c) => c === 200).length === 5 && codes.slice(5).every((c) => c === 429), codes.join(','));
  }

  // Fail open: counter throws
  {
    const logs: string[] = [];
    const broken: CounterNamespaceLike = { idFromName: (n) => n, get: () => ({ fetch: async () => { throw new Error('boom'); } }) };
    const limiter = durableObjectLimiter(broken, { log: (l) => logs.push(l) });
    const clock = { t: 1 };
    const h = createRateLimit({ ipHeader: null, now: () => clock.t, getShared: () => limiter, log: (l) => logs.push(l) })(3, 60_000);
    const codes = await burst([h], 'x', 5);
    check('counter errors: calls still go through (fail open) on the in-memory limit', codes.slice(0, 3).every((c) => c === 200), codes.join(','));
    check('counter errors: the in-memory limit still refuses the 4th', codes[3] === 429 && codes[4] === 429, codes.join(','));
    check('counter errors: a log line says so', logs.some((l) => l.includes('[ratelimit] shared counter unavailable') && l.includes('boom')), logs[0] ?? '');
  }
  // Fail open: counter answers an error status / nonsense
  {
    const logs: string[] = [];
    const bad: CounterNamespaceLike = { idFromName: (n) => n, get: () => ({ fetch: async () => ({ ok: false, json: async () => ({}) }) }) };
    const nonsense: CounterNamespaceLike = { idFromName: (n) => n, get: () => ({ fetch: async () => ({ ok: true, json: async () => ({ allowed: 'maybe' }) }) }) };
    check('counter answers an error: fail open', (await durableObjectLimiter(bad, { log: (l) => logs.push(l) })('k', 1, 1000)) === true);
    check('counter answers nonsense: fail open', (await durableObjectLimiter(nonsense, { log: (l) => logs.push(l) })('k', 1, 1000)) === true);
    check('both logged', logs.length === 2);
  }
  // Fail open: counter slow
  {
    const logs: string[] = [];
    const slow: CounterNamespaceLike = { idFromName: (n) => n, get: () => ({ fetch: () => new Promise(() => undefined) }) };
    const started = Date.now();
    const allowed = await durableObjectLimiter(slow, { timeoutMs: 50, log: (l) => logs.push(l) })('k', 1, 1000);
    check('counter slow: gives up after the timeout and lets the call through', allowed === true && Date.now() - started < 1000, `${Date.now() - started} ms`);
    check('counter slow: logged', logs.length === 1 && logs[0].includes('longer than 50 ms'));
  }
  // Without a binding (local `npm run server`): only the in-memory limit, same as before
  {
    const clock = { t: 1 };
    const h = createRateLimit({ ipHeader: null, now: () => clock.t, getShared: () => null as SharedLimiter | null })(2, 60_000);
    const codes = await burst([h], 'y', 3);
    check('no shared counter: the in-memory limit works alone', codes.join(',') === '200,200,429', codes.join(','));
  }
  // Limiter that throws outright must not break the route
  {
    const h = createRateLimit({ ipHeader: null, getShared: () => (async () => { throw new Error('x'); }) as SharedLimiter, log: () => undefined })(2, 60_000);
    check('a throwing limiter does not break the route', (await call(h, 'z')) === 200);
  }

  // The counter object itself
  {
    const clock = { t: 10_000 };
    const storage = new FakeStorage();
    const obj = new RateLimitCounter({ storage }, undefined, () => clock.t);
    const hit = async (max: number, win: number) => (await (await obj.fetch({ url: `https://x/hit?max=${max}&window=${win}` })).json()) as { allowed: boolean };
    await hit(2, 1000); await hit(2, 1000);
    check('counter object: third call refused', !(await hit(2, 1000)).allowed);
    check('counter object: an alarm is set past the window', storage.alarmAt === 10_000 + 1000 + 1000);
    clock.t += 1500;
    await obj.alarm();
    check('counter object: after the window the alarm wipes the storage', storage.data.size === 0 && storage.alarmAt === null);
    check('counter object: and a call passes again', (await hit(2, 1000)).allowed);
    const bad = await obj.fetch({ url: 'https://x/hit?max=0&window=1000' });
    const huge = await obj.fetch({ url: 'https://x/hit?max=5&window=99999999999' });
    check('counter object: nonsense limits are refused with 400', bad.status === 400 && huge.status === 400);
  }

  // The numbers in index.ts did not change (the router lines that carry a limit; the reference list is origin/main at 36a4406)
  {
    const src = readFileSync(new URL('../../server/index.ts', import.meta.url), 'utf8');
    const found = [...src.matchAll(/rateLimit\((\d+), 60_000\)/g)].map((m) => Number(m[1]));
    const expected = [10, 30, 30, 5, 20, 5, 10, 30, 30, 30, 120, 60, 60, 60, 6, 12, 30, 30, 8];
    // the room routes under 120 and 60 sit in two loops, so only compare the multiset of numbers, not the order
    const sorted = (a: number[]) => [...a].sort((x, y) => x - y).join(',');
    check('index.ts: every limit number is the one from origin/main', sorted(found) === sorted(expected), `found ${sorted(found)} expected ${sorted(expected)}`);
    check('index.ts: no leftover in-memory limiter of its own', !/const hits = new Map/.test(src));
    const worker = readFileSync(new URL('../../server/worker.ts', import.meta.url), 'utf8');
    check('worker.ts exports the counter class and plugs the binding in', /export \{ RateLimitCounter \}/.test(worker) && /setSharedLimiter\(durableObjectLimiter\(counters\)\)/.test(worker));
    const cfg = readFileSync(new URL('../../wrangler.jsonc', import.meta.url), 'utf8');
    check('wrangler.jsonc: binding RATE_LIMITER and SQLite migration', /"name": "RATE_LIMITER", "class_name": "RateLimitCounter"/.test(cfg) && /"new_sqlite_classes": \["RateLimitCounter"\]/.test(cfg) && !/"new_classes"/.test(cfg));
  }

  console.log(failures === 0 ? '\nALL OK' : `\n${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
})();
