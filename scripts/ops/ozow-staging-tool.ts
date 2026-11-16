// OZOW STAGING TOOL (12 Nov 2026; sized in Drake/programmer/reports/2026-11-12-ozow-staging-prep.md, 2.7; the CEO runs it on his own computer).
//
//   npx tsx scripts/ops/ozow-staging-tool.ts <command> [--env staging|production] [more]
//
//   webhook-list                  what subscriptions Ozow holds for this client (ids, event, message type, address). Changes nothing.
//   webhook-create                makes ONE subscription: event transaction.complete, message type full, our Worker's webhook address. Looks first and
//                                 refuses to make a second (a duplicate delivers every message twice).
//   webhook-secret                reads that subscription's signing secret and hands it straight to `wrangler secret put OZOW_WEBHOOK_SECRET` through
//                                 standard input: it is never printed, never written to a file, never shown on screen.
//   webhook-delete <id>           deletes one subscription (shows what it is first and asks you to type "delete").
//   replay-check                  STAGING only: asks Ozow for the same R50 payment twice with the same Idempotency-Key and body (the second answer must be the
//                                 first payment again, not a 409 and not a second payment), then once with the same key and a different amount (must be 409).
//                                 The payments are never paid; they expire in 15 minutes. Nothing here touches our database or Worker.
//   resend <transactionId>        asks Ozow to send that transaction's notification again (test "the same webhook twice").
//   notifications <transactionId> what Ozow delivered for that transaction and what our Worker answered (status code and time only).
//
// WHAT IT NEVER DOES: it never reads the client id, client secret or site code from a file, an argument or the environment: it asks for them at a hidden
// prompt each run (a window you type in; it refuses a pipe). It never prints them, the access token, or the signing secret, and never writes any of them
// anywhere; a reply from Ozow is reduced to its status code and short error code (Ozow's own error text can echo a client id). Every line it prints is
// also scrubbed of anything you typed. It makes no call to our database and none to our Worker; the only thing it runs is `wrangler secret put`.
// --env production asks you to type "production" first. replay-check refuses production.
//
// Everything it needs from the outside comes in as `deps`, so scripts/dev/ozow-staging-tool-test.ts runs it against a pretend Ozow with no network.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const STAGING_BASE = 'https://stagingone.ozow.com/v1';
export const PRODUCTION_BASE = 'https://one.ozow.com/v1';
export const DEFAULT_ENDPOINT = 'https://tutorlage-api.pakisosetunku.workers.dev/api/wallet/webhook/ozow';
export const WORKER_SECRET_NAME = 'OZOW_WEBHOOK_SECRET';
const OZOW_HOSTS = ['one.ozow.com', 'stagingone.ozow.com'];
const TIMEOUT_MS = 15_000;

export interface ToolFetchInit { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }
export interface ToolDeps {
  fetchFn: (url: string, init: ToolFetchInit) => Promise<{ status: number; text(): Promise<string> }>;
  /** A prompt whose typing is not shown. */
  askHidden(question: string): Promise<string>;
  /** A prompt whose typing is shown (for the typed confirmations only). */
  askLine(question: string): Promise<string>;
  out(line: string): void;
  /** Hands the value to `wrangler secret put <name>` through standard input. Resolves; never throws. */
  putWorkerSecret(name: string, value: string): Promise<{ ok: boolean }>;
  now(): number;
  randomHex(bytes: number): string;
}

// A few characters of something a stranger sent, safe to print.
const clean = (value: unknown, max = 60): string => (typeof value === 'string' ? value.replace(/[^A-Za-z0-9_./:-]/g, '').slice(0, max) : '');
const asObj = (v: unknown): Record<string, unknown> | null => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const isId = (v: string): boolean => /^[0-9A-Za-z-]{8,64}$/.test(v);

interface Parsed { command: string; positional: string[]; env: 'staging' | 'production'; endpoint: string; id: string | null; problem: string | null }

