// SCHEDULED PULSE (17 Nov 2026, the PM's "Option B"): the site pulse (scripts/ops/site-pulse.ts) run by a Cloudflare cron on the Worker every
// 10 minutes, mailing one person when the public site stops answering. It exists because the CEO's PC being off left nobody watching.
//
// When it writes (and only then):
//   - the first run that finds something broken after a good one;
//   - once an hour while it stays broken (a reminder, about every 60 minutes);
//   - once when it is fine again.
// A hard cap: at most MAX_MAILS_PER_DAY mails a day (UTC day, which is when Resend's own daily allowance resets). Resend is on its FREE plan
// (100 mails a day for the whole site, sign-up mail through Supabase included), so this never takes more than 24 of them. The mail says so.
//
// Where things live (nothing secret is in the repository):
//   - the address that gets the mail: the Worker secret PULSE_ALERT_TO. Not set = nothing is mailed (the run is only logged);
//   - the mail path: the Worker secrets RESEND_API_KEY and MAIL_FROM, the same ones the account-closing emails use;
//   - the memory between runs ("was it fine last time, when did I last write, how many today"): one small value in the Workers KV store bound
//     as PULSE_STATE. Without that binding nothing is mailed either (it fails quiet, never noisy), and the log says why.
// Left out of the check on purpose: the Worker's own address (this runs inside it; the outside pinger, UptimeRobot, watches it).
// It cannot see sign-up emails arriving, signed-in screens or payments (the pulse's own header says the same).
import { formatPulse, runPulse, type PulseResult } from '../scripts/ops/site-pulse';
import { mailerFromEnv } from './closeAccount';

export const MAX_MAILS_PER_DAY = 24;
// The cron runs every 10 minutes, so a reminder "an hour after the last mail" is due at the first run at least 55 minutes later.
export const REMIND_AFTER_MS = 55 * 60 * 1000;
const STATE_KEY = 'pulse:state';

export interface KvLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
}
export type SendMail = (mail: { to: string; subject: string; text: string }) => Promise<{ ok: boolean; detail?: string }>;

interface PulseState {
  ok: boolean;               // was the last run fine?
  brokenSince: number | null;
  lastMailAt: number | null;
  mailDay: string;           // the UTC day mailsToday counts (YYYY-MM-DD)
  mailsToday: number;
}

export interface ScheduledDeps {
  pulse: () => Promise<PulseResult>;
  kv: KvLike | undefined;
  sendMail: SendMail;
  to: string | undefined;
  now: number;               // milliseconds since 1970
  log?: (line: string) => void;
}

export type ScheduledOutcome =
  | { action: 'quiet'; ok: boolean }
  | { action: 'mailed'; ok: boolean; mailsToday: number }
  | { action: 'mail_failed'; ok: boolean; detail: string }
  | { action: 'capped'; ok: boolean }
  | { action: 'no_recipient'; ok: boolean }
  | { action: 'no_state'; ok: boolean };

const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

function freshState(now: number): PulseState {
  return { ok: true, brokenSince: null, lastMailAt: null, mailDay: utcDay(now), mailsToday: 0 };
}

async function loadState(kv: KvLike, now: number): Promise<PulseState> {
  try {
    const raw = await kv.get(STATE_KEY);
    if (!raw) return freshState(now);
    const s = JSON.parse(raw) as Partial<PulseState>;
    return {
      ok: s.ok !== false,
      brokenSince: typeof s.brokenSince === 'number' ? s.brokenSince : null,
      lastMailAt: typeof s.lastMailAt === 'number' ? s.lastMailAt : null,
      mailDay: typeof s.mailDay === 'string' ? s.mailDay : utcDay(now),
      mailsToday: typeof s.mailsToday === 'number' ? s.mailsToday : 0,
    };
  } catch {
    return freshState(now);
  }
}

const minutes = (ms: number) => Math.max(1, Math.round(ms / 60_000));

function mailText(kind: 'problem' | 'reminder' | 'recovered', result: PulseResult, number: number, since: number | null, now: number): string {
  const lead =
    kind === 'recovered'
      ? `The Tutorlage public site is answering again${since ? ` (it was not fine for about ${minutes(now - since)} minutes)` : ''}.`
      : kind === 'reminder'
        ? `Still broken${since ? `: the problem started about ${minutes(now - since)} minutes ago` : ''}.`
        : 'Something on the public Tutorlage site is not answering.';
  return [
    lead,
    '',
    formatPulse(result, new Date(now)),
    '',
    'What this is: an automatic check of tutorlage.com that runs every 10 minutes from Cloudflare, so it works when nobody\'s computer is on.',
    'When it writes: when something first breaks, again once an hour while it stays broken, and once when it is fine again.',
    `This is mail ${number} of ${MAX_MAILS_PER_DAY} allowed today (UTC day ${utcDay(now)}). Resend's free plan allows 100 emails a day for the whole site, sign-up emails included, so this check never sends more than ${MAX_MAILS_PER_DAY} a day.${number >= MAX_MAILS_PER_DAY ? ' THIS IS THE LAST ONE TODAY: it stays silent until midnight UTC (02:00 SAST), even if the site is still broken.' : ''}`,
    'Not covered: sign-up emails arriving, signed-in screens, payments, and the payments/rooms Worker\'s own address (the outside pinger watches that one).',
  ].join('\n');
}

