// OZOW PAYMENTS API CHECK (17 Nov 2026; the CEO runs it on his own computer BEFORE anything is changed on the Worker).
//
//   npx tsx scripts/ops/ozow-payments-check.ts            asks for the three things Ozow gave you, makes ONE TEST payment request at Ozow, and tells you in plain words
//                                                         whether Ozow accepts them. No money moves. Nothing is created in our system.
//   npx tsx scripts/ops/ozow-payments-check.ts --save     the same, and if Ozow accepts them it offers to store the same three values in the Worker
//                                                         (OZOW_SITE_CODE, OZOW_API_KEY, OZOW_PRIVATE_KEY) so you do not have to type them again.
//
// WHAT THE TEST PROVES: Ozow accepts the Site Code, the API Key and the Private Key together (a wrong Private Key fails Ozow's hash check), the site is active, API payments are
// switched on for it, and the amount limit on the account allows the amount we will use (R35). It makes a payment request with isTest true: Ozow's own test mode, in which the bank is
// skipped; the request is never paid and nothing is taken. It then asks Ozow's status check about that request, which proves the call the Worker's 5-minute job uses.
//
// WHAT IT NEVER DOES: it never reads the Site Code, API Key or Private Key from a file, an argument or the environment: it asks for them at a hidden prompt each run (a window you
// type in; it refuses a pipe). It never prints them, never writes them anywhere, and never sends the Private Key to anyone (it only signs with it). A reply from Ozow is reduced to its
// status code and a short code of ours (Ozow's own error text can echo your details). Every line it prints is scrubbed of anything you typed. It makes no call to our database or Worker;
// the only other thing it can run is `wrangler secret put`, and only if you passed --save, Ozow accepted the values, and you typed "save".
//
// Everything it needs from the outside comes in as `deps`, so scripts/dev/ozow-payments-check-test.ts runs it against a pretend Ozow with no network.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { OZOW_PAYMENTS_PRODUCTION_BASE, createOzowPaymentsProvider, ozowPaymentsConfigFromEnv } from '../../server/ozowPayments';

export const TEST_AMOUNT_RAND = 35;
export const SECRET_NAMES = { siteCode: 'OZOW_SITE_CODE', apiKey: 'OZOW_API_KEY', privateKey: 'OZOW_PRIVATE_KEY' } as const;

export interface ToolFetchInit { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }
export interface ToolDeps {
  fetchFn: (url: string, init: ToolFetchInit) => Promise<{ status: number; text(): Promise<string> }>;
  /** A prompt whose typing is not shown. */
  askHidden(question: string): Promise<string>;
  /** A prompt whose typing is shown (for the typed confirmation only). */
  askLine(question: string): Promise<string>;
  out(line: string): void;
  /** Hands the value to `wrangler secret put <name>` through standard input. Resolves; never throws. */
  putWorkerSecret(name: string, value: string): Promise<{ ok: boolean }>;
  now(): number;
  randomHex(bytes: number): string;
}

// What to tell the CEO for each short code (the codes are server/ozowPayments.ts's errorCodeOf and the detail of the create call).
const ADVICE: Array<[RegExp, string]> = [
  [/hash_failed/, 'Ozow says the signature (the "hash") does not match. The usual cause is the Private Key: copied with a space or a missing character, or the API Key and the Private Key swapped. Copy both again from dash.ozow.com (Merchant Details and Site) and run this again.'],
  [/credentials/, 'Ozow refused the API Key or the Site Code (it answered 401 or 403). Check that the API Key is the one for this Site Code and that the site is active on your dashboard.'],
  [/amount_limit/, 'Ozow refused the AMOUNT: the account has a limit lower than R35 (for example the R0.01 limit a new account starts with). Only Ozow can lift it: email support@ozow.com. Nothing on our side can.'],
  [/api_not_enabled/, 'Ozow has not switched on API payments for this site. Email support@ozow.com and ask them to enable API access for the site code.'],
  [/site_not_active/, 'Ozow says the site or the merchant account is not active yet. Email support@ozow.com.'],
  [/banking_details|country_or_currency|bank_reference|transaction_reference/, 'Ozow refused a detail of the request that we build ourselves. Send this whole screen to the programmer.'],
  [/duplicate_reference/, 'Ozow says that reference was used in the last 24 hours. Run this again (it makes a new one each time).'],
];

