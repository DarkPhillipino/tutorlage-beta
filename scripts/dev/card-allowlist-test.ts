// Checks on the card allowlist (16 Nov 2026, CEO rule: the Paystack TEST card is for the review accounts and the CEO's own sign-in only). Run:
//   npx tsx scripts/dev/card-allowlist-test.ts
// Four parts: (1) the Worker's decision function, (2) the booking page's question, (3) the REAL Worker (server/index.ts) started as a child process
// against a pretend database on a local port: a person who may not pay by card is refused before anything is sent to Paystack, and a payer who may no longer
// pay by card is not charged on a tutor's accept, (4) what the page and the files say. Nothing here touches dev or production; no real key or Paystack call.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { CARD_CHECK_UNAVAILABLE_MESSAGE, CARD_NOT_OPEN_MESSAGE, cardCheckoutDecision } from '../../server/cardCheckout';
import { CARD_CLOSED_COPY, fetchCardAllowed } from '../../src/lib/cardCheckout';

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
};
const root = new URL('../../', import.meta.url);
const read = (p: string) => fs.readFileSync(new URL(p, root), 'utf8');

// ---- 1. the Worker's decision -----------------------------------------------------------------------------------------------------------------
async function decisionTests() {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const dbWith = (data: unknown, error: { message: string } | null = null, boom = false) => ({
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      if (boom) throw new Error('network down');
      return { data, error };
    },
  });
  const yes = await cardCheckoutDecision(dbWith(true), 'u-1');
  check('1a. only an exact true opens the door, asked of the database as card_checkout_allowed with that person', yes.allowed === true && calls[0]?.name === 'card_checkout_allowed' && calls[0]?.args.p_profile === 'u-1');
  for (const odd of [false, null, undefined, 'true', 1, 'yes', {}, [true]]) {
    const d = await cardCheckoutDecision(dbWith(odd), 'u-1');
    check(`1b. an answer of ${JSON.stringify(odd) ?? 'undefined'} is a refusal (403, plain words)`, d.allowed === false && d.status === 403 && d.code === 'card_not_open' && d.error === CARD_NOT_OPEN_MESSAGE);
  }
  const err = await cardCheckoutDecision(dbWith(true, { message: 'function does not exist' }), 'u-1');
  check('1c. a database error is a refusal, never an opening (503, and the database words are not passed on)', err.allowed === false && err.status === 503 && err.error === CARD_CHECK_UNAVAILABLE_MESSAGE && !/function/.test(err.error));
  const boom = await cardCheckoutDecision(dbWith(true, null, true), 'u-1');
  check('1d. a lost connection is a refusal (503)', boom.allowed === false && boom.status === 503);
  const none = await cardCheckoutDecision(dbWith(true), null);
  const before = calls.length;
  check('1e. no person is a refusal and the database is not even asked', none.allowed === false && none.status === 403 && calls.length === before);
  check('1f. the words said to a refused person name no provider and no test', !/paystack|test|card check/i.test(CARD_NOT_OPEN_MESSAGE) && /wallet/i.test(CARD_NOT_OPEN_MESSAGE));
}

// ---- 2. the booking page's question -------------------------------------------------------------------------------------------------------------
async function pageQuestionTests() {
  const dbWith = (data: unknown, error: unknown = null, boom = false) => ({
    rpc: async (name: string) => {
      if (name !== 'card_checkout_available') throw new Error(`asked ${name}`);
      if (boom) throw new Error('down');
      return { data, error };
    },
  });
  check('2a. true opens the card', (await fetchCardAllowed(dbWith(true) as never)) === true);
  check('2b. false keeps it closed', (await fetchCardAllowed(dbWith(false) as never)) === false);
  check('2c. an error, an odd answer or a lost connection keeps it closed', !(await fetchCardAllowed(dbWith(true, { message: 'x' }) as never)) && !(await fetchCardAllowed(dbWith('true') as never)) && !(await fetchCardAllowed(dbWith(null) as never)) && !(await fetchCardAllowed(dbWith(true, null, true) as never)));
  check('2d. the words for a person who may not pay by card name no provider and no test card', !/paystack|test|card/i.test(Object.values(CARD_CLOSED_COPY).join(' ')));
}

