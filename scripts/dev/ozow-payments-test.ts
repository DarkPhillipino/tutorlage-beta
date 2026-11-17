// Checks on the Ozow PAYMENTS API client for the online wallet top-up: server/ozowPayments.ts, run against a PRETEND Ozow (scripts/dev/fake-ozow-payments.ts): no network, no real key, no real money.
// Covers: the settings; Ozow's OWN worked hash example (the page's inputs, its expected SHA512; the private key printed there is the placeholder text, used as the key here) and the field
// order, the empty-field rule, two decimals and lowercasing; the request we send (every field, the hash an independent copy of Ozow's algorithm accepts, the private key never in it); every
// kind of answer to a create (Ozow's rejection is an HTTP 200); the status check; the notification hash (13 fields, tampering, repeats, constant time); the one translated word
// ("Complete" -> "Successful"); the test flag; and that no key reaches a returned note.
// Run: npx tsx scripts/dev/ozow-payments-test.ts
import crypto from 'node:crypto';
import fs from 'node:fs';
import { FakeClock } from './fake-ozow';
import { FAKE_PAYMENTS, FakeOzowPayments, ozowNotificationHash, ozowRequestHash, paymentsSecretsToHide } from './fake-ozow-payments';
import {
  DEFAULT_WORKER_ORIGIN, NOTIFICATION_HASH_ORDER, OZOW_PAYMENTS_PRODUCTION_BASE, OZOW_PAYMENTS_PROVIDER, OZOW_PAYMENTS_STAGING_BASE, REQUEST_HASH_ORDER,
  createOzowPaymentsProvider, errorCodeOf, expiryText, internalStatus, isOzowPaymentLink, notificationHashCheck, ozowPaymentsConfigFromEnv, requestHashCheck, sameHash, twoDecimals,
} from '../../server/ozowPayments';
import type { OzowPaymentsConfig } from '../../server/ozowPayments';

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) failures += 1;
  process.stdout.write(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}\n`);
};
const read = (f: string) => fs.readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8');

const baseConfig = (over: Partial<OzowPaymentsConfig> = {}): OzowPaymentsConfig => ({
  apiKey: FAKE_PAYMENTS.apiKey,
  privateKey: FAKE_PAYMENTS.privateKey,
  siteCode: FAKE_PAYMENTS.siteCode,
  apiBase: OZOW_PAYMENTS_PRODUCTION_BASE,
  returnOrigin: 'https://tutorlage.com',
  workerOrigin: DEFAULT_WORKER_ORIGIN,
  isTest: false,
  ...over,
});
const goodEnv = (): Record<string, string> => ({
  OZOW_API_KEY: FAKE_PAYMENTS.apiKey,
  OZOW_PRIVATE_KEY: FAKE_PAYMENTS.privateKey,
  OZOW_SITE_CODE: FAKE_PAYMENTS.siteCode,
  OZOW_RETURN_ORIGIN: 'https://tutorlage.com',
});
const TOPUP = '11111111-2222-4333-8444-555555555555';
const input = (over: Record<string, unknown> = {}) => ({ topupId: TOPUP, reference: 'TL-ABC234', amountRand: 35, expiresAt: '2026-11-17T14:30:45Z', idempotencyKey: `topup-${TOPUP}`, returnPath: `/wallet/topup-return?topup=${TOPUP}`, ...over });

function rig(o: { config?: Partial<OzowPaymentsConfig>; timeoutMs?: number } = {}) {
  const clock = new FakeClock();
  const ozow = new FakeOzowPayments(clock);
  let n = 0;
  const provider = createOzowPaymentsProvider(baseConfig(o.config), ozow.fetch, { timeoutMs: o.timeoutMs ?? 40, newId: () => `00000000-0000-4000-8000-${String((n += 1)).padStart(12, '0')}` });
  return { clock, ozow, provider };
}
const noKeys = (text: string) => paymentsSecretsToHide().every((s) => !text.includes(s));

(async () => {
  // =============================================================== settings ===================================================================
  {
    const ok = ozowPaymentsConfigFromEnv(goodEnv());
    check('settings: with the three secrets and the site address, the provider is set up, live (not a rehearsal), on Ozow\'s production address and the Worker\'s own address',
      ok.config !== null && ok.missing.length === 0 && ok.problems.length === 0 && ok.config.apiBase === OZOW_PAYMENTS_PRODUCTION_BASE && ok.config.isTest === false && ok.config.workerOrigin === DEFAULT_WORKER_ORIGIN && ok.config.returnOrigin === 'https://tutorlage.com');
    for (const k of ['OZOW_API_KEY', 'OZOW_PRIVATE_KEY', 'OZOW_SITE_CODE', 'OZOW_RETURN_ORIGIN']) {
      const env = goodEnv();
      delete env[k];
      const r = ozowPaymentsConfigFromEnv(env);
      check(`settings: without ${k} nothing is set up and the report names it (never a value)`, r.config === null && r.missing.join() === k && noKeys(JSON.stringify(r)));
    }
    const odd = (over: Record<string, string>) => ozowPaymentsConfigFromEnv({ ...goodEnv(), ...over });
    check('settings: a base address that is not Ozow\'s is refused', odd({ OZOW_PAYMENTS_BASE: 'https://evil.example.com' }).config === null && odd({ OZOW_PAYMENTS_BASE: 'http://api.ozow.com' }).config === null && odd({ OZOW_PAYMENTS_BASE: 'https://one.ozow.com/v1' }).config === null);
    check('settings: Ozow\'s staging address is accepted, and is the only other one', odd({ OZOW_PAYMENTS_BASE: OZOW_PAYMENTS_STAGING_BASE }).config?.apiBase === OZOW_PAYMENTS_STAGING_BASE);
    check('settings: the site address must be https, an address only, not localhost', odd({ OZOW_RETURN_ORIGIN: 'http://tutorlage.com' }).config === null && odd({ OZOW_RETURN_ORIGIN: 'https://tutorlage.com/x' }).config === null && odd({ OZOW_RETURN_ORIGIN: 'https://localhost' }).config === null);
    check('settings: the Worker\'s own address must be workers.dev or tutorlage.com, https, and short enough for Ozow\'s 150 characters', odd({ OZOW_NOTIFY_ORIGIN: 'https://evil.example.com' }).config === null && odd({ OZOW_NOTIFY_ORIGIN: 'https://api.tutorlage.com' }).config?.workerOrigin === 'https://api.tutorlage.com'
      && odd({ OZOW_NOTIFY_ORIGIN: `https://${'a'.repeat(110)}.workers.dev` }).config === null);
    check('settings: a site code with odd characters, or a key with a space, is refused', odd({ OZOW_SITE_CODE: 'bad code!' }).config === null && odd({ OZOW_API_KEY: 'has a space in it' }).config === null && odd({ OZOW_PRIVATE_KEY: 'short' }).config === null);
    const same = odd({ OZOW_PRIVATE_KEY: FAKE_PAYMENTS.apiKey });
    check('settings: the API key and the private key are two different keys; pasting one into both is refused (and no value is in the report)', same.config === null && same.problems.some((p) => /same value/.test(p)) && noKeys(JSON.stringify(same)));
    check('settings: the rehearsal flag reads true / 1 / yes and nothing else', odd({ OZOW_PAYMENTS_TEST: 'true' }).config?.isTest === true && odd({ OZOW_PAYMENTS_TEST: 'YES' }).config?.isTest === true && odd({ OZOW_PAYMENTS_TEST: 'false' }).config?.isTest === false && odd({ OZOW_PAYMENTS_TEST: 'maybe' }).config?.isTest === false);
  }

  // =============================================================== the hash: Ozow's own example ===============================================
  // From Ozow's Hosted Checkout (Payments API) page, "Hash check example". The page prints the key as the placeholder text "[your private key]" and the resulting hash below; that hash
  // is the SHA512 of the lowercased string WITH THAT PLACEHOLDER TEXT as the key (checked when this test was written), so the page's own example is a complete test vector.
  const OZOW_EXAMPLE = {
    siteCode: 'TSTSTE0001', countryCode: 'ZA', currencyCode: 'ZAR', amount: '25.00', transactionReference: '123', bankReference: 'ABC123',
    cancelUrl: 'https://demo.ozow.com/cancel.aspx', errorUrl: 'https://demo.ozow.com/error.aspx', successUrl: 'https://demo.ozow.com/success.aspx', notifyUrl: 'https://demo.ozow.com/notify.aspx', isTest: false,
  };
  const OZOW_EXAMPLE_KEY = '[your private key]';
  const OZOW_EXAMPLE_HASH = '6f4a57ab3cfefdad8bae15fa49dfb4ac3ab6e8ef48828ef78a7dc6968df59b0e24671ac05c68aed41bbe182a82660cb7e54ce80a98b5b1e2f33a2a236c5e6d50';
  check('hash: Ozow\'s own worked example gives the hash Ozow prints', requestHashCheck(OZOW_EXAMPLE, OZOW_EXAMPLE_KEY) === OZOW_EXAMPLE_HASH);
  check('hash: ...and so does the test\'s own independent copy of the algorithm (so the two cannot drift together unnoticed)', ozowRequestHash(OZOW_EXAMPLE, OZOW_EXAMPLE_KEY) === OZOW_EXAMPLE_HASH);
  check('hash: the page\'s concatenated string is exactly what is hashed (everything lowercase, the key last)',
    crypto.createHash('sha512').update('tstste0001zazar25.00123abc123https://demo.ozow.com/cancel.aspxhttps://demo.ozow.com/error.aspxhttps://demo.ozow.com/success.aspxhttps://demo.ozow.com/notify.aspxfalse[your private key]').digest('hex') === OZOW_EXAMPLE_HASH);
  check('hash: a real key gives a different hash, and a different key gives a different one again', requestHashCheck(OZOW_EXAMPLE, 'another-key-1') !== OZOW_EXAMPLE_HASH && requestHashCheck(OZOW_EXAMPLE, 'another-key-1') !== requestHashCheck(OZOW_EXAMPLE, 'another-key-2'));
  check('hash: the field order is Ozow\'s (positions 1 to 28) and starts the way the worked example does', REQUEST_HASH_ORDER.length === 28 && REQUEST_HASH_ORDER.slice(0, 6).join() === 'siteCode,countryCode,currencyCode,amount,transactionReference,bankReference'
    && REQUEST_HASH_ORDER.indexOf('isTest') === 16 && REQUEST_HASH_ORDER.indexOf('expiryDateUtc') === 22 && REQUEST_HASH_ORDER.indexOf('notifyUrl') === 15);
  check('hash: the order matters (swapping two fields changes the hash) but the order the object lists them in does not', requestHashCheck({ ...OZOW_EXAMPLE, cancelUrl: OZOW_EXAMPLE.errorUrl, errorUrl: OZOW_EXAMPLE.cancelUrl }, OZOW_EXAMPLE_KEY) !== OZOW_EXAMPLE_HASH
    && requestHashCheck({ isTest: false, notifyUrl: OZOW_EXAMPLE.notifyUrl, successUrl: OZOW_EXAMPLE.successUrl, errorUrl: OZOW_EXAMPLE.errorUrl, cancelUrl: OZOW_EXAMPLE.cancelUrl, bankReference: 'ABC123', transactionReference: '123', amount: '25.00', currencyCode: 'ZAR', countryCode: 'ZA', siteCode: 'TSTSTE0001' }, OZOW_EXAMPLE_KEY) === OZOW_EXAMPLE_HASH);
  check('hash: an empty or missing field adds nothing (not a space, not "null")', requestHashCheck({ ...OZOW_EXAMPLE, optional1: '', customer: undefined, selectedBankId: null }, OZOW_EXAMPLE_KEY) === OZOW_EXAMPLE_HASH);
  check('hash: a boolean is written true / false (isTest true is in the hash, and differs from false)', requestHashCheck({ ...OZOW_EXAMPLE, isTest: true }, OZOW_EXAMPLE_KEY) !== OZOW_EXAMPLE_HASH && ozowRequestHash({ ...OZOW_EXAMPLE, isTest: true }, OZOW_EXAMPLE_KEY) === requestHashCheck({ ...OZOW_EXAMPLE, isTest: true }, OZOW_EXAMPLE_KEY));
  check('hash: the amount is two decimals (100.00, never 100 or 100.0); the money we send is whole rand and comes out right', twoDecimals(100) === '100.00' && twoDecimals('100') === '100.00' && twoDecimals('100.5') === '100.50' && twoDecimals('100.05') === '100.05' && twoDecimals(35) === '35.00' && twoDecimals('abc') === 'abc');
  check('hash: a different amount spelling is a different hash (so a wrong spelling would be refused by Ozow, not silently accepted)', requestHashCheck({ ...OZOW_EXAMPLE, amount: '25' }, OZOW_EXAMPLE_KEY) !== OZOW_EXAMPLE_HASH);
  check('hash: the expiry (position 23) comes after isTest and before nothing we send: with it, the same fields give the independent copy\'s answer', (() => {
    const withExpiry = { ...OZOW_EXAMPLE, expiryDateUtc: '2026-11-17 14:30' };
    return requestHashCheck(withExpiry, OZOW_EXAMPLE_KEY) === ozowRequestHash(withExpiry, OZOW_EXAMPLE_KEY) && requestHashCheck(withExpiry, OZOW_EXAMPLE_KEY) !== OZOW_EXAMPLE_HASH;
  })());

  // =============================================================== the notification hash =====================================================
  const NOTE = { SiteCode: 'TSTSTE0001', TransactionId: 'c02dc1c9-a117-45cf-b375-d304cf434a52', TransactionReference: 'ORDER-001', Amount: '100.00', Status: 'Complete', Optional1: '', Optional2: '', Optional3: '', Optional4: '', Optional5: '', CurrencyCode: 'ZAR', IsTest: 'False', StatusMessage: '' };
  check('notification hash: 13 fields, Ozow\'s order (CurrencyCode after the five optionals; SubStatus and Hash are not in it)', NOTIFICATION_HASH_ORDER.length === 13 && NOTIFICATION_HASH_ORDER.join() === 'SiteCode,TransactionId,TransactionReference,Amount,Status,Optional1,Optional2,Optional3,Optional4,Optional5,CurrencyCode,IsTest,StatusMessage');
  check('notification hash: the string is siteCode, transaction id, reference, amount, status, currency, IsTest, then the key, all lowercase (the page\'s own handler, written out)',
    notificationHashCheck(NOTE, 'k-1') === crypto.createHash('sha512').update('tstste0001c02dc1c9-a117-45cf-b375-d304cf434a52order-001100.00completezarfalsek-1').digest('hex'));
  check('notification hash: and it equals the test\'s independent copy', notificationHashCheck(NOTE, 'k-1') === ozowNotificationHash(NOTE, 'k-1') && notificationHashCheck({ ...NOTE, StatusMessage: 'User cancelled transaction', Status: 'Cancelled' }, 'k-1') === ozowNotificationHash({ ...NOTE, StatusMessage: 'User cancelled transaction', Status: 'Cancelled' }, 'k-1'));
  check('notification hash: it is NOT the request\'s order (reusing the request order would refuse every notification)', notificationHashCheck(NOTE, 'k-1') !== requestHashCheck({ siteCode: NOTE.SiteCode, currencyCode: NOTE.CurrencyCode, amount: NOTE.Amount, transactionReference: NOTE.TransactionReference, isTest: false }, 'k-1'));
  check('sameHash: equal in any letter case passes; one character off, a short one and an empty one fail', sameHash('ABCDEF', 'abcdef') && !sameHash('abcdee', 'abcdef') && !sameHash('abcde', 'abcdef') && !sameHash('', 'abcdef'));

  // =============================================================== the one translated word ====================================================
  check('status: Ozow\'s "Complete" is the one paid word and becomes the database\'s "Successful"', internalStatus('Complete') === 'Successful' && internalStatus('complete') === 'Successful' && internalStatus(' COMPLETE ') === 'Successful');
  check('status: every other word passes through untouched, so nothing else can be credited (PendingInvestigation, Completed, Successful from nowhere is already the paid word and stays so)',
    ['PendingInvestigation', 'Pending', 'Cancelled', 'Error', 'Abandoned', 'Completed', 'Completely', 'Incomplete', 'Voided', 'Expired', '', 'weird'].every((w) => internalStatus(w) === w) && internalStatus('Successful') === 'Successful');

  // =============================================================== error codes, expiry, links =================================================
  check('error codes: Ozow\'s wording (errors/payments-api) becomes a short code of ours; unknown wording is "rejected"', errorCodeOf('The HashCheck value has failed') === 'hash_failed' && errorCodeOf('Duplicate transaction reference not allowed.') === 'duplicate_reference'
    && errorCodeOf('Merchant has a maximum transaction amount of 0.01') === 'amount_limit' && errorCodeOf('The amount is less than the minimum amount') === 'amount_limit' && errorCodeOf('Merchant is not allowed to perform API transactions') === 'api_not_enabled'
    && errorCodeOf('Bank reference missing') === 'bank_reference' && errorCodeOf('Invalid country code') === 'country_or_currency' && errorCodeOf('There is no active merchant that exists with Site Code: \'X\'') === 'site_not_active'
    && errorCodeOf('Merchant has not been activated for dynamic banking details') === 'banking_details' && errorCodeOf('Something no page mentions') === 'rejected' && errorCodeOf(null) === 'rejected');
  check('expiry: an ISO time becomes Ozow\'s yyyy-MM-dd HH:mm in UTC; rubbish becomes nothing', expiryText('2026-11-17T14:30:45Z') === '2026-11-17 14:30' && expiryText('2026-11-17T23:59:59.999Z') === '2026-11-17 23:59' && expiryText('not a date') === '');
  check('links: only an https address on ozow.com (the payment page is on pay.ozow.com) is accepted', isOzowPaymentLink('https://pay.ozow.com/abc/Secure') && !isOzowPaymentLink('http://pay.ozow.com/x') && !isOzowPaymentLink('https://evil.example.com/pay') && !isOzowPaymentLink('https://ozow.com.evil.example/x') && !isOzowPaymentLink('https://user:pw@pay.ozow.com/x') && !isOzowPaymentLink(null));

  // =============================================================== createPayment ==============================================================
  {
    const { ozow, provider } = rig();
    const out = await provider.createPayment(input());
    const call = ozow.calls[0];
    const body = JSON.parse(call.body);
    const id = ozow.requestFor('TL-ABC234')?.paymentRequestId;
    check('create: a good request is answered with the id and the link exactly as Ozow gave them', out.kind === 'created' && out.paymentId === id && out.redirectUrl === `https://pay.ozow.com/${id}/Secure`);
    check('create: one POST to /postpaymentrequest on Ozow\'s production address, JSON, the key in the ApiKey header (not Authorization)', ozow.calls.length === 1 && call.method === 'POST' && call.path === '/postpaymentrequest' && call.headers.ApiKey === FAKE_PAYMENTS.apiKey && !('Authorization' in call.headers) && call.headers['Content-Type'] === 'application/json');
    check('create: the body carries exactly the fields we mean to send and nothing else (no customer, no names, no optional fields, no bank details)',
      Object.keys(body).sort().join() === ['amount', 'bankReference', 'cancelUrl', 'countryCode', 'currencyCode', 'errorUrl', 'expiryDateUtc', 'hashCheck', 'isTest', 'notifyUrl', 'siteCode', 'successUrl', 'transactionReference'].sort().join());
    check('create: country ZA, currency ZAR, the amount is TEXT with two decimals ("35.00"), isTest is the JSON boolean false', body.countryCode === 'ZA' && body.currencyCode === 'ZAR' && body.amount === '35.00' && body.isTest === false && body.siteCode === FAKE_PAYMENTS.siteCode);
    check('create: the transaction reference is our TL- reference, the bank reference is the same (letters, numbers and dashes, at most 20), the payer sees nothing private', body.transactionReference === 'TL-ABC234' && body.bankReference === 'TL-ABC234');
    check('create: the expiry is the database\'s moment, to the minute, in UTC', body.expiryDateUtc === '2026-11-17 14:30');
    check('create: the notification address is the Worker\'s Payments API webhook; the three return addresses are the Worker\'s return route with the top-up id; all within Ozow\'s 150 characters',
      body.notifyUrl === `${DEFAULT_WORKER_ORIGIN}/api/wallet/webhook/ozow-payments` && body.successUrl === `${DEFAULT_WORKER_ORIGIN}/api/wallet/ozow-return?topup=${TOPUP}` && body.cancelUrl === body.successUrl && body.errorUrl === body.successUrl
      && [body.notifyUrl, body.successUrl, body.cancelUrl, body.errorUrl].every((u: string) => u.length <= 150));
    check('create: the hashCheck is the one Ozow\'s algorithm (the test\'s independent copy) computes over what was sent with our private key: the fake Ozow accepted it', ozow.requestFor('TL-ABC234') !== undefined && body.hashCheck === ozowRequestHash(body, FAKE_PAYMENTS.privateKey));
    check('create: the private key is NOT in the body, a header, or the address', !call.body.includes(FAKE_PAYMENTS.privateKey) && !JSON.stringify(call.headers).includes(FAKE_PAYMENTS.privateKey) && !call.path.includes(FAKE_PAYMENTS.privateKey) && !JSON.stringify(call.query).includes(FAKE_PAYMENTS.privateKey));
  }
  {
    const { ozow, provider } = rig({ config: { isTest: true } });
    await provider.createPayment(input());
    const body = JSON.parse(ozow.calls[0].body);
    check('create: in rehearsal the request says isTest true, and its hash covers that (the fake Ozow accepts it)', body.isTest === true && ozow.requestFor('TL-ABC234') !== undefined && body.hashCheck === ozowRequestHash(body, FAKE_PAYMENTS.privateKey));
  }
  {
    const { ozow, provider } = rig();
    const out = await provider.createPayment(input({ expiresAt: 'nonsense' }));
    check('create: an expiry that cannot be read is left out (and then left out of the hash too); the payment is still made', out.kind === 'created' && !('expiryDateUtc' in JSON.parse(ozow.calls[0].body)));
  }
  for (const [mode, kind, code] of [['hash', 'refused', 'hash_failed'], ['cap', 'refused', 'amount_limit'], ['weird_error', 'refused', 'rejected'], ['duplicate', 'unclear', 'duplicate_reference'], ['401', 'refused', 'credentials'], ['403', 'refused', 'credentials']] as const) {
    const { provider, ozow } = rig();
    ozow.mode.create = mode;
    const out = await provider.createPayment(input());
    check(`create: Ozow saying "${mode}" is ${kind === 'refused' ? 'a definite no (nothing exists at Ozow)' : 'unclear (a request may already exist for that reference)'}, with the short code ${code}, never Ozow's own words`,
      out.kind === kind && 'detail' in out && out.detail.includes(code) && !/Something unexpected|token profile|Unable to authorize|maximum transaction amount|HashCheck value/.test(out.detail) && noKeys(out.detail));
  }
  for (const mode of ['500', 'garbled', 'nobody', 'nolink', 'badlink', 'timeout', 'network'] as const) {
    const { provider, ozow } = rig();
    ozow.mode.create = mode;
    const out = await provider.createPayment(input());
    check(`create: Ozow answering "${mode}" (a request may exist and nobody holds its link) is "unclear", never "created", never "refused"`, out.kind === 'unclear' && noKeys(out.detail) && !/pay\.ozow\.com/.test(out.detail));
  }
  {
    const { provider, ozow } = rig();
    const bad = await provider.createPayment(input({ reference: '!!!', amountRand: 35 }));
    const cents = await provider.createPayment(input({ amountRand: 35.5 }));
    const zero = await provider.createPayment(input({ amountRand: 0 }));
    check('create: a reference or amount that cannot be described to Ozow in its allowed shape is refused WITHOUT calling Ozow', bad.kind === 'refused' && cents.kind === 'refused' && zero.kind === 'refused' && ozow.calls.length === 0);
  }
  {
    const { provider, ozow } = rig();
    await provider.createPayment(input({ reference: 'TL-ABC 234-WITH-A-LONG-TAIL-OF-TEXT' }));
    const body = JSON.parse(ozow.calls[0].body);
    check('create: the bank reference is cut to 20 characters of letters, numbers, spaces and dashes (Ozow refuses a longer one)', body.bankReference.length <= 20 && /^[A-Za-z0-9 -]+$/.test(body.bankReference));
  }
  {
    const { provider, ozow } = rig();
    ozow.maxAmount = 0.01;
    const out = await provider.createPayment(input({ amountRand: 35 }));
    check('create: an Ozow account still capped at R0.01 refuses a R35 top-up with the code amount_limit, so the CEO sees at once why', out.kind === 'refused' && out.detail.includes('amount_limit'));
  }

  // =============================================================== checkPayment ===============================================================
  {
    const { ozow, provider } = rig();
    await provider.createPayment(input());
    ozow.addTransaction('TL-ABC234', { status: 'Complete' });
    const out = await provider.checkPayment({ paymentId: 'x', reference: 'TL-ABC234', createdAt: '2026-11-17T10:00:00Z' });
    const call = ozow.calls.at(-1)!;
    check('check: GET /GetTransactionByReference with the site code and OUR reference, the key in the ApiKey header; no isTest in a live run', call.method === 'GET' && call.path === '/GetTransactionByReference' && call.query.siteCode === FAKE_PAYMENTS.siteCode && call.query.transactionReference === 'TL-ABC234' && !('isTest' in call.query) && call.headers.ApiKey === FAKE_PAYMENTS.apiKey);
    check('check: a paid transaction comes back in the database\'s words: Successful, amount "35.00", ZAR, our site, not a test, Ozow\'s transaction id', out.kind === 'ok' && out.transactions.length === 1
      && out.transactions[0].status === 'Successful' && out.transactions[0].amountText === '35.00' && out.transactions[0].currency === 'ZAR' && out.transactions[0].siteOk === true && out.transactions[0].isTest === 'False' && out.transactions[0].reference === 'TL-ABC234' && /^[0-9a-f-]{36}$/.test(out.transactions[0].txnId));
    check('check: the private key and the API key are in no address, and none is in what is returned', noKeys(JSON.stringify(out)) && !call.path.includes(FAKE_PAYMENTS.apiKey) && !JSON.stringify(call.query).includes(FAKE_PAYMENTS.apiKey));
  }
  {
    const { ozow, provider } = rig();
    await provider.createPayment(input());
    for (const [status, sub] of [['Cancelled', 'Unclassified'], ['Error', 'InsufficientFunds'], ['Abandoned', 'Unclassified'], ['PendingInvestigation', 'Unclassified'], ['Pending', 'Unclassified']]) ozow.addTransaction('TL-ABC234', { status, subStatus: sub });
    const out = await provider.checkPayment({ paymentId: 'x', reference: 'TL-ABC234', createdAt: '2026-11-17T10:00:00Z' });
    check('check: every other status goes to the database as Ozow wrote it (so none can be credited), with the sub-status in the note', out.kind === 'ok' && out.transactions.map((t) => t.status).join() === 'Cancelled,Error,Abandoned,PendingInvestigation,Pending' && out.transactions.some((t) => /InsufficientFunds/.test(t.reason)));
  }
  {
    const { ozow, provider } = rig();
    await provider.createPayment(input());
    const out = await provider.checkPayment({ paymentId: 'x', reference: 'TL-ABC234', createdAt: '2026-11-17T10:00:00Z' });
    check('check: an empty list is "nothing yet", an ordinary answer, not a failure', out.kind === 'ok' && out.transactions.length === 0);
    ozow.addTransaction('TL-ABC234', { status: 'Complete', siteCode: 'SOMEONE-ELSE' });
    ozow.addTransaction('TL-ABC234', { status: 'Complete', currencyCode: 'USD', amount: 35.0 });
    ozow.addTransaction('TL-ABC234', { status: 'Complete', amount: 12.3 });
    const odd = await provider.checkPayment({ paymentId: 'x', reference: 'TL-ABC234', createdAt: '2026-11-17T10:00:00Z' });
    check('check: another site code is flagged (siteOk false), another currency is passed on as written, an amount is always two decimals ("12.30")', odd.kind === 'ok' && odd.transactions[0].siteOk === false && odd.transactions[1].currency === 'USD' && odd.transactions[2].amountText === '12.30');
  }
  for (const mode of ['500', 'garbled', '401', 'timeout', 'notlist'] as const) {
    const { ozow, provider } = rig();
    ozow.mode.check = mode;
    const out = await provider.checkPayment({ paymentId: 'x', reference: 'TL-ABC234', createdAt: '2026-11-17T10:00:00Z' });
    check(`check: Ozow answering "${mode}" is "failed" (never "nothing yet", so an old top-up is never closed on a failed look)`, out.kind === 'failed' && noKeys(out.detail));
  }
  {
    const { ozow, provider } = rig();
    const out = await provider.checkPayment({ paymentId: 'x', reference: 'TL-A&transactionReference=OTHER', createdAt: '2026-11-17T10:00:00Z' });
    check('check: a reference with odd characters is refused before any call (it cannot be used to change the query)', out.kind === 'failed' && ozow.calls.length === 0);
  }
  {
    const { ozow, provider } = rig({ config: { isTest: true } });
    await provider.createPayment(input());
    ozow.addTransaction('TL-ABC234', { status: 'Complete' });
    const out = await provider.checkPayment({ paymentId: 'x', reference: 'TL-ABC234', createdAt: '2026-11-17T10:00:00Z' });
    check('check: in rehearsal the lookup asks for test transactions (isTest=true) and marks what comes back as a test, so the database will not credit it', ozow.calls.at(-1)!.query.isTest === 'true' && out.kind === 'ok' && out.transactions.length === 1 && out.transactions[0].isTest === 'True');
  }

  // =============================================================== verifyWebhook ==============================================================
  {
    const { ozow, provider } = rig();
    await provider.createPayment(input());
    const verify = (text: string) => provider.verifyWebhook({}, Buffer.from(text));
    const good = verify(ozow.notification('TL-ABC234'));
    check('notification: a genuine one (signed with our key) is verified and read: reference, transaction id, Successful, 35.00, ZAR, our site, not a test',
      good.kind === 'verified' && good.event.kind === 'transaction' && good.event.tx.reference === 'TL-ABC234' && good.event.tx.status === 'Successful' && good.event.tx.amountText === '35.00' && good.event.tx.currency === 'ZAR' && good.event.tx.siteOk === true && good.event.tx.isTest === 'False' && /^[0-9a-f-]{36}$/.test(good.event.tx.txnId));
    check('notification: its event id is the transaction and status (so the same message twice is one event, and Pending then Complete are two)',
      good.kind === 'verified' && good.event.kind === 'transaction' && good.eventId === `tx:${good.event.tx.txnId}:complete`.toLowerCase());
    const sameTwice = ozow.notification('TL-ABC234', { TransactionId: '0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a' });
    const a = verify(sameTwice);
    const b = verify(sameTwice);
    const pending = verify(ozow.notification('TL-ABC234', { TransactionId: '0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a', Status: 'Pending' }));
    check('notification: a repeat has the same event id, a change of status has another', a.kind === 'verified' && b.kind === 'verified' && a.eventId === b.eventId && pending.kind === 'verified' && pending.eventId !== a.eventId);
    // every way to break it
    const bad = (text: string) => {
      const r = verify(text);
      return r.kind === 'rejected' ? r.reason : `NOT REJECTED (${r.kind})`;
    };
    const fields = (n: string) => ozow.notification('TL-ABC234', { TransactionId: '0b0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b0b' }, n === 'wrongkey' ? { key: 'some-other-key-0001' } : {});
    check('notification: signed with ANOTHER key is refused (bad_signature)', bad(fields('wrongkey')) === 'bad_signature');
    const genuine = ozow.notification('TL-ABC234', { TransactionId: '0c0c0c0c-0c0c-4c0c-8c0c-0c0c0c0c0c0c' });
    const amended = (from: string, to: string) => genuine.replace(from, to);
    check('notification: one digit of the amount changed after signing is refused', bad(amended('Amount=35.00', 'Amount=350.00')) === 'bad_signature' && bad(amended('Amount=35.00', 'Amount=3.00')) === 'bad_signature');
    check('notification: the status changed after signing (Cancelled turned into Complete) is refused', bad(ozow.notification('TL-ABC234', { Status: 'Cancelled' }).replace('Status=Cancelled', 'Status=Complete')) === 'bad_signature');
    check('notification: the reference, the currency, the site code, the test flag, the transaction id and the message are each part of the signature', ['TransactionReference=TL-ABC234', 'CurrencyCode=ZAR', `SiteCode=${FAKE_PAYMENTS.siteCode}`, 'IsTest=False'].every((frag) => bad(genuine.replace(frag, frag.replace(/.$/, 'X'))) === 'bad_signature')
      && bad(genuine.replace(/TransactionId=[^&]+/, 'TransactionId=0d0d0d0d-0d0d-4d0d-8d0d-0d0d0d0d0d0d')) === 'bad_signature' && bad(genuine.replace('StatusMessage=', 'StatusMessage=hello')) === 'bad_signature');
    check('notification: a Hash with one character changed, a short one, a long one and an empty one are all refused', bad(genuine.replace(/Hash=([0-9a-f]{2})/, (m, c) => `Hash=${c === 'aa' ? 'bb' : 'aa'}`)) === 'bad_signature' && bad(genuine.replace(/Hash=[0-9a-f]+/, 'Hash=abc')) === 'bad_signature'
      && bad(genuine.replace(/Hash=[0-9a-f]+/, `Hash=${'a'.repeat(300)}`)) === 'bad_body' && bad(genuine.replace(/Hash=[0-9a-f]+/, 'Hash=')) === 'missing_header');
    check('notification: no Hash at all is the quiet "missing_header" kind (a probe, nothing signed), an empty body and rubbish likewise', bad(ozow.notification('TL-ABC234', {}, { skipHash: true })) === 'missing_header' && bad('') === 'missing_header' && bad('this is not a form') === 'missing_header' && bad('{"Hash":"x"}') === 'missing_header');
    check('notification: a field sent twice (which Status?) is refused; so is a huge number of fields', bad(`${genuine}&Status=Cancelled`) === 'bad_body' && bad(`${genuine}&Amount=1.00`) === 'bad_body' && bad(`${genuine}${Array.from({ length: 60 }, (_, i) => `&x${i}=1`).join('')}`) === 'bad_body');
    check('notification: fields Ozow adds that are not in the signature (SubStatus, BankName) change nothing', verify(`${genuine}&BankName=Fake&SmartIndicators=FIRST_OZOW&MaskedAccountNumber=1234%2A%2A%2A8765`).kind === 'verified');
    check('notification: the hash in capital letters is accepted; the amount without decimals is read as Ozow hashes it (35 is 35.00)', verify(genuine.replace(/Hash=([0-9a-f]+)/, (_m, h) => `Hash=${h.toUpperCase()}`)).kind === 'verified'
      && (() => { const r = verify(ozow.notification('TL-ABC234', { Amount: '35' })); return r.kind === 'verified' && r.event.kind === 'transaction' && r.event.tx.amountText === '35.00'; })());
    // a cancelled payment, with a message, and every status word
    const cancelled = verify(ozow.notification('TL-ABC234', { Status: 'Cancelled', StatusMessage: 'User cancelled transaction' }));
    check('notification: a signed Cancelled message is read as Cancelled with Ozow\'s words in the note, and is NOT turned into Successful', cancelled.kind === 'verified' && cancelled.event.kind === 'transaction' && cancelled.event.tx.status === 'Cancelled' && /User cancelled transaction/.test(cancelled.event.tx.reason));
    const states = ['Complete', 'Cancelled', 'Error', 'Abandoned', 'PendingInvestigation', 'Pending', 'SomethingNew'].map((s) => {
      const r = verify(ozow.notification('TL-ABC234', { Status: s, TransactionId: crypto.randomUUID() }));
      return r.kind === 'verified' && r.event.kind === 'transaction' ? r.event.tx.status : 'x';
    });
    check('notification: of every status word Ozow documents, only Complete becomes the paid word', states.join() === 'Successful,Cancelled,Error,Abandoned,PendingInvestigation,Pending,SomethingNew');
    const test = verify(ozow.notification('TL-ABC234', { IsTest: 'True' }));
    check('notification: a test message is passed on as a test ("True") for the database to refuse on the live system', test.kind === 'verified' && test.event.kind === 'transaction' && test.event.tx.isTest === 'True');
    const other = verify(ozow.notification('TL-ABC234', { SiteCode: 'SOMEONE-ELSE' }));
    check('notification: a message for another site code, even signed with our key, is flagged (siteOk false)', other.kind === 'verified' && other.event.kind === 'transaction' && other.event.tx.siteOk === false);
    const noTxn = verify(ozow.notification('TL-ABC234', { TransactionId: '' }));
    check('notification: a signed message without a transaction id is "unreadable", never a transaction', noTxn.kind === 'verified' && noTxn.event.kind === 'unreadable');
    const weirdAmount = verify(ozow.notification('TL-ABC234', { Amount: '35.005' }));
    check('notification: an amount that is not money with two decimals reaches the database as nothing (so it goes to a person)', weirdAmount.kind === 'verified' && weirdAmount.event.kind === 'transaction' && weirdAmount.event.tx.amountText === '');
  }

  // =============================================================== the test flag ==============================================================
  {
    const live = createOzowPaymentsProvider(baseConfig(), async () => ({ status: 200, text: async () => '[]' }));
    const rehearsal = createOzowPaymentsProvider(baseConfig({ isTest: true }), async () => ({ status: 200, text: async () => '[]' }));
    const staging = createOzowPaymentsProvider(baseConfig({ apiBase: OZOW_PAYMENTS_STAGING_BASE }), async () => ({ status: 200, text: async () => '[]' }));
    check('test flag: the live address never lets a test payment be credited, even in rehearsal; only Ozow\'s staging address does', live.allowTestPayments === false && rehearsal.allowTestPayments === false && staging.allowTestPayments === true);
    check('provider name: the database and the setting call this provider ozow_payments', live.name === OZOW_PAYMENTS_PROVIDER && OZOW_PAYMENTS_PROVIDER === 'ozow_payments');
  }

  // =============================================================== the file itself ============================================================
  const src = read('server/ozowPayments.ts');
  const code = src.replace(/^\s*\/\/.*$/gm, '');
  check('the file never logs, never writes a file, never reads an environment variable by itself (settings come in through ozowPaymentsConfigFromEnv\'s argument)', !/console\.|writeFile|appendFile|process\.env/.test(code));
  check('the private key is used in exactly one place, the hash (hashOver) and nowhere near a request: not in a header, a URL or a body', (code.match(/privateKey/g) ?? []).length <= 12 && !/headers:[^}]*privateKey|\$\{[^}]*privateKey[^}]*\}/.test(code) && !/Authorization/.test(code));
  check('every hash comparison is constant-time (timingSafeEqual) and no "===" compares a Hash', /timingSafeEqual/.test(code) && !/Hash'\)\s*===|===\s*got\('Hash'\)/.test(code));
  check('the status translation is one word and one place: exactly one comparison with "complete"', (code.match(/'complete'/g) ?? []).length === 1 && /return raw\.trim\(\)\.toLowerCase\(\) === 'complete' \? 'Successful'/.test(code));
  check('no wording in the new file offers "free" lessons or sessions', !/free (lesson|session)/i.test(src));

  process.stdout.write(failures === 0 ? '\nALL OK\n' : `\n${failures} FAILED\n`);
  process.exit(failures === 0 ? 0 : 1);
})();