export async function runCheck(argv: string[], deps: ToolDeps): Promise<number> {
  const typed: string[] = [];
  const scrub = (line: string): string => typed.reduce((l, secret) => (secret.length >= 4 ? l.split(secret).join('[hidden]') : l), line);
  const say = (line = '') => deps.out(scrub(line));
  const known = new Set(['--save']);
  const unknown = argv.filter((a) => !known.has(a));
  if (unknown.length) {
    say(`I do not know "${unknown[0].replace(/[^A-Za-z0-9-]/g, '').slice(0, 30)}". Use no words, or --save.`);
    return 1;
  }
  const save = argv.includes('--save');

  say('Ozow Payments API check. This makes ONE TEST payment request at Ozow. No money moves and nothing is created in the Tutorlage system.');
  say('What you type is not shown on screen and is not saved anywhere.');
  say();
  let siteCode: string;
  let apiKey: string;
  let privateKey: string;
  try {
    siteCode = (await deps.askHidden('Site Code (from dash.ozow.com, Sites): ')).trim();
    typed.push(siteCode);
    apiKey = (await deps.askHidden('API Key (Merchant Details and Site): ')).trim();
    typed.push(apiKey);
    privateKey = (await deps.askHidden('Private Key (Merchant Details and Site): ')).trim();
    typed.push(privateKey);
  } catch (e) {
    say(e instanceof Error && /terminal/.test(e.message) ? e.message : 'Stopped. Nothing was sent.');
    return 1;
  }

  // The same checks the Worker makes of its settings (it refuses the same wrong shapes), so a typing slip is caught here, before Ozow is asked.
  const checked = ozowPaymentsConfigFromEnv({ OZOW_API_KEY: apiKey, OZOW_PRIVATE_KEY: privateKey, OZOW_SITE_CODE: siteCode, OZOW_RETURN_ORIGIN: 'https://tutorlage.com' });
  if (!checked.config) {
    say('Something you typed is not in the shape Ozow gives:');
    for (const p of [...checked.missing.map((m) => `${m} is empty`), ...checked.problems]) say(`  - ${p}`);
    say('Nothing was sent to Ozow. Run it again.');
    return 1;
  }
  const config = { ...checked.config, apiBase: OZOW_PAYMENTS_PRODUCTION_BASE, isTest: true }; // production's address, but a TEST request: never a real payment

  const provider = createOzowPaymentsProvider(config, deps.fetchFn, { timeoutMs: 15_000 });
  const reference = `TL-CHK${deps.randomHex(3).toUpperCase()}`;
  const topupId = [deps.randomHex(4), deps.randomHex(2), '4' + deps.randomHex(2).slice(1), '8' + deps.randomHex(2).slice(1), deps.randomHex(6)].join('-');
  say(`Asking Ozow to accept a TEST payment request of R${TEST_AMOUNT_RAND} (reference ${reference})...`);
  const made = await provider.createPayment({
    topupId,
    reference,
    amountRand: TEST_AMOUNT_RAND,
    expiresAt: new Date(deps.now() + 30 * 60_000).toISOString(),
    idempotencyKey: `check-${topupId}`,
    returnPath: `/wallet/topup-return?topup=${topupId}`,
  });
  say();
  if (made.kind !== 'created') {
    say(made.kind === 'refused' ? 'NOT ACCEPTED. Ozow refused the request.' : 'NO CLEAR ANSWER from Ozow (it did not answer, or answered something we could not read).');
    say(`  What Ozow said, as a short code: ${scrubDetail(made.detail)}`);
    const advice = ADVICE.find(([re]) => re.test(made.detail));
    say(advice ? `  What it usually means: ${advice[1]}` : made.kind === 'unclear' ? '  What to do: wait a minute and run it again. If it keeps happening, send this screen to the programmer.' : '  What to do: send this whole screen to the programmer.');
    say('Nothing was saved anywhere.');
    return 1;
  }
  say('ACCEPTED. Ozow took the test payment request. That proves:');
  say('  - the Site Code, the API Key and the Private Key work together (Ozow checked the signature),');
  say('  - the site is active and API payments are switched on for it,');
  say(`  - the account's amount limit allows R${TEST_AMOUNT_RAND}.`);
  say('No money moved. The request is never paid and expires by itself.');
  const status = await provider.checkPayment({ paymentId: made.paymentId, reference, createdAt: new Date(deps.now()).toISOString() });
  if (status.kind === 'ok') say(`Ozow's status check also answered (it holds ${status.transactions.length === 0 ? 'no transaction for that request yet, which is right' : `${status.transactions.length} transaction(s) for it`}). That is the call the Worker's 5-minute job makes.`);
  else say(`Ozow's status check did NOT answer cleanly (${scrubDetail(status.detail)}). Run this again; if it repeats, send this screen to the programmer.`);

  if (status.kind !== 'ok') return 1;
  if (!save) {
    say();
    say('To store these three values in the Worker without typing them again, run it again with --save. (Nothing has been stored.)');
    return 0;
  }
  say();
  const answer = (await deps.askLine('Type save to store the Site Code, API Key and Private Key in the Worker now (anything else stops): ')).trim().toLowerCase();
  if (answer !== 'save') {
    say('Stopped. Nothing was stored.');
    return 0;
  }
  const order: Array<[string, string]> = [[SECRET_NAMES.siteCode, siteCode], [SECRET_NAMES.apiKey, apiKey], [SECRET_NAMES.privateKey, privateKey]];
  for (const [name, value] of order) {
    const r = await deps.putWorkerSecret(name, value);
    say(r.ok ? `Stored ${name} in the Worker.` : `Could NOT store ${name} (wrangler did not finish). Nothing else was stored after it. Run: npx wrangler secret put ${name}`);
    if (!r.ok) return 1;
  }
  say('All three are stored. The Worker uses them from its next deploy.');
  return 0;
}

// Only the short parts of a detail line (status, short code, our own call number) are ever printed; the call number is ours, not Ozow's.
function scrubDetail(detail: string): string {
  return detail.replace(/[^A-Za-z0-9_ ,.():-]/g, '').slice(0, 120);
}

// ---------------------------------------------------------------- the real world (not used by the test) ----------------------------------------------------

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// What you type is not shown. Refuses to run unless this is a real terminal window (so a secret cannot be piped in from a file or another command).
function askHiddenInTerminal(question: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    if (!stdin.isTTY || typeof stdin.setRawMode !== 'function') {
      reject(new Error('Run this in a terminal window you type in. It will not read a secret from a pipe or a file (no terminal window found).'));
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

// `npx wrangler secret put <name>` with the value on standard input (wrangler reads a piped value without echoing anything). Run from the folder that holds wrangler.jsonc.
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
  runCheck(process.argv.slice(2), {
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
