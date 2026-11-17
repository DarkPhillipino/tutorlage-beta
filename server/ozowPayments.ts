// Ozow PAYMENTS API ("classic") client for the online wallet top-up: a SECOND provider behind the same door as server/ozow.ts (One API). 17 Nov 2026, the CEO's order:
// the credentials Ozow gave him are the Payments API set (Site Code, API Key, Private Key), so the wallet takes bank payments on those now; One API stays in the code, chosen
// by the database setting wallet_online_provider ('ozow' = One API, 'ozow_payments' = this file). Nothing else changes: the routes, the screens, the wallet and the database's one
// decision point (wallet_online_apply) are the same, so every credit-safety rule already in the database still applies to a payment made this way.
// Written from Ozow's own pages (hub.ozow.com, each page has a Markdown twin: add .md):
//   integration-methods/apis/deprecated-integrations/hosted-checkout   (POST /postpaymentrequest, the request hash, the notification and ITS hash, the statuses)
//   api-reference/payments-api (+ post-post-payment-request, get-get-transaction-by-reference, webhooks/transaction-notification), errors/payments-api, integration-methods/statuses,
//   integration-methods/apis/deprecated-integrations/payin-test-cases-payments-api, getting-started/prerequisites-and-onboarding.
// How a payment goes:
//   1. createPayment: POST {base}/postpaymentrequest with the ApiKey header and a SHA512 hashCheck (the fields we send, in Ozow's fixed order, plus the private key, all lowercased).
//      A rejected request is ALSO an HTTP 200, with url null and the reason in errorMessage: it counts as created only when url is an Ozow link and errorMessage is empty.
//   2. the payer goes to Ozow's page and back to OUR Worker's return route (server/walletOnline.ts, GET or POST: the pages do not say which), which sends them on to the site.
//   3. Ozow POSTs a form-encoded notification to our Worker; verifyWebhook checks its Hash (13 fields in Ozow's order, private key appended, lowercased, SHA512, constant-time).
//   4. checkPayment (the 5-minute backstop and "Check now") asks GET /GetTransactionByReference. Same answer shapes go to the database.
// THE ONE PLACE A STATUS WORD IS TRANSLATED: Ozow's Payments API says "Complete" for a paid payment (the One API says "Successful"; Ozow's statuses page lists them side by side). The
// database credits only "successful", so internalStatus() turns EXACTLY "Complete" (any case) into "Successful" and passes every other word through untouched: "PendingInvestigation" and
// anything we have never seen then lands in the database's "a status we do not know" branch and goes to a person, never to the wallet.
// Secrets (OZOW_API_KEY, OZOW_PRIVATE_KEY, OZOW_SITE_CODE) are Worker secrets, read once in server/index.ts. The private key signs the request and checks the notification; it is NEVER sent,
// never put in a URL, a log line, a reply or a note. Nothing here copies Ozow's error text: only the HTTP status and a short code of our own.
import crypto from 'node:crypto';
import type { CheckOutcome, CreatePaymentInput, CreatePaymentOutcome, PaymentProvider, ProviderTransaction, WebhookEvent, WebhookResult } from './walletOnline';
import { cleanBit } from './walletOnline';

export const OZOW_PAYMENTS_PROVIDER = 'ozow_payments'; // the value of the setting wallet_online_provider, the attempt's provider, and the p_provider the database sees
export const OZOW_PAYMENTS_WEBHOOK_PATH = 'ozow-payments'; // POST /api/wallet/webhook/ozow-payments
export const OZOW_PAYMENTS_RETURN_PATH = '/api/wallet/ozow-return'; // GET or POST ?topup=<id>: sends the payer on to the site
export const OZOW_PAYMENTS_PRODUCTION_BASE = 'https://api.ozow.com';
export const OZOW_PAYMENTS_STAGING_BASE = 'https://stagingapi.ozow.com';
export const OZOW_PAYMENTS_STAGING_HOST = 'stagingapi.ozow.com';
const OZOW_PAYMENTS_HOSTS = ['api.ozow.com', OZOW_PAYMENTS_STAGING_HOST];
// Where the Worker is reached from outside (the CEO's workers.dev address; the same one the Ozow One webhook tool uses). Not a secret; OZOW_NOTIFY_ORIGIN replaces it if the Worker ever moves.
export const DEFAULT_WORKER_ORIGIN = 'https://tutorlage-api.pakisosetunku.workers.dev';
export const OZOW_PAYMENTS_SECRET_NAMES = ['OZOW_API_KEY', 'OZOW_PRIVATE_KEY', 'OZOW_SITE_CODE'] as const;
export const OZOW_PAYMENTS_ONLY_SECRET_NAMES = ['OZOW_API_KEY', 'OZOW_PRIVATE_KEY'] as const; // the two that say "this Worker is meant to use the Payments API"
const MAX_URL_LENGTH = 150; // Ozow: cancelUrl, errorUrl, successUrl and notifyUrl are at most 150 characters