// ---- 3. the real Worker against a pretend database -----------------------------------------------------------------------------------------------
interface Fake { url: string; log: string[]; setup: (s: { allowed?: Record<string, boolean>; rpcError?: boolean; requests?: Record<string, { requested_by_profile_id: string; payment_status: string }> }) => void; stop: () => Promise<void> }
async function startFakeDatabase(): Promise<Fake> {
  const log: string[] = [];
  let st: Parameters<Fake['setup']>[0] = {};
  const users: Record<string, { id: string; email: string }> = {
    'token-normal': { id: 'normal-0001', email: 'normal.person@example.com' },
    'token-staff': { id: 'staff-0001', email: 'staff.person@example.com' },
    'token-tutor': { id: 'tutor-0001', email: 'tutor.person@example.com' },
  };
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const url = new URL(req.url ?? '/', 'http://x');
      const body = Buffer.concat(chunks).toString('utf8');
      const json = (code: number, value: unknown) => {
        res.writeHead(code, { 'content-type': 'application/json' });
        res.end(JSON.stringify(value));
      };
      if (url.pathname === '/auth/v1/user') {
        const token = String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
        const u = users[token];
        if (!u) return json(401, { msg: 'bad token', code: 401 });
        return json(200, { id: u.id, email: u.email, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' });
      }
      if (url.pathname.startsWith('/rest/v1/rpc/')) {
        const name = url.pathname.slice('/rest/v1/rpc/'.length);
        const args = body ? JSON.parse(body) : {};
        log.push(`rpc ${name} ${JSON.stringify(args)}`);
        if (name === 'card_checkout_allowed') {
          if (st.rpcError) return json(404, { code: 'PGRST202', message: 'Could not find the function', details: null, hint: null });
          return json(200, st.allowed?.[String(args.p_profile)] === true);
        }
        if (name === 'claim_session_request') return json(200, { mode: 'already_paid', session_id: 'sess-0001' });
        return json(200, null);
      }
      if (url.pathname === '/rest/v1/session_requests') {
        log.push(`select session_requests ${url.search}`);
        const id = /(?:^|&)id=eq\.([^&]+)/.exec(url.search.slice(1))?.[1];
        const row = id ? st.requests?.[decodeURIComponent(id)] : undefined;
        const wantsObject = String(req.headers.accept ?? '').includes('pgrst.object');
        if (wantsObject) return row ? json(200, row) : json(406, { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: 'The result contains 0 rows', hint: null });
        return json(200, row ? [row] : []);
      }
      log.push(`other ${req.method} ${url.pathname}`);
      return json(200, []);
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  return { url: `http://127.0.0.1:${port}`, log, setup: (s) => { st = s; log.length = 0; }, stop: () => new Promise((r) => server.close(() => r())) };
}

async function startWorker(databaseUrl: string): Promise<{ base: string; stop: () => void; output: () => string }> {
  const port = 20000 + Math.floor(Math.random() * 20000);
  let out = '';
  const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
    cwd: new URL('../../', import.meta.url),
    env: {
      ...process.env,
      PORT: String(port),
      SUPABASE_URL: databaseUrl,
      VITE_SUPABASE_URL: databaseUrl,
      SUPABASE_SERVICE_ROLE_KEY: 'not-a-real-service-key-for-the-test',
      PAYSTACK_SECRET_KEY: 'not-a-real-paystack-key-for-the-test',
      ALLOWED_ORIGINS: 'http://localhost:3000',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  const base = `http://127.0.0.1:${port}`;
  const started = Date.now();
  for (;;) {
    if (Date.now() - started > 30000) { child.kill(); throw new Error(`the Worker did not start: ${out.slice(-500)}`); }
    try {
      const r = await fetch(`${base}/healthz`);
      if (r.ok) break;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  return { base, stop: () => child.kill(), output: () => out };
}

async function workerTests() {
  const db = await startFakeDatabase();
  const worker = await startWorker(db.url);
  const post = async (path: string, token: string, body?: unknown) => {
    const r = await fetch(`${worker.base}${path}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });
    return { status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, unknown> };
  };
  const initBody = { reference: 'ref-test-0001', callbackUrl: 'http://localhost:3000/payment/callback' };
  try {
    // A normal person (not on the list)
    db.setup({ allowed: { 'staff-0001': true } });
    let a = await post('/api/payments/initialize', 'token-normal', initBody);
    check('3a. a normal person who tries to start a card payment is refused: 403, card_not_open, plain words', a.status === 403 && a.body.code === 'card_not_open' && a.body.error === CARD_NOT_OPEN_MESSAGE, `${a.status} ${JSON.stringify(a.body)}`);
    check('3b. ...and the Worker looked nothing up and sent nothing to Paystack (only the allowlist question was asked)', db.log.length === 1 && db.log[0].startsWith('rpc card_checkout_allowed') && db.log[0].includes('normal-0001'), db.log.join(' | '));

    // The database cannot be asked (old database without the function)
    db.setup({ rpcError: true, allowed: { 'staff-0001': true } });
    a = await post('/api/payments/initialize', 'token-staff', initBody);
    check('3c. when the database cannot answer, even a listed person is refused (503), nothing is sent on', a.status === 503 && a.body.code === 'card_check_unavailable' && db.log.every((l) => l.startsWith('rpc card_checkout_allowed')), `${a.status} ${JSON.stringify(a.body)}`);

    // A listed person passes the gate: it goes on to look the request up (none matches here, so it stops with the old answer and still sends nothing to Paystack)
    db.setup({ allowed: { 'staff-0001': true } });
    a = await post('/api/payments/initialize', 'token-staff', initBody);
    check('3d. a listed person passes the gate and reaches the old request lookup (stops there: no such request), still nothing to Paystack', a.status === 400 && /No unsent request/.test(String(a.body.error)) && db.log.some((l) => l.startsWith('select session_requests')), `${a.status} ${JSON.stringify(a.body)}`);

    // No sign-in at all is still the old 401
    a = await post('/api/payments/initialize', 'token-nobody', initBody);
    check('3e. an unknown token is still refused with 401 before the allowlist is asked', a.status === 401);

    // Accepting: a payer who is not allowed (card_verified request) is not charged and the request is not claimed
    db.setup({ allowed: {}, requests: { '11111111-1111-4111-8111-111111111111': { requested_by_profile_id: 'normal-0001', payment_status: 'card_verified' } } });
    a = await post('/api/requests/11111111-1111-4111-8111-111111111111/accept', 'token-tutor');
    check('3f. a tutor cannot accept a card-verified request whose payer may not pay by card (409), and the request is not even claimed', a.status === 409 && a.body.code === 'card_not_open' && !db.log.some((l) => l.startsWith('rpc claim_session_request')), `${a.status} ${JSON.stringify(a.body)} :: ${db.log.join(' | ')}`);

    // Accepting a request that was paid from the wallet is not touched by the card gate
    db.setup({ allowed: {}, requests: { '22222222-2222-4222-8222-222222222222': { requested_by_profile_id: 'normal-0001', payment_status: 'wallet_paid' } } });
    a = await post('/api/requests/22222222-2222-4222-8222-222222222222/accept', 'token-tutor');
    check('3g. a wallet-paid request is accepted as before (200 booked) and the card question is never asked', a.status === 200 && a.body.status === 'booked' && db.log.some((l) => l.startsWith('rpc claim_session_request')) && !db.log.some((l) => l.startsWith('rpc card_checkout_allowed')), `${a.status} ${JSON.stringify(a.body)} :: ${db.log.join(' | ')}`);

    // A card-verified request whose payer IS allowed goes on to the claim as before
    db.setup({ allowed: { 'staff-0001': true }, requests: { '33333333-3333-4333-8333-333333333333': { requested_by_profile_id: 'staff-0001', payment_status: 'card_verified' } } });
    a = await post('/api/requests/33333333-3333-4333-8333-333333333333/accept', 'token-tutor');
    check('3h. a card-verified request whose payer is on the list goes on to the claim as before', db.log.some((l) => l.startsWith('rpc claim_session_request')), `${a.status} ${JSON.stringify(a.body)} :: ${db.log.join(' | ')}`);
  } finally {
    worker.stop();
    await db.stop();
  }
}

// ---- 4. what the page and the files say ---------------------------------------------------------------------------------------------------------------
function sourceTests() {
  const idx = read('server/index.ts');
  const initAt = idx.indexOf("app.post('/api/payments/initialize'");
  const initGate = idx.indexOf('cardCheckoutDecision(db, user.id)', initAt);
  const initPaystack = idx.indexOf("paystack('/transaction/initialize'", initAt);
  check('4a. in /api/payments/initialize the allowlist is asked before the request lookup and before the Paystack call', initAt > 0 && initGate > initAt && initGate < idx.indexOf("from('session_requests')", initAt) && initGate < initPaystack);
  const accAt = idx.indexOf("app.post('/api/requests/:id/accept'");
  const accGate = idx.indexOf('cardCheckoutDecision(db, payerRow.requested_by_profile_id)', accAt);
  check('4b. in /api/requests/:id/accept the allowlist is asked before the request is claimed and before the saved card is charged', accAt > 0 && accGate > accAt && accGate < idx.indexOf("db.rpc('claim_session_request'", accAt) && accGate < idx.indexOf("paystack('/transaction/charge_authorization'", accAt));
  const calls = (idx.match(/paystack\('\/transaction\/(initialize|charge_authorization)'/g) ?? []).length;
  check('4c. these are the only two places the Worker starts a card payment or charges a card', calls === 2);

  const prices = read('src/components/PricesPage.tsx');
  check('4d. the booking page asks the database whether this person may pay by card and treats "not yet answered" as closed', /useCardAllowed\(!freeOpen\)/.test(prices) && /const cardClosed = !freeOpen && cardAnswer !== 'yes'/.test(prices));
  const closedStart = prices.indexOf('{cardClosed ? (');
  const closedEnd = prices.indexOf(') : bankMain ? (', closedStart);
  const closedBranch = prices.slice(closedStart, closedEnd);
  check('4e. the page part for a person without the card has no card button, no card note and no provider word', closedStart > 0 && closedEnd > closedStart && !/cardButton|cardNote|Paystack|test card|Test mode|Save card/i.test(closedBranch));
  check('4f. the send handler refuses the card path for such a person too (not only the hidden button)', /if \(!useWallet && cardClosed\) return;/.test(prices));
  check('4g. the wallet box is open for a person without the card (no "See more" to press)', /const walletMode = walletAvailable && \(showWallet \|\| bankMain \|\| cardClosed\)/.test(prices));
  const bank = read('src/components/BankMainCheckout.tsx');
  check('4h. the bank-first page shows no "Pay with a card instead" when it is given no card section', /cardSection !== null && \(/.test(bank) && /cardSection: React\.ReactNode \| null/.test(bank));

  const mig = read('supabase/migrations/20261116190000_card_checkout_allowlist.sql');
  check('4i. migration: mode seeded staff; odd values read as staff; allowed is service_role only; the list is closed to browsers',
    /'card_checkout_mode', '"staff"'::jsonb/.test(mig) && /else 'staff' end/.test(mig) && /grant execute on function public\.card_checkout_allowed\(uuid\) to service_role/.test(mig) && !/grant execute on function public\.card_checkout_allowed\(uuid\) to authenticated/.test(mig) && /revoke all on public\.card_checkout_staff from public, anon, authenticated, service_role/.test(mig));
  check('4j. migration: it replaces and drops nothing that exists', !/drop (table|function|trigger|policy)/i.test(mig) && !/alter table public\.(?!card_checkout_staff)/i.test(mig));
}

(async () => {
  await decisionTests();
  await pageQuestionTests();
  await workerTests();
  sourceTests();
  console.log(failures === 0 ? '\nall checks passed' : `\n${failures} FAILED`);
  process.exitCode = failures === 0 ? 0 : 1;
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
