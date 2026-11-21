// The Worker's rate limit (OWASP review finding 1, job P, 21 Nov 2026).
//
// Before: each copy of the Worker kept its own in-memory counts, so a caller whose requests landed on several copies got
// several times the limit. Now every request is ALSO counted in a Durable Object (one object per limiter key: visitor address
// plus route), which every copy asks, so the limit is shared. The in-memory count stays as the first, cheap check: it only
// ever counts a subset of the shared count, so it can refuse a call the shared counter would also refuse, never a call the
// shared counter would allow. Nothing in here makes a limit looser; the numbers in index.ts are unchanged.
//
// FAIL OPEN: if the shared counter errors, is missing or takes longer than SHARED_TIMEOUT_MS, the request is let through (with a
// log line) and only the in-memory limit applies, as before. The money routes are also protected by the token, the signature and
// the database rules, so a counter outage must not take payments down.
//
// No Cloudflare imports here (so the tests can run it under tsx); the Durable Object class is in rateLimitCounter.ts and the
// binding is plugged in by worker.ts through setSharedLimiter().
import type { NextFunction, Request, RequestHandler, Response } from 'express';

/** The counting rule, pure: given the times of the calls already allowed, decide on one more call at `now`. */
export function slidingWindowDecide(
  hits: readonly number[],
  now: number,
  maxRequests: number,
  windowMs: number,
): { allowed: boolean; hits: number[] } {
  const recent = hits.filter((t) => now - t < windowMs && t <= now);
  if (recent.length >= maxRequests) return { allowed: false, hits: recent }; // a refused call is not counted (as before)
  recent.push(now);
  return { allowed: true, hits: recent };
}

/** Asks the shared counter. Resolves true = allowed, false = refused. Never rejects: on trouble it logs and resolves true. */
export type SharedLimiter = (key: string, maxRequests: number, windowMs: number) => Promise<boolean>;

export const SHARED_TIMEOUT_MS = 400;

let shared: SharedLimiter | null = null;
/** worker.ts plugs the Durable Object in here; local `npm run server` never does, so it keeps the in-memory limit only. */
export function setSharedLimiter(limiter: SharedLimiter | null): void {
  shared = limiter;
}

// The shape of the one thing we use from a Durable Object namespace binding.
export interface CounterNamespaceLike {
  idFromName(name: string): unknown;
  get(id: unknown): { fetch(request: Request | string, init?: RequestInit): Promise<{ ok: boolean; json(): Promise<unknown> }> };
}

/** The shared limiter backed by a Durable Object namespace. */
export function durableObjectLimiter(
  ns: CounterNamespaceLike,
  opts: { timeoutMs?: number; log?: (line: string) => void } = {},
): SharedLimiter {
  const timeoutMs = opts.timeoutMs ?? SHARED_TIMEOUT_MS;
  const log = opts.log ?? ((line: string) => console.log(line));
  return async (key, maxRequests, windowMs) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const stub = ns.get(ns.idFromName(key));
      const call = stub
        .fetch(`https://rate-limit.internal/hit?max=${maxRequests}&window=${windowMs}`, { method: 'POST' })
        .then(async (r) => {
          if (!r.ok) throw new Error(`counter answered an error`);
          const body = (await r.json()) as { allowed?: unknown };
          if (typeof body?.allowed !== 'boolean') throw new Error('counter answer not understood');
          return body.allowed;
        });
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`counter took longer than ${timeoutMs} ms`)), timeoutMs);
      });
      return await Promise.race([call, timeout]);
    } catch (e) {
      log(`[ratelimit] shared counter unavailable, letting the request through on the in-memory limit: ${String((e as Error)?.message ?? e)}`);
      return true;
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
}

export interface RateLimitOptions {
  /** Name of the request header that holds the visitor's address (Cloudflare: cf-connecting-ip), or null to use req.ip. */
  ipHeader: string | null;
  now?: () => number;
  /** Test hook; defaults to whatever worker.ts plugged in through setSharedLimiter(). */
  getShared?: () => SharedLimiter | null;
  log?: (line: string) => void;
}

/** The visitor's address as the limiter sees it. */
export function callerAddress(req: Request, ipHeader: string | null): string {
  const forwarded = ipHeader ? req.headers[ipHeader] : undefined;
  return (typeof forwarded === 'string' && forwarded) || req.ip || 'unknown';
}

/** The route class: method plus the route pattern (so /api/rooms/ABC/join and /api/rooms/XYZ/join share one counter per visitor). */
function routeClass(req: Request): string {
  const pattern = typeof req.route?.path === 'string' ? req.route.path : req.path;
  return `${req.method} ${pattern}`;
}

export function createRateLimit(opts: RateLimitOptions) {
  const now = opts.now ?? Date.now;
  const getShared = opts.getShared ?? (() => shared);
  const log = opts.log ?? ((line: string) => console.log(line));
  return function rateLimit(maxRequests: number, windowMs: number): RequestHandler {
    const hits = new Map<string, number[]>(); // this copy's own counts: the cheap first check and the fail-open fallback
    const tooMany = (res: Response) =>
      void res.status(429).json({ error: 'Too many requests — please slow down and try again shortly.' });
    return async (req: Request, res: Response, next: NextFunction) => {
      try {
        const address = callerAddress(req, opts.ipHeader);
        const t = now();
        const local = slidingWindowDecide(hits.get(address) ?? [], t, maxRequests, windowMs);
        hits.set(address, local.hits);
        if (!local.allowed) return tooMany(res);
        const limiter = getShared();
        if (limiter) {
          // One counter per address, route and limit (the limit is in the key so a number change never reuses old counts).
          const key = `${address}|${routeClass(req)}|${maxRequests}/${windowMs}`;
          const allowed = await limiter(key, maxRequests, windowMs);
          if (!allowed) return tooMany(res);
        }
        next();
      } catch (e) {
        // Never let the limiter itself take a route down.
        log(`[ratelimit] limiter error, letting the request through: ${String((e as Error)?.message ?? e)}`);
        next();
      }
    };
  };
}