// ---------------------------------------------------------------- settings -----------------------------------------------------------------------

export interface OzowPaymentsConfig {
  apiKey: string; // sent in the ApiKey header (not a bearer token)
  privateKey: string; // signs the request hash and checks the notification hash; never sent
  siteCode: string;
  apiBase: string; // https://api.ozow.com (production) or https://stagingapi.ozow.com (staging credentials, on request from Ozow)
  returnOrigin: string; // https://tutorlage.com : the payer ends on <origin>/wallet/topup-return?topup=<id>
  workerOrigin: string; // where Ozow posts its notification and first sends the payer's browser (our Worker)
  isTest: boolean; // REHEARSAL: every request says isTest true, so Ozow skips the bank and lets the person pick a pretend outcome; the database refuses to credit it (see allowTestPayments)
}

export interface OzowPaymentsConfigResult {
  config: OzowPaymentsConfig | null;
  missing: string[]; // names only, never values
  problems: string[]; // a setting that is there but wrong, described without its value
}

const flag = (v: string) => ['true', '1', 'yes'].includes(v.trim().toLowerCase());

function validOrigin(value: string, hostOk: (host: string) => boolean): boolean {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && u.origin === value.replace(/\/+$/, '') && !u.username && !u.password && u.hostname !== 'localhost' && hostOk(u.hostname);
  } catch {
    return false;
  }
}

// All or nothing: with any setting missing or wrong, config is null and this provider is simply not set up (the routes answer "not set up" for it).
export function ozowPaymentsConfigFromEnv(env: Record<string, string | undefined>): OzowPaymentsConfigResult {
  const get = (k: string) => (env[k] ?? '').trim();
  const missing = [...OZOW_PAYMENTS_SECRET_NAMES, 'OZOW_RETURN_ORIGIN'].filter((k) => get(k) === '');
  const problems: string[] = [];
  const apiBase = (get('OZOW_PAYMENTS_BASE') || OZOW_PAYMENTS_PRODUCTION_BASE).replace(/\/+$/, '');
  if (!validOrigin(apiBase, (h) => OZOW_PAYMENTS_HOSTS.includes(h))) problems.push(`OZOW_PAYMENTS_BASE must be ${OZOW_PAYMENTS_PRODUCTION_BASE} or ${OZOW_PAYMENTS_STAGING_BASE}`);
  const origin = get('OZOW_RETURN_ORIGIN');
  if (origin && !validOrigin(origin, () => true)) problems.push('OZOW_RETURN_ORIGIN must be the site address only, starting https:// (for example https://tutorlage.com), and not localhost');
  const workerOrigin = (get('OZOW_NOTIFY_ORIGIN') || DEFAULT_WORKER_ORIGIN).replace(/\/+$/, '');
  if (!validOrigin(workerOrigin, (h) => h.endsWith('.workers.dev') || h === 'tutorlage.com' || h.endsWith('.tutorlage.com'))) {
    problems.push('OZOW_NOTIFY_ORIGIN must be the Worker address only, starting https:// (a workers.dev or tutorlage.com address)');
  } else if (`${workerOrigin}${OZOW_PAYMENTS_RETURN_PATH}?topup=00000000-0000-0000-0000-000000000000`.length > MAX_URL_LENGTH) {
    problems.push(`OZOW_NOTIFY_ORIGIN is too long: Ozow allows addresses of at most ${MAX_URL_LENGTH} characters`);
  }
  if (get('OZOW_SITE_CODE') && !/^[A-Za-z0-9_-]{1,50}$/.test(get('OZOW_SITE_CODE'))) problems.push('OZOW_SITE_CODE has characters a site code does not have');
  for (const k of ['OZOW_API_KEY', 'OZOW_PRIVATE_KEY']) {
    if (get(k) && !/^[\x21-\x7e]{8,200}$/.test(get(k))) problems.push(`${k} does not look like a key (it must be 8 to 200 printable characters with no spaces)`);
  }
  if (get('OZOW_API_KEY') && get('OZOW_API_KEY') === get('OZOW_PRIVATE_KEY')) problems.push('OZOW_API_KEY and OZOW_PRIVATE_KEY are the same value: they are two different keys');
  if (missing.length || problems.length) return { config: null, missing, problems };
  return {
    config: {
      apiKey: get('OZOW_API_KEY'),
      privateKey: get('OZOW_PRIVATE_KEY'),
      siteCode: get('OZOW_SITE_CODE'),
      apiBase,
      returnOrigin: origin.replace(/\/+$/, ''),
      workerOrigin,
      isTest: flag(get('OZOW_PAYMENTS_TEST')),
    },
    missing,
    problems,
  };
}

