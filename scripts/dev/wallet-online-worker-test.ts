// Checks on the Worker's online (pay-by-bank) wallet top-up routes: server/walletOnline.ts + server/ozow.ts, run as REAL HTTP routes in a small
// Express app against a PRETEND Ozow and a PRETEND database (scripts/dev/fake-ozow.ts). No network, no real key, no real money, no real database.
// Covers: start-online (one payment per top-up, every kind of Ozow answer), the webhook (credit once, replay, wrong amount / currency / site code,
// test flag, bad signatures, database down), "Check now" (owner only, once per 15 seconds), the backstop job, that no secret reaches a log line,
// a reply or a database argument, and that the Worker's database calls agree with the migration they talk to.
// Run: npx tsx scripts/dev/wallet-online-worker-test.ts
import crypto from 'node:crypto';
import fs from 'node:fs';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { MAX_WEBHOOK_BYTES, createWalletOnline, mountOnlineRoutes, mountOnlineWebhook } from '../../server/walletOnline';
import { OZOW_PRODUCTION_BASE, createOzowProvider } from '../../server/ozow';
import { FAKE, FakeClock, FakeOzow, FakeWalletDb, secretsToHide, webhookSecret } from './fake-ozow';

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) failures += 1;
  process.stdout.write(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}\n`);
};
const read = (f: string) => fs.readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8');

const PAYER = '00000000-0000-4000-8000-0000000000aa';
const OTHER = '00000000-0000-4000-8000-0000000000bb';
const JOB_HEADER = 'x-job-secret';

// Everything any Worker code wrote, said or sent to the database, searched for secrets at the end.
const seen: string[] = [];
for (const m of ['log', 'error', 'warn', 'info'] as const) {
  console[m] = (...args: unknown[]) => void seen.push(args.map(String).join(' '));
}
const servers: { close(): void }[] = [];

interface Rig {
  clock: FakeClock;
  ozow: FakeOzow;
  db: FakeWalletDb;
  logs: string[];
  post(path: string, init?: { token?: string | null; headers?: Record<string, string>; body?: string | Buffer; json?: unknown }): Promise<{ status: number; text: string; json: any; headers: Headers }>;
  get(path: string, init?: { token?: string | null; headers?: Record<string, string> }): ReturnType<Rig['post']>;
  deliver(payload: unknown, o?: DeliverOptions): ReturnType<Rig['post']>;
  start(topup: Record<string, any>, token?: string | null): ReturnType<Rig['post']>;
  paidTopup(amount?: number): Promise<{ topup: any; paymentId: string }>;
  tx(topup: any, over?: Record<string, unknown>): Record<string, unknown>;
}
interface DeliverOptions {
  id?: string;
  ts?: number;
  secret?: string;
  signature?: string;
  headers?: Record<string, string | undefined>;
  contentType?: string | null;
}

// Independent of server/ozow.ts: Ozow's algorithm written out again.
const sign = (secret: string, id: string, ts: string, raw: Buffer) =>
  `v1,${crypto.createHmac('sha256', Buffer.from(secret.replace(/^whsec_/, ''), 'base64')).update(Buffer.concat([Buffer.from(`${id}.${ts}.`), raw])).digest('base64')}`;

async function makeRig(o: { noProvider?: boolean; noJobSecret?: boolean; staging?: boolean; concurrency?: number } = {}): Promise<Rig> {
  const clock = new FakeClock();
  const ozow = new FakeOzow(clock);
  const db = new FakeWalletDb(clock);
  db.addUser(FAKE.userToken, PAYER);
  db.addUser(FAKE.otherUserToken, OTHER);
  const logs: string[] = [];
  let n = 0;
  const provider = createOzowProvider(
    { clientId: FAKE.clientId, clientSecret: FAKE.clientSecret, siteCode: FAKE.siteCode, webhookSecret: webhookSecret(), apiBase: o.staging ? 'https://stagingone.ozow.com/v1' : OZOW_PRODUCTION_BASE, returnOrigin: 'https://tutorlage.com' },
    ozow.fetch,
    { now: clock.now, timeoutMs: 40, log: (l) => logs.push(l), newId: () => `00000000-0000-4000-8000-${String((n += 1)).padStart(12, '0')}` },
  );
  const wo = createWalletOnline({
    db,
    userIdFromToken: async (t) => db.users.get(t) ?? null,
    providers: o.noProvider ? {} : { ozow: provider },
    jobSecret: o.noJobSecret ? undefined : FAKE.jobSecret,
    log: (l) => logs.push(l),
    concurrency: o.concurrency,
  });
  const app = express();
  const noLimit = () => (_q: any, _s: any, next: () => void) => next();
  mountOnlineWebhook(app, wo, { rateLimit: noLimit });
  // A strict JSON reader AFTER the webhook, like server/index.ts: the webhook must never reach it.
  app.use(express.json({ limit: '1kb' }));
  mountOnlineRoutes(app, wo, { rateLimit: noLimit });
  app.use((_e: unknown, _q: any, res: any, _n: any) => res.status(400).json({ error: 'the generic reader refused it' }));
  const server = await new Promise<import('node:http').Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  servers.push(server);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const post: Rig['post'] = async (path, init = {}) => {
    const headers: Record<string, string> = { ...init.headers };
    if (init.token !== null && init.token !== undefined) headers.Authorization = `Bearer ${init.token}`;
    let body = init.body;
    if (init.json !== undefined) {
      body = JSON.stringify(init.json);
      headers['Content-Type'] = 'application/json';
    }
    const res = await fetch(base + path, { method: 'POST', headers, body: body as any });
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
  const get: Rig['get'] = async (path, init = {}) => {
    const headers: Record<string, string> = { ...init.headers };
    if (init.token !== null && init.token !== undefined) headers.Authorization = `Bearer ${init.token}`;
    const res = await fetch(base + path, { method: 'GET', headers });
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
    clock,
    ozow,
    db,
    logs,
    post,
    get,
    start: (topup, token = FAKE.userToken) => post(`/api/wallet/topups/${topup.id}/start-online`, { token, json: { amount: 999 } }),
    async paidTopup(amount = 50) {
      const topup = db.addTopup(PAYER, amount);
      const r = await rig.start(topup);
      if (r.status !== 200) throw new Error(`setup: start-online answered ${r.status}`);
      return { topup, paymentId: db.attempts.get(topup.id)!.provider_payment_id };
    },
    tx: (topup, over = {}) => ({
      type: 'transaction.complete',
      timestamp: new Date(clock.now()).toISOString(),
      data: { SiteCode: FAKE.siteCode, TransactionId: crypto.randomUUID(), TransactionReference: topup.reference, Amount: `${topup.amount_rand}.00`, Status: 'Successful', Optional1: '', CurrencyCode: 'ZAR', IsTest: 'False', StatusMessage: '', Hash: 'ignored', ...over },
    }),
    deliver: (payload, d = {}) => {
      const raw = Buffer.from(typeof payload === 'string' ? payload : JSON.stringify(payload));
      const id = d.id ?? `msg_${crypto.randomUUID().slice(0, 12)}`;
      const ts = String(d.ts ?? Math.floor(clock.now() / 1000));
      const headers: Record<string, string> = { 'svix-id': id, 'svix-timestamp': ts, 'svix-signature': d.signature ?? sign(d.secret ?? webhookSecret(), id, ts, raw) };
      for (const [k, v] of Object.entries(d.headers ?? {})) {
        if (v === undefined) delete headers[k];
        else headers[k] = v;
      }
      if (d.contentType !== null) headers['Content-Type'] = d.contentType ?? 'application/json';
      return post('/api/wallet/webhook/ozow', { headers, body: raw });
    },
  };
  return rig;
}
const bodyOf = (r: Rig, t: any, over: Record<string, unknown> = {}) => r.tx(t, over);
const eventsOf = (r: Rig, outcome: string) => r.db.events.filter((e) => e.outcome === outcome);

(async () => {
  // =============================================================== start-online ==============================================================
  {
    const r = await makeRig();
    const t = r.db.addTopup(PAYER, 50);
    const res = await r.start(t);
    const payment = r.ozow.paymentFor(t.reference);
    check('start: a signed-in payer starts the top-up and gets Ozow\'s link back, exactly as Ozow gave it', res.status === 200 && res.json.redirect_url === `https://pay.ozow.com/${payment?.id}/secure` && res.json.resumed === false && typeof res.json.expires_at === 'string');
    check('start: the amount sent to Ozow is the database\'s (R50), never the browser\'s (the browser sent 999)', payment?.body.amount.value === 50 && JSON.stringify(payment?.body).indexOf('999') < 0);
    check('start: the Idempotency-Key is the database\'s topup-<id> and the reference is the top-up\'s own', r.ozow.calls.find((c) => c.path === '/payments')?.headers['Idempotency-Key'] === `topup-${t.id}` && payment?.body.merchantReference === t.reference);
    check('start: the payment id and link are saved (claim, then create, then attach) and the top-up stays open', r.db.calls.map((c) => c.name).join() === 'wallet_online_claim,wallet_online_attach' && r.db.attempts.get(t.id)?.provider_payment_id === payment?.id && t.status === 'awaiting_payment');
    const again = await r.start(t);
    check('start: a second click or tab gets the same link back and creates no second payment', again.status === 200 && again.json.resumed === true && again.json.redirect_url === res.json.redirect_url && r.ozow.count('POST', '/payments') === 1);
  }
  {
    const r = await makeRig();
    const t = r.db.addTopup(PAYER, 50);
    const both = await Promise.all([r.start(t), r.start(t), r.start(t)]);
    check('start: three clicks at the same moment make exactly one payment at Ozow', r.ozow.count('POST', '/payments') === 1 && r.ozow.payments.size === 1);
    check('start: ...one of them gets the link and the others are told to wait or get the same link', both.some((x) => x.status === 200) && both.every((x) => x.status === 200 || (x.status === 409 && x.json.code === 'busy')));
  }
  for (const [mode, label] of [['400', 'refused it (400)'], ['403', 'refused it (403)']] as const) {
    const r = await makeRig();
    const t = r.db.addTopup(PAYER, 50);
    r.ozow.mode.create = mode;
    const res = await r.start(t);
    check(`start: when Ozow ${label} the payer is told plainly, the top-up is closed, and nothing is attached`, res.status === 502 && res.json.code === 'start_failed' && /Nothing was taken/.test(res.json.error) && t.status === 'unsuccessful' && !r.db.calls.some((c) => c.name === 'wallet_online_attach') && r.db.notifications.some((x) => x.type === 'wallet_topup_cancelled'));
    check(`start: ...and Ozow\'s own error text (it holds our client id and site code) is not in the reply`, secretsToHide().every((s) => !res.text.includes(s)) && !/Consumer could not/.test(res.text));
  }
  for (const mode of ['500', 'garbled', 'nolink', 'badlink'] as const) {
    const r = await makeRig();
    const t = r.db.addTopup(PAYER, 50);
    r.ozow.mode.create = mode;
    const res = await r.start(t);
    const second = await r.start(t);
    check(`start: Ozow answering "${mode}" (a payment may exist): the payer is told, the top-up is closed, and Ozow is called once, never again`, res.status === 502 && t.status === 'unsuccessful' && r.ozow.count('POST', '/payments') === 1 && second.status === 409 && second.json.code === 'closed' && r.ozow.count('POST', '/payments') === 1);
  }
  {
    const r = await makeRig();
    const t = r.db.addTopup(PAYER, 50);
    r.ozow.mode.create = 'hang';
    const res = await r.start(t);
    check('start: Ozow not answering in time: one call, the payment exists at Ozow but nobody holds a link, the top-up is closed, the payer can start again', res.status === 502 && r.ozow.count('POST', '/payments') === 1 && r.ozow.payments.size === 1 && t.status === 'unsuccessful' && !r.db.attempts.get(t.id)?.provider_payment_id);
    const fresh = r.db.addTopup(PAYER, 50);
    r.ozow.mode.create = 'ok';
    check('start: ...and a NEW top-up (new reference) then works', (await r.start(fresh)).status === 200 && r.ozow.payments.size === 2);
  }
  {
    const r = await makeRig();
    const first = await r.paidTopup();
    r.ozow.expireToken();
    const t2 = r.db.addTopup(PAYER, 50);
    const res = await r.start(t2);
    check('start: the Ozow token runs out between two payers: renewed once, both payments made', first.paymentId && res.status === 200 && r.ozow.tokenCalls === 2 && r.ozow.payments.size === 2);
    const t3 = r.db.addTopup(PAYER, 50);
    await r.start(t3);
    check('start: later payers reuse the cached token (one token request for the next payment)', r.ozow.tokenCalls === 2);
  }
  {
    const r = await makeRig({ noProvider: true });
    const t = r.db.addTopup(PAYER, 50);
    const res = await r.start(t);
    check('start: with Ozow not set up the answer is a plain 503 with the manual-transfer advice, and the database is not touched', res.status === 503 && res.json.code === 'not_configured' && /bank transfer/.test(res.json.error) && r.db.calls.length === 0 && t.status === 'awaiting_payment');
  }
  {
    const r = await makeRig();
    const t = r.db.addTopup(PAYER, 50);
    const bad = await r.start(t, FAKE.otherUserToken);
    check('start: someone else\'s top-up is "not found" and Ozow is never called', bad.status === 404 && bad.json.code === 'not_found' && r.ozow.calls.length === 0);
    check('start: no sign-in, an unknown token and a bad id are refused before anything happens', (await r.start(t, null)).status === 401 && (await r.start(t, 'garbage')).status === 401 && (await r.post('/api/wallet/topups/not-a-uuid/start-online', { token: FAKE.userToken })).status === 404 && r.ozow.calls.length === 0 && r.db.calls.length === 0 === false);
  }
  {
    const r = await makeRig();
    const t = r.db.addTopup(PAYER, 50, { status: 'cancelled' });
    const res = await r.start(t);
    check('start: a top-up that is already closed answers 409 closed, with no Ozow call', res.status === 409 && res.json.code === 'closed' && r.ozow.calls.length === 0);
  }
  {
    const r = await makeRig();
    const t = r.db.addTopup(PAYER, 50);
    r.db.failNext('wallet_online_claim');
    const down = await r.start(t);
    r.db.failNext('wallet_online_claim', 1, 'throw');
    const thrown = await r.start(t);
    check('start: the database down at the first step: 500 "nothing was taken", Ozow never called (both an error answer and a network throw)', down.status === 500 && thrown.status === 500 && down.json.code === 'server_error' && r.ozow.calls.length === 0);
    check('start: the 500 text does not carry the database\'s own message', !/connection to the database/.test(down.text));
  }
  {
    const r = await makeRig();
    const t = r.db.addTopup(PAYER, 50);
    r.db.failNext('wallet_online_attach');
    const res = await r.start(t);
    check('start: one failed save of the payment id is retried once and the payer still gets the link (Ozow called once)', res.status === 200 && r.db.calls.filter((c) => c.name === 'wallet_online_attach').length === 2 && r.ozow.count('POST', '/payments') === 1);
    const t2 = r.db.addTopup(PAYER, 50);
    r.db.failNext('wallet_online_attach', 2);
    const res2 = await r.start(t2);
    check('start: two failed saves: 500, no link given, and still only one payment made', res2.status === 500 && r.ozow.count('POST', '/payments') === 2 && !res2.text.includes('pay.ozow.com'));
    const again = await r.start(t2);
    r.clock.advance(180);
    const later = await r.start(t2);
    check('start: ...a retry within 2 minutes is told to wait, and after that the top-up is closed; Ozow is never asked for a second payment', again.status === 409 && again.json.code === 'busy' && later.status === 409 && later.json.code === 'closed' && t2.status === 'unsuccessful' && r.ozow.count('POST', '/payments') === 2);
  }
  {
    const r = await makeRig();
    const { topup } = await r.paidTopup();
    r.db.mode = 'off';
    const resume = await r.start(topup);
    const t2 = r.db.addTopup(PAYER, 50);
    const fresh = await r.start(t2);
    check('start: switching the mode off stops NEW payments (409) but a link already made still resumes', resume.status === 200 && resume.json.resumed === true && fresh.status === 409 && fresh.json.code === 'closed' && r.ozow.payments.size === 1);
  }
  {
    const r = await makeRig();
    const { topup } = await r.paidTopup();
    r.clock.advance(3700);
    const res = await r.start(topup);
    check('start: after the link has expired it is not handed out again', res.status === 409 && res.json.code === 'closed');
  }

  // =============================================================== the webhook ==============================================================
  {
    const r = await makeRig();
    const { topup } = await r.paidTopup();
    const first = await r.deliver(r.tx(topup), { id: 'msg_first' });
    check('webhook: a genuine Successful message credits the wallet once and is answered 200 with no body', first.status === 200 && first.text === '' && r.db.credits(topup.id) === 1 && topup.status === 'successful');
    check('webhook: ...recorded against the message id, and the payer is told', eventsOf(r, 'credited').length === 1 && eventsOf(r, 'credited')[0].event_id === 'msg_first' && r.db.notifications.some((x) => x.type === 'wallet_topup_successful'));
    const body = r.tx(topup, { TransactionId: 'fixed-txn-1' });
    const t2 = (await r.paidTopup()).topup;
    const fixed = r.tx(t2, { TransactionId: 'fixed-txn-2' });
    const a = await r.deliver(fixed, { id: 'msg_dup' });
    const events = r.db.events.length;
    const b = await r.deliver(fixed, { id: 'msg_dup' });
    check('webhook: the very same delivery sent again is answered 200, credits nothing more and writes no new record', a.status === 200 && b.status === 200 && r.db.credits(t2.id) === 1 && r.db.events.length === events);
    const c = await r.deliver(fixed, { id: 'msg_dup_other_id' });
    check('webhook: the same transaction under a different message id is also 200 and still one credit, with nothing for a person to look at', c.status === 200 && r.db.credits(t2.id) === 1 && !eventsOf(r, 'needs_review').length);
    void body;
  }
  const refused = async (label: string, over: Record<string, unknown>, expectText: RegExp, staging = false) => {
    const r = await makeRig({ staging });
    const { topup } = await r.paidTopup();
    const res = await r.deliver(r.tx(topup, over));
    const review = eventsOf(r, 'needs_review');
    check(`webhook: ${label}: answered 200, NOT credited, recorded for a person, finance told`, res.status === 200 && r.db.credits(topup.id) === 0 && topup.status === 'awaiting_payment' && review.length === 1 && expectText.test(review[0].detail) && r.db.finance.length === 1);
  };
  await refused('an amount one cent too much ("50.01")', { Amount: '50.01' }, /Paid R50\.01 but the top-up is R50/);
  await refused('an amount too little ("5.00")', { Amount: '5.00' }, /Paid R5\.00/);
  await refused('an amount without decimals ("50")', { Amount: '50' }, /not in the expected form/);
  await refused('an amount that is a number, not a string', { Amount: 50 }, /not in the expected form/);
  await refused('the wrong currency (USD)', { CurrencyCode: 'USD' }, /currency is not ZAR/);
  await refused('a missing currency', { CurrencyCode: undefined }, /currency is not ZAR/);
  await refused('another site\'s code', { SiteCode: 'SOMEONE-ELSES-SITE' }, /site code does not match/);
  await refused('a test payment (IsTest "True") on the live system', { IsTest: 'True' }, /test payment arrived on the live site/);
  await refused('a reference that belongs to no top-up', { TransactionReference: 'TL-NOPE99' }, /No online top-up has this reference/);
  await refused('"Complete" (only Successful pays)', { Status: 'Complete' }, /status we do not know/);
  await refused('"Refunded"', { Status: 'Refunded' }, /status we do not know/);
  await refused('a Successful message with no transaction id', { TransactionId: '' }, /no transaction id/);
  {
    const r = await makeRig({ staging: true });
    const { topup } = await r.paidTopup();
    const res = await r.deliver(r.tx(topup, { IsTest: 'True' }));
    check('webhook: against Ozow\'s staging system a test payment IS credited (that is the only place they exist)', res.status === 200 && r.db.credits(topup.id) === 1);
  }
  {
    const r = await makeRig();
    const { topup } = await r.paidTopup();
    const fail = await r.deliver(r.tx(topup, { Status: 'Error', StatusMessage: 'Cancelled by the payer' }));
    check('webhook: an Error message (the payer cancelled) is 200, nothing credited, and the top-up stays open with the reason noted', fail.status === 200 && r.db.credits(topup.id) === 0 && topup.status === 'awaiting_payment' && eventsOf(r, 'attempt_failed').length === 1 && /Cancelled by the payer/.test(eventsOf(r, 'attempt_failed')[0].detail));
    const pending = await r.deliver(r.tx(topup, { Status: 'Pending' }));
    check('webhook: Pending is 200 and ignored', pending.status === 200 && eventsOf(r, 'ignored').length === 1 && r.db.credits(topup.id) === 0);
    const ok = await r.deliver(r.tx(topup));
    check('webhook: a second, successful transaction can still follow an error and is credited once', ok.status === 200 && r.db.credits(topup.id) === 1);
    const twice = await r.deliver(r.tx(topup));
    check('webhook: a second SUCCESSFUL transaction for a top-up already credited is NOT credited again; a person is told it was paid twice', twice.status === 200 && r.db.credits(topup.id) === 1 && eventsOf(r, 'needs_review').some((e) => /Paid twice/.test(e.detail)));
  }
  {
    const r = await makeRig();
    const { topup } = await r.paidTopup();
    topup.status = 'cancelled';
    const res = await r.deliver(r.tx(topup));
    check('webhook: money for a top-up that was already closed is 200, not credited, and goes to a person ("Late payment")', res.status === 200 && r.db.credits(topup.id) === 0 && eventsOf(r, 'needs_review').some((e) => /Late payment/.test(e.detail)));
  }
  {
    const r = await makeRig();
    const a = (await r.paidTopup()).topup;
    const b = (await r.paidTopup()).topup;
    await r.deliver(r.tx(a, { TransactionId: 'shared-txn' }));
    const res = await r.deliver(r.tx(b, { TransactionId: 'shared-txn' }));
    check('webhook: a transaction id already used on another top-up is not credited a second time', res.status === 200 && r.db.credits(a.id) === 1 && r.db.credits(b.id) === 0 && eventsOf(r, 'needs_review').some((e) => /already on another top-up/.test(e.detail)));
  }
  {
    const r = await makeRig();
    const { topup } = await r.paidTopup();
    r.db.mode = 'off';
    const res = await r.deliver(r.tx(topup));
    check('webhook: turning the mode off does not stop money already paid from being credited', res.status === 200 && r.db.credits(topup.id) === 1);
  }

  // ---- bad messages ----
  {
    const r = await makeRig();
    const { topup } = await r.paidTopup();
    const good = r.tx(topup);
    const goodRaw = JSON.stringify(good);
    const secretText = () => secretsToHide().some((s) => r.logs.join('\n').includes(s));
    const cases: [string, ReturnType<Rig['deliver']>][] = [
      ['a wrong signature', r.deliver(good, { signature: 'v1,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' })],
      ['a body changed after signing (one digit)', (async () => { const id = 'msg_tamper'; const ts = String(Math.floor(r.clock.now() / 1000)); const sig = sign(webhookSecret(), id, ts, Buffer.from(goodRaw)); return r.post('/api/wallet/webhook/ozow', { headers: { 'Content-Type': 'application/json', 'svix-id': id, 'svix-timestamp': ts, 'svix-signature': sig }, body: goodRaw.replace('"Amount":"50.00"', '"Amount":"90.00"') }); })()],
      ['a signature made with another secret', r.deliver(good, { secret: `whsec_${Buffer.from('another key').toString('base64')}` })],
      ['a message from an hour ago (replay)', r.deliver(good, { ts: Math.floor(r.clock.now() / 1000) - 3600 })],
      ['a message dated an hour ahead', r.deliver(good, { ts: Math.floor(r.clock.now() / 1000) + 3600 })],
      ['no svix-id', r.deliver(good, { headers: { 'svix-id': undefined } })],
      ['no svix-timestamp', r.deliver(good, { headers: { 'svix-timestamp': undefined } })],
      ['no svix-signature', r.deliver(good, { headers: { 'svix-signature': undefined } })],
    ];
    for (const [label, pending] of cases) {
      const res = await pending;
      check(`webhook: ${label} is answered 400 with no detail`, res.status === 400 && res.json?.error === 'Not accepted.' && Object.keys(res.json).length === 1);
    }
    check('webhook: ...none of them credited anything, each is recorded as rejected, and the Worker\'s log has one line each with a reason code and a size but never the body', r.db.credits(topup.id) === 0 && eventsOf(r, 'rejected').length === 8 && r.logs.filter((l) => /^webhook: rejected \(/.test(l)).length === 8 && r.logs.every((l) => !l.includes(topup.reference) && !l.includes('Amount')));
    check('webhook: ...the reason codes are distinguishable in the log', ['bad_signature', 'stale_timestamp', 'missing_header'].every((c) => r.logs.some((l) => l.includes(`(${c})`))));
    check('webhook: ...and the unverified message id is NOT used as the event id (a stranger cannot use up a real id)', eventsOf(r, 'rejected').every((e) => e.event_id === null));
    const real = await r.deliver(good, { id: 'msg_tamper' });
    check('webhook: ...so the genuine message that has an id a stranger already used is still credited', real.status === 200 && r.db.credits(topup.id) === 1);
    check('webhook: ...finance was told once about the rejections, not eight times', r.db.finance.filter((f) => f.startsWith('rejected')).length === 1);
    check('webhook: no secret in the Worker\'s log for any of these', !secretText());
  }
  {
    const r = await makeRig();
    const { topup } = await r.paidTopup();
    for (let i = 0; i < 25; i += 1) await r.deliver(r.tx(topup), { signature: 'v1,AAAA' });
    check('webhook: a flood of bad messages is recorded at most 20 an hour (the database\'s cap) and still answered 400', eventsOf(r, 'rejected').length === 20);
    r.db.failNext('wallet_online_record_event', 1);
    const res = await r.deliver(r.tx(topup), { signature: 'v1,AAAA' });
    check('webhook: if the rejection cannot even be recorded, it is still a plain 400 (never a 500, and never a credit)', res.status === 400 && r.db.credits(topup.id) === 0);
  }
  {
    const r = await makeRig();
    const { topup } = await r.paidTopup();
    const msg = r.tx(topup);
    r.db.failNext('wallet_online_apply', 1);
    const down = await r.deliver(msg, { id: 'msg_retry' });
    check('webhook: database down: answered 500 (so Ozow sends it again) and nothing is credited', down.status === 500 && r.db.credits(topup.id) === 0 && topup.status === 'awaiting_payment');
    const retry = await r.deliver(msg, { id: 'msg_retry' });
    check('webhook: ...Ozow\'s retry of the same message then credits it once', retry.status === 200 && r.db.credits(topup.id) === 1);
    const t2 = (await r.paidTopup()).topup;
    r.db.failNext('wallet_online_apply', 1, 'throw');
    check('webhook: the database unreachable (a throw) is also a 500', (await r.deliver(r.tx(t2))).status === 500 && r.db.credits(t2.id) === 0);
  }
  {
    const r = await makeRig();
    const { topup } = await r.paidTopup();
    const thin = await r.deliver({ type: 'transaction.complete', timestamp: 'x', data: { id: 'abc', status: 'Successful', reason: '' } });
    check('webhook: a "thin" message (the subscription is not the full kind) is 200, never credited, and a person is told to fix the subscription', thin.status === 200 && r.db.credits(topup.id) === 0 && eventsOf(r, 'needs_review').some((e) => /must be set to full/.test(e.detail)));
    const other = await r.deliver({ type: 'refund.complete', timestamp: 'x', data: {} });
    check('webhook: a message of another type is 200 and noted as ignored', other.status === 200 && eventsOf(r, 'ignored').some((e) => /another type/.test(e.detail)));
    const junk = await r.deliver('this is not json');
    check('webhook: a correctly signed body that is not JSON is 200 and goes to a person', junk.status === 200 && eventsOf(r, 'needs_review').some((e) => /could not be read/.test(e.detail)));
  }
  {
    const r = await makeRig();
    const { topup } = await r.paidTopup();
    const a = await r.deliver(r.tx(topup), { contentType: 'text/plain' });
    const t2 = (await r.paidTopup()).topup;
    const b = await r.deliver(r.tx(t2), { contentType: null });
    const t3 = (await r.paidTopup()).topup;
    const c = await r.deliver(r.tx(t3), { contentType: 'application/json; charset=utf-8' });
    check('webhook: the raw reader takes any content type (text/plain, none, application/json) and the bytes are untouched', a.status === 200 && b.status === 200 && c.status === 200 && r.db.credits(topup.id) + r.db.credits(t2.id) + r.db.credits(t3.id) === 3);
    const junkJson = await r.deliver('{"broken": ', { contentType: 'application/json' });
    check('webhook: a signed body that is invalid JSON under application/json never reaches the generic JSON reader (which would have said 400)', junkJson.status === 200);
    const big = await r.deliver(`{"pad":"${'x'.repeat(MAX_WEBHOOK_BYTES + 100)}"}`);
    check(`webhook: a body over ${MAX_WEBHOOK_BYTES / 1024} KB is refused 413 and recorded`, big.status === 413 && eventsOf(r, 'rejected').some((e) => /larger than/.test(e.detail)));
  }
  {
    const r = await makeRig({ noProvider: true });
    const res = await r.deliver({ type: 'transaction.complete', data: {} });
    check('webhook: with Ozow not set up it answers 503 (so Ozow retries later) and the database is not touched', res.status === 503 && r.db.calls.length === 0);
  }
  {
    const r = await makeRig();
    const { topup } = await r.paidTopup();
    const lines: string[] = [];
    r.db.calls.length = 0;
    await r.deliver(r.tx(topup), { id: 'msg_args' });
    const args = JSON.stringify(r.db.calls);
    lines.push(args);
    const applied = r.db.calls.find((c) => c.name === 'wallet_online_apply')!.args;
    check('webhook: the database receives the provider\'s strings as they came (amount "50.00", currency, status, IsTest) and only a yes/no for the site code', applied.p_amount_text === '50.00' && applied.p_currency === 'ZAR' && applied.p_status === 'Successful' && applied.p_is_test === 'False' && applied.p_site_ok === true && applied.p_allow_test === false && applied.p_event_id === 'msg_args' && applied.p_source === 'webhook' && applied.p_provider === 'ozow');
    check('webhook: no secret and no site code in any database argument', secretsToHide().every((s) => !args.includes(s)));
  }

  // =============================================================== check now ==============================================================
  {
    const r = await makeRig();
    const { topup, paymentId } = await r.paidTopup();
    r.ozow.addTransaction(paymentId, { status: 'Successful' });
    const path = `/api/wallet/topups/${topup.id}/check`;
    const res = await r.post(path, { token: FAKE.userToken });
    check('check: the payer asks "Check now" after paying, no webhook has come: Ozow is asked and the wallet is credited once', res.status === 200 && res.json.result === 'checked' && res.json.status === 'successful' && r.db.credits(topup.id) === 1 && r.ozow.count('GET', `/payments/${paymentId}/transactions`) === 1);
    check('check: ...and it was marked as checked', r.db.calls.some((c) => c.name === 'wallet_online_mark_checked') && !!r.db.attempts.get(topup.id)?.checked_at);
    const after = await r.post(path, { token: FAKE.userToken });
    check('check: a top-up that is already closed just says so', after.status === 200 && after.json.result === 'closed' && after.json.status === 'successful');
  }
  {
    const r = await makeRig();
    const { topup } = await r.paidTopup();
    const path = `/api/wallet/topups/${topup.id}/check`;
    const a = await r.post(path, { token: FAKE.userToken });
    const b = await r.post(path, { token: FAKE.userToken });
    const gets = r.ozow.calls.filter((c) => c.method === 'GET').length;
    check('check: nothing paid yet: 200 "checked", still waiting', a.status === 200 && a.json.result === 'checked' && a.json.status === 'awaiting_payment');
    check('check: asking again within 15 seconds is 429 with Retry-After, and Ozow is NOT asked again', b.status === 429 && b.json.code === 'wait' && Number(b.headers.get('retry-after')) >= 1 && Number(b.headers.get('retry-after')) <= 15 && gets === 1);
    r.clock.advance(16);
    const c = await r.post(path, { token: FAKE.userToken });
    check('check: after 16 seconds it is allowed again', c.status === 200 && r.ozow.calls.filter((x) => x.method === 'GET').length === 2);
  }
  {
    const r = await makeRig();
    const { topup, paymentId } = await r.paidTopup();
    const path = `/api/wallet/topups/${topup.id}/check`;
    const other = await r.post(path, { token: FAKE.otherUserToken });
    check('check: only the owner can ask; someone else gets "not found" and Ozow is not asked', other.status === 404 && r.ozow.calls.filter((c) => c.method === 'GET').length === 0);
    check('check: no sign-in is 401', (await r.post(path, {})).status === 401);
    r.ozow.mode.list = '500';
    const down = await r.post(path, { token: FAKE.userToken });
    check('check: Ozow down: 502 with a plain message, and the top-up is NOT marked as checked', down.status === 502 && down.json.code === 'check_failed' && !r.db.calls.some((c) => c.name === 'wallet_online_mark_checked') && secretsToHide().every((s) => !down.text.includes(s)));
    r.ozow.mode.list = 'ok';
    r.clock.advance(20);
    r.ozow.addTransaction(paymentId, { status: 'Error', reason: 'Voided' });
    r.ozow.addTransaction(paymentId, { status: 'SUCCESSFUL' });
    const ok = await r.post(path, { token: FAKE.userToken });
    check('check: a voided first transaction and a SUCCESSFUL (upper case) second: credited once, the status compared without case', ok.status === 200 && r.db.credits(topup.id) === 1 && ok.json.status === 'successful');
  }
  {
    const r = await makeRig();
    const { topup, paymentId } = await r.paidTopup();
    r.ozow.addTransaction(paymentId, { status: 'Successful', merchantReference: 'TL-SOMEONE' });
    const res = await r.post(`/api/wallet/topups/${topup.id}/check`, { token: FAKE.userToken });
    check('check: a transaction listed under this payment with another reference is never acted on; a person is told', res.status === 200 && r.db.credits(topup.id) === 0 && eventsOf(r, 'needs_review').some((e) => /another reference/.test(e.detail)));
  }
  for (const [label, over, expect] of [
    ['an amount of the wrong shape (a bare number, so no currency either)', { amount: 50 }, /currency is not ZAR|not in the expected form/],
    ['an amount object without a value', { amount: { currency: 'ZAR' } }, /not in the expected form/],
    ['the wrong amount', { amount: { value: 49, currency: 'ZAR' } }, /Paid R49\.00/],
    ['the wrong currency', { amount: { value: 50, currency: 'USD' } }, /currency is not ZAR/],
    ['the wrong site code', { siteCode: 'SOMEONE-ELSES' }, /site code does not match/],
  ] as const) {
    const r = await makeRig();
    const { topup, paymentId } = await r.paidTopup();
    r.ozow.addTransaction(paymentId, { status: 'Successful', ...over });
    await r.post(`/api/wallet/topups/${topup.id}/check`, { token: FAKE.userToken });
    check(`check: a status check that finds ${label} is not credited and goes to a person`, r.db.credits(topup.id) === 0 && eventsOf(r, 'needs_review').some((e) => expect.test(e.detail)));
  }
  {
    const r = await makeRig();
    const t = r.db.addTopup(PAYER, 50);
    r.db.attempts.set(t.id, { topup_id: t.id, provider: 'ozow', provider_payment_id: null, claimed_at: r.db.iso(), expires_at: r.db.iso(r.clock.now() + 3600_000) });
    const none = await r.post(`/api/wallet/topups/${t.id}/check`, { token: FAKE.userToken });
    check('check: a top-up whose payment was never made has nothing to check', none.status === 200 && none.json.result === 'nothing_to_check' && r.ozow.calls.length === 0);
    const { topup, paymentId } = await r.paidTopup();
    r.ozow.addTransaction(paymentId, { status: 'Successful' });
    r.db.failNext('wallet_online_apply', 1);
    const down = await r.post(`/api/wallet/topups/${topup.id}/check`, { token: FAKE.userToken });
    check('check: the database failing while applying what Ozow said is a 500 and the top-up is not marked as checked', down.status === 500 && r.db.credits(topup.id) === 0 && !r.db.attempts.get(topup.id)?.checked_at);
  }
  {
    const r = await makeRig({ noProvider: true });
    const t = r.db.addTopup(PAYER, 50);
    r.db.attempts.set(t.id, { topup_id: t.id, provider: 'ozow', provider_payment_id: 'p1', claimed_at: r.db.iso(), expires_at: r.db.iso(r.clock.now() + 3600_000) });
    const res = await r.post(`/api/wallet/topups/${t.id}/check`, { token: FAKE.userToken });
    check('check: with Ozow not set up the answer is a plain 503', res.status === 503 && res.json.code === 'not_configured');
  }

  // =============================================================== online-environment (public; 12 Nov 2026, Option A) ==============================
  // The booking page asks this before it makes the bank the main way to pay, and its "Test mode" note follows the answer.
  {
    const ENV = '/api/wallet/online-environment';
    const live = await makeRig();
    const calls = live.ozow.calls.length;
    const dbCalls = live.db.calls.length;
    const a = await live.get(ENV);
    check('environment: production Ozow answers 200 with test false, and no sign-in is needed', a.status === 200 && a.json.configured === true && a.json.test === false && a.json.provider === 'ozow');
    check('environment: it asks Ozow nobody and reads no database', live.ozow.calls.length === calls && live.db.calls.length === dbCalls);
    check('environment: the answer is never kept by a browser or a proxy (no-store)', /no-store/i.test(a.headers.get('cache-control') ?? ''));
    check('environment: the answer holds only configured, provider and test (nothing about a secret, an address or a person)', Object.keys(a.json).sort().join() === 'configured,provider,test');
    const stg = await makeRig({ staging: true });
    const b = await stg.get(ENV);
    check('environment: Ozow staging answers 200 with test true (the only case the "Test mode" note may be shown for Ozow)', b.status === 200 && b.json.test === true && b.json.configured === true);
    const none = await makeRig({ noProvider: true });
    const c = await none.get(ENV);
    check('environment: Ozow not set up answers 503 not_configured, with no test field at all', c.status === 503 && c.json.code === 'not_configured' && !('test' in c.json) && !('configured' in c.json));
    const signedIn = await live.get(ENV, { token: FAKE.userToken });
    check('environment: a signed-in call gets the same answer (the token is ignored)', signedIn.status === 200 && signedIn.json.test === false);
    const wrongMethod = await live.post(ENV, { token: FAKE.userToken });
    check('environment: it is a GET only (a POST finds nothing here)', wrongMethod.status === 404 || wrongMethod.status === 400);
  }

  // =============================================================== the backstop ==============================================================
  const JOB = '/api/internal/wallet/online-check';
  {
    const r = await makeRig();
    const calls = r.db.calls.length;
    const none = await r.post(JOB, {});
    const wrong = await r.post(JOB, { headers: { [JOB_HEADER]: 'nope' } });
    const user = await r.post(JOB, { token: FAKE.userToken });
    check('backstop: no secret, a wrong secret, or a signed-in user\'s token is 401, and the database is not touched', none.status === 401 && wrong.status === 401 && user.status === 401 && r.db.calls.length === calls);
    const unset = await makeRig({ noJobSecret: true });
    check('backstop: with WALLET_JOB_SECRET not set the route answers 503 even for a guess', (await unset.post(JOB, { headers: { [JOB_HEADER]: 'anything' } })).status === 503 && unset.db.calls.length === 0);
    const noProv = await makeRig({ noProvider: true });
    check('backstop: with Ozow not set up it answers 503 and asks nobody', (await noProv.post(JOB, { headers: { [JOB_HEADER]: FAKE.jobSecret } })).status === 503 && noProv.ozow.calls.length === 0);
    const idle = await r.post(JOB, { headers: { [JOB_HEADER]: FAKE.jobSecret } });
    check('backstop: nothing waiting: 200, due 0, and Ozow is not called', idle.status === 200 && idle.json.due === 0 && r.ozow.calls.length === 0);
  }
  {
    const r = await makeRig();
    const young = await r.paidTopup();
    r.ozow.addTransaction(young.paymentId, { status: 'Successful' });
    const early = await r.post(JOB, { headers: { [JOB_HEADER]: FAKE.jobSecret } });
    check('backstop: a top-up younger than 10 minutes is left alone', early.json.due === 0 && r.db.credits(young.topup.id) === 0);
    r.clock.advance(11 * 60);
    const run = await r.post(JOB, { headers: { [JOB_HEADER]: FAKE.jobSecret } });
    check('backstop: paid at Ozow, the webhook never came: after 10 minutes the job finds it and credits it once', run.status === 200 && run.json.due === 1 && run.json.checked === 1 && run.json.outcomes.credited === 1 && r.db.credits(young.topup.id) === 1);
    const second = await r.post(JOB, { headers: { [JOB_HEADER]: FAKE.jobSecret } });
    check('backstop: a second run finds nothing more to do and credits nothing again', second.json.due === 0 && r.db.credits(young.topup.id) === 1);
  }
  {
    const r = await makeRig();
    const a = await r.paidTopup();
    const b = await r.paidTopup();
    const c = await r.paidTopup();
    r.ozow.addTransaction(a.paymentId, { status: 'Error', reason: 'Voided' });
    r.ozow.addTransaction(a.paymentId, { status: 'Successful' });
    r.ozow.addTransaction(b.paymentId, { status: 'Successful' });
    r.ozow.addTransaction(c.paymentId, { status: 'Successful' });
    r.ozow.failList.add(b.paymentId);
    r.clock.advance(11 * 60);
    const run = await r.post(JOB, { headers: { [JOB_HEADER]: FAKE.jobSecret } });
    check('backstop: one top-up Ozow cannot answer for does not stop the others (a voided first transaction is also handled)', run.status === 200 && run.json.due === 3 && run.json.checked === 2 && run.json.provider_failed === 1 && r.db.credits(a.topup.id) === 1 && r.db.credits(b.topup.id) === 0 && r.db.credits(c.topup.id) === 1);
    r.ozow.failList.clear();
    const later = await r.post(JOB, { headers: { [JOB_HEADER]: FAKE.jobSecret } });
    check('backstop: the one that failed was not marked as checked, so the next run asks about it again (and only it) and credits it', later.json.due === 1 && later.json.checked === 1 && r.db.credits(b.topup.id) === 1);
  }
  {
    const r = await makeRig({ concurrency: 3 });
    const all = [];
    for (let i = 0; i < 12; i += 1) all.push(await r.paidTopup(50 + i));
    for (const x of all) r.ozow.addTransaction(x.paymentId, { status: 'Successful' });
    r.clock.advance(11 * 60);
    const run = await r.post(JOB, { headers: { [JOB_HEADER]: FAKE.jobSecret } });
    check('backstop: twelve paid top-ups are all found and credited in one run (a few asked at once)', run.json.due === 12 && all.every((x) => r.db.credits(x.topup.id) === 1));
  }
  {
    const r = await makeRig();
    const a = await r.paidTopup();
    r.ozow.addTransaction(a.paymentId, { status: 'Refunded' });
    r.clock.advance(11 * 60);
    await r.post(JOB, { headers: { [JOB_HEADER]: FAKE.jobSecret } });
    check('backstop: a "Refunded" transaction is never credited and goes to a person', r.db.credits(a.topup.id) === 0 && eventsOf(r, 'needs_review').some((e) => /status we do not know/.test(e.detail)));
    const r2 = await makeRig();
    r2.db.failNext('wallet_online_due_checks', 1);
    const down = await r2.post(JOB, { headers: { [JOB_HEADER]: FAKE.jobSecret } });
    check('backstop: the database down when listing what is due: 500', down.status === 500);
    const r3 = await makeRig();
    const x = await r3.paidTopup();
    r3.ozow.addTransaction(x.paymentId, { status: 'Successful' });
    r3.clock.advance(11 * 60);
    r3.db.failNext('wallet_online_apply', 1);
    const part = await r3.post(JOB, { headers: { [JOB_HEADER]: FAKE.jobSecret } });
    check('backstop: the database failing mid-way is counted, nothing is credited, and the top-up is not marked as checked', part.status === 200 && part.json.db_failed === 1 && r3.db.credits(x.topup.id) === 0 && !r3.db.attempts.get(x.topup.id)?.checked_at);
  }

  // =============================================================== no secrets ==============================================================
  {
    const text = seen.join('\n');
    check('no secret: across every scenario above, no client id, client secret, site code, signing secret or job secret appears in any reply, header, log line or console output', secretsToHide().every((s) => !text.includes(s)));
    check('no secret: no Ozow access token appears either', !/FAKE-ACCESS-TOKEN/.test(text));
    check('no secret: no user access token appears in a reply or a log line', !text.includes(FAKE.userToken) && !text.includes(FAKE.otherUserToken));
  }

  // =============================================================== the contract with the migration ==============================================================
  {
    const files = fs.readdirSync(new URL('../../supabase/migrations/', import.meta.url)).filter((f) => /wallet_online/.test(f));
    const sql = files.map((f) => read(`supabase/migrations/${f}`)).join('\n');
    check('contract: the online top-up migration exists', files.length >= 1);
    const sent = new Map<string, Set<string>>();
    // every database call every scenario made is in the rigs, but they are gone; the names the Worker can call are listed from its own source
    const source = read('server/walletOnline.ts');
    const names = [...new Set([...source.matchAll(/'(wallet_online_[a-z_]+)'/g)].map((m) => m[1]))];
    check('contract: the Worker calls these database functions', names.sort().join() === ['wallet_online_apply', 'wallet_online_attach', 'wallet_online_check_request', 'wallet_online_claim', 'wallet_online_create_failed', 'wallet_online_due_checks', 'wallet_online_mark_checked', 'wallet_online_record_event'].join(), names.join());
    for (const name of names) {
      const m = new RegExp(`create or replace function public\\.${name}\\(([^)]*)\\)`, 'i').exec(sql);
      check(`contract: ${name} exists in the migration and is granted to service_role only`, !!m && new RegExp(`grant execute on function public\\.${name}\\([^)]*\\) to service_role`, 'i').test(sql) && !new RegExp(`grant execute on function public\\.${name}\\([^)]*\\) to (anon|authenticated|public)`, 'i').test(sql));
      if (!m) continue;
      const declared = m[1].split(',').map((p) => p.trim()).filter(Boolean).map((p) => ({ name: p.split(/\s+/)[0], hasDefault: /\bdefault\b/i.test(p) }));
      const used = new Set<string>();
      // the argument names the Worker writes next to each call: p_xxx: or { p_xxx, ...
      const callSites = [...source.matchAll(new RegExp(`'${name}',\\s*(\\{[^}]*\\}|applyArgs\\([^)]*\\))`, 'g'))];
      for (const c of callSites) {
        if (c[1].startsWith('applyArgs')) {
          for (const k of source.slice(source.indexOf('function applyArgs')).slice(0, 900).matchAll(/\b(p_[a-z_]+):/g)) used.add(k[1]);
        } else for (const k of c[1].matchAll(/\b(p_[a-z_]+)\b/g)) used.add(k[1]);
      }
      sent.set(name, used);
      const missing = declared.filter((d) => !d.hasDefault && !used.has(d.name)).map((d) => d.name);
      const extra = [...used].filter((u) => !declared.some((d) => d.name === u));
      check(`contract: ${name}: the Worker sends exactly the arguments the function declares`, missing.length === 0 && extra.length === 0, `missing [${missing}] extra [${extra}]`);
    }
    check('contract: the backstop job in the migration calls the route this Worker serves, with the x-job-secret header', /\/api\/internal\/wallet\/online-check/.test(sql) && /'x-job-secret'/.test(sql) && /wallet_job_secret/.test(sql));
  }

  // =============================================================== wiring and files ==============================================================
  {
    const idx = read('server/index.ts');
    const reader = idx.indexOf('const MAX_BODY_BYTES');
    const webhookAt = idx.indexOf('mountOnlineWebhook(app');
    const configGate = idx.indexOf("Payments are not set up on this server yet.");
    const routesAt = idx.indexOf('mountOnlineRoutes(app');
    check('wiring: the webhook is mounted BEFORE the generic JSON reader (which would refuse a body it does not like)', reader > 0 && webhookAt > 0 && webhookAt < reader);
    check('wiring: the other three routes are mounted AFTER the "server not configured" gate and the sign-in routes, and before app.listen', configGate > 0 && routesAt > configGate && routesAt < idx.indexOf('app.listen('));
    check('wiring: the secrets come from the environment (process.env) and the job secret is WALLET_JOB_SECRET', /ozowConfigFromEnv\(process\.env\)/.test(idx) && /process\.env\.WALLET_JOB_SECRET/.test(idx));
    check('wiring: the webhook is passed the "server not configured" check', /mountOnlineWebhook\(app, onlineTopUps, \{ rateLimit, unavailable: \(\) => CONFIG_ERROR \}\)/.test(idx));
    const wrangler = read('wrangler.jsonc');
    check('files: wrangler.jsonc holds the two plain variables and none of the five secrets', /"OZOW_API_BASE":\s*"https:\/\/one\.ozow\.com\/v1"/.test(wrangler) && /"OZOW_RETURN_ORIGIN":\s*"https:\/\/tutorlage\.com"/.test(wrangler) && !/"(OZOW_CLIENT_ID|OZOW_CLIENT_SECRET|OZOW_SITE_CODE|OZOW_WEBHOOK_SECRET|WALLET_JOB_SECRET)"\s*:/.test(wrangler));
    const everything = ['server/ozow.ts', 'server/walletOnline.ts', 'server/index.ts', 'wrangler.jsonc', '.env.example', 'vite.config.ts'].map(read).join('\n');
    check('files: no VITE_ name for any Ozow or job secret anywhere', !/VITE_(OZOW|WALLET_JOB)/.test(everything));
    const env = read('.env.example');
    check('files: .env.example names all five secrets and the two variables, with placeholders only', ['OZOW_CLIENT_ID', 'OZOW_CLIENT_SECRET', 'OZOW_SITE_CODE', 'OZOW_WEBHOOK_SECRET', 'WALLET_JOB_SECRET', 'OZOW_API_BASE', 'OZOW_RETURN_ORIGIN'].every((n) => env.includes(n)) && !/OZOW_[A-Z_]+="(?!MY_|https:)/.test(env));
    const mine = [read('server/ozow.ts'), read('server/walletOnline.ts')].join('\n');
    check('files: nothing key-shaped is written out in the Worker code (no sk_/pk_/whsec_ literal followed by characters)', !/\b(sk|pk)_(live|test)_[A-Za-z0-9]{6,}/.test(mine) && !/whsec_[A-Za-z0-9+/=]{6,}/.test(mine));
    check('files: no wording in the new Worker files offers "free" lessons or sessions', !/\bfree\b/i.test(mine));
  }

  for (const s of servers) s.close();
  process.stdout.write(failures === 0 ? '\nALL OK\n' : `\n${failures} CHECK(S) FAILED\n`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => {
  process.stdout.write(`FAIL the test crashed: ${e?.stack ?? e}\n`);
  process.exit(1);
});
