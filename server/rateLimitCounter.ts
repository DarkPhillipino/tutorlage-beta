// The Durable Object behind the Worker's shared rate limit (job P, 21 Nov 2026). One object per limiter key (visitor address + route
// + limit, built in rateLimit.ts), so all Worker copies count in the same place. SQLite-backed class (wrangler.jsonc
// `new_sqlite_classes`), which is the kind the Workers free plan allows. It keeps only a short list of call times (at most the
// route's limit, never more than 120) and wipes itself an alarm after the window has passed, so idle keys cost nothing.
//
// No Cloudflare imports: the class is the old plain shape (constructor(state), fetch(request)), so the tests run it under tsx with a
// fake `state`. Requests are serialised by Cloudflare's input gates around storage calls, so two calls never read the same list.
import { slidingWindowDecide } from './rateLimit';

export interface CounterStorageLike {
  get(key: string): Promise<unknown>;
  put(key: string, value: unknown): Promise<void>;
  deleteAll(): Promise<void>;
  setAlarm(time: number): Promise<void>;
}
export interface CounterStateLike {
  storage: CounterStorageLike;
}

const HITS_KEY = 'hits';
const WINDOW_KEY = 'window';
const MAX_WINDOW_MS = 3_600_000; // a caller cannot make an object hold on to data for more than an hour

export class RateLimitCounter {
  constructor(private readonly state: CounterStateLike, _env?: unknown, private readonly now: () => number = Date.now) {}

  async fetch(request: { url: string }): Promise<Response> {
    const url = new URL(request.url);
    const maxRequests = Number(url.searchParams.get('max'));
    const windowMs = Number(url.searchParams.get('window'));
    if (!Number.isInteger(maxRequests) || maxRequests < 1 || maxRequests > 1000 || !Number.isInteger(windowMs) || windowMs < 1 || windowMs > MAX_WINDOW_MS) {
      return Response.json({ error: 'bad limit' }, { status: 400 });
    }
    const { storage } = this.state;
    const t = this.now();
    const stored = await storage.get(HITS_KEY);
    const previous = Array.isArray(stored) ? (stored as number[]).filter((x) => typeof x === 'number') : [];
    const decision = slidingWindowDecide(previous, t, maxRequests, windowMs);
    if (decision.allowed) {
      await storage.put(HITS_KEY, decision.hits);
      await storage.put(WINDOW_KEY, windowMs);
      await storage.setAlarm(t + windowMs + 1000); // wipe once the window has passed
    }
    return Response.json({ allowed: decision.allowed, count: decision.hits.length });
  }

  // Cloudflare calls this after the window: drop old calls, and leave nothing behind if none remain.
  async alarm(): Promise<void> {
    const { storage } = this.state;
    const stored = await storage.get(HITS_KEY);
    const windowMs = Number(await storage.get(WINDOW_KEY)) || 60_000;
    const t = this.now();
    const live = (Array.isArray(stored) ? (stored as number[]) : []).filter((x) => t - x < windowMs);
    if (live.length === 0) {
      await storage.deleteAll();
      return;
    }
    await storage.put(HITS_KEY, live);
    await storage.setAlarm(t + windowMs + 1000);
  }
}