// ---------------------------------------------------------------- the hashes ---------------------------------------------------------------------

// The request hash: these fields, in THIS order (Ozow's "Field concatenation order", positions 1 to 28), only the ones that have a value; hashCheck and Token are never in it.
export const REQUEST_HASH_ORDER = [
  'siteCode', 'countryCode', 'currencyCode', 'amount', 'transactionReference', 'bankReference',
  'optional1', 'optional2', 'optional3', 'optional4', 'optional5', 'customer',
  'cancelUrl', 'errorUrl', 'successUrl', 'notifyUrl', 'isTest', 'selectedBankId',
  'bankAccountNumber', 'branchCode', 'bankAccountName', 'payeeDisplayName', 'expiryDateUtc',
  'allowVariableAmount', 'variableAmountMin', 'variableAmountMax', 'customerIdentifier', 'customerCellphoneNumber',
] as const;

// The notification hash: these fields of the message Ozow posts to us, in THIS order (not the request's order, and not the order the fields arrive in), the private key last.
export const NOTIFICATION_HASH_ORDER = [
  'SiteCode', 'TransactionId', 'TransactionReference', 'Amount', 'Status',
  'Optional1', 'Optional2', 'Optional3', 'Optional4', 'Optional5', 'CurrencyCode', 'IsTest', 'StatusMessage',
] as const;

// An amount with exactly two decimals ("25.00"): the form Ozow hashes. Whole numbers and one-decimal numbers are completed; anything else is left alone (and then fails the hash).
export function twoDecimals(value: string | number): string {
  const text = String(value).trim();
  const m = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(text);
  return m ? `${m[1]}.${(m[2] ?? '').padEnd(2, '0')}` : text;
}

function sha512Hex(text: string): string {
  return crypto.createHash('sha512').update(text, 'utf8').digest('hex');
}

// fields: name -> value (string, or a boolean written as true / false). Empty and missing fields contribute nothing at all.
function hashOver(order: readonly string[], fields: Record<string, string | boolean | undefined | null>, privateKey: string): string {
  const parts: string[] = [];
  for (const name of order) {
    const v = fields[name];
    if (v === undefined || v === null || v === '') continue;
    parts.push(typeof v === 'boolean' ? (v ? 'true' : 'false') : String(v));
  }
  return sha512Hex((parts.join('') + privateKey).toLowerCase());
}

export const requestHashCheck = (fields: Record<string, string | boolean | undefined | null>, privateKey: string): string => hashOver(REQUEST_HASH_ORDER, fields, privateKey);
export const notificationHashCheck = (fields: Record<string, string | undefined | null>, privateKey: string): string => hashOver(NOTIFICATION_HASH_ORDER, fields, privateKey);

// Constant time; different lengths never match (and are never compared).
export function sameHash(sent: string, expected: string): boolean {
  const a = Buffer.from(sent.trim().toLowerCase());
  const b = Buffer.from(expected.toLowerCase());
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ---------------------------------------------------------------- reading Ozow's shapes ------------------------------------------------------------

type Obj = Record<string, unknown>;
const asObj = (v: unknown): Obj | null => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : null);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

