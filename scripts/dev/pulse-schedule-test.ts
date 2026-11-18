// Checks on the scheduled pulse (server/pulseSchedule.ts, 17 Nov 2026). Run:  npx tsx scripts/dev/pulse-schedule-test.ts
// No real internet, no real mail, no real Cloudflare: a fake pulse, a fake key-value store and a fake mailer. Proves: a good run says nothing;
// the first bad run mails once; a bad run within the hour is silent; an hour later it mails again; a recovery mails once; at most 24 mails a
// day and the 24th says it is the last; a failed mail is retried next run and not counted; no address or no store = no mail; the stored state
// survives; the Worker wiring answers the scheduled event; and the alert address is written nowhere in the repository.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { MAX_MAILS_PER_DAY, REMIND_AFTER_MS, runScheduledPulse, runScheduledPulseFromEnv, type KvLike, type ScheduledDeps } from '../../server/pulseSchedule';
import type { PulseResult } from '../ops/site-pulse';

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
};

const GOOD: PulseResult = { ok: true, checks: [{ name: 'home page', ok: true, ms: 100, detail: 'loads' }, { name: 'database: sign-in service', ok: true, ms: 100, detail: 'healthy' }] };
const BAD: PulseResult = { ok: false, checks: [{ name: 'home page', ok: false, ms: 100, detail: 'answered 503, expected 200' }, { name: 'database: sign-in service', ok: true, ms: 100, detail: 'healthy' }] };
const MIN = 60_000;
const T0 = Date.UTC(2026, 10, 17, 6, 0, 0); // 17 Nov 2026, 06:00 UTC

function world(opts: { to?: string | undefined; noKv?: boolean; mailFails?: boolean } = {}) {
  const store = new Map<string, string>();
  const mails: { to: string; subject: string; text: string }[] = [];
  const kv: KvLike = { get: async (k) => store.get(k) ?? null, put: async (k, v) => void store.set(k, v) };
  let next: PulseResult = GOOD;
  const logs: string[] = [];
  let mailFails = opts.mailFails ?? false;
  const round = (now: number) => {
    const deps: ScheduledDeps = {
      pulse: async () => next,
      kv: opts.noKv ? undefined : kv,
      sendMail: async (m) => {
        if (mailFails) return { ok: false, detail: 'Resend 500' };
        mails.push(m);
        return { ok: true };
      },
      to: 'to' in opts ? opts.to : 'alerts@example.invalid',
      now,
      log: (l) => logs.push(l),
    };
    return runScheduledPulse(deps);
  };
  return { round, set: (r: PulseResult) => { next = r; }, mails, store, logs, failMail: (v: boolean) => { mailFails = v; } };
}

