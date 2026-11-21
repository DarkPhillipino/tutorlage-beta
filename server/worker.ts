// Cloudflare Workers entry for the payments API (master backlog item 1; the CEO chose Cloudflare on
// 2026-10-02 and pays for Workers Paid). Config is in wrangler.jsonc at the project root.
//
// Runs the same Express app as `npm run server`: index.ts calls app.listen(PORT), and httpServerHandler
// sends each incoming request to whatever is listening on that port (8787 unless PORT is set).
// The imports run in this order, so settings are in place before index.ts reads them.
import './worker-env';
import './index';
import { httpServerHandler } from 'cloudflare:node';
import { env as workerEnv } from 'cloudflare:workers';
import { runScheduledPulseFromEnv } from './pulseSchedule';
import { durableObjectLimiter, setSharedLimiter, type CounterNamespaceLike } from './rateLimit';
import { RateLimitCounter } from './rateLimitCounter';

// Shared rate limit (job P, 21 Nov 2026): the Durable Object namespace RATE_LIMITER (wrangler.jsonc) counts calls for every Worker copy. The class
// must be exported from this entry file for Cloudflare to find it. Without the binding the limit stays in memory per copy, as before.
export { RateLimitCounter };
const counters = (workerEnv as Record<string, unknown>).RATE_LIMITER as CounterNamespaceLike | undefined;
if (counters) setSharedLimiter(durableObjectLimiter(counters));

const handler = httpServerHandler({ port: Number(process.env.PORT) || 8787 });

// Scheduled pulse (17 Nov 2026): the cron in wrangler.jsonc ("triggers") calls this every 10 minutes. It adds the one `scheduled` method to
// the same handler object (the web requests are untouched). What it does and when it writes: server/pulseSchedule.ts.
Object.assign(handler, {
  scheduled(_controller: unknown, env: Record<string, unknown>, ctx: { waitUntil(promise: Promise<unknown>): void }) {
    ctx.waitUntil(runScheduledPulseFromEnv(env).catch((e) => console.log(`[pulse] the scheduled run failed: ${String((e as Error)?.message ?? e)}`)));
  },
});

export default handler;
