// Ozow One API client for the online wallet top-up (phase 2 of 3; design: Drake/programmer/reports/2026-11-09-ozow-design.md, 1.2 to 1.4).
// REDIRECT checkout on Ozow's One API only (hosted checkout): we create a payment, send the payer to the link Ozow gives us, and learn the
// result from a signed webhook, with a status check (this file's checkPayment) as the backstop. The older Payments API is not used.
// Written from Ozow's own pages (hub.ozow.com/api-reference/one-api/ and .../integration-methods/apis/money-in/verify-a-webhook/):
//   POST /token (client credentials, scope payments)   POST /payments (+ Idempotency-Key)   GET /payments/{id}/transactions   Svix-style webhook signature.
// Secrets (OZOW_CLIENT_ID, OZOW_CLIENT_SECRET, OZOW_SITE_CODE, OZOW_WEBHOOK_SECRET) are Worker secrets, read once from the environment in
// server/index.ts. Nothing here logs one, puts one in a reply, or copies Ozow's error text (it can echo a client id): only the HTTP status and
// Ozow's short error code. Everything the network needs comes in as `fetchFn`, so scripts/dev/ozow-test.ts runs it with a pretend Ozow.
import crypto from 'node:crypto';
import type { CheckOutcome, CreatePaymentInput, CreatePaymentOutcome, PaymentProvider, ProviderTransaction, WebhookEvent, WebhookResult } from './walletOnline';
import { cleanBit } from './walletOnline';

export const OZOW_PRODUCTION_BASE = 'https://one.ozow.com/v1';
export const OZOW_STAGING_HOST = 'stagingone.ozow.com';
const OZOW_HOSTS = ['one.ozow.com', OZOW_STAGING_HOST];
export const SIGNATURE_TOLERANCE_SECONDS = 300; // Ozow: "within five minutes of now, in either direction"
export const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000; // a token is renewed 5 minutes before it runs out

// ---------------------------------------------------------------- settings -----------------------------------------------------------------------

export interface OzowConfig {
  clientId: string;
  clientSecret: string;
  siteCode: string;
  webhookSecret: string; // as Ozow shows it: whsec_ followed by Base64
  apiBase: string; // https://one.ozow.com/v1 (production) or https://stagingone.ozow.com/v1 (staging, on request from Ozow)
  returnOrigin: string; // https://tutorlage.com : the payer comes back to <origin>/wallet/topup-return?topup=<id>
}

export interface OzowConfigResult {
  config: OzowConfig | null;
  missing: string[]; // names only, never values
  problems: string[]; // a setting that is there but wrong, described without its value
}

export const OZOW_SECRET_NAMES = ['OZOW_CLIENT_ID', 'OZOW_CLIENT_SECRET', 'OZOW_SITE_CODE', 'OZOW_WEBHOOK_SECRET'] as const;

function signingKey(secret: string): Buffer {
  return Buffer.from(secret.trim().replace(/^whsec_/, ''), 'base64');
}

// All or nothing: with any setting missing or wrong, config is null and every online-payment route answers "not set up" (webhook 503).
export function ozowConfigFromEnv(env: Record<string, string | undefined>): OzowConfigResult {
  const get = (k: string) => (env[k] ?? '').trim();
  const missing = [...OZOW_SECRET_NAMES, 'OZOW_RETURN_ORIGIN'].filter((k) => get(k) === '');
  const problems: string[] = [];
  const apiBase = (get('OZOW_API_BASE') || OZOW_PRODUCTION_BASE).replace(/\/+$/, '');
  try {
    const u = new URL(apiBase);
    if (u.protocol !== 'https:' || !OZOW_HOSTS.includes(u.hostname) || u.username || u.password) throw new Error('host');
  } catch {
    problems.push(`OZOW_API_BASE must be https://${OZOW_HOSTS[0]}/v1 or https://${OZOW_HOSTS[1]}/v1`);
  }
  const origin = get('OZOW_RETURN_ORIGIN');
  if (origin) {
    try {
      const u = new URL(origin);
      if (u.protocol !== 'https:' || u.origin !== origin.replace(/\/+$/, '') || u.hostname === 'localhost') throw new Error('origin');
    } catch {
      problems.push('OZOW_RETURN_ORIGIN must be the site address only, starting https:// (for example https://tutorlage.com), and not localhost');
    }
  }
  if (get('OZOW_SITE_CODE') && !/^[A-Za-z0-9_-]{1,50}$/.test(get('OZOW_SITE_CODE'))) problems.push('OZOW_SITE_CODE has characters a site code does not have');
  if (get('OZOW_WEBHOOK_SECRET') && signingKey(get('OZOW_WEBHOOK_SECRET')).length < 8) problems.push('OZOW_WEBHOOK_SECRET is not a signing secret (it should be whsec_ followed by Base64)');
  if (missing.length || problems.length) return { config: null, missing, problems };
  return {
    config: {
      clientId: get('OZOW_CLIENT_ID'),
      clientSecret: get('OZOW_CLIENT_SECRET'),
      siteCode: get('OZOW_SITE_CODE'),
      webhookSecret: get('OZOW_WEBHOOK_SECRET'),
      apiBase,
      returnOrigin: origin.replace(/\/+$/, ''),
    },
    missing,
    problems,
  };
}

