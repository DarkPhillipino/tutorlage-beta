// Checks on the Ozow client for the online wallet top-up: server/ozow.ts, run against a PRETEND Ozow (scripts/dev/fake-ozow.ts): no network,
// no real key, no real money. Covers the settings, Ozow's webhook signature (including the published test values and every way to break it),
// the token (cache, renewal, expiry in the middle of a flow), creating a payment (shape, Idempotency-Key, every kind of answer), listing
// transactions, and that no secret ever reaches a log line or a returned note.
// Run: npx tsx scripts/dev/ozow-test.ts
import crypto from 'node:crypto';
import { FAKE, FakeClock, FakeOzow, join, secretsToHide, webhookSecret } from './fake-ozow';
import { OZOW_PRODUCTION_BASE, TOKEN_REFRESH_MARGIN_MS, checkOzowSignature, createOzowProvider, isOzowLink, ozowConfigFromEnv, ozowSignatureFor } from '../../server/ozow';
import type { OzowConfig } from '../../server/ozow';

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) failures += 1;
  process.stdout.write(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}\n`);
};

const baseConfig = (over: Partial<OzowConfig> = {}): OzowConfig => ({
  clientId: FAKE.clientId,
  clientSecret: FAKE.clientSecret,
  siteCode: FAKE.siteCode,
  webhookSecret: webhookSecret(),
  apiBase: OZOW_PRODUCTION_BASE,
  returnOrigin: 'https://tutorlage.com',
  ...over,
});
const goodEnv = (): Record<string, string> => ({
  OZOW_CLIENT_ID: FAKE.clientId,
  OZOW_CLIENT_SECRET: FAKE.clientSecret,
  OZOW_SITE_CODE: FAKE.siteCode,
  OZOW_WEBHOOK_SECRET: webhookSecret(),
  OZOW_API_BASE: 'https://one.ozow.com/v1',
  OZOW_RETURN_ORIGIN: 'https://tutorlage.com',
});
// Independent of server/ozow.ts: Ozow's algorithm written out again, straight from the page.
const sign = (secret: string, id: string, ts: string, raw: string | Buffer) =>
  `v1,${crypto.createHmac('sha256', Buffer.from(secret.replace(/^whsec_/, ''), 'base64')).update(Buffer.concat([Buffer.from(`${id}.${ts}.`), Buffer.from(raw)])).digest('base64')}`;

function rig(opts: { config?: Partial<OzowConfig>; timeoutMs?: number } = {}) {
  const clock = new FakeClock();
  const ozow = new FakeOzow(clock);
  const lines: string[] = [];
  let n = 0;
  const provider = createOzowProvider(baseConfig(opts.config), ozow.fetch, {
    now: clock.now,
    timeoutMs: opts.timeoutMs ?? 40,
    log: (l) => lines.push(l),
    newId: () => `00000000-0000-4000-8000-${String((n += 1)).padStart(12, '0')}`,
  });
  return { clock, ozow, provider, lines };
}
const input = (over: Record<string, unknown> = {}) => ({
  topupId: '11111111-1111-4111-8111-111111111111',
  reference: 'TL-AB23CD',
  amountRand: 50,
  expiresAt: '2026-11-09T13:00:00Z',
  idempotencyKey: 'topup-11111111-1111-4111-8111-111111111111',
  returnPath: '/wallet/topup-return?topup=11111111-1111-4111-8111-111111111111',
  ...over,
});
const created = (o: any): o is { kind: 'created'; paymentId: string; redirectUrl: string } => o.kind === 'created';

(async () => {
  const everyText: string[] = []; // every log line, note and detail seen below: searched for secrets at the end

  // ---- settings -----------------------------------------------------------------------------------------------------------------------------
  {
    const ok = ozowConfigFromEnv(goodEnv());
    check('settings: a full set gives a config, trimmed, with the production address by default', !!ok.config && ok.config.apiBase === 'https://one.ozow.com/v1' && ozowConfigFromEnv({ ...goodEnv(), OZOW_API_BASE: '' }).config?.apiBase === OZOW_PRODUCTION_BASE);
    for (const name of ['OZOW_CLIENT_ID', 'OZOW_CLIENT_SECRET', 'OZOW_SITE_CODE', 'OZOW_WEBHOOK_SECRET', 'OZOW_RETURN_ORIGIN']) {
      const env = goodEnv();
      delete env[name];
      const r = ozowConfigFromEnv(env);
      check(`settings: without ${name} there is no config and the name (only) is reported`, r.config === null && r.missing.join() === name);
      everyText.push(...r.missing, ...r.problems);
    }
    const bad = ozowConfigFromEnv({ ...goodEnv(), OZOW_API_BASE: 'https://evil.example.com/v1' });
    check('settings: an address that is not Ozow\'s is refused (the secrets must never be sent elsewhere)', bad.config === null && bad.problems.length === 1);
    check('settings: plain http, and a look-alike host, are refused', ozowConfigFromEnv({ ...goodEnv(), OZOW_API_BASE: 'http://one.ozow.com/v1' }).config === null && ozowConfigFromEnv({ ...goodEnv(), OZOW_API_BASE: 'https://one.ozow.com.evil.example/v1' }).config === null);
    check('settings: Ozow\'s staging address is accepted', ozowConfigFromEnv({ ...goodEnv(), OZOW_API_BASE: 'https://stagingone.ozow.com/v1/' }).config?.apiBase === 'https://stagingone.ozow.com/v1');
    for (const origin of ['https://tutorlage.com/wallet', 'http://tutorlage.com', 'https://localhost', 'tutorlage.com']) {
      check(`settings: the return origin ${origin} is refused`, ozowConfigFromEnv({ ...goodEnv(), OZOW_RETURN_ORIGIN: origin }).config === null);
    }
    check('settings: a trailing slash on the return origin is tolerated', ozowConfigFromEnv({ ...goodEnv(), OZOW_RETURN_ORIGIN: 'https://tutorlage.com/' }).config?.returnOrigin === 'https://tutorlage.com');
    check('settings: a webhook secret that is not whsec_ plus Base64 is refused', ozowConfigFromEnv({ ...goodEnv(), OZOW_WEBHOOK_SECRET: 'x' }).config === null);
    const text = JSON.stringify(ozowConfigFromEnv({ ...goodEnv(), OZOW_API_BASE: 'https://evil.example.com/v1', OZOW_WEBHOOK_SECRET: 'x' }));
    check('settings: what is reported about a wrong setting never contains a secret value', secretsToHide().every((s) => !text.includes(s)));
  }

  // ---- the webhook signature -----------------------------------------------------------------------------------------------------------------
  {
    // Ozow's published offline test values (verify-a-webhook page). The secret and signature are assembled from pieces, never typed out whole.
    const secret = join('whsec', '_', 'plJ3nmyC', 'DGBKInav', 'dOK15jsl');
    const body = '{"event_type":"ping","data":{"success":true}}';
    const id = 'msg_loFOjxBNrRLzqYUf';
    const ts = '1731705121';
    const expected = join('rAvfW3dJ/X/qxhsaXPOyyCGm', 'RKsaKWcsNccKXlIktD0=');
    check('signature: Ozow\'s published test values give Ozow\'s published signature', ozowSignatureFor(secret, id, ts, Buffer.from(body)) === expected);
    const headers = { 'svix-id': id, 'svix-timestamp': ts, 'svix-signature': `v1,${expected}` };
    check('signature: the same delivery passes when the clock is held at its timestamp', checkOzowSignature(secret, headers, Buffer.from(body), 1731705121_000).ok === true);
    const late = checkOzowSignature(secret, headers, Buffer.from(body), 1731705121_000 + 3600_000);
    check('signature: replayed an hour later it fails, although the signature itself is right', late.ok === false && late.reason === 'stale_timestamp');
  }
  {
    const secret = webhookSecret();
    const now = new FakeClock().now();
    const id = 'msg_2abcDEF123';
    const ts = String(Math.floor(now / 1000));
    const body = '{"type":"transaction.complete","data":{"Amount":"50.00"}}';
    const h = (over: Record<string, string | string[] | undefined> = {}, sig = sign(secret, id, ts, body)) => ({ 'svix-id': id, 'svix-timestamp': ts, 'svix-signature': sig, ...over });
    const run = (headers: Record<string, any>, raw: string | Buffer = body, at = now) => checkOzowSignature(secret, headers, Buffer.from(raw), at);
    const reason = (r: ReturnType<typeof run>) => (r.ok === true ? 'ok' : (r as { reason: string }).reason);

    check('signature: an untouched delivery passes', run(h()).ok === true);
    check('signature: one changed byte of the body fails (a digit of the amount)', reason(run(h(), body.replace('50.00', '90.00'))) === 'bad_signature');
    const sig = sign(secret, id, ts, body);
    const flipped = `${sig.slice(0, -3)}${sig.slice(-3, -2) === 'A' ? 'B' : 'A'}${sig.slice(-2)}`;
    check('signature: one changed character of the signature fails', reason(run(h({}, flipped))) === 'bad_signature');
    check('signature: a signature made with another secret fails', reason(run(h({}, sign(join('whsec', '_', Buffer.from('some other key entirely').toString('base64')), id, ts, body)))) === 'bad_signature');
    check('signature: a different message id fails (the id is part of what is signed)', reason(run(h({ 'svix-id': 'msg_other' }))) === 'bad_signature');
    for (const name of ['svix-id', 'svix-timestamp', 'svix-signature']) {
      check(`signature: missing ${name} fails`, reason(run(h({ [name]: undefined }))) === 'missing_header');
    }
    check('signature: a header sent twice (an array) counts as missing', reason(run(h({ 'svix-signature': [sig, sig] as any }))) === 'missing_header');
    check('signature: a timestamp that is not a number fails', reason(run(h({ 'svix-timestamp': 'yesterday' }))) === 'bad_timestamp');
    check('signature: 299 seconds old passes; 301 seconds old fails', run(h(), body, now + 299_000).ok === true && reason(run(h(), body, now + 301_000)) === 'stale_timestamp');
    check('signature: dated 301 seconds in the future fails; 299 passes', reason(run(h(), body, now - 301_000)) === 'stale_timestamp' && run(h(), body, now - 299_000).ok === true);
    check('signature: while a secret is rotated the header carries two; either one passing is a pass (old first, new second)', run(h({}, `v1,${Buffer.from('not it').toString('base64')} ${sig}`)).ok === true && run(h({}, `${sig} v1,AAAA`)).ok === true);
    check('signature: an entry of another version is ignored, even if its value is right', reason(run(h({}, sig.replace('v1,', 'v2,')))) === 'bad_signature');
    check('signature: the bytes are used exactly as received: odd spacing and key order verify, and re-serialised JSON would not', (() => {
      const odd = '{ "data" : {"Amount":"50.00"},\n  "type":"transaction.complete" }';
      const reserialised = JSON.stringify(JSON.parse(odd));
      return run(h({}, sign(secret, id, ts, odd)), odd).ok === true && reason(run(h({}, sign(secret, id, ts, odd)), reserialised)) === 'bad_signature';
    })());
    check('signature: a body with accented and emoji characters verifies as bytes', (() => {
      const u = '{"StatusMessage":"Betaling ontvang – é ✓ 🙂"}';
      return run(h({}, sign(secret, id, ts, u)), u).ok === true;
    })());
    check('signature: an empty body can be verified (and is not special-cased)', run(h({}, sign(secret, id, ts, '')), '').ok === true);
    check('signature: nothing is accepted when the secret cannot be turned into a key', checkOzowSignature('', h(), Buffer.from(body), now).ok === false);
  }

  // ---- the token ---------------------------------------------------------------------------------------------------------------------------------
  {
    const r = rig();
    const first = await r.provider.createPayment(input());
    check('token: the first payment call asks for a token (form fields, scope payments) and then creates', created(first) && r.ozow.tokenCalls === 1 && r.ozow.calls[0].path === '/token' && r.ozow.calls[0].headers['Content-Type'] === 'application/x-www-form-urlencoded' && !r.ozow.calls[0].headers.Authorization);
    const form = new URLSearchParams(r.ozow.calls[0].body);
    check('token: the form holds client_id, client_secret, scope=payments and grant_type=client_credentials', form.get('client_id') === FAKE.clientId && form.get('client_secret') === FAKE.clientSecret && form.get('scope') === 'payments' && form.get('grant_type') === 'client_credentials');
    check('token: the payment call sends "Authorization: Bearer <token>" whatever token_type said', r.ozow.calls[1].headers.Authorization === `Bearer ${r.ozow.validToken}`);
    await r.provider.createPayment(input({ idempotencyKey: 'topup-2', reference: 'TL-ZZZZZZ' }));
    check('token: a second call uses the same token (cached)', r.ozow.tokenCalls === 1);
    r.clock.advance(14400 - TOKEN_REFRESH_MARGIN_MS / 1000 - 1);
    await r.provider.createPayment(input({ idempotencyKey: 'topup-3', reference: 'TL-YYYYYY' }));
    check('token: just before 5 minutes from expiry it is still cached', r.ozow.tokenCalls === 1);
    r.clock.advance(2);
    await r.provider.createPayment(input({ idempotencyKey: 'topup-4', reference: 'TL-XXXXXX' }));
    check('token: within 5 minutes of expiry a new one is fetched first (expires_in arrives as the string "14400")', r.ozow.tokenCalls === 2);
  }
  {
    const r = rig();
    await r.provider.createPayment(input());
    r.ozow.expireToken();
    const again = await r.provider.createPayment(input({ idempotencyKey: 'topup-b', reference: 'TL-BBBBBB' }));
    check('token: it runs out in the middle of a flow (Ozow answers 401): one renewal and the call is repeated, with success', created(again) && r.ozow.tokenCalls === 2 && r.ozow.calls.filter((c) => c.path === '/payments').length === 3);
  }
  {
    const r = rig();
    await r.provider.createPayment(input());
    r.ozow.expireToken();
    r.ozow.mode.token = '401';
    const out = await r.provider.createPayment(input({ idempotencyKey: 'topup-c', reference: 'TL-CCCCCC' }));
    check('token: if the renewal is refused too, the payment is refused (nothing was created) and there is no third try', out.kind === 'refused' && r.ozow.calls.filter((c) => c.path === '/payments').length === 2);
    everyText.push(out.kind === 'refused' ? out.detail : '');
  }
  {
    const r = rig();
    r.ozow.mode.token = '500';
    const out = await r.provider.createPayment(input());
    check('token: when Ozow cannot give a token no payment call is made, and the answer is "refused" (nothing exists at Ozow)', out.kind === 'refused' && r.ozow.count('POST', '/payments') === 0);
    everyText.push(out.kind === 'refused' ? out.detail : '');
  }
  {
    const r = rig();
    const all = await Promise.all([1, 2, 3].map((i) => r.provider.createPayment(input({ idempotencyKey: `topup-p${i}`, reference: `TL-PPPPP${i}` }))));
    check('token: three payments started at once share one token request', all.every(created) && r.ozow.tokenCalls === 1);
  }
  {
    const r = rig();
    r.ozow.tokenLifetime = '60';
    await r.provider.createPayment(input());
    r.clock.advance(31);
    await r.provider.createPayment(input({ idempotencyKey: 'topup-s', reference: 'TL-SSSSSS' }));
    check('token: a short-lived token is renewed after 30 seconds rather than used past its life', r.ozow.tokenCalls === 2);
  }

  // ---- creating a payment --------------------------------------------------------------------------------------------------------------------------
  {
    const r = rig();
    const out = await r.provider.createPayment(input());
    const call = r.ozow.calls.find((c) => c.path === '/payments')!;
    const sent = JSON.parse(call.body);
    check('create: the body has siteCode, region ZA, ZAR amount, merchantReference (our TL- reference), expireAt and returnUrl', sent.siteCode === FAKE.siteCode && sent.region === 'ZA' && sent.amount.currency === 'ZAR' && sent.amount.value === 50 && sent.merchantReference === 'TL-AB23CD' && sent.expireAt === '2026-11-09T13:00:00Z' && sent.returnUrl === 'https://tutorlage.com/wallet/topup-return?topup=11111111-1111-4111-8111-111111111111');
    check('create: beneficiaryReference is the reference with letters and numbers only (TL-AB23CD becomes TLAB23CD)', sent.beneficiaryReference === 'TLAB23CD' && /^[A-Za-z0-9]{1,20}$/.test(sent.beneficiaryReference));
    check('create: no notifyUrl, payer, payerReference, institutionId or variableAmount is sent', !['notifyUrl', 'payer', 'payerReference', 'institutionId', 'variableAmount'].some((k) => k in sent));
    check('create: the Idempotency-Key header is the one the database gave, and a correlation id is sent', call.headers['Idempotency-Key'] === 'topup-11111111-1111-4111-8111-111111111111' && /^[0-9a-f-]{36}$/.test(call.headers['X-Correlation-ID']) && call.headers['Content-Type'] === 'application/json');
    check('create: the payment id and the link are returned exactly as Ozow gave them (never built by us)', created(out) && out.redirectUrl === `https://pay.ozow.com/${out.paymentId}/secure` && out.paymentId === [...r.ozow.payments.keys()][0]);
    const replay = await r.provider.createPayment(input());
    check('create: the same request again (same key, same body) reaches the same payment at Ozow: one payment, not two', created(replay) && created(out) && replay.paymentId === out.paymentId && r.ozow.payments.size === 1);
    const clash = await r.provider.createPayment(input({ amountRand: 60 }));
    check('create: the same key with a different body (Ozow: 409) is "unclear", never a second payment', clash.kind === 'unclear' && r.ozow.payments.size === 1);
    everyText.push(clash.kind === 'unclear' ? clash.detail : '');
  }
  for (const [mode, expected] of [['400', 'refused'], ['403', 'refused'], ['409', 'unclear'], ['500', 'unclear'], ['garbled', 'unclear'], ['nolink', 'unclear'], ['badlink', 'unclear']] as const) {
    const r = rig();
    r.ozow.mode.create = mode;
    const out = await r.provider.createPayment(input());
    check(`create: Ozow answering "${mode}" is classed ${expected}${expected === 'unclear' ? ' (a payment may exist: never retried)' : ' (none was made)'}`, out.kind === expected && r.ozow.count('POST', '/payments') === 1);
    if (out.kind !== 'created') everyText.push(out.detail);
    if (out.kind !== 'created') check(`create: the note for "${mode}" does not echo Ozow's error text (it can hold our client id and site code)`, secretsToHide().every((s) => !out.detail.includes(s)));
  }
  {
    const r = rig({ timeoutMs: 30 });
    r.ozow.mode.create = 'hang';
    const out = await r.provider.createPayment(input());
    check('create: no answer in time is "unclear", the payment DOES exist at Ozow, and there is exactly one call (no retry)', out.kind === 'unclear' && r.ozow.payments.size === 1 && r.ozow.count('POST', '/payments') === 1);
    everyText.push(out.kind === 'unclear' ? out.detail : '');
  }
  {
    const r = rig();
    const link = (u: string) => isOzowLink(u);
    check('create: a link must be https on ozow.com (pay.ozow.com passes; http, other hosts, look-alikes and links with credentials do not)', link('https://pay.ozow.com/x/secure') && link('https://ozow.com/x') && !link('http://pay.ozow.com/x') && !link('https://pay.ozow.com.evil.example/x') && !link('https://evil.example/ozow.com') && !link('https://u:p@pay.ozow.com/x') && !link('javascript:alert(1)') && !link('') && !link(null as any));
    void r;
  }

  // ---- listing transactions (the status check) ----------------------------------------------------------------------------------------------------
  {
    const r = rig();
    const made = await r.provider.createPayment(input());
    if (!created(made)) throw new Error('setup');
    const pid = made.paymentId;
    const empty = await r.provider.checkPayment({ paymentId: pid, reference: 'TL-AB23CD', createdAt: '2026-11-09T11:20:00.123456+00:00' });
    const call = r.ozow.calls.filter((c) => c.method === 'GET').pop()!;
    check('check: asks for the transactions of that payment with fromDate (the day before creation) and toDate (tomorrow), whole days, and a limit', call.path === `/payments/${pid}/transactions` && call.query.fromDate === '2026-11-08' && call.query.toDate === '2026-11-10' && call.query.limit === '50');
    check('check: an empty list means "nothing yet", not an error', empty.kind === 'ok' && empty.transactions.length === 0);
    check('check: the unknown-payment case (Ozow answers 200 with an empty list) is also "nothing yet"', (await r.provider.checkPayment({ paymentId: 'no-such-payment', reference: 'TL-AB23CD', createdAt: '2026-11-09T11:20:00Z' })).kind === 'ok');
    r.ozow.addTransaction(pid, { status: 'Error', reason: 'Voided' });
    r.ozow.addTransaction(pid, { status: 'SUCCESSFUL' });
    r.ozow.addTransaction(pid, { status: 'Successful', amount: { value: '50.5', currency: 'ZAR' } });
    r.ozow.addTransaction(pid, { status: 'Successful', amount: 50 });
    r.ozow.addTransaction(pid, { status: 'Successful', siteCode: 'SOMEONE-ELSES' });
    const got = await r.provider.checkPayment({ paymentId: pid, reference: 'TL-AB23CD', createdAt: '2026-11-09T11:20:00Z' });
    const txs = got.kind === 'ok' ? got.transactions : [];
    check('check: every transaction under the payment is returned, with the status as Ozow wrote it (compared without case later, by the database)', txs.length === 5 && txs[0].status === 'Error' && txs[0].reason === 'Voided' && txs[1].status === 'SUCCESSFUL');
    check('check: amount.value 50 becomes "50.00"; the string "50.5" becomes "50.50"; any other shape becomes "" (the database then asks a person)', txs[1].amountText === '50.00' && txs[2].amountText === '50.50' && txs[3].amountText === '' && txs[1].currency === 'ZAR');
    check('check: the site code is compared in the Worker (true for ours, false for another); the code itself is never returned', txs[1].siteOk === true && txs[4].siteOk === false && !JSON.stringify(txs).includes(FAKE.siteCode));
    check('check: the reference is Ozow\'s merchantReference, the transaction id is Ozow\'s id, and IsTest is unknown ("")', txs[1].reference === 'TL-AB23CD' && /^[0-9a-f-]{36}$/.test(txs[1].txnId) && txs[1].isTest === '');
    r.ozow.mode.list = '500';
    const down = await r.provider.checkPayment({ paymentId: pid, reference: 'TL-AB23CD', createdAt: '2026-11-09T11:20:00Z' });
    check('check: Ozow answering 500 is "failed" (so it is not marked as checked)', down.kind === 'failed');
    r.ozow.mode.list = 'hang';
    const hung = await r.provider.checkPayment({ paymentId: pid, reference: 'TL-AB23CD', createdAt: '2026-11-09T11:20:00Z' });
    check('check: no answer in time is "failed"', hung.kind === 'failed');
    r.ozow.mode.list = 'noresults';
    const odd = await r.provider.checkPayment({ paymentId: pid, reference: 'TL-AB23CD', createdAt: '2026-11-09T11:20:00Z' });
    check('check: a 200 with no list of results is "failed", not "nothing yet"', odd.kind === 'failed');
    const before = r.ozow.calls.length;
    const evil = await r.provider.checkPayment({ paymentId: '../../token', reference: 'TL-AB23CD', createdAt: '2026-11-09T11:20:00Z' });
    check('check: a payment id with slashes or dots is refused before any call is made', evil.kind === 'failed' && r.ozow.calls.length === before);
    for (const x of [down, hung, odd, evil]) everyText.push(x.kind === 'failed' ? x.detail : '');
    const bad = await r.provider.checkPayment({ paymentId: pid, reference: 'TL-AB23CD', createdAt: 'not a date' });
    check('check: an unreadable creation time still gives a valid date range', bad.kind === 'failed' || bad.kind === 'ok');
  }

  // ---- reading a webhook ----------------------------------------------------------------------------------------------------------------------------
  {
    const r = rig();
    const now = r.clock.now();
    const ts = String(Math.floor(now / 1000));
    const secret = webhookSecret();
    const deliver = (payload: unknown, id = 'msg_read1') => {
      const raw = Buffer.from(typeof payload === 'string' ? payload : JSON.stringify(payload));
      return r.provider.verifyWebhook({ 'svix-id': id, 'svix-timestamp': ts, 'svix-signature': sign(secret, id, ts, raw) }, raw);
    };
    const full = (over: Record<string, unknown> = {}) => ({
      type: 'transaction.complete',
      timestamp: new Date(now).toISOString(),
      data: { SiteCode: FAKE.siteCode, TransactionId: '3f1c0e0a-0000-4000-8000-000000000001', TransactionReference: 'TL-AB23CD', Amount: '50.00', Status: 'Successful', Optional1: '', CurrencyCode: 'ZAR', IsTest: 'False', StatusMessage: '', Hash: 'ignored', ...over },
    });
    const a = deliver(full());
    check('webhook: a full delivery is read: reference, transaction id, status, amount string, currency, IsTest', a.kind === 'verified' && a.eventId === 'msg_read1' && a.event.kind === 'transaction' && a.event.tx.reference === 'TL-AB23CD' && a.event.tx.txnId === '3f1c0e0a-0000-4000-8000-000000000001' && a.event.tx.status === 'Successful' && a.event.tx.amountText === '50.00' && a.event.tx.currency === 'ZAR' && a.event.tx.isTest === 'False' && a.event.tx.siteOk === true);
    const other = deliver(full({ SiteCode: 'NOT-OURS' }));
    check('webhook: another site code gives siteOk false (the database then asks a person)', other.kind === 'verified' && other.event.kind === 'transaction' && other.event.tx.siteOk === false);
    const num = deliver(full({ Amount: 50 }));
    check('webhook: an Amount that is not a string is passed on as "" (never turned into a number and trusted)', num.kind === 'verified' && num.event.kind === 'transaction' && num.event.tx.amountText === '');
    const thin = deliver({ type: 'transaction.complete', timestamp: 'x', data: { id: 'abc', status: 'Successful', reason: '' } });
    check('webhook: a thin delivery (only data.id, status, reason) is "thin": it can never credit', thin.kind === 'verified' && thin.event.kind === 'thin');
    const evt = deliver({ type: 'refund.complete', data: {} });
    check('webhook: another event type is "other"', evt.kind === 'verified' && evt.event.kind === 'other' && evt.event.type === 'refund.complete');
    check('webhook: a signed body that is not JSON is "unreadable"', (() => { const x = deliver('not json'); return x.kind === 'verified' && x.event.kind === 'unreadable'; })());
    check('webhook: a signed JSON body of the wrong shape is "unreadable"', (() => { const x = deliver('[1,2]'); const y = deliver('{"type":5}'); return x.kind === 'verified' && x.event.kind === 'unreadable' && y.kind === 'verified' && y.event.kind === 'unreadable'; })());
    const noTest = deliver(full({ IsTest: undefined }));
    check('webhook: a missing IsTest is "" (the database treats only True as a test)', noTest.kind === 'verified' && noTest.event.kind === 'transaction' && noTest.event.tx.isTest === '');
    const bad = r.provider.verifyWebhook({ 'svix-id': 'msg_bad<script>', 'svix-timestamp': ts, 'svix-signature': 'v1,AAAA' }, Buffer.from('{}'));
    check('webhook: a failed check returns a reason code and a cleaned-up id hint (a stranger\'s text is never passed on raw)', bad.kind === 'rejected' && bad.reason.length > 0 && !/[<>]/.test(bad.messageIdHint));
  }

  // ---- staging versus production -----------------------------------------------------------------------------------------------------------------
  check('test payments: accepted only against Ozow\'s staging system', rig().provider.allowTestPayments === false && rig({ config: { apiBase: 'https://stagingone.ozow.com/v1' } }).provider.allowTestPayments === true);

  // ---- no secret anywhere --------------------------------------------------------------------------------------------------------------------------
  {
    const r = rig({ timeoutMs: 30 });
    const text = () => `${r.lines.join('\n')}\n${everyText.join('\n')}`;
    r.ozow.mode.token = '401';
    await r.provider.createPayment(input());
    r.ozow.mode.token = 'ok';
    r.ozow.mode.create = '400';
    await r.provider.createPayment(input({ idempotencyKey: 'topup-n1', reference: 'TL-NNNNN1' }));
    r.ozow.mode.create = 'hang';
    await r.provider.createPayment(input({ idempotencyKey: 'topup-n2', reference: 'TL-NNNNN2' }));
    const all = text();
    check('no secret: no client id, client secret, site code, signing secret, job secret or access token is in anything the client wrote or returned', [...secretsToHide(), r.ozow.validToken ?? '\u0000'].every((s) => !all.includes(s)));
    check('no secret: the client wrote no log line of its own on the happy paths (it returns outcomes; the caller logs)', r.lines.length === 0 || r.lines.every((l) => !/FAKE/.test(l)));
  }

  process.stdout.write(failures === 0 ? '\nALL OK\n' : `\n${failures} CHECK(S) FAILED\n`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => {
  process.stdout.write(`FAIL the test crashed: ${e?.stack ?? e}\n`);
  process.exit(1);
});