export function parseArgs(argv: string[]): Parsed {
  const out: Parsed = { command: '', positional: [], env: 'staging', endpoint: DEFAULT_ENDPOINT, id: null, problem: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--env') {
      const v = argv[(i += 1)];
      if (v === 'staging' || v === 'production') out.env = v;
      else out.problem = '--env must be staging or production';
    } else if (a === '--endpoint') {
      out.endpoint = argv[(i += 1)] ?? '';
    } else if (a === '--id') {
      out.id = argv[(i += 1)] ?? null;
    } else if (a.startsWith('--')) {
      out.problem = `I do not know the option ${clean(a, 30)}`;
    } else if (!out.command) {
      out.command = a;
    } else {
      out.positional.push(a);
    }
  }
  return out;
}

const HELP = [
  'Ozow staging tool. Usage: npx tsx scripts/ops/ozow-staging-tool.ts <command> [--env staging|production]',
  '  webhook-list | webhook-create | webhook-secret | webhook-delete <id> | replay-check | resend <transactionId> | notifications <transactionId>',
  'The client id and secret are typed at a hidden prompt; nothing secret is ever printed or saved. See the top of the file for what each command does.',
];

class Stop extends Error {
  code: number;
  constructor(message: string, code = 1) {
    super(message);
    this.code = code;
  }
}