// ---------------------------------------------------------------- the webhook signature -----------------------------------------------------------

// Base64 of HMAC-SHA256 over "{svix-id}.{svix-timestamp}.{raw body}", keyed with the decoded secret. Exported for the offline check against
// Ozow's published test values.
export function ozowSignatureFor(secret: string, messageId: string, timestamp: string, rawBody: Buffer): string {
  return crypto.createHmac('sha256', signingKey(secret)).update(`${messageId}.${timestamp}.`).update(rawBody).digest('base64');
}

type HeaderBag = Record<string, string | string[] | undefined>;
const one = (h: HeaderBag, name: string): string | null => {
  const v = h[name];
  return typeof v === 'string' && v.length > 0 ? v : null;
};

// Ozow's five steps, in order. Returns the reason code for the first one that fails.
export function checkOzowSignature(secret: string, headers: HeaderBag, rawBody: Buffer, nowMs: number): { ok: true; messageId: string } | { ok: false; reason: string; messageIdHint: string } {
  const id = one(headers, 'svix-id');
  const timestamp = one(headers, 'svix-timestamp');
  const signature = one(headers, 'svix-signature');
  const hint = cleanBit(id ?? '', 40);
  if (!id || !timestamp || !signature) return { ok: false, reason: 'missing_header', messageIdHint: hint };
  if (id.length > 200 || signature.length > 2000 || !/^[\x21-\x7e]+$/.test(id)) return { ok: false, reason: 'bad_header', messageIdHint: hint };
  if (!/^\d{1,12}$/.test(timestamp)) return { ok: false, reason: 'bad_timestamp', messageIdHint: hint };
  if (Math.abs(nowMs / 1000 - Number(timestamp)) > SIGNATURE_TOLERANCE_SECONDS) return { ok: false, reason: 'stale_timestamp', messageIdHint: hint };
  if (signingKey(secret).length === 0) return { ok: false, reason: 'no_key', messageIdHint: hint };
  const expected = Buffer.from(ozowSignatureFor(secret, id, timestamp, rawBody));
  let matched = false;
  for (const candidate of signature.split(' ')) {
    const comma = candidate.indexOf(',');
    if (comma < 0 || candidate.slice(0, comma) !== 'v1') continue; // ignore any version but v1
    const given = Buffer.from(candidate.slice(comma + 1));
    // timingSafeEqual throws on a length mismatch, so the lengths are compared first. Every candidate is checked (no early exit on the first).
    if (given.length === expected.length && crypto.timingSafeEqual(given, expected)) matched = true;
  }
  return matched ? { ok: true, messageId: id } : { ok: false, reason: 'bad_signature', messageIdHint: hint };
}

// ---------------------------------------------------------------- reading Ozow's shapes ------------------------------------------------------------

type Obj = Record<string, unknown>;
const asObj = (v: unknown): Obj | null => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : null);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

// Transaction.amount is `Amount` in Ozow's OpenAPI file (hub.ozow.com/api-reference/specs/one-api.yaml, read 12 Nov 2026): { currency, value }, described as the amount that
// was requested (not necessarily the amount paid). It is NOT in that schema's required list, so it may be missing: the staging run (Drake/programmer/reports/2026-11-12-ozow-staging-prep.md, section
// "Staging test list") is what shows whether it is really there. A missing or odd amount comes back as '' and the database sends the payment to a person instead of crediting it.
function amountTextOf(v: unknown): string {
  if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return v.toFixed(2);
  if (typeof v === 'string') {
    const m = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(v.trim());
    return m ? `${m[1]}.${(m[2] ?? '').padEnd(2, '0')}` : '';
  }
  return '';
}