export async function runScheduledPulse(deps: ScheduledDeps): Promise<ScheduledOutcome> {
  const log = deps.log ?? (() => undefined);
  let result: PulseResult;
  try {
    result = await deps.pulse();
  } catch (e) {
    result = { ok: false, checks: [{ name: 'the pulse itself', ok: false, ms: 0, detail: String((e as Error)?.message ?? e) }] };
  }
  const failing = result.checks.filter((c) => !c.ok).map((c) => c.name);
  log(`pulse ${result.ok ? 'OK' : 'PROBLEM'}: ${result.checks.length} checks${failing.length ? `, failing: ${failing.join('; ')}` : ''}`);

  if (!deps.kv) {
    log('no PULSE_STATE store bound: nothing is mailed');
    return { action: 'no_state', ok: result.ok };
  }
  const state = await loadState(deps.kv, deps.now);
  if (state.mailDay !== utcDay(deps.now)) {
    state.mailDay = utcDay(deps.now);
    state.mailsToday = 0;
  }

  // What should be said, if anything.
  let kind: 'problem' | 'reminder' | 'recovered' | null = null;
  if (result.ok && !state.ok) kind = 'recovered';
  else if (!result.ok && state.ok) kind = 'problem';
  else if (!result.ok && !state.ok && (state.lastMailAt === null || deps.now - state.lastMailAt >= REMIND_AFTER_MS)) kind = 'reminder';

  const brokenSince = result.ok ? null : state.ok ? deps.now : state.brokenSince ?? deps.now;
  const save = (next: PulseState) => deps.kv!.put(STATE_KEY, JSON.stringify(next));

  if (!kind) {
    // Nothing to say. Write only when the day rolled over (so the count restarts) and the stored value would otherwise lie.
    if (state.ok !== result.ok) await save({ ...state, ok: result.ok, brokenSince });
    return { action: 'quiet', ok: result.ok };
  }
  if (!deps.to) {
    log('no PULSE_ALERT_TO set: nothing is mailed');
    return { action: 'no_recipient', ok: result.ok };
  }
  if (state.mailsToday >= MAX_MAILS_PER_DAY) {
    log(`daily cap of ${MAX_MAILS_PER_DAY} mails reached: staying silent`);
    await save({ ...state, ok: result.ok, brokenSince });
    return { action: 'capped', ok: result.ok };
  }

  const number = state.mailsToday + 1;
  const subject =
    kind === 'recovered'
      ? 'Tutorlage site check: all fine again'
      : `Tutorlage site check: ${kind === 'reminder' ? 'STILL ' : ''}${failing.length} of ${result.checks.length} checks failing`;
  const sent = await deps.sendMail({ to: deps.to, subject, text: mailText(kind, result, number, state.brokenSince, deps.now) });
  if (!sent.ok) {
    // Not counted, and the stored state is left as it was, so the next run (10 minutes later) tries again.
    log(`mail failed: ${sent.detail ?? 'no detail'}`);
    return { action: 'mail_failed', ok: result.ok, detail: sent.detail ?? 'no detail' };
  }
  await save({ ok: result.ok, brokenSince, lastMailAt: deps.now, mailDay: state.mailDay, mailsToday: number });
  return { action: 'mailed', ok: result.ok, mailsToday: number };
}

// The Worker's scheduled event: builds the real pieces from the Worker's bindings and runs one round. Returns the outcome so it is logged.
export async function runScheduledPulseFromEnv(env: Record<string, unknown>, now: number = Date.now()): Promise<ScheduledOutcome> {
  const text = (name: string) => (typeof env[name] === 'string' ? (env[name] as string) : undefined);
  const kvBinding = env.PULSE_STATE as Partial<KvLike> | undefined;
  const kv = kvBinding && typeof kvBinding.get === 'function' && typeof kvBinding.put === 'function' ? (kvBinding as KvLike) : undefined;
  const sendMail = mailerFromEnv({ RESEND_API_KEY: text('RESEND_API_KEY'), MAIL_FROM: text('MAIL_FROM') }, (url, init) => fetch(url, init));
  const outcome = await runScheduledPulse({
    pulse: () => runPulse({ checkWorker: false }),
    kv,
    sendMail: (m) => sendMail(m) as Promise<{ ok: boolean; detail?: string }>,
    to: text('PULSE_ALERT_TO'),
    now,
    log: (line) => console.log(`[pulse] ${line}`),
  });
  console.log(`[pulse] outcome: ${JSON.stringify(outcome)}`);
  return outcome;
}