export async function runTool(argv: string[], deps: ToolDeps): Promise<number> {
  const args = parseArgs(argv);
  // Everything typed or received that is secret: every line printed is scrubbed of it (defence in depth: the tool does not print these on purpose).
  const hide = new Set<string>();
  const say = (line: string) => {
    let text = line;
    for (const s of hide) if (s.length >= 4) text = text.split(s).join('[hidden]');
    deps.out(text);
  };
  const remember = (secret: string) => {
    if (secret) hide.add(secret);
    return secret;
  };

  const COMMANDS = ['webhook-list', 'webhook-create', 'webhook-secret', 'webhook-delete', 'replay-check', 'resend', 'notifications'];
  if (!args.command || args.command === 'help' || args.command === '--help' || !COMMANDS.includes(args.command) || args.problem) {
    if (args.problem) say(args.problem);
    else if (args.command && !COMMANDS.includes(args.command) && args.command !== 'help') say(`I do not know the command ${clean(args.command, 30)}.`);
    for (const l of HELP) say(l);
    return args.command === '' || args.command === 'help' ? 0 : 2;
  }
  const base = args.env === 'production' ? PRODUCTION_BASE : STAGING_BASE;

  try {
    if (args.command === 'replay-check' && args.env === 'production') throw new Stop('replay-check only makes test payments, so it runs on staging only.', 2);
    if (args.command === 'webhook-create' || args.command === 'webhook-secret') {
      try {
        const u = new URL(args.endpoint);
        if (u.protocol !== 'https:' || u.username || u.password || u.hostname === 'localhost') throw new Error('bad');
      } catch {
        throw new Stop('--endpoint must be a public https address (Ozow refuses localhost).', 2);
      }
    }
    if ((args.command === 'webhook-delete' || args.command === 'resend' || args.command === 'notifications') && !isId(args.positional[0] ?? '')) {
      throw new Stop(`${args.command} needs the id after it.`, 2);
    }
    if (args.command === 'webhook-secret' && args.id !== null && !isId(args.id)) throw new Stop('--id is not an id.', 2);

    say(`Environment: ${args.env.toUpperCase()} (${base})`);
    if (args.env === 'production') {
      const typed = (await deps.askLine('You are about to use Ozow\'s PRODUCTION system. Type production to go on: ')).trim().toLowerCase();
      if (typed !== 'production') throw new Stop('Not confirmed. Nothing was done.', 2);
    }

    // ---- the credentials: typed, hidden, kept only in this run ----
    const askSecret = async (question: string): Promise<string> => {
      try {
        return remember((await deps.askHidden(question)).trim());
      } catch (e) {
        throw new Stop(e instanceof Error && e.message !== 'stopped' ? e.message : 'Stopped. Nothing was done.', 2);
      }
    };
    const clientId = await askSecret('Client ID (what you type is not shown): ');
    const clientSecret = await askSecret('Client secret (not shown): ');
    if (!clientId || !clientSecret) throw new Stop('The client id and the client secret are both needed.', 2);
    const siteCode = args.command === 'replay-check' ? await askSecret('Site code (not shown): ') : '';
    if (args.command === 'replay-check' && !siteCode) throw new Stop('The site code is needed.', 2);

    // ---- one call to Ozow; only the status and the short error code survive ----
    type Answer = { status: number; json: Record<string, unknown> | null; list: unknown[] | null; code: string; pointer: string };
    const call = async (method: string, apiPath: string, init: { token?: string; json?: unknown; form?: URLSearchParams; idempotencyKey?: string } = {}): Promise<Answer> => {
      const headers: Record<string, string> = { Accept: 'application/json', 'X-Correlation-ID': crypto.randomUUID() };
      if (init.token) headers.Authorization = `Bearer ${init.token}`;
      let body: string | undefined;
      if (init.form) {
        headers['Content-Type'] = 'application/x-www-form-urlencoded';
        body = init.form.toString();
      } else if (init.json !== undefined) {
        headers['Content-Type'] = 'application/json';
        body = JSON.stringify(init.json);
      }
      if (init.idempotencyKey) headers['Idempotency-Key'] = init.idempotencyKey;
      const url = `${base}${apiPath}`;
      if (!OZOW_HOSTS.includes(new URL(url).hostname)) throw new Stop('Refusing to send anything outside Ozow.', 2);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      try {
        const res = await deps.fetchFn(url, { method, headers, body, signal: controller.signal });
        const text = await res.text();
        let parsed: unknown = null;
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = null;
        }
        const json = asObj(parsed);
        const list = Array.isArray(parsed) ? parsed : Array.isArray(json?.results) ? (json?.results as unknown[]) : null;
        const pointer = clean(asObj(json?.source)?.pointer, 60);
        return { status: res.status, json, list, code: clean(json?.code, 40), pointer };
      } catch (e) {
        if (e instanceof Stop) throw e;
        throw new Stop(`Ozow could not be reached (${controller.signal.aborted ? 'no answer in time' : 'network'}). Nothing was changed.`);
      } finally {
        clearTimeout(timer);
      }
    };
    const why = (a: Answer) => `HTTP ${a.status}${a.code ? ` ${a.code}` : ''}${a.pointer ? ` (about ${a.pointer})` : ''}`;
    const tokenFor = async (scope: string): Promise<string> => {
      const a = await call('POST', '/token', { form: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, scope, grant_type: 'client_credentials' }) });
      const token = typeof a.json?.access_token === 'string' ? a.json.access_token : '';
      if (a.status !== 200 || !token) {
        throw new Stop(`Ozow would not give a "${scope}" token: ${why(a)}. ${a.status === 400 || a.status === 401 || a.status === 403 ? `Check the client id and secret, and that this client has the "${scope}" scope.` : ''}`.trim());
      }
      return remember(token);
    };
    type Hook = { id: string; endpoint: string; eventType: string; messageType: string };
    const listHooks = async (token: string): Promise<Hook[]> => {
      const a = await call('GET', '/webhooks?limit=50&offset=0', { token });
      if (a.status !== 200 || !a.list) throw new Stop(`Could not list the subscriptions: ${why(a)}.`);
      return a.list.map(asObj).filter((h): h is Record<string, unknown> => h !== null).map((h) => ({
        id: clean(h.id, 64), endpoint: typeof h.endpoint === 'string' ? h.endpoint.slice(0, 300) : '', eventType: clean(h.eventType, 40), messageType: clean(h.messageType, 10),
      }));
    };
    const describeHook = (h: Hook) => `${h.id}  event ${h.eventType}  message type ${h.messageType}  address ${h.endpoint}`;

    // ================================================================ the commands ================================================================
    if (args.command === 'webhook-list') {
      const hooks = await listHooks(await tokenFor('webhooks'));
      say(hooks.length === 0 ? 'No webhook subscriptions.' : `${hooks.length} subscription${hooks.length === 1 ? '' : 's'}:`);
      for (const h of hooks) say(`  ${describeHook(h)}`);
      return 0;
    }

    if (args.command === 'webhook-create') {
      const token = await tokenFor('webhooks');
      const hooks = await listHooks(token);
      const same = hooks.filter((h) => h.endpoint === args.endpoint && h.eventType === 'transaction.complete');
      if (same.length > 0) {
        say(`A subscription for this address and event already exists, so NOTHING was created (a second one would deliver every message twice):`);
        for (const h of same) say(`  ${describeHook(h)}`);
        if (same.some((h) => h.messageType !== 'full')) say('One of them is not message type full. Delete it with webhook-delete <id> and run webhook-create again: a thin message can never credit anything.');
        else say('Next: run webhook-secret to put its signing secret into the Worker.');
        return 2;
      }
      const a = await call('POST', '/webhooks', { token, json: { endpoint: args.endpoint, eventType: 'transaction.complete', messageType: 'full' }, idempotencyKey: `tool-webhook-${deps.randomHex(8)}` });
      const id = clean(a.json?.id, 64);
      if (!(a.status === 200 || a.status === 201) || !id) throw new Stop(`Ozow did not make the subscription: ${why(a)}.`);
      say(`Subscription made: ${id}  event transaction.complete  message type ${clean(a.json?.messageType, 10) || 'full'}`);
      say('Next: run webhook-secret to put its signing secret into the Worker.');
      return 0;
    }

    if (args.command === 'webhook-secret') {
      const token = await tokenFor('webhooks');
      let id = args.id;
      if (id === null) {
        const mine = (await listHooks(token)).filter((h) => h.endpoint === args.endpoint && h.eventType === 'transaction.complete');
        if (mine.length === 0) throw new Stop('There is no subscription for this address and event yet. Run webhook-create first.', 2);
        if (mine.length > 1) throw new Stop(`There are ${mine.length} subscriptions for this address and event. Delete the extra ones (webhook-delete <id>), or name one with --id <id>.`, 2);
        id = mine[0].id;
      }
      const a = await call('GET', `/webhooks/${encodeURIComponent(id)}/secret`, { token });
      const secret = typeof a.json?.secret === 'string' ? a.json.secret.trim() : '';
      if (a.status !== 200 || !secret) throw new Stop(`Ozow did not give the secret: ${why(a)}.`);
      remember(secret);
      const key = secret.replace(/^whsec_/, '');
      if (key.length < 8) throw new Stop('The secret Ozow gave does not look like a signing secret, so it was NOT saved.');
      const put = await deps.putWorkerSecret(WORKER_SECRET_NAME, secret);
      if (!put.ok) throw new Stop(`wrangler could not save ${WORKER_SECRET_NAME} (you may need to sign in with: npx wrangler login). The secret was not saved anywhere. Run webhook-secret again.`);
      say(`Saved into the Worker as ${WORKER_SECRET_NAME} (subscription ${clean(id, 64)}). The value was not shown and not written to any file.`);
      return 0;
    }

    if (args.command === 'webhook-delete') {
      const id = args.positional[0];
      const token = await tokenFor('webhooks');
      const hooks = await listHooks(token);
      const target = hooks.find((h) => h.id === id);
      if (!target) throw new Stop(`There is no subscription with that id. (${hooks.length} found; webhook-list shows them.)`, 2);
      say(`About to delete: ${describeHook(target)}`);
      const typed = (await deps.askLine('Type delete to go on: ')).trim().toLowerCase();
      if (typed !== 'delete') throw new Stop('Not confirmed. Nothing was deleted.', 2);
      const a = await call('DELETE', `/webhooks/${encodeURIComponent(id)}`, { token });
      if (!(a.status === 200 || a.status === 202 || a.status === 204)) throw new Stop(`Ozow did not delete it: ${why(a)}.`);
      say(`Deleted ${id}.`);
      return 0;
    }

    if (args.command === 'resend') {
      const id = args.positional[0];
      const a = await call('POST', `/transactions/${encodeURIComponent(id)}/notifications/resend`, { token: await tokenFor('payments') });
      if (a.status !== 202 && a.status !== 200) throw new Stop(`Ozow did not accept the resend: ${why(a)}.`);
      say(`Ozow accepted the resend (HTTP ${a.status}). Watch what our wallet does with it, then run notifications ${clean(id, 64)} to see what the Worker answered.`);
      return 0;
    }

    if (args.command === 'notifications') {
      const id = args.positional[0];
      const a = await call('GET', `/transactions/${encodeURIComponent(id)}/notifications`, { token: await tokenFor('payments') });
      if (a.status !== 200 || !a.list) throw new Stop(`Could not read the notifications: ${why(a)}.`);
      const rows = a.list.map(asObj).filter((r): r is Record<string, unknown> => r !== null);
      const answered = rows.filter((r) => typeof r.responseStatusCode === 'number' && r.responseStatusCode >= 200 && r.responseStatusCode < 300).length;
      say(`${rows.length} delivery attempt${rows.length === 1 ? '' : 's'}, ${answered} answered with a success (2xx):`);
      for (const r of rows) say(`  message ${clean(r.messageId, 50)}  our Worker answered ${typeof r.responseStatusCode === 'number' ? r.responseStatusCode : '?'}  at ${clean(r.timestamp, 40)}`);
      return 0;
    }

    // replay-check (staging only; checked above)
    {
      const token = await tokenFor('payments');
      const ref = `TLTEST${deps.randomHex(3).toUpperCase()}`; // letters and digits only, 12 characters: valid as both references
      const key = `tool-replay-${deps.randomHex(8)}`;
      const expireAt = new Date(deps.now() + 15 * 60_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
      const body = (rand: number) => ({
        siteCode, region: 'ZA', amount: { currency: 'ZAR', value: rand }, merchantReference: ref, beneficiaryReference: ref, expireAt, returnUrl: 'https://tutorlage.com/',
      });
      const host = (v: unknown) => { try { return new URL(String(v)).hostname; } catch { return 'no link'; } };
      const first = await call('POST', '/payments', { token, json: body(50), idempotencyKey: key });
      const firstId = clean(first.json?.id, 64);
      if (!(first.status === 200 || first.status === 201) || !firstId) throw new Stop(`Call 1 (a new key): Ozow refused: ${why(first)}. Nothing else was tried.`);
      say(`Call 1 (new key):                   HTTP ${first.status}, payment ${firstId}, status ${clean(first.json?.status, 20) || '?'}, link on ${host(first.json?.redirectUrl)}`);
      const second = await call('POST', '/payments', { token, json: body(50), idempotencyKey: key });
      const secondId = clean(second.json?.id, 64);
      const sameId = secondId !== '' && secondId === firstId;
      const sameLink = typeof second.json?.redirectUrl === 'string' && second.json.redirectUrl === first.json?.redirectUrl;
      say(`Call 2 (same key, same body):       HTTP ${second.status}${second.code ? ` ${second.code}` : ''}, payment ${secondId || 'none'} -> ${sameId ? 'the SAME payment' : 'NOT the same payment'}, link ${sameLink ? 'identical' : 'NOT identical'}`);
      const third = await call('POST', '/payments', { token, json: body(51), idempotencyKey: key });
      say(`Call 3 (same key, other amount):    HTTP ${third.status}${third.code ? ` ${third.code}` : ''}${third.status === 409 ? ' (refused as a different request, as expected)' : ''}`);
      const replayOk = (second.status === 200 || second.status === 201) && sameId && sameLink;
      const conflictOk = third.status === 409;
      say(replayOk ? 'RESULT 1: PASS. A replay of the same key and body returned the original payment (no 409, no second payment).' : 'RESULT 1: NOT AS EXPECTED. Tell the programmer exactly the three lines above.');
      say(conflictOk ? 'RESULT 2: PASS. The same key with a different body is refused with 409.' : 'RESULT 2: NOT AS EXPECTED. Tell the programmer the Call 3 line above.');
      say('The payment was never paid and expires in 15 minutes. Nothing was credited anywhere (this tool never touches our database or Worker).');
      return replayOk && conflictOk ? 0 : 1;
    }
  } catch (e) {
    if (e instanceof Stop) {
      say(e.message);
      return e.code;
    }
    say('The tool stopped on an unexpected problem. Nothing secret was printed. Tell the programmer which command you ran.');
    return 1;
  }
}