// An https address on ozow.com. We never build the link ourselves; we only refuse one that clearly is not Ozow's.
export function isOzowLink(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2000) return false;
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && !u.username && !u.password && (u.hostname === 'ozow.com' || u.hostname.endsWith('.ozow.com'));
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- the client -----------------------------------------------------------------------

export interface OzowFetchInit {
  method: string;
  headers: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
}
export type OzowFetch = (url: string, init: OzowFetchInit) => Promise<{ status: number; text(): Promise<string> }>;

export interface OzowOptions {
  timeoutMs?: number; // each call to Ozow
  now?: () => number;
  log?: (line: string) => void;
  newId?: () => string; // X-Correlation-ID
}

type Called = { kind: 'answered'; status: number; body: Obj | null; correlationId: string } | { kind: 'transport'; reason: 'timeout' | 'network'; correlationId: string };

const describe = (c: Called): string =>
  c.kind === 'transport' ? `no answer (${c.reason}), call ${c.correlationId}` : `HTTP ${c.status}${cleanBit(c.body?.code, 40) ? ` ${cleanBit(c.body?.code, 40)}` : ''}, call ${c.correlationId}`;

export function createOzowProvider(config: OzowConfig, fetchFn: OzowFetch, opts: OzowOptions = {}): PaymentProvider {
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const now = opts.now ?? Date.now;
  const log = opts.log ?? ((line: string) => console.error(line));
  const newId = opts.newId ?? (() => crypto.randomUUID());
  const staging = new URL(config.apiBase).hostname === OZOW_STAGING_HOST;

  async function call(method: string, path: string, init: { headers?: Record<string, string>; body?: string; token?: string }): Promise<Called> {
    const correlationId = newId();
    const headers: Record<string, string> = { 'X-Correlation-ID': correlationId, Accept: 'application/json', ...init.headers };
    if (init.token) headers.Authorization = `Bearer ${init.token}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchFn(`${config.apiBase}${path}`, { method, headers, body: init.body, signal: controller.signal });
      const text = await res.text();
      let body: Obj | null = null;
      try {
        body = asObj(JSON.parse(text));
      } catch {
        body = null;
      }
      return { kind: 'answered', status: res.status, body, correlationId };
    } catch {
      return { kind: 'transport', reason: controller.signal.aborted ? 'timeout' : 'network', correlationId };
    } finally {
      clearTimeout(timer);
    }
  }

  // ---- the token: kept in memory until 5 minutes before it runs out, one call at a time, one renewal if Ozow answers 401 ----
  let cached: { token: string; refreshAtMs: number } | null = null;
  let inflight: Promise<string> | null = null;

  async function fetchToken(): Promise<string> {
    const form = new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, scope: 'payments', grant_type: 'client_credentials' });
    const r = await call('POST', '/token', { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form.toString() });
    if (r.kind !== 'answered' || r.status !== 200 || typeof r.body?.access_token !== 'string' || r.body.access_token === '') {
      throw new Error(`token: ${describe(r)}`);
    }
    // expires_in arrives as a string ("14400"); token_type is documented "bearer" but shown "Bearer", so it is not compared: we always send "Bearer <token>".
    const ttlSeconds = Number(r.body.expires_in);
    const ttlMs = (Number.isFinite(ttlSeconds) && ttlSeconds > 0 ? ttlSeconds : 600) * 1000;
    cached = { token: r.body.access_token, refreshAtMs: now() + Math.max(ttlMs - TOKEN_REFRESH_MARGIN_MS, 30_000) };
    return cached.token;
  }
  function token(): Promise<string> {
    if (cached && now() < cached.refreshAtMs) return Promise.resolve(cached.token);
    if (!inflight) inflight = fetchToken().finally(() => (inflight = null));
    return inflight;
  }
  // After a 401 with `used`: someone may already have renewed it; otherwise renew now.
  function tokenAfter401(used: string): Promise<string> {
    if (cached && cached.token !== used && now() < cached.refreshAtMs) return Promise.resolve(cached.token);
    cached = null;
    return token();
  }

  // One authenticated call; a 401 renews the token once and repeats the call.
  async function authed(method: string, path: string, init: { headers?: Record<string, string>; body?: string }): Promise<Called> {
    let used = await token();
    let r = await call(method, path, { ...init, token: used });
    if (r.kind === 'answered' && r.status === 401) {
      used = await tokenAfter401(used);
      r = await call(method, path, { ...init, token: used });
    }
    return r;
  }

  const beneficiaryOf = (reference: string): string => reference.replace(/[^A-Za-z0-9]/g, '').slice(0, 20); // letters and numbers only, at most 20

  // WHAT SEPARATES STAGING FROM PRODUCTION (Ozow support, 12 Nov 2026: IsTest does not apply to One API; Ozow's migration page says test and live are told apart by
  // environment, not by a flag on the request). The database cannot tell a staging payment from a real one: a staging payment that passes our checks IS credited like
  // real money. What keeps the two apart is this Worker's settings, which are set together or not at all:
  //  1. OZOW_API_BASE with OZOW_CLIENT_ID / OZOW_CLIENT_SECRET: a client belongs to one environment, so we only ever make payments, and ask about them, where we are set to;
  //  2. OZOW_WEBHOOK_SECRET: a webhook is believed only if it is signed with the secret of the subscription we hold, and every subscription has its own secret;
  //  3. OZOW_SITE_CODE: the SiteCode in a message must equal ours (siteOk, below). This separates the two ONLY if staging and production have different site codes, and Ozow has not said so.
  // `allowTestPayments` lets a message that says IsTest "True" past the database's refusal of test payments, and is true only when OZOW_API_BASE is the staging host.
  // So changing environment means changing ALL of the above together and having no top-up in flight (list: the staging report, "Staging to production, one list").
  return {
    name: 'ozow',
    allowTestPayments: staging,

    async createPayment(input: CreatePaymentInput): Promise<CreatePaymentOutcome> {
      const payload: Obj = {
        siteCode: config.siteCode,
        region: 'ZA',
        amount: { currency: 'ZAR', value: input.amountRand },
        // our TL- reference. Ozow (support 12 Nov, and its OpenAPI file): pre-filled in the payer's OWN reference field at their bank, shortened by banks that limit it, so it
        // is visible to the payer and must carry nothing private. It is NOT what lands on our bank statement: that is beneficiaryReference, below.
        merchantReference: input.reference,
        expireAt: input.expiresAt,
        returnUrl: `${config.returnOrigin}${input.returnPath}`,
      };
      // beneficiaryReference is the reference on OUR bank statement (for reconciliation), letters and numbers only, 20 at most, a site prefix counts towards the 20; the payer does
      // not see it. Ozow's page adds that a missing one is rejected unless the site lets the payer supply the reference, which can be read either way: if staging answers 400
      // pointing at /beneficiaryReference, the PM asks Ozow (the top-up is closed as "refused", nothing is taken).
      const beneficiary = beneficiaryOf(input.reference);
      if (beneficiary) payload.beneficiaryReference = beneficiary;
      let r: Called;
      try {
        r = await authed('POST', '/payments', { headers: { 'Content-Type': 'application/json', 'Idempotency-Key': input.idempotencyKey }, body: JSON.stringify(payload) });
      } catch (e) {
        // No token could be had, so the payment call was never made: nothing exists at Ozow.
        return { kind: 'refused', detail: e instanceof Error ? e.message.slice(0, 120) : 'no token' };
      }
      if (r.kind === 'transport') return { kind: 'unclear', detail: describe(r) };
      if (r.status === 200 || r.status === 201) {
        const id = str(r.body?.id);
        if (/^[A-Za-z0-9-]{1,100}$/.test(id) && isOzowLink(r.body?.redirectUrl) && str(r.body?.status) !== 'Expired') {
          return { kind: 'created', paymentId: id, redirectUrl: r.body.redirectUrl as string };
        }
        return { kind: 'unclear', detail: `HTTP ${r.status} without a usable id and link, call ${r.correlationId}` };
      }
      // Ozow (support 12 Nov; its migration page): replaying the SAME Idempotency-Key with the SAME body returns the original result (200 or 201, handled above), so a replay is never an
      // error. 409 Conflict is what Ozow's reference gives for the same key with a DIFFERENT body (key and request data do not match an earlier request): a payment
      // may exist under that key, so it is "unclear", never a second payment. How long Ozow keeps a key is not stated. Other 4xx: Ozow refused before making one.
      if (r.status >= 400 && r.status < 500 && r.status !== 409) return { kind: 'refused', detail: describe(r) };
      return { kind: 'unclear', detail: describe(r) };
    },

    async checkPayment(input: { paymentId: string; reference: string; createdAt: string }): Promise<CheckOutcome> {
      if (!/^[A-Za-z0-9-]{1,100}$/.test(input.paymentId)) return { kind: 'failed', detail: 'the payment id is not in the expected form' };
      // fromDate and toDate are both required, whole days, and the pages do not say which time zone: ask for the day before creation to tomorrow.
      const created = new Date(input.createdAt);
      const from = new Date((Number.isNaN(created.getTime()) ? now() - 2 * 86_400_000 : created.getTime()) - 86_400_000);
      const to = new Date(now() + 86_400_000);
      const query = new URLSearchParams({ limit: '50', fromDate: from.toISOString().slice(0, 10), toDate: to.toISOString().slice(0, 10) });
      let r: Called;
      try {
        r = await authed('GET', `/payments/${input.paymentId}/transactions?${query.toString()}`, {});
      } catch (e) {
        return { kind: 'failed', detail: e instanceof Error ? e.message.slice(0, 120) : 'no token' };
      }
      if (r.kind === 'transport' || r.status !== 200) return { kind: 'failed', detail: describe(r) };
      const results = r.body?.results;
      // An id that matches no payment answers 200 with an empty list: that is "nothing yet", not an error.
      if (!Array.isArray(results)) return { kind: 'failed', detail: `HTTP 200 without a list of results, call ${r.correlationId}` };
      const transactions: ProviderTransaction[] = [];
      for (const item of results) {
        const t = asObj(item);
        if (!t) continue;
        const amount = asObj(t.amount);
        transactions.push({
          reference: str(t.merchantReference),
          txnId: str(t.id),
          status: str(t.status), // compared without case by the database
          amountText: amountTextOf(amount?.value),
          currency: str(amount?.currency),
          siteOk: str(t.siteCode) !== '' && str(t.siteCode) === config.siteCode,
          isTest: '', // the Transaction page has no such field; the database then treats it as "not a test"
          reason: str(t.reason),
        });
      }
      return { kind: 'ok', transactions };
    },

    verifyWebhook(headers: HeaderBag, rawBody: Buffer): WebhookResult {
      const seen = checkOzowSignature(config.webhookSecret, headers, rawBody, now());
      if (seen.ok === false) return { kind: 'rejected', reason: seen.reason, messageIdHint: seen.messageIdHint };
      return { kind: 'verified', eventId: seen.messageId, event: readEvent(rawBody) };
    },
  };

  function readEvent(rawBody: Buffer): WebhookEvent {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody.toString('utf8'));
    } catch {
      return { kind: 'unreadable' };
    }
    const envelope = asObj(parsed);
    if (!envelope || typeof envelope.type !== 'string') return { kind: 'unreadable' };
    if (envelope.type !== 'transaction.complete') return { kind: 'other', type: envelope.type };
    const d = asObj(envelope.data);
    if (!d) return { kind: 'unreadable' };
    // A "thin" subscription carries only data.id (the transaction id), status and reason: no reference, amount or currency. Never credited from.
    if (typeof d.TransactionReference !== 'string' || typeof d.Status !== 'string' || typeof d.TransactionId !== 'string') return { kind: 'thin' };
    return {
      kind: 'transaction',
      tx: {
        reference: d.TransactionReference,
        txnId: d.TransactionId,
        status: d.Status,
        amountText: str(d.Amount), // must be a string: a number or anything else goes to the database as '' and is sent to a person
        currency: str(d.CurrencyCode),
        siteOk: typeof d.SiteCode === 'string' && d.SiteCode !== '' && d.SiteCode === config.siteCode,
        isTest: str(d.IsTest), // Ozow's OpenAPI file lists IsTest ("True"/"False") in the full message although support says it does not apply to One API; absent ('') counts as "not a test"
        reason: str(d.StatusMessage),
      },
    };
  }
}