async function main() {
  // 1. A good run says nothing, and leaves nothing behind.
  {
    const w = world();
    const o = await w.round(T0);
    check('a good run is quiet and writes nothing', o.action === 'quiet' && w.mails.length === 0 && w.store.size === 0);
  }

  // 2. Fine -> broken mails once, then stays quiet inside the hour, mails again an hour later, and mails once on recovery.
  {
    const w = world();
    await w.round(T0);
    w.set(BAD);
    const first = await w.round(T0 + 10 * MIN);
    check('the first bad run after a good one mails', first.action === 'mailed' && w.mails.length === 1);
    check('the mail names what failed and how, and the cap', /Something on the public Tutorlage site is not answering/.test(w.mails[0].text) && /home page/.test(w.mails[0].text) && /answered 503/.test(w.mails[0].text) && /mail 1 of 24 allowed today/.test(w.mails[0].text) && /never sends more than 24 a day/.test(w.mails[0].text), w.mails[0]?.text.split('\n')[0]);
    check('the subject says how many checks fail', /1 of 2 checks failing/.test(w.mails[0].subject), w.mails[0].subject);
    for (let i = 2; i <= 5; i += 1) await w.round(T0 + i * 10 * MIN);
    check('still broken inside the hour: no more mail', w.mails.length === 1, `mails ${w.mails.length}`);
    const reminder = await w.round(T0 + 10 * MIN + REMIND_AFTER_MS + 5 * MIN);
    check('still broken an hour later: one reminder', reminder.action === 'mailed' && w.mails.length === 2 && /STILL 1 of 2/.test(w.mails[1].subject) && /Still broken: the problem started about/.test(w.mails[1].text), w.mails[1]?.subject);
    w.set(GOOD);
    const rec = await w.round(T0 + 10 * MIN + REMIND_AFTER_MS + 15 * MIN);
    check('fine again: one recovery mail', rec.action === 'mailed' && w.mails.length === 3 && /all fine again/.test(w.mails[2].subject) && /answering again/.test(w.mails[2].text));
    const after = await w.round(T0 + 10 * MIN + REMIND_AFTER_MS + 25 * MIN);
    check('after the recovery a good run is quiet', after.action === 'quiet' && w.mails.length === 3);
  }

  // 3. The state is really in the store (a new Worker instance, same store, carries on).
  {
    const w = world();
    w.set(BAD);
    await w.round(T0);
    const saved = JSON.parse([...w.store.values()][0]);
    check('the stored state says broken, when it started and when it last wrote', saved.ok === false && saved.brokenSince === T0 && saved.lastMailAt === T0 && saved.mailsToday === 1, JSON.stringify(saved));
    const again = await w.round(T0 + 10 * MIN);
    check('the next run reads that state and stays quiet', again.action === 'quiet' && w.mails.length === 1);
  }

  // 4. The daily cap: 24 mails, the 24th says it is the last, nothing after it, and the count restarts at midnight UTC.
  {
    const w = world();
    let t = T0;
    let mailsSeen = 0;
    for (let i = 0; i < 40; i += 1) {
      w.set(i % 2 === 0 ? BAD : GOOD); // every run flips: fine -> broken -> fine ... each flip wants a mail
      await w.round(t);
      t += 10 * MIN;
      mailsSeen = w.mails.length;
    }
    check(`a flapping site never gets more than ${MAX_MAILS_PER_DAY} mails in a UTC day`, mailsSeen === MAX_MAILS_PER_DAY && t < Date.UTC(2026, 10, 18), `mails ${mailsSeen}`);
    check('the last allowed mail says it is the last one today', /THIS IS THE LAST ONE TODAY/.test(w.mails[MAX_MAILS_PER_DAY - 1].text) && !/THIS IS THE LAST ONE TODAY/.test(w.mails[MAX_MAILS_PER_DAY - 2].text));
    check('the capped runs say so in the log', w.logs.some((l) => /daily cap of 24 mails reached/.test(l)));
    w.set(BAD);
    await w.round(Date.UTC(2026, 10, 18, 0, 10, 0));
    check('after midnight UTC the count starts again', w.mails.length === MAX_MAILS_PER_DAY + 1 && /mail 1 of 24/.test(w.mails[MAX_MAILS_PER_DAY].text));
  }

  // 5. A failed mail is not counted and is tried again on the next run.
  {
    const w = world({ mailFails: true });
    w.set(BAD);
    const o = await w.round(T0);
    check('a failed mail is reported, not counted, and the state is not advanced', o.action === 'mail_failed' && w.store.size === 0 && w.mails.length === 0);
    w.failMail(false);
    const retry = await w.round(T0 + 10 * MIN);
    check('the next run tries again and the mail goes', retry.action === 'mailed' && w.mails.length === 1);
  }

  // 6. No address, or no store: nothing is mailed, and the log says why.
  {
    const w = world({ to: undefined });
    w.set(BAD);
    const o = await w.round(T0);
    check('no PULSE_ALERT_TO: nothing is mailed', o.action === 'no_recipient' && w.mails.length === 0 && w.logs.some((l) => /no PULSE_ALERT_TO/.test(l)));
    const n = world({ noKv: true });
    n.set(BAD);
    const o2 = await n.round(T0);
    check('no PULSE_STATE store: nothing is mailed', o2.action === 'no_state' && n.mails.length === 0 && n.logs.some((l) => /no PULSE_STATE/.test(l)));
  }

  // 7. A pulse that itself throws counts as broken (and is named), it never crashes the run.
  {
    const w = world();
    const deps: ScheduledDeps = { pulse: async () => { throw new Error('boom'); }, kv: { get: async () => null, put: async () => undefined }, sendMail: async (m) => { w.mails.push(m); return { ok: true }; }, to: 'a@example.invalid', now: T0 };
    const o = await runScheduledPulse(deps);
    check('a pulse that throws is reported as a problem, by name', o.action === 'mailed' && /the pulse itself/.test(w.mails[0].text) && /boom/.test(w.mails[0].text));
  }

  // 8. The Worker's own wiring: bindings read from the Worker's settings, the address never printed to the log.
  {
    const puts: string[] = [];
    const logged: string[] = [];
    const realLog = console.log;
    const realFetch = globalThis.fetch;
    const sent: { url: string; body: string }[] = [];
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      if (u.startsWith('https://api.resend.com/')) { sent.push({ url: u, body: String(init?.body) }); return new Response('{}', { status: 200 }); }
      return new Response('nope', { status: 503 }); // the site and everything else "down"
    }) as typeof fetch;
    console.log = (...a: unknown[]) => void logged.push(a.join(' '));
    try {
      const outcome = await runScheduledPulseFromEnv({ PULSE_STATE: { get: async () => null, put: async (_k: string, v: string) => void puts.push(v) }, PULSE_ALERT_TO: 'alerts@example.invalid', RESEND_API_KEY: 're_test', MAIL_FROM: 'Tutorlage <no-reply@example.invalid>' }, T0);
      console.log = realLog;
      check('the wiring runs one round from the Worker settings and mails through Resend', outcome.action === 'mailed' && sent.length === 1 && /"to":\["alerts@example\.invalid"\]/.test(sent[0].body), JSON.stringify(outcome));
      check('the log never contains the address', !logged.some((l) => /alerts@example/.test(l)));
      check('the worker check is left out of the scheduled pulse', !/Worker \(\/healthz\)/.test(sent[0]?.body ?? ''));
      const none = await runScheduledPulseFromEnv({}, T0);
      check('with no bindings and no secrets the wiring does nothing and does not crash', none.action === 'no_state');
    } finally {
      console.log = realLog;
      globalThis.fetch = realFetch;
    }
  }

  // 9. The alert address is a Worker secret: it must be written nowhere in the repository (CEO and PM, 17 Nov 2026).
  {
    const needle = ['tutorlage', 'ptyltd'].join(''); // built from pieces so this file does not contain it either
    const skip = new Set(['node_modules', 'dist', '.git', '.claude', 'Drake', '.wrangler', 'test-results', 'build']);
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        if (skip.has(name)) continue;
        const p = join(dir, name);
        const s = statSync(p);
        if (s.isDirectory()) walk(p);
        else if (s.size < 2_000_000 && /\.(ts|tsx|js|mjs|cjs|json|jsonc|md|html|yml|yaml|sql|txt|toml|env|example)$/i.test(name) && readFileSync(p, 'utf8').toLowerCase().includes(needle)) hits.push(p);
      }
    };
    walk('.');
    check('the alert address is not written in any file of the repository (Drake/ is private and not scanned)', hits.length === 0, hits.join(', '));
    const wrangler = readFileSync('wrangler.jsonc', 'utf8');
    check('wrangler.jsonc names the secret but holds no address, and has the cron and the store', /PULSE_ALERT_TO/.test(wrangler) && !/@/.test(wrangler.replace(/\/\/.*$/gm, '')) && /\*\/10 \* \* \* \*/.test(wrangler) && /PULSE_STATE/.test(wrangler));
  }

  console.log(failures === 0 ? '\nall checks passed' : `\n${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