// "Complete" is a paid Payments API payment; the database's paid word is "successful". Exactly one word is translated; see the header.
export function internalStatus(raw: string): string {
  return raw.trim().toLowerCase() === 'complete' ? 'Successful' : raw.trim();
}

// A short note for the audit row: Ozow's own status word, its sub-status and message, letters and numbers and a few marks only (never an address or anything long).
function noteOf(status: string, subStatus: string, message: string): string {
  const clean = (v: string, max: number) => v.replace(/[^A-Za-z0-9 .,:;_()/'-]/g, '').trim().slice(0, max);
  return [clean(status, 30) && `Ozow says ${clean(status, 30)}`, clean(subStatus, 30), clean(message, 90)].filter(Boolean).join(': ').slice(0, 150);
}

// Ozow's amount in a notification is text with two decimals; in a status check it is a JSON number. Either becomes "35.00", or '' when it is not an amount (the database then sends it to a person).
function amountTextOf(v: unknown): string {
  if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return v.toFixed(2);
  if (typeof v === 'string' && /^\d{1,9}(\.\d{1,2})?$/.test(v.trim())) return twoDecimals(v);
  return '';
}

// An https address on ozow.com (the payment page is on pay.ozow.com). We never build the link ourselves; we only refuse one that clearly is not Ozow's.
export function isOzowPaymentLink(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2000) return false;
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && !u.username && !u.password && (u.hostname === 'ozow.com' || u.hostname.endsWith('.ozow.com'));
  } catch {
    return false;
  }
}

// Ozow's errorMessage text is not copied anywhere; it is turned into one of these short codes of ours (the phrases are from errors/payments-api).
const ERROR_CODES: Array<[RegExp, string]> = [
  [/hashcheck/i, 'hash_failed'],
  [/duplicate transaction reference/i, 'duplicate_reference'],
  [/bank reference/i, 'bank_reference'],
  [/transaction reference/i, 'transaction_reference'],
  [/minimum|maximum|cannot be less than|exceeds/i, 'amount_limit'],
  [/not allowed to perform api|api access/i, 'api_not_enabled'],
  [/dynamic banking|banking details|bank id|bank account|branch code|beneficiary/i, 'banking_details'],
  [/country|currency/i, 'country_or_currency'],
  [/merchant|site code|merchantsite/i, 'site_not_active'],
  [/api key|authoriz|authoris/i, 'not_authorised'],
];
export function errorCodeOf(message: unknown): string {
  const text = typeof message === 'string' ? message : '';
  for (const [re, code] of ERROR_CODES) if (re.test(text)) return code;
  return 'rejected';
}

// 2026-11-17T14:30:45.000Z -> "2026-11-17 14:30" (UTC, the form Ozow wants for expiryDateUtc); '' when it is not a date.
export function expiryText(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 16).replace('T', ' ');
}

// ---------------------------------------------------------------- the client -----------------------------------------------------------------------

export interface OzowPaymentsFetchInit {
  method: string;
  headers: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
}
export type OzowPaymentsFetch = (url: string, init: OzowPaymentsFetchInit) => Promise<{ status: number; text(): Promise<string> }>;

export interface OzowPaymentsOptions {
  timeoutMs?: number; // each call to Ozow
  newId?: () => string; // our own call number for log lines
}

type Called = { kind: 'answered'; status: number; json: unknown; callId: string } | { kind: 'transport'; reason: 'timeout' | 'network'; callId: string };