// ---------------------------------------------------------------- the real world (not used by the test) ----------------------------------------------------

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// What you type is not shown. Refuses to run unless this is a real terminal window (so a secret cannot be piped in from a file or another command).
function askHiddenInTerminal(question: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    if (!stdin.isTTY || typeof stdin.setRawMode !== 'function') {
      reject(new Error('Run this in a terminal window you type in. It will not read a secret from a pipe or a file.'));
      return;
    }
    process.stdout.write(question);
    let value = '';
    const finish = (error?: Error) => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off('data', onData);
      process.stdout.write('\n');
      if (error) reject(error);
      else resolve(value);
    };
    const onData = (chunk: Buffer) => {
      for (const ch of chunk.toString('utf8')) {
        if (ch === '\r' || ch === '\n') return finish();
        if (ch === '\u0003') return finish(new Error('stopped'));
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1);
        else if (ch >= ' ') value += ch;
      }
    };
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on('data', onData);
  });
}

function askLineInTerminal(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (answer) => { rl.close(); resolve(answer); }));
}

// `npx wrangler secret put <name>` with the value on standard input (wrangler reads a piped value without echoing anything). Run from the folder that holds
// wrangler.jsonc. The value goes nowhere else.
function putWorkerSecretWithWrangler(name: string, value: string): Promise<{ ok: boolean }> {
  return new Promise((resolve) => {
    if (!/^[A-Z][A-Z0-9_]{2,40}$/.test(name) || !fs.existsSync(path.join(REPO_ROOT, 'wrangler.jsonc'))) {
      resolve({ ok: false });
      return;
    }
    const child = spawn(`npx wrangler secret put ${name}`, { cwd: REPO_ROOT, shell: true, stdio: ['pipe', 'inherit', 'inherit'] });
    child.on('error', () => resolve({ ok: false }));
    child.on('close', (code) => resolve({ ok: code === 0 }));
    child.stdin?.write(`${value}\n`);
    child.stdin?.end();
  });
}

const invokedDirectly = process.argv[1] ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;
if (invokedDirectly) {
  runTool(process.argv.slice(2), {
    fetchFn: (url, init) => fetch(url, init),
    askHidden: askHiddenInTerminal,
    askLine: askLineInTerminal,
    out: (line) => process.stdout.write(`${line}\n`),
    putWorkerSecret: putWorkerSecretWithWrangler,
    now: Date.now,
    randomHex: (bytes) => crypto.randomBytes(bytes).toString('hex'),
  }).then(
    (code) => process.exit(code),
    () => {
      process.stdout.write('The tool stopped. Nothing secret was printed.\n');
      process.exit(1);
    },
  );
}
