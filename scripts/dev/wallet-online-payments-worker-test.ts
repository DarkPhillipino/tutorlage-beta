// Checks on the Worker's online (pay-by-bank) wallet top-up when the provider is Ozow's PAYMENTS API: server/ozowPayments.ts behind the same door as the One API (server/walletOnline.ts), run as
// REAL HTTP routes in a small Express app against a PRETEND Ozow Payments API and the same PRETEND database the One API tests use (scripts/dev/fake-ozow-payments.ts, fake-ozow.ts). No network, no key.
// Every credit-safety rule the One API path has is checked again here for this provider: credit only on Ozow's paid word, amount / currency / site code compared with our own row, nothing credited
// twice, a mismatch or a test payment credits nothing and tells finance, a tampered or unsigned notification credits nothing, the backstop and "Check now" work, no key reaches a log, a reply
// or a database argument. Plus what is new: the form-encoded notification, the return route, two providers set up at once, and the answer of the public environment route.
// The database's own rules stay proved by supabase/tests/wallet_online_topups.sql (unchanged by this work: the setting wallet_online_provider is free text and attempts store any provider name).
// Run: npx tsx scripts/dev/wallet-online-payments-worker-test.ts
import crypto from 'node:crypto';
import fs from 'node:fs';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { MAX_WEBHOOK_BYTES, createWalletOnline, mountOnlineReturn, mountOnlineRoutes, mountOnlineWebhook } from '../../server/walletOnline';
import { OZOW_PRODUCTION_BASE, createOzowProvider } from '../../server/ozow';
import { DEFAULT_WORKER_ORIGIN, OZOW_PAYMENTS_PRODUCTION_BASE, OZOW_PAYMENTS_STAGING_BASE, createOzowPaymentsProvider } from '../../server/ozowPayments';
import { FAKE, FakeClock, FakeOzow, FakeWalletDb, secretsToHide, webhookSecret } from './fake-ozow';
import { FAKE_PAYMENTS, FakeOzowPayments, paymentsSecretsToHide } from './fake-ozow-payments';

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) failures += 1;
  process.stdout.write(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}\n`);
};
const read = (f: string) => fs.readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8');

const PAYER = '00000000-0000-4000-8000-0000000000aa';
const OTHER = '00000000-0000-4000-8000-0000000000bb';
const FORM = 'application/x-www-form-urlencoded';

// Everything any Worker code wrote, said or sent to the database, searched for secrets at the end.
const seen: string[] = [];
for (const m of ['log', 'error', 'warn', 'info'] as const) {
  console[m] = (...args: unknown[]) => void seen.push(args.map(String).join(' '));
}
const servers: { close(): void }[] = [];
const sign = (secret: string, id: string, ts: string, raw: Buffer) =>
  `v1,${crypto.createHmac('sha256', Buffer.from(secret.replace(/^whsec_/, ''), 'base64')).update(Buffer.concat([Buffer.from(`${id}.${ts}.`), raw])).digest('base64')}`;

type Res = { status: number; text: string; json: any; headers: Headers };
interface Rig {
  clock: FakeClock;
  pay: FakeOzowPayments;
  one: FakeOzow;
  db: FakeWalletDb;
  logs: string[];
  post(path: string, init?: { token?: string | null; headers?: Record<string, string>; body?: string | Buffer; json?: unknown }): Promise<Res>;
  get(path: string, init?: { token?: string | null; headers?: Record<string, string> }): Promise<Res>;
  start(topup: Record<string, any>, token?: string | null): Promise<Res>;
  deliver(text: string, o?: { contentType?: string | null; headers?: Record<string, string> }): Promise<Res>;
  started(amount?: number): Promise<{ topup: any; reference: string }>;
  base: string;
}

async function makeRig(o: { paymentsProvider?: boolean; oneApi?: boolean; staging?: boolean; rehearsal?: boolean; returnOrigin?: string | null; concurrency?: number } = {}): Promise<Rig> {
  const clock = new FakeClock();
  const pay = new FakeOzowPayments(clock);
  const one = new FakeOzow(clock);
  const db = new FakeWalletDb(clock);
  db.provider = o.paymentsProvider === false ? 'ozow' : 'ozow_payments';
  db.addUser(FAKE.userToken, PAYER);
  db.addUser(FAKE.otherUserToken, OTHER);
  const logs: string[] = [];
  let n = 0;
  const providers: Record<string, any> = {};
  if (o.paymentsProvider !== false) {
    providers.ozow_payments = createOzowPaymentsProvider(
      { apiKey: FAKE_PAYMENTS.apiKey, privateKey: FAKE_PAYMENTS.privateKey, siteCode: FAKE_PAYMENTS.siteCode, apiBase: o.staging ? OZOW_PAYMENTS_STAGING_BASE : OZOW_PAYMENTS_PRODUCTION_BASE, returnOrigin: 'https://tutorlage.com', workerOrigin: DEFAULT_WORKER_ORIGIN, isTest: Boolean(o.rehearsal) },
      pay.fetch,
      { timeoutMs: 40, newId: () => `00000000-0000-4000-8000-${String((n += 1)).padStart(12, '0')}` },
    );
  }
  if (o.oneApi) {
    providers.ozow = createOzowProvider(
      { clientId: FAKE.clientId, clientSecret: FAKE.clientSecret, siteCode: FAKE.siteCode, webhookSecret: webhookSecret(), apiBase: OZOW_PRODUCTION_BASE, returnOrigin: 'https://tutorlage.com' },
      one.fetch,
      { now: clock.now, timeoutMs: 40, log: (l) => logs.push(l) },
    );
  }
  const wo = createWalletOnline({ db, userIdFromToken: async (t) => db.users.get(t) ?? null, providers, jobSecret: FAKE.jobSecret, log: (l) => logs.push(l), concurrency: o.concurrency });
  const app = express();
  const noLimit = () => (_q: any, _s: any, next: () => void) => next();
  mountOnlineWebhook(app, wo, { rateLimit: noLimit });
  mountOnlineReturn(app, { rateLimit: noLimit, returnOrigin: o.returnOrigin === undefined ? 'https://tutorlage.com' : o.returnOrigin });
  // A strict JSON reader AFTER the webhook and the return route, like server/index.ts: neither may ever reach it.
  app.use(express.json({ limit: '1kb' }));
  mountOnlineRoutes(app, wo, { rateLimit: noLimit });
  app.use((_e: unknown, _q: any, res: any, _n: any) => res.status(400).json({ error: 'the generic reader refused it' }));
  const server = await new Promise<import('node:http').Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  servers.push(server);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const send = async (method: string, path: string, init: { token?: string | null; headers?: Record<string, string>; body?: string | Buffer; json?: unknown } = {}): Promise<Res> => {
    const headers: Record<string, string> = { ...init.headers };
    if (init.token !== null && init.token !== undefined) headers.Authorization = `Bearer ${init.token}`;
    let body = init.body;
    if (init.json !== undefined) {
      body = JSON.stringify(init.json);
      headers['Content-Type'] = 'application/json';
    }
    const res = await fetch(base + path, { method, headers, body: method === 'GET' ? undefined : (body as any), redirect: 'manual' });
    const text = await res.text();
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    seen.push(text, JSON.stringify([...res.headers.entries()]));
    return { status: res.status, text, json, headers: res.headers };
  };
  const rig: Rig = {
    clock, pay, one, db, logs, base,
    post: (path, init) => send('POST', path, init),
    get: (path, init) => send('GET', path, init),
    start: (topup, token = FAKE.userToken) => send('POST', `/api/wallet/topups/${topup.id}/start-online`, { token, json: { amount: 999 } }),
    deliver: (text, d = {}) => {
      const headers: Record<string, string> = { ...d.headers };
      if (d.contentType !== null) headers['Content-Type'] = d.contentType ?? FORM;
      return send('POST', '/api/wallet/webhook/ozow-payments', { headers, body: text });
    },
    async started(amount = 35) {
      const topup = db.addTopup(PAYER, amount);
      const r = await rig.start(topup);
      if (r.status !== 200) throw new Error(`setup: start-online answered ${r.status}`);
      return { topup, reference: topup.reference };
    },
  };
  return rig;
}
const eventsOf = (r: Rig, outcome: string) => r.db.events.filter((e) => e.outcome === outcome);
const applyCalls = (r: Rig) => r.db.calls.filter((c) => c.name === 'wallet_online_apply');

(async () => {
  // =============================================================== start-online ===============================================================
  {
    const r = await makeRig();
    const t = r.db.addTopup(PAYER, 35);
    const res = await r.start(t);
    const req = r.pay.requestFor(t.reference);
    check('start: a signed-in payer starts the top-up and gets Ozow\'s link back exactly as Ozow gave it', res.status === 200 && res.json.redirect_url === `https://pay.ozow.com/${req?.paymentRequestId}/Secure` && res.json.resumed === false);
    check('start: the database chose the provider (ozow_payments), so the Payments API was called and the One API was not', r.db.attempts.get(t.id)?.provider === 'ozow_payments' && r.pay.count('POST', '/postpaymentrequest') === 1 && r.one.calls.length === 0);
    check('start: the amount sent to Ozow is the database\'s R35.00 (the browser sent 999), as text with two decimals', req?.body.amount === '35.00' && !r.pay.calls[0].body.includes('999'));
    check('start: the request Ozow accepted carries our TL- reference twice (transaction and bank reference), ZA, ZAR, not a test, and the Worker\'s notification address', req?.body.transactionReference === t.reference && req?.body.bankReference === t.reference && req?.body.isTest === false && req?.body.notifyUrl === `${DEFAULT_WORKER_ORIGIN}/api/wallet/webhook/ozow-payments`);
    check('start: the payment id and link are saved (claim, then attach), the top-up stays open and nothing is credited', r.db.calls.map((c) => c.name).join() === 'wallet_online_claim,wallet_online_attach' && r.db.attempts.get(t.id)?.provider_payment_id === req?.paymentRequestId && t.status === 'awaiting_payment' && r.db.credits(t.id) === 0);
    const again = await r.start(t);
    check('start: a second click or tab gets the same link back and makes no second payment at Ozow', again.status === 200 && again.json.resumed === true && again.json.redirect_url === res.json.redirect_url && r.pay.count('POST', '/postpaymentrequest') === 1);
  }
  {
    const r = await makeRig();
    const t = r.db.addTopup(PAYER, 35);
    const all = await Promise.all([r.start(t), r.start(t), r.start(t)]);
    check('start: three clicks at the same moment make exactly one payment request at Ozow', r.pay.count('POST', '/postpaymentrequest') === 1 && r.pay.requests.size === 1 && all.some((x) => x.status === 200));
  }
  for (const [mode, why] of [['hash', 'a hash failure'], ['cap', 'the account\'s amount limit'], ['403', 'a deactivated site'], ['401', 'a wrong API key']] as const) {
    const r = await makeRig();
    const t = r.db.addTopup(PAYER, 35);
    r.pay.mode.create = mode;
    const res = await r.start(t);
    check(`start: Ozow refusing (${why}): the payer is told plainly nothing was taken, the top-up is closed, nothing is attached, and Ozow's own words are not in the reply`,
      res.status === 502 && res.json.code === 'start_failed' && /Nothing was taken/.test(res.json.error) && t.status === 'unsuccessful' && !r.db.attempts.get(t.id)?.provider_payment_id && !/HashCheck|maximum transaction|Unable to authorize|API key is/.test(res.text));
    check(`start: ...and the log line for the CEO carries a short code, not Ozow's text`, r.logs.some((l) => /start-online: refused/.test(l) && (mode === 'hash' ? /hash_failed/.test(l) : mode === 'cap' ? /amount_limit/.test(l) : /credentials/.test(l))));
  }
  for (const mode of ['500', 'garbled', 'nolink', 'badlink', 'timeout', 'duplicate'] as const) {
    const r = await makeRig();
    const t = r.db.addTopup(PAYER, 35);
    r.pay.mode.create = mode;
    const res = await r.start(t);
    const second = await r.start(t);
    check(`start: Ozow answering "${mode}" (a request may exist and nobody holds its link): the payer is told, the top-up is closed, and Ozow is called once and never again`, res.status === 502 && t.status === 'unsuccessful' && r.pay.count('POST', '/postpaymentrequest') === 1 && second.status !== 200);
  }
  {
    const r = await makeRig();
    const t = r.db.addTopup(PAYER, 35);
    const res = await r.start(t, FAKE.otherUserToken);
    check('start: someone else\'s top-up is "not found" and Ozow is never called', res.status === 404 && r.pay.calls.length === 0);
    const none = await r.post(`/api/wallet/topups/${t.id}/start-online`, {});
    check('start: no sign-in is refused before anything else', none.status === 401 && r.pay.calls.length === 0);
  }
  {
    const r = await makeRig({ paymentsProvider: false });
    const t = r.db.addTopup(PAYER, 35);
    const res = await r.start(t);
    check('start: while no provider is set up the payer is told "not available" (503, not_configured) and Ozow is never called', res.status === 503 && res.json.code === 'not_configured' && r.pay.calls.length === 0 && t.status === 'awaiting_payment');
  }
  {
    const r = await makeRig({ oneApi: true });
    r.db.provider = 'ozow';
    const t = r.db.addTopup(PAYER, 35);
    const res = await r.start(t);
    check('two providers set up: the setting "ozow" still sends a top-up to the One API (the Payments API is not called)', res.status === 200 && r.one.count('POST', '/payments') === 1 && r.pay.calls.length === 0 && r.db.attempts.get(t.id)?.provider === 'ozow');
    const r2 = await makeRig({ oneApi: true });
    const t2 = r2.db.addTopup(PAYER, 35);
    const res2 = await r2.start(t2);
    check('two providers set up: the setting "ozow_payments" sends a top-up to the Payments API (the One API is not called)', res2.status === 200 && r2.pay.count('POST', '/postpaymentrequest') === 1 && r2.one.calls.length === 0 && r2.db.attempts.get(t2.id)?.provider === 'ozow_payments');
  }

  // =============================================================== the notification: money in ================================================
  {
    const r = await makeRig();
    const { topup, reference } = await r.started(35);
    const txn = crypto.randomUUID();
    const note = r.pay.notification(reference, { TransactionId: txn });
    const res = await r.deliver(note);
    check('webhook: a genuine "Complete" for the right amount credits the wallet once, the top-up is successful, and the answer is 200', res.status === 200 && r.db.credits(topup.id) === 1 && topup.status === 'successful' && r.db.ledger[0]?.amount === 35);
    check('webhook: what reached the database is the paid word the database knows ("Successful", from Ozow\'s "Complete"), the provider ozow_payments, our site code check true, two decimals, ZAR, not a test',
      (() => { const a = applyCalls(r)[0]?.args as any; return a?.p_provider === 'ozow_payments' && a.p_status === 'Successful' && a.p_site_ok === true && a.p_amount_text === '35.00' && a.p_currency === 'ZAR' && a.p_is_test === 'False' && a.p_allow_test === false && a.p_txn_id === txn && a.p_reference === reference && a.p_source === 'webhook'; })());
    check('webhook: the payer is told (a bell notice) and the audit row says credited', r.db.notifications.some((n) => n.type === 'wallet_topup_successful') && eventsOf(r, 'credited').length === 1);
    const again = await r.deliver(note);
    check('webhook: the SAME message again (Ozow may repeat) is a duplicate: 200, and still exactly one credit', again.status === 200 && r.db.credits(topup.id) === 1 && r.db.ledger.length === 1);
    const same = await r.deliver(r.pay.notification(reference, { TransactionId: txn, StatusMessage: '' }));
    check('webhook: a re-sent message with a new envelope but the same transaction is "already credited", not a second credit', same.status === 200 && r.db.credits(topup.id) === 1);
    const twice = await r.deliver(r.pay.notification(reference, { TransactionId: crypto.randomUUID() }));
    check('webhook: a second SUCCESSFUL transaction (a different id) for a top-up already credited is NOT credited again: it goes to a person as "paid twice"', twice.status === 200 && r.db.credits(topup.id) === 1 && r.db.finance.some((f) => /Paid twice/.test(f)));
  }
  for (const [status, label] of [['Cancelled', 'cancelled'], ['Error', 'an error'], ['Abandoned', 'abandoned']] as const) {
    const r = await makeRig();
    const { topup, reference } = await r.started(35);
    const res = await r.deliver(r.pay.notification(reference, { Status: status, StatusMessage: label === 'cancelled' ? 'User cancelled transaction' : '' }));
    check(`webhook: a signed "${status}" credits nothing and the top-up stays open until it expires (the payer can still pay on the link if Ozow lets them)`, res.status === 200 && r.db.credits(topup.id) === 0 && topup.status === 'awaiting_payment' && r.db.ledger.length === 0);
  }
  {
    const r = await makeRig();
    const { topup, reference } = await r.started(35);
    const res = await r.deliver(r.pay.notification(reference, { Status: 'PendingInvestigation' }));
    check('webhook: "PendingInvestigation" (the bank result is unclear) is NEVER credited: it goes to a person, and the top-up stays open', res.status === 200 && r.db.credits(topup.id) === 0 && topup.status === 'awaiting_payment' && r.db.finance.some((f) => /status we do not know: pendinginvestigation/.test(f)));
    const pend = await r.deliver(r.pay.notification(reference, { Status: 'Pending' }));
    check('webhook: "Pending" is "not finished yet": nothing credited, nobody alerted', pend.status === 200 && r.db.credits(topup.id) === 0 && eventsOf(r, 'ignored').length >= 1);
    const later = await r.deliver(r.pay.notification(reference, { Status: 'Complete' }));
    check('webhook: and when Ozow later says Complete for the same payment, it IS credited (a Pending message did not use up the transaction)', later.status === 200 && r.db.credits(topup.id) === 1);
  }
  {
    const r = await makeRig();
    const { topup, reference } = await r.started(35);
    const wrong = await r.deliver(r.pay.notification(reference, { Amount: '350.00' }));
    check('webhook: a payment of a DIFFERENT amount than the top-up (even correctly signed) credits nothing and goes to a person', wrong.status === 200 && r.db.credits(topup.id) === 0 && r.db.finance.some((f) => /Paid R350\.00 but the top-up is R35/.test(f)));
    const less = await r.deliver(r.pay.notification(reference, { Amount: '3.50' }));
    check('webhook: ...also when it is less', less.status === 200 && r.db.credits(topup.id) === 0 && r.db.finance.some((f) => /Paid R3\.50/.test(f)));
    const usd = await r.deliver(r.pay.notification(reference, { CurrencyCode: 'USD' }));
    check('webhook: another currency credits nothing and goes to a person', usd.status === 200 && r.db.credits(topup.id) === 0 && r.db.finance.some((f) => /currency is not ZAR/.test(f)));
    const site = await r.deliver(r.pay.notification(reference, { SiteCode: 'SOMEONE-ELSE-1' }));
    check('webhook: another site code (even signed with our key) credits nothing and goes to a person', site.status === 200 && r.db.credits(topup.id) === 0 && r.db.finance.some((f) => /site code does not match/.test(f)));
    const test = await r.deliver(r.pay.notification(reference, { IsTest: 'True' }));
    check('webhook: a TEST payment ("IsTest True") on the live system credits nothing, is recorded, and finance is told (this is also what a rehearsal produces)', test.status === 200 && r.db.credits(topup.id) === 0 && r.db.finance.some((f) => /test payment arrived on the live site/.test(f)) && topup.status === 'awaiting_payment');
    const ok = await r.deliver(r.pay.notification(reference));
    check('webhook: after all those refusals the genuine payment still credits, once', ok.status === 200 && r.db.credits(topup.id) === 1);
  }
  {
    const r = await makeRig();
    const { topup, reference } = await r.started(35);
    const tampered = (await r.deliver(r.pay.notification(reference))).status; // credits, so a fresh top-up is used for tampering below
    check('setup: a genuine message is accepted', tampered === 200 && r.db.credits(topup.id) === 1);
    const r2 = await makeRig();
    const { topup: t2, reference: ref2 } = await r2.started(35);
    const genuine = r2.pay.notification(ref2, { TransactionId: crypto.randomUUID() });
    const bits: Array<[string, string]> = [
      ['the amount changed', genuine.replace('Amount=35.00', 'Amount=350.00')],
      ['the status changed (Cancelled made Complete)', r2.pay.notification(ref2, { Status: 'Cancelled' }).replace('Status=Cancelled', 'Status=Complete')],
      ['signed with the wrong key', r2.pay.notification(ref2, {}, { key: 'a-completely-other-key-9' })],
      ['no Hash at all', r2.pay.notification(ref2, {}, { skipHash: true })],
      ['an empty body', ''],
      ['JSON instead of a form', JSON.stringify({ TransactionReference: ref2, Status: 'Complete', Hash: 'x' })],
      ['a repeated Status field', `${genuine}&Status=Cancelled`],
    ];
    for (const [label, text] of bits) {
      const res = await r2.deliver(text, { contentType: label.startsWith('JSON') ? 'application/json' : FORM });
      check(`webhook: ${label} is refused (400, no detail) and credits nothing`, res.status === 400 && res.json?.error === 'Not accepted.' && r2.db.credits(t2.id) === 0 && applyCalls(r2).length === 0);
    }
    check('webhook: every refusal is recorded (the database caps and quiets them) and none of them reached the decision point', eventsOf(r2, 'rejected').length >= 1 && applyCalls(r2).length === 0);
    check('webhook: the quiet "missing_header" kind (a probe with nothing signed) is the reason recorded for an unsigned message, so the database\'s one-an-hour rule applies', r2.db.events.some((e) => /missing_header/.test(String(e.detail))) || r2.logs.some((l) => /rejected \(missing_header\)/.test(l)));
  }
  {
    const r = await makeRig();
    const { topup, reference } = await r.started(35);
    r.db.failNext('wallet_online_apply', 1);
    const first = await r.deliver(r.pay.notification(reference, { TransactionId: '0e0e0e0e-0e0e-4e0e-8e0e-0e0e0e0e0e0e' }));
    check('webhook: when the database cannot be written the answer is 500 (so Ozow sends it again) and nothing was credited', first.status === 500 && r.db.credits(topup.id) === 0);
    const retry = await r.deliver(r.pay.notification(reference, { TransactionId: '0e0e0e0e-0e0e-4e0e-8e0e-0e0e0e0e0e0e' }));
    check('webhook: the retry credits it, once', retry.status === 200 && r.db.credits(topup.id) === 1);
  }
  {
    const r = await makeRig();
    const res = await r.deliver(r.pay.notification('TL-NOSUCH', {}));
    check('webhook: a correctly signed message about a reference we do not have goes to a person; nothing credited; no error', res.status === 200 && r.db.ledger.length === 0 && r.db.finance.some((f) => /No online top-up has this reference/.test(f)));
    const big = await r.deliver(`Status=Complete&pad=${'x'.repeat(MAX_WEBHOOK_BYTES + 10)}`);
    check('webhook: a body over 64 KB is refused (413) before it is read', big.status === 413);
    const oneApiPath = await r.post('/api/wallet/webhook/ozow', { headers: { 'Content-Type': 'application/json' }, body: '{}' });
    check('webhook: the One API address answers "not set up" (503) while only the Payments API is set up, and the generic JSON reader is never in the way of either address', oneApiPath.status === 503 && !/generic reader/.test(oneApiPath.text) && !/generic reader/.test(big.text));
    const none = await makeRig({ paymentsProvider: false });
    const off = await none.deliver(none.pay.notification('TL-NOSUCH'));
    check('webhook: with the Payments API not set up its address answers 503 and does nothing', off.status === 503 && none.db.calls.length === 0);
  }
  {
    // another provider's top-up must not be touched by a Payments API message, and the other way round
    const r = await makeRig({ oneApi: true });
    r.db.provider = 'ozow';
    const t = r.db.addTopup(PAYER, 35);
    await r.start(t); // an attempt with provider ozow (One API)
    const note = r.pay.notification(t.reference, { Amount: '35.00' });
    const res = await r.deliver(note);
    check('two providers: a Payments API message that carries the reference of a One API top-up credits nothing (the top-up belongs to the other provider) and goes to a person', res.status === 200 && r.db.credits(t.id) === 0 && r.db.finance.some((f) => /No online top-up has this reference/.test(f)));
    const raw = Buffer.from(JSON.stringify({ type: 'transaction.complete', timestamp: new Date(r.clock.now()).toISOString(), data: { SiteCode: FAKE.siteCode, TransactionId: crypto.randomUUID(), TransactionReference: t.reference, Amount: '35.00', Status: 'Successful', CurrencyCode: 'ZAR', IsTest: 'False', StatusMessage: '' } }));
    const ts = String(Math.floor(r.clock.now() / 1000));
    const one = await r.post('/api/wallet/webhook/ozow', { headers: { 'Content-Type': 'application/json', 'svix-id': 'msg_x1', 'svix-timestamp': ts, 'svix-signature': sign(webhookSecret(), 'msg_x1', ts, raw) }, body: raw });
    check('two providers: the One API webhook, signed the One API way, still credits a One API top-up through its own address', one.status === 200 && r.db.credits(t.id) === 1 && (applyCalls(r).at(-1)?.args as any)?.p_provider === 'ozow');
  }

  // =============================================================== Check now and the backstop =================================================
  {
    const r = await makeRig();
    const { topup, reference } = await r.started(35);
    const before = await r.post(`/api/wallet/topups/${topup.id}/check`, { token: FAKE.userToken });
    check('check now: before the payer has done anything Ozow lists nothing: "checked", still waiting, nothing credited', before.status === 200 && before.json.result === 'checked' && before.json.transactions === 0 && r.db.credits(topup.id) === 0);
    r.pay.addTransaction(reference, { status: 'Complete' });
    r.clock.advance(20);
    const after = await r.post(`/api/wallet/topups/${topup.id}/check`, { token: FAKE.userToken });
    check('check now: once Ozow lists a Complete transaction (the notification never arrived) the payer\'s own check credits it, once', after.status === 200 && after.json.status === 'successful' && r.db.credits(topup.id) === 1);
    const ask = r.pay.calls.filter((c) => c.path === '/GetTransactionByReference').at(-1)!;
    check('check now: Ozow was asked by OUR reference with the site code and the key in the header', ask.query.transactionReference === reference && ask.query.siteCode === FAKE_PAYMENTS.siteCode && ask.headers.ApiKey === FAKE_PAYMENTS.apiKey && !('isTest' in ask.query));
    r.clock.advance(20);
    const closed = await r.post(`/api/wallet/topups/${topup.id}/check`, { token: FAKE.userToken });
    check('check now: a top-up already credited says "closed" and asks Ozow nothing more', closed.json.result === 'closed' && r.pay.count('GET', '/GetTransactionByReference') === 2);
    const note = await r.deliver(r.pay.notification(reference, { TransactionId: (r.pay.txns[0] as any).transactionId }));
    check('check now: the notification arriving AFTER the check changes nothing (still one credit)', note.status === 200 && r.db.credits(topup.id) === 1);
  }
  {
    const r = await makeRig();
    const { topup } = await r.started(35);
    await r.post(`/api/wallet/topups/${topup.id}/check`, { token: FAKE.userToken });
    const quick = await r.post(`/api/wallet/topups/${topup.id}/check`, { token: FAKE.userToken });
    const other = await r.post(`/api/wallet/topups/${topup.id}/check`, { token: FAKE.otherUserToken });
    check('check now: at most one look at Ozow every 15 seconds per top-up (429), and only the payer can ask (404 for anyone else)', quick.status === 429 && other.status === 404 && r.pay.count('GET', '/GetTransactionByReference') === 1);
  }
  {
    const r = await makeRig();
    const { topup } = await r.started(35);
    r.pay.mode.check = '500';
    r.clock.advance(20);
    const res = await r.post(`/api/wallet/topups/${topup.id}/check`, { token: FAKE.userToken });
    check('check now: when Ozow cannot be asked the payer is told we will keep checking (502), nothing is credited and the top-up is not marked as checked', res.status === 502 && res.json.code === 'check_failed' && r.db.credits(topup.id) === 0 && !r.db.attempts.get(topup.id)?.checked_at && !/Something went wrong/.test(res.text));
  }
  {
    const r = await makeRig();
    const a = await r.started(35);
    const b = await r.started(35);
    const c = await r.started(35);
    r.pay.addTransaction(a.reference, { status: 'Complete' });
    r.pay.addTransaction(b.reference, { status: 'Cancelled' });
    // c: Ozow has nothing
    r.clock.advance(11 * 60);
    const none = await r.post('/api/internal/wallet/online-check', {});
    const wrong = await r.post('/api/internal/wallet/online-check', { headers: { 'x-job-secret': 'not-the-secret' } });
    const run = await r.post('/api/internal/wallet/online-check', { headers: { 'x-job-secret': FAKE.jobSecret } });
    check('backstop: needs the job secret (401 without or with a wrong one)', none.status === 401 && wrong.status === 401);
    check('backstop: asks Ozow about every payment that never got a message, credits the paid one exactly once, leaves the cancelled and the empty ones open', run.status === 200 && run.json.due === 3 && run.json.checked === 3 && r.db.credits(a.topup.id) === 1 && r.db.credits(b.topup.id) === 0 && r.db.credits(c.topup.id) === 0 && b.topup.status === 'awaiting_payment');
    r.clock.advance(11 * 60);
    await r.post('/api/internal/wallet/online-check', { headers: { 'x-job-secret': FAKE.jobSecret } });
    check('backstop: running again never credits twice', r.db.credits(a.topup.id) === 1 && r.db.ledger.length === 1);
  }
  {
    const r = await makeRig();
    const { topup, reference } = await r.started(35);
    r.pay.addTransaction(reference, { status: 'Cancelled' });
    r.pay.addTransaction(reference, { status: 'Complete' });
    r.clock.advance(20);
    const res = await r.post(`/api/wallet/topups/${topup.id}/check`, { token: FAKE.userToken });
    check('check now: Ozow listing a Cancelled attempt AND a Complete one for the same reference: the Complete one is read first and credited (a failure never starves a credit)', res.status === 200 && r.db.credits(topup.id) === 1);
  }
  {
    const r = await makeRig();
    const { topup, reference } = await r.started(35);
    r.pay.addTransaction(reference, { status: 'Complete', amount: 3500 });
    r.clock.advance(20);
    const big = await r.post(`/api/wallet/topups/${topup.id}/check`, { token: FAKE.userToken });
    check('check now: Ozow listing a Complete payment of another amount credits nothing and goes to a person', big.status === 200 && r.db.credits(topup.id) === 0 && r.db.finance.some((f) => /Paid R3500\.00/.test(f)));
    const r2 = await makeRig();
    const { topup: t2, reference: ref2 } = await r2.started(35);
    r2.pay.addTransaction(ref2, { status: 'Complete', isTest: true });
    r2.clock.advance(20);
    const test = await r2.post(`/api/wallet/topups/${t2.id}/check`, { token: FAKE.userToken });
    check('check now: a rehearsal transaction is not even listed by a live lookup (it asks for live transactions only), so nothing is credited', test.status === 200 && r2.db.credits(t2.id) === 0);
  }
  {
    const r = await makeRig({ rehearsal: true });
    const { topup, reference } = await r.started(35);
    check('rehearsal: every request says isTest true (and its hash covers that: the pretend Ozow accepted it)', JSON.parse(r.pay.calls[0].body).isTest === true && r.pay.requestFor(reference) !== undefined);
    check('rehearsal: the public environment answer does NOT say "test" (that note promises pretend money in the wallet; a rehearsal adds none), so the rehearsal is for the CEO alone to see',(await r.get('/api/wallet/online-environment')).json?.test === false);
    const res = await r.deliver(r.pay.notification(reference, { IsTest: 'True' }));
    check('rehearsal: the pretend outcome Ozow sends back (Complete, IsTest True) is refused by the database on the live system: NO money, a note to finance, the top-up stays open', res.status === 200 && r.db.credits(topup.id) === 0 && r.db.finance.some((f) => /test payment arrived on the live site/.test(f)));
    r.pay.addTransaction(reference, { status: 'Complete' });
    r.clock.advance(20);
    const chk = await r.post(`/api/wallet/topups/${topup.id}/check`, { token: FAKE.userToken });
    check('rehearsal: "Check now" in a rehearsal asks for test transactions, finds the pretend one and still credits nothing', chk.status === 200 && r.pay.calls.filter((c) => c.path === '/GetTransactionByReference').at(-1)?.query.isTest === 'true' && r.db.credits(topup.id) === 0);
  }
  {
    // staging credentials (not held today): test payments ARE allowed to credit there, as in the One API's staging
    const r = await makeRig({ staging: true, rehearsal: true });
    const { topup, reference } = await r.started(35);
    const res = await r.deliver(r.pay.notification(reference, { IsTest: 'True' }));
    check('staging address: a test payment may credit (it is Ozow\'s staging system), exactly as the One API staging does', res.status === 200 && r.db.credits(topup.id) === 1 && (applyCalls(r)[0]?.args as any)?.p_allow_test === true);
  }

  // =============================================================== the return route ===========================================================
  {
    const r = await makeRig();
    const id = '11111111-2222-4333-8444-555555555555';
    const viaGet = await r.get(`/api/wallet/ozow-return?topup=${id}&Status=Complete&Hash=abc`);
    check('return: the payer\'s browser coming back (GET, with Ozow\'s fields in the address) is sent on, 303, to the site\'s own "checking your payment" page for that top-up', viaGet.status === 303 && viaGet.headers.get('location') === `https://tutorlage.com/wallet/topup-return?topup=${id}` && viaGet.headers.get('cache-control') === 'no-store');
    const viaPost = await r.post(`/api/wallet/ozow-return?topup=${id}`, { headers: { 'Content-Type': FORM, Origin: 'https://pay.ozow.com' }, body: 'SiteCode=X&Status=Complete&Hash=abc' });
    check('return: a form POST (the other way a redirect can arrive), with Ozow\'s own Origin and body, is sent on the same way: no error from the generic reader or a cross-origin check', viaPost.status === 303 && viaPost.headers.get('location') === `https://tutorlage.com/wallet/topup-return?topup=${id}`);
    const jsonPost = await r.post(`/api/wallet/ozow-return?topup=${id}`, { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pad: 'x'.repeat(5000) }) });
    check('return: even a large JSON POST is sent on (the body is never read)', jsonPost.status === 303);
    for (const bad of ['', '?topup=', '?topup=not-a-uuid', `?topup=${id}x`, '?topup=https://evil.example.com', '?redirect=https://evil.example.com', `?topup[]=${id}`]) {
      const res = await r.get(`/api/wallet/ozow-return${bad}`);
      check(`return: "${bad || '(nothing)'}" goes to the site's wallet page, never anywhere else`, res.status === 303 && res.headers.get('location') === 'https://tutorlage.com/wallet');
    }
    const off = await makeRig({ returnOrigin: null });
    check('return: with the Payments API not set up the route answers 503 and sends nobody anywhere', (await off.get(`/api/wallet/ozow-return?topup=${id}`)).status === 503);
    check('return: the outcome is never taken from the browser coming back: nothing the browser carries reaches the database', r.db.calls.length === 0);
    // ---- the hint (18 Nov 2026): which of our three return addresses Ozow used, passed on for the page's WORDING only ----
    for (const hint of ['success', 'cancelled', 'error']) {
      const res = await r.get(`/api/wallet/ozow-return?topup=${id}&r=${hint}`);
      check(`return: the hint "${hint}" is passed on to the site's page, still 303 to the site's own address`, res.status === 303 && res.headers.get('location') === `https://tutorlage.com/wallet/topup-return?topup=${id}&r=${hint}`);
    }
    const viaPostHint = await r.post(`/api/wallet/ozow-return?topup=${id}&r=cancelled`, { headers: { 'Content-Type': FORM, Origin: 'https://pay.ozow.com' }, body: 'Status=Complete&Hash=abc' });
    check('return: a form POST with the hint carries it on too, and what Ozow put in the body is ignored', viaPostHint.status === 303 && viaPostHint.headers.get('location') === `https://tutorlage.com/wallet/topup-return?topup=${id}&r=cancelled`);
    const SHAPE = /^https:\/\/tutorlage\.com\/wallet\/topup-return\?topup=[0-9a-f-]{36}(&r=(success|cancelled|error))?$/;
    for (const bad of ['r=paid', 'r=Complete', 'r=CANCELLED', 'r=', 'r=cancelled%20', 'r=cancelled&r=success', 'r[]=error', 'r=%3Cscript%3E', 'r=https://evil.example.com', 'r=success/../x']) {
      const res = await r.get(`/api/wallet/ozow-return?topup=${id}&${bad}`);
      const loc = res.headers.get('location') ?? '';
      check(`return: the odd hint "${bad}" is dropped (or is exactly one of the three words): the page address is only our own page, the id, and at most one known hint`, res.status === 303 && SHAPE.test(loc), loc);
    }
    const noId = await r.get('/api/wallet/ozow-return?r=cancelled');
    check('return: a hint without a good top-up id goes to the wallet page and carries nothing', noId.status === 303 && noId.headers.get('location') === 'https://tutorlage.com/wallet');
    const evil = await r.get(`/api/wallet/ozow-return?topup=${id}&r=cancelled&next=https://evil.example.com&redirect=//evil.example.com`);
    check('return: nothing else in the address can move the redirect off our own site', evil.headers.get('location') === `https://tutorlage.com/wallet/topup-return?topup=${id}&r=cancelled`);
    check('return: a stranger cannot make us call Ozow or touch a row through this route: after all these requests there was no database call and no call to Ozow', r.db.calls.length === 0 && r.pay.calls.length === 0, `${r.db.calls.length}/${r.pay.calls?.length}`);
  }

  // =============================================================== the public environment answer ==============================================
  {
    const live = await makeRig();
    const env = await live.get('/api/wallet/online-environment');
    check('environment: only the Payments API set up, live: configured, provider ozow_payments, NOT test (so no "Test mode" note)', env.status === 200 && env.json.configured === true && env.json.provider === 'ozow_payments' && env.json.test === false && env.headers.get('cache-control') === 'no-store');
    const stg = await makeRig({ staging: true });
    check('environment: Ozow\'s staging address says test (the screens say so)', (await stg.get('/api/wallet/online-environment')).json.test === true);
    const both = await makeRig({ oneApi: true });
    const e2 = await both.get('/api/wallet/online-environment');
    check('environment: both providers set up with the One API on LIVE addresses too: configured, not test', e2.status === 200 && e2.json.test === false);
    const none = await makeRig({ paymentsProvider: false });
    check('environment: no provider set up: 503 "not configured" (the screens then do not offer the bank as the main way)', (await none.get('/api/wallet/online-environment')).status === 503);
    check('environment: it carries no key, no site code and no address', secretsToHide().concat(paymentsSecretsToHide()).every((s) => !env.text.includes(s)) && !/https?:/.test(env.text));
  }
  {
    // One API on its STAGING host plus the Payments API live: the answer is "test" (the cautious one) until the staging secrets are removed; the go-live sheet removes them
    const clock = new FakeClock();
    const wo = createWalletOnline({
      db: new FakeWalletDb(clock),
      userIdFromToken: async () => null,
      providers: {
        ozow: createOzowProvider({ clientId: FAKE.clientId, clientSecret: FAKE.clientSecret, siteCode: FAKE.siteCode, webhookSecret: webhookSecret(), apiBase: 'https://stagingone.ozow.com/v1', returnOrigin: 'https://tutorlage.com' }, new FakeOzow(clock).fetch),
        ozow_payments: createOzowPaymentsProvider({ apiKey: FAKE_PAYMENTS.apiKey, privateKey: FAKE_PAYMENTS.privateKey, siteCode: FAKE_PAYMENTS.siteCode, apiBase: OZOW_PAYMENTS_PRODUCTION_BASE, returnOrigin: 'https://tutorlage.com', workerOrigin: DEFAULT_WORKER_ORIGIN, isTest: false }, new FakeOzowPayments(clock).fetch),
      },
      jobSecret: FAKE.jobSecret,
    });
    check('environment: a One API STAGING provider left set up beside the live Payments API makes the answer "test": the cautious side, and the sheet removes the three One API secrets so this cannot happen', wo.environment().status === 200 && (wo.environment().body as any).test === true);
  }

  // =============================================================== no secret anywhere ========================================================
  {
    const all = seen.join('\n');
    const hide = paymentsSecretsToHide().concat(secretsToHide());
    check('no secret: no API key, private key, site code or job secret is in any log line, any reply or any header the Worker produced in all these runs', hide.every((s) => !all.includes(s)));
  }
  {
    const r = await makeRig();
    const { reference } = await r.started(35);
    await r.deliver(r.pay.notification(reference));
    await r.deliver(r.pay.notification(reference, {}, { key: 'a-completely-other-key-9' }));
    await r.post('/api/internal/wallet/online-check', { headers: { 'x-job-secret': FAKE.jobSecret } });
    const sent = JSON.stringify(r.db.calls);
    check('no secret: nothing sent to the database (every argument of every call) holds a key, the site code or the job secret', paymentsSecretsToHide().concat(secretsToHide()).every((s) => !sent.includes(s)));
    check('no secret: the audit rows and the notes finance reads hold no key either', paymentsSecretsToHide().every((s) => !JSON.stringify(r.db.events).includes(s) && !JSON.stringify(r.db.finance).includes(s)));
  }

  // =============================================================== the wiring ===============================================================
  {
    const index = read('server/index.ts');
    const ic = index.replace(/^\s*\/\/.*$/gm, '');
    check('wiring: index.ts builds the providers from their own settings and registers the Payments API one under the name the database uses', /ozowPaymentsConfigFromEnv\(process\.env\)/.test(ic) && /\[OZOW_PAYMENTS_PROVIDER\]: createOzowPaymentsProvider\(ozowPayments\.config/.test(ic) && /\.\.\.\(ozow\.config \? \{ ozow: createOzowProvider/.test(ic));
    check('wiring: the webhook and the return route are mounted BEFORE the generic JSON reader (it would refuse a form body or add a cross-origin check)', ic.indexOf('mountOnlineWebhook(app') > 0 && ic.indexOf('mountOnlineReturn(app') > ic.indexOf('mountOnlineWebhook(app') && ic.indexOf('mountOnlineReturn(app') < ic.indexOf('const MAX_BODY_BYTES'));
    const w = read('wrangler.jsonc');
    check('wiring: wrangler.jsonc holds the two plain Payments API variables (base address, rehearsal off) and no key', /"OZOW_PAYMENTS_BASE": "https:\/\/api\.ozow\.com"/.test(w) && /"OZOW_PAYMENTS_TEST": "false"/.test(w) && !/OZOW_API_KEY"\s*:|OZOW_PRIVATE_KEY"\s*:/.test(w));
    const wo = read('server/walletOnline.ts');
    check('wiring: the provider-neutral file still knows no Ozow secret and no hash: it only learned two webhook addresses and a return route', !/sha512|privateKey|apiKey|OZOW_PRIVATE/i.test(wo));
    check('wiring: nothing in the Payments API files offers "free" lessons or sessions', !/free (lesson|session)/i.test(read('server/ozowPayments.ts') + wo));
  }
  for (const s of servers) s.close();
  process.stdout.write(failures === 0 ? '\nALL OK\n' : `\n${failures} FAILED\n`);
  process.exit(failures === 0 ? 0 : 1);
})();