export function createOzowPaymentsProvider(config: OzowPaymentsConfig, fetchFn: OzowPaymentsFetch, opts: OzowPaymentsOptions = {}): PaymentProvider {
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const newId = opts.newId ?? (() => crypto.randomUUID());
  const staging = new URL(config.apiBase).hostname === OZOW_PAYMENTS_STAGING_HOST;

  async function call(method: string, path: string, init: { body?: string; headers?: Record<string, string> } = {}): Promise<Called> {
    const callId = newId();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchFn(`${config.apiBase}${path}`, { method, headers: { Accept: 'application/json', ApiKey: config.apiKey, ...init.headers }, body: init.body, signal: controller.signal });
      const text = await res.text();
      let json: unknown = null;
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
      return { kind: 'answered', status: res.status, json, callId };
    } catch {
      return { kind: 'transport', reason: controller.signal.aborted ? 'timeout' : 'network', callId };
    } finally {
      clearTimeout(timer);
    }
  }
  const describe = (c: Called, code = ''): string => (c.kind === 'transport' ? `no answer (${c.reason}), call ${c.callId}` : `HTTP ${c.status}${code ? ` ${code}` : ''}, call ${c.callId}`);

  // WHAT SEPARATES A REHEARSAL, STAGING AND PRODUCTION. Ozow's Payments API has a real isTest flag (the One API has none). With isTest true on the live address Ozow skips the bank and lets the
  // person pick a successful or unsuccessful outcome, and still posts a notification (with IsTest "True"). That message must NEVER put money in a wallet on the live system, so
  // allowTestPayments is true ONLY on Ozow's staging address (stagingapi.ozow.com, which needs its own credentials): on the live address the database refuses a test notification ("A test payment
  // arrived on the live site"), records it, and tells finance. The same flag is asked of every status check, so a rehearsal's payments are looked up as rehearsal payments.
  return {
    name: OZOW_PAYMENTS_PROVIDER,
    allowTestPayments: staging,

    async createPayment(input: CreatePaymentInput): Promise<CreatePaymentOutcome> {
      const topupReturn = `${config.workerOrigin}${OZOW_PAYMENTS_RETURN_PATH}?topup=${input.topupId}`;
      const reference = input.reference.replace(/[^A-Za-z0-9 -]/g, '').slice(0, 20); // bankReference: the payer's own bank shows this as "their reference"; letters, numbers, spaces and dashes, at most 20
      if (!reference || input.reference.length > 50 || topupReturn.length > MAX_URL_LENGTH || !Number.isInteger(input.amountRand) || input.amountRand <= 0) {
        return { kind: 'refused', detail: 'the payment could not be described to Ozow in the allowed shape' }; // nothing was sent
      }
      const fields: Record<string, string | boolean> = {
        siteCode: config.siteCode,
        countryCode: 'ZA',
        currencyCode: 'ZAR',
        amount: twoDecimals(input.amountRand),
        transactionReference: input.reference, // our TL- reference; Ozow refuses a reference this site used in the last 24 hours, and we never create a second payment for a top-up
        bankReference: reference,
        cancelUrl: topupReturn,
        errorUrl: topupReturn,
        successUrl: topupReturn,
        notifyUrl: `${config.workerOrigin}/api/wallet/webhook/${OZOW_PAYMENTS_WEBHOOK_PATH}`,
        isTest: config.isTest,
      };
      const expiry = expiryText(input.expiresAt);
      if (expiry) fields.expiryDateUtc = expiry; // "Payment will not be allowed to be made after this date", UTC, yyyy-MM-dd HH:mm: the same moment the database stored (to the minute)
      const body = JSON.stringify({ ...fields, hashCheck: requestHashCheck(fields, config.privateKey) });
      const r = await call('POST', '/postpaymentrequest', { headers: { 'Content-Type': 'application/json' }, body });
      if (r.kind === 'transport') return { kind: 'unclear', detail: describe(r) };
      const json = asObj(r.json);
      if (r.status === 200) {
        // Ozow's own warning: a rejection is also a 200, with url null and the reason in errorMessage.
        const id = str(json?.paymentRequestId);
        const message = json?.errorMessage;
        if (!json) return { kind: 'unclear', detail: `HTTP 200 that could not be read, call ${r.callId}` };
        if (typeof message === 'string' && message.trim() !== '') {
          const code = errorCodeOf(message);
          // A reference used before means a payment request may already exist for it: never treated as "nothing exists".
          return code === 'duplicate_reference' ? { kind: 'unclear', detail: describe(r, code) } : { kind: 'refused', detail: describe(r, code) };
        }
        if (/^[A-Za-z0-9-]{1,100}$/.test(id) && isOzowPaymentLink(json.url)) return { kind: 'created', paymentId: id, redirectUrl: json.url };
        return { kind: 'unclear', detail: `HTTP 200 without a usable id and link, call ${r.callId}` };
      }
      if (r.status >= 400 && r.status < 500) return { kind: 'refused', detail: describe(r, r.status === 401 || r.status === 403 ? 'credentials' : '') };
      return { kind: 'unclear', detail: describe(r) };
    },

    // GET /GetTransactionByReference: every transaction Ozow holds for our TL- reference (at most 10). An empty list is "nothing yet" (the payer has not opened the page or paid), not an error.
    async checkPayment(input: { paymentId: string; reference: string; createdAt: string }): Promise<CheckOutcome> {
      if (!/^[A-Za-z0-9 -]{1,50}$/.test(input.reference)) return { kind: 'failed', detail: 'the reference is not in the expected form' };
      const query = new URLSearchParams({ siteCode: config.siteCode, transactionReference: input.reference });
      if (config.isTest) query.set('isTest', 'true'); // "Defaults to false. Use true only to get results for test requests."
      const r = await call('GET', `/GetTransactionByReference?${query.toString()}`);
      if (r.kind === 'transport' || r.status !== 200) return { kind: 'failed', detail: describe(r) };
      if (!Array.isArray(r.json)) return { kind: 'failed', detail: `HTTP 200 without a list of transactions, call ${r.callId}` };
      const transactions: ProviderTransaction[] = [];
      for (const item of r.json) {
        const t = asObj(item);
        if (!t) continue;
        transactions.push({
          reference: str(t.transactionReference),
          txnId: str(t.transactionId),
          status: internalStatus(str(t.status)),
          amountText: amountTextOf(t.amount),
          currency: str(t.currencyCode),
          siteOk: str(t.siteCode) !== '' && str(t.siteCode) === config.siteCode,
          isTest: config.isTest ? 'True' : 'False', // the answer carries no such field; we asked for exactly this kind
          reason: noteOf(str(t.status), str(t.subStatus), str(t.statusMessage)),
        });
      }
      return { kind: 'ok', transactions };
    },

    // The notification is a form-encoded POST to a public address anyone can call: its Hash is the ONLY thing that makes it Ozow's. Nothing is read from it before that check passes.
    verifyWebhook(_headers, rawBody: Buffer): WebhookResult {
      let form: URLSearchParams;
      try {
        form = new URLSearchParams(rawBody.toString('utf8'));
      } catch {
        return { kind: 'rejected', reason: 'bad_body', messageIdHint: '' };
      }
      const names = [...form.keys()];
      const got = (name: string): string => form.get(name) ?? '';
      const hint = cleanBit(got('TransactionId'), 40);
      if (!form.has('Hash') || got('Hash').trim() === '') return { kind: 'rejected', reason: 'missing_header', messageIdHint: hint }; // nothing signed at all (the quiet kind: see wallet_online_record_event)
      if (new Set(names).size !== names.length || got('Hash').length > 200 || names.length > 40) return { kind: 'rejected', reason: 'bad_body', messageIdHint: hint }; // a repeated field makes "which value" ambiguous
      const fields: Record<string, string> = {};
      for (const name of NOTIFICATION_HASH_ORDER) fields[name] = got(name);
      fields.Amount = twoDecimals(fields.Amount); // "Amount, with two decimal places"
      if (!sameHash(got('Hash'), notificationHashCheck(fields, config.privateKey))) return { kind: 'rejected', reason: 'bad_signature', messageIdHint: hint };
      // From here on the message is Ozow's. A change of status (Pending, then Complete) has a different id, a repeat of the same one is a duplicate.
      const status = got('Status');
      const txnId = got('TransactionId');
      if (!/^[A-Za-z0-9-]{1,100}$/.test(txnId) || status === '') return { kind: 'verified', eventId: `unreadable:${cleanBit(got('Hash'), 40)}`, event: { kind: 'unreadable' } satisfies WebhookEvent };
      return {
        kind: 'verified',
        eventId: `tx:${txnId}:${cleanBit(status, 40)}`.toLowerCase(),
        event: {
          kind: 'transaction',
          tx: {
            reference: got('TransactionReference'),
            txnId,
            status: internalStatus(status),
            amountText: amountTextOf(fields.Amount),
            currency: got('CurrencyCode'),
            siteOk: got('SiteCode') !== '' && got('SiteCode') === config.siteCode,
            isTest: got('IsTest'),
            reason: noteOf(status, got('SubStatus'), got('StatusMessage')),
          },
        },
      };
    },
  };
}
