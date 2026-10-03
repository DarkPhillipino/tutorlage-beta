import 'dotenv/config';
import crypto from 'node:crypto';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import { createClient } from '@supabase/supabase-js';

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
const PORT = Number(process.env.PORT) || 8787;
// The same project URL the frontend uses; SUPABASE_URL wins if a host sets it separately.
const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
// Bypasses row-level security. Server-side only — never prefix with VITE_.
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
// Comma-separated real origins allowed to call this API and to be used as a
// payment callback target. Defaults to the local dev origin so nothing here
// breaks before a real deploy — set this to the real production frontend
// origin(s) when the server is deployed (backlog item 1).
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? 'http://localhost:3000')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

// Hosted on Cloudflare Workers (server/worker.ts, master backlog item 1) or run locally with `npm run server`.
const ON_CLOUDFLARE = typeof navigator !== 'undefined' && navigator.userAgent === 'Cloudflare-Workers';

const CONFIG_ERROR = !PAYSTACK_SECRET_KEY
  ? 'PAYSTACK_SECRET_KEY is not set'
  : !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY
    ? 'SUPABASE_URL (or VITE_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY must be set'
    : null;
// Locally a missing secret stops the server at once. On Cloudflare the Worker's start-up code also runs
// when it's uploaded, before its secrets may exist, so it starts anyway and answers 503 (below) until
// they're set with `wrangler secret put`.
if (CONFIG_ERROR && !ON_CLOUDFLARE) {
  throw new Error(`${CONFIG_ERROR} — check .env`);
}
const PAYSTACK_TEST_MODE = PAYSTACK_SECRET_KEY?.startsWith('sk_test_') ?? false;
// Backlog 7a. 'enforce': where the tutor's bank supports Paystack's account validation, the account must
// be confirmed as theirs and able to receive money before payouts are set up. 'record': the result is
// stored but doesn't block. Paystack's test mode refutes every made-up account, so test mode defaults to
// 'record' (set BANK_VALIDATION=enforce to try the refusal path); live keys always enforce.
const BANK_VALIDATION: 'enforce' | 'record' =
  PAYSTACK_TEST_MODE && process.env.BANK_VALIDATION !== 'enforce' ? 'record' : 'enforce';

// Privileged database access for the two things browsers may no longer do
// (backlog 7i): read the price the database set for a request, and mark a
// request paid once Paystack has confirmed the exact amount.
const db = createClient(SUPABASE_URL || 'https://not-configured.invalid', SUPABASE_SERVICE_ROLE_KEY || 'not-configured', {
  auth: { persistSession: false, autoRefreshToken: false },
});

const app = express();
// Behind a hosting provider's proxy, req.ip is the proxy's address unless
// Express is told to trust it — the rate limiter below keys on req.ip.
if (process.env.TRUST_PROXY) {
  app.set('trust proxy', Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY);
}
// JSON request bodies, keeping the exact bytes of each: Paystack signs the raw webhook body, and
// re-serialised JSON wouldn't match the signature. Written out rather than express.json(), because Express
// 4's body parser loads iconv-lite, which fails to load on Cloudflare Workers ("require_streams(...) is not
// a function"), and the Worker then can't start. Same limit (100 KB) and same req.body shapes as before:
// {} when there's no JSON body.
const MAX_BODY_BYTES = 100 * 1024;
app.use((req: Request, res: Response, next: NextFunction) => {
  if (!/^application\/json\b/i.test(req.headers['content-type'] ?? '')) {
    req.body = {};
    next();
    return;
  }
  const chunks: Buffer[] = [];
  let size = 0;
  req.on('data', (chunk: Buffer) => {
    size += chunk.length;
    if (size <= MAX_BODY_BYTES) chunks.push(chunk);
  });
  req.on('error', next);
  req.on('end', () => {
    if (size > MAX_BODY_BYTES) {
      res.status(413).json({ error: 'That request is too large.' });
      return;
    }
    const raw = Buffer.concat(chunks);
    (req as Request & { rawBody?: Buffer }).rawBody = raw;
    if (raw.length === 0) {
      req.body = {};
      next();
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.toString('utf8'));
    } catch {
      parsed = undefined;
    }
    // Objects and arrays only, as express.json()'s strict mode did: a bare null or number would break the
    // handlers that destructure req.body.
    if (parsed === null || typeof parsed !== 'object') {
      res.status(400).json({ error: 'The request body is not valid JSON.' });
      return;
    }
    req.body = parsed;
    next();
  });
});

// Real CORS, not Express's permissive default: only echo back an Origin
// that's actually on the allowlist above, rather than allowing any origin to
// call a payment-initiating endpoint from a browser.
app.use((req: Request, res: Response, next: NextFunction) => {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }
  next();
});

// Only reachable on Cloudflare (locally a missing secret stops the server above). After the CORS headers,
// so the app can read the message.
if (CONFIG_ERROR) {
  console.error(`Payments API not configured: ${CONFIG_ERROR}`);
  app.use((_req: Request, res: Response) => {
    res.status(503).json({ error: 'Payments are not set up on this server yet.' });
  });
}

// On Cloudflare the connection comes from Cloudflare's own network, so req.ip isn't the visitor and every
// visitor would share one limit. There the visitor's address is read from the header Cloudflare sets
// (RATE_LIMIT_IP_HEADER=cf-connecting-ip, in wrangler.jsonc). Only set it on a host that overwrites that
// header itself; anywhere else a client could send any value to dodge the limit.
const RATE_LIMIT_IP_HEADER = process.env.RATE_LIMIT_IP_HEADER?.trim().toLowerCase() || null;

// Minimal in-memory sliding-window rate limiter — no new dependency needed
// for a single-process proxy this size. Keyed by IP (see TRUST_PROXY above). On Cloudflare each copy of
// the Worker keeps its own counts, so the limit is per copy, not global.
function rateLimit(maxRequests: number, windowMs: number) {
  const hits = new Map<string, number[]>();
  return (req: Request, res: Response, next: NextFunction) => {
    const forwarded = RATE_LIMIT_IP_HEADER ? req.headers[RATE_LIMIT_IP_HEADER] : undefined;
    const key = (typeof forwarded === 'string' && forwarded) || req.ip || 'unknown';
    const now = Date.now();
    const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
    if (recent.length >= maxRequests) {
      res.status(429).json({ error: 'Too many requests — please slow down and try again shortly.' });
      return;
    }
    recent.push(now);
    hits.set(key, recent);
    next();
  };
}

// A reference/code used in a URL or logged value — safe charset only, no
// control characters or injection-shaped input.
const SAFE_TOKEN = /^[A-Za-z0-9_-]{1,200}$/;
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// One Paystack call. ok = HTTP success and Paystack's own status: true.
async function paystack(path: string, init: { method?: string; body?: unknown } = {}) {
  const response = await fetch(`https://api.paystack.co${path}`, {
    method: init.method ?? 'GET',
    headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`, 'Content-Type': 'application/json' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  let body: any = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return { ok: response.ok && body?.status === true, httpStatus: response.status, body };
}

// The signed-in caller, from their own access token — never from the request body. Sends the 401 itself.
async function signedInUser(req: Request, res: Response) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!token) {
    res.status(401).json({ error: 'Sign in first.' });
    return null;
  }
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) {
    res.status(401).json({ error: 'Your sign-in has expired — sign in again.' });
    return null;
  }
  return data.user;
}

// For hosting health checks.
app.get('/healthz', (_req, res) => {
  res.json({ ok: true });
});

// --- Card check at booking (backlog 7a) ---
//
// Sending a request no longer charges the price. The payer's card is saved with a small check charge
// (card_check_amount_cents, R1 — Paystack's recommended first charge for a card to be charged later),
// refunded straight away. The price is charged only when a tutor accepts (POST /api/requests/:id/accept),
// split so the tutor's share goes straight to the tutor. An unmatched request is never charged.

interface InitializeBody {
  reference: string;
  callbackUrl: string;
}

// Starts the card check for the caller's own new request and hands back Paystack's hosted checkout URL.
// The payer is the signed-in user (their access token, not the body), and the amount comes from the
// database's setting — the browser sends neither.
app.post('/api/payments/initialize', rateLimit(10, 60_000), async (req, res) => {
  const user = await signedInUser(req, res);
  if (!user) return;
  const { reference, callbackUrl } = req.body as Partial<InitializeBody>;

  if (!reference || !callbackUrl) {
    res.status(400).json({ error: 'reference and callbackUrl are both required' });
    return;
  }
  if (!SAFE_TOKEN.test(reference)) {
    res.status(400).json({ error: 'reference has an invalid format' });
    return;
  }
  if (!ALLOWED_ORIGINS.some((origin) => callbackUrl.startsWith(origin))) {
    res.status(400).json({ error: 'callbackUrl is not on the allowed origin list' });
    return;
  }
  if (!user.email || !EMAIL_SHAPE.test(user.email)) {
    res.status(400).json({ error: 'Your account needs an email address for Paystack to send your receipt to.' });
    return;
  }

  const [{ data: request, error: lookupError }, { data: setting, error: settingError }] = await Promise.all([
    db
      .from('session_requests')
      .select('requested_by_profile_id, currency_code, payment_status')
      .eq('paystack_reference', reference)
      .maybeSingle(),
    db.from('system_settings').select('setting_value').eq('setting_key', 'card_check_amount_cents').maybeSingle(),
  ]);
  if (lookupError || settingError) {
    console.error('Card check lookup failed:', lookupError ?? settingError);
    res.status(500).json({ error: 'Could not look up that request' });
    return;
  }
  if (!request || request.payment_status !== 'initiated') {
    res.status(400).json({ error: 'No unsent request matches that reference' });
    return;
  }
  if (request.requested_by_profile_id !== user.id) {
    res.status(403).json({ error: 'That request belongs to someone else.' });
    return;
  }
  const amount = Number(setting?.setting_value ?? 100);

  try {
    const init = await paystack('/transaction/initialize', {
      method: 'POST',
      body: {
        email: user.email,
        amount,
        currency: String(request.currency_code).trim(),
        reference,
        callback_url: callbackUrl,
        // A card is the only channel whose authorization can be charged again later.
        channels: ['card'],
        metadata: { purpose: 'card_check' },
      },
    });
    if (!init.ok) {
      res.status(502).json({ error: init.body?.message ?? 'Paystack initialize failed' });
      return;
    }
    res.json({ authorizationUrl: init.body.data.authorization_url, reference: init.body.data.reference });
  } catch (err) {
    console.error('Paystack initialize error:', err);
    res.status(502).json({ error: 'Could not reach Paystack' });
  }
});

type CardCheckResult = { status: 'card_verified' | 'paid' | 'failed' | 'pending'; reason?: string | null };

// Checks a card-check transaction with Paystack (never trusting the browser's redirect) and records the
// saved card in the database (record_card_verification checks the amount, currency and that the card
// can be charged again). The R1 is then refunded, whatever the outcome. Used by the callback page's
// verify call and by the webhook, so a payer who closes the tab before the redirect still gets through.
async function settleCardCheck(reference: string): Promise<CardCheckResult | null> {
  const { data: request, error } = await db
    .from('session_requests')
    .select('payment_status, charge_failure_reason')
    .eq('paystack_reference', reference)
    .maybeSingle();
  if (error) throw error;
  if (!request) return null;
  if (request.payment_status === 'paid') return { status: 'paid' }; // paid up front before 7a
  if (request.payment_status === 'failed') return { status: 'failed', reason: request.charge_failure_reason };
  if (request.payment_status !== 'initiated') return { status: 'card_verified' };

  const check = await paystack(`/transaction/verify/${encodeURIComponent(reference)}`);
  if (!check.ok) throw new Error(check.body?.message ?? `Paystack verify failed (${check.httpStatus})`);
  const txn = check.body.data;

  if (txn.status === 'success') {
    const { data: result, error: recordError } = await db.rpc('record_card_verification', {
      p_reference: reference,
      p_amount_cents: txn.amount,
      p_currency: txn.currency,
      p_authorization: txn.authorization ?? {},
      p_customer_email: txn.customer?.email ?? '',
    });
    if (recordError) throw recordError;

    const refund = await paystack('/refund', { method: 'POST', body: { transaction: reference } });
    if (refund.ok) {
      await db.from('session_requests').update({ card_check_refund_status: 'queued' }).eq('paystack_reference', reference);
    } else {
      // The callback page and the webhook can both settle the same card check; the second refund attempt
      // then fails ("already reversed"). Only record a failure when nothing has been recorded yet.
      const note = `not refunded: ${refund.body?.message ?? `HTTP ${refund.httpStatus}`}`;
      console.error(`Card check ${reference} — ${note}`);
      await db
        .from('session_requests')
        .update({ card_check_refund_status: note })
        .eq('paystack_reference', reference)
        .is('card_check_refund_status', null);
    }

    if (result === 'card_verified') return { status: 'card_verified' };
    const { data: after } = await db
      .from('session_requests')
      .select('charge_failure_reason')
      .eq('paystack_reference', reference)
      .maybeSingle();
    return { status: 'failed', reason: after?.charge_failure_reason };
  }
  if (txn.status === 'failed' || txn.status === 'abandoned' || txn.status === 'reversed') {
    await db
      .from('session_requests')
      .update({ payment_status: 'failed' })
      .eq('paystack_reference', reference)
      .eq('payment_status', 'initiated');
    return { status: 'failed' };
  }
  return { status: 'pending' };
}

app.get('/api/payments/verify/:reference', rateLimit(30, 60_000), async (req, res) => {
  const { reference } = req.params;
  if (!SAFE_TOKEN.test(reference)) {
    res.status(400).json({ error: 'reference has an invalid format' });
    return;
  }
  try {
    const result = await settleCardCheck(reference);
    if (!result) {
      res.status(404).json({ error: 'No request matches that reference' });
      return;
    }
    res.json(result);
  } catch (err) {
    console.error('Card check verify error:', err);
    res.status(502).json({ error: 'Could not confirm the card check with Paystack — try again in a minute.' });
  }
});

// --- Tutor bank details (backlog 7a) ---

interface Bank {
  code: string;
  name: string;
  supportsValidation: boolean;
}
let bankCache: { banks: Bank[]; at: number } | null = null;

// South African banks Paystack can pay out to, and which of them support account validation.
async function southAfricanBanks(): Promise<Bank[]> {
  if (bankCache && Date.now() - bankCache.at < 12 * 3600_000) return bankCache.banks;
  const [all, verifiable] = await Promise.all([
    paystack('/bank?currency=ZAR&perPage=100'),
    paystack('/bank?currency=ZAR&enabled_for_verification=true&perPage=100'),
  ]);
  if (!all.ok) throw new Error(all.body?.message ?? `Paystack bank list failed (${all.httpStatus})`);
  const canValidate = new Set<string>((verifiable.ok ? verifiable.body.data : []).map((b: any) => String(b.code)));
  const banks: Bank[] = (all.body.data as any[])
    .filter((b) => b.active && !b.is_deleted)
    .map((b) => ({ code: String(b.code), name: String(b.name), supportsValidation: canValidate.has(String(b.code)) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  bankCache = { banks, at: Date.now() };
  return banks;
}

app.get('/api/banks', rateLimit(30, 60_000), async (_req, res) => {
  try {
    res.json({ banks: await southAfricanBanks() });
  } catch (err) {
    console.error('Bank list error:', err);
    res.status(502).json({ error: 'Could not load the list of banks — try again shortly.' });
  }
});

// A South African ID number: 13 digits with a valid Luhn check digit.
function isSouthAfricanIdNumber(id: string): boolean {
  if (!/^\d{13}$/.test(id)) return false;
  let sum = 0;
  for (let i = 0; i < 13; i++) {
    let digit = Number(id[i]);
    if (i % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return sum % 10 === 0;
}

interface PayoutAccountBody {
  bankCode: string;
  accountNumber: string;
  accountHolderName: string;
  documentType: 'identityNumber' | 'passportNumber';
  documentNumber: string;
}

// A tutor adds or changes the bank account their share is paid into. Paystack validates it (where the
// bank supports it — South Africa's check needs the account holder's ID or passport number, which is
// passed to Paystack and never stored or logged), then a Paystack subaccount is created or updated so
// split payments settle straight to the tutor. Only the bank, the last 4 digits, the validation result
// and the subaccount code are stored.
app.post('/api/tutor/payout-account', rateLimit(5, 60_000), async (req, res) => {
  const user = await signedInUser(req, res);
  if (!user) return;

  const body = req.body as Partial<PayoutAccountBody>;
  const accountNumber = String(body.accountNumber ?? '').replace(/\s/g, '');
  const holder = String(body.accountHolderName ?? '').trim().replace(/\s+/g, ' ');
  const documentType = body.documentType;
  const documentNumber = String(body.documentNumber ?? '').replace(/\s/g, '').toUpperCase();

  if (!/^\d{6,16}$/.test(accountNumber)) {
    res.status(400).json({ error: 'Enter your account number (digits only).' });
    return;
  }
  if (holder.length < 2 || holder.length > 100 || !/^[\p{L}' .-]+$/u.test(holder)) {
    res.status(400).json({ error: 'Enter the account holder’s name as the bank has it.' });
    return;
  }
  const documentValid =
    documentType === 'identityNumber'
      ? isSouthAfricanIdNumber(documentNumber)
      : documentType === 'passportNumber'
        ? /^[A-Z0-9]{6,20}$/.test(documentNumber)
        : false;
  if (!documentValid) {
    res.status(400).json({ error: 'Enter a valid South African ID number, or your passport number.' });
    return;
  }

  const { data: tutor, error: tutorError } = await db.from('tutor_profiles').select('id').eq('id', user.id).maybeSingle();
  if (tutorError) {
    console.error('Tutor lookup failed:', tutorError);
    res.status(500).json({ error: 'Could not check your account — try again.' });
    return;
  }
  if (!tutor) {
    res.status(403).json({ error: 'Only tutor accounts can add bank details for payouts.' });
    return;
  }

  let bank: Bank | undefined;
  try {
    bank = (await southAfricanBanks()).find((b) => b.code === body.bankCode);
  } catch (err) {
    console.error('Bank list error:', err);
    res.status(502).json({ error: 'Could not load the list of banks — try again shortly.' });
    return;
  }
  if (!bank) {
    res.status(400).json({ error: 'Choose your bank from the list.' });
    return;
  }

  try {
    let validationStatus: 'validated' | 'bank_not_supported' | 'recorded_test_mode' = 'bank_not_supported';
    let validationDetail: Record<string, unknown> = {};
    if (bank.supportsValidation) {
      const check = await paystack('/bank/validate', {
        method: 'POST',
        body: {
          bank_code: bank.code,
          country_code: 'ZA',
          account_number: accountNumber,
          account_name: holder,
          account_type: 'personal',
          document_type: documentType,
          document_number: documentNumber,
        },
      });
      const d = check.body?.data ?? {};
      validationDetail = {
        verified: d.verified ?? null,
        accountHolderMatch: d.accountHolderMatch ?? null,
        accountAcceptsCredits: d.accountAcceptsCredits ?? null,
        accountOpenForMoreThanThreeMonths: d.accountOpenForMoreThanThreeMonths ?? null,
        message: d.verificationMessage ?? check.body?.message ?? null,
      };
      const passed = check.ok && (d.verified === true || (d.accountHolderMatch === true && d.accountAcceptsCredits === true));
      if (passed) {
        validationStatus = 'validated';
      } else if (BANK_VALIDATION === 'enforce') {
        res.status(400).json({
          error: check.ok
            ? "Your bank couldn't confirm this account is in your name and can receive payments. Check the account number, the account holder's name and your ID number."
            : 'Paystack couldn’t check this account right now — try again in a few minutes.',
        });
        return;
      } else {
        validationStatus = 'recorded_test_mode';
      }
    }

    const { data: existing, error: existingError } = await db
      .from('tutor_payout_accounts')
      .select('paystack_subaccount_code')
      .eq('tutor_id', user.id)
      .maybeSingle();
    if (existingError) throw existingError;

    const subaccountDetails = {
      business_name: holder,
      settlement_bank: bank.code,
      account_number: accountNumber,
      // Only a default: every charge passes Tutorlage's commission for that level as transaction_charge.
      percentage_charge: 30,
      description: `Tutorlage tutor ${user.id}`,
    };
    const sub = existing?.paystack_subaccount_code
      ? await paystack(`/subaccount/${existing.paystack_subaccount_code}`, {
          method: 'PUT',
          body: { ...subaccountDetails, active: true },
        })
      : await paystack('/subaccount', { method: 'POST', body: subaccountDetails });
    const subaccountCode = sub.body?.data?.subaccount_code ?? existing?.paystack_subaccount_code;
    if (!sub.ok || !subaccountCode) {
      res.status(502).json({ error: `Paystack couldn't set up payouts to this account: ${sub.body?.message ?? 'try again'}.` });
      return;
    }

    const last4 = accountNumber.slice(-4);
    const { error: saveError } = await db.rpc('save_tutor_payout_account', {
      p_tutor_id: user.id,
      p_bank_code: bank.code,
      p_bank_name: bank.name,
      p_account_holder: holder,
      p_last4: last4,
      p_subaccount_code: subaccountCode,
      p_validation_status: validationStatus,
      p_validation_detail: validationDetail,
    });
    if (saveError) throw saveError;

    res.json({ bankName: bank.name, last4, validationStatus });
  } catch (err) {
    // Never log the request body: it holds the account and ID numbers.
    console.error('Payout account error:', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Could not save your bank details — try again.' });
  }
});

// --- Accepting a request (backlog 7a) ---
//
// The database reserves the request for this tutor and says what to charge (claim_session_request); the
// saved card is charged with the tutor's subaccount so Paystack pays the tutor's share straight to them,
// transaction_charge = Tutorlage's commission for the level, bearer = the paystack_fee_bearer setting.
// Success books the session; a decline cancels the request (the learner is told they weren't charged).
// Anything unclear — a timeout, a bank still authenticating — is left 'charging' and settled by the
// database's reconcile_stale_charges job, which asks Paystack what happened.
app.post('/api/requests/:id/accept', rateLimit(20, 60_000), async (req, res) => {
  const user = await signedInUser(req, res);
  if (!user) return;
  const requestId = req.params.id;
  if (!UUID_SHAPE.test(requestId)) {
    res.status(400).json({ error: 'That request id is not valid.' });
    return;
  }

  const { data: claim, error: claimError } = await db.rpc('claim_session_request', {
    p_request_id: requestId,
    p_tutor_id: user.id,
  });
  if (claimError) {
    res.status(409).json({ error: claimError.message });
    return;
  }
  if (claim.mode === 'already_paid') {
    res.json({ status: 'booked', sessionId: claim.session_id });
    return;
  }

  let charge: Awaited<ReturnType<typeof paystack>>;
  try {
    charge = await paystack('/transaction/charge_authorization', {
      method: 'POST',
      body: {
        authorization_code: claim.authorization_code,
        email: claim.email,
        amount: claim.amount_cents,
        currency: claim.currency,
        reference: claim.charge_reference,
        subaccount: claim.subaccount,
        transaction_charge: claim.commission_cents,
        bearer: claim.bearer,
        metadata: { purpose: 'session_charge', request_id: requestId },
      },
    });
  } catch (err) {
    console.error(`Charge ${claim.charge_reference} — no answer from Paystack:`, err);
    res.status(202).json({
      status: 'confirming',
      message: "Paystack is still confirming the learner's payment. The session appears in your list once it's confirmed — usually within a few minutes.",
    });
    return;
  }

  const txn = charge.body?.data;
  if (charge.ok && txn?.status === 'success') {
    const { data: sessionId, error: finalizeError } = await db.rpc('finalize_session_charge', {
      p_request_id: requestId,
      p_charge_reference: claim.charge_reference,
      p_amount_cents: txn.amount,
      p_currency: txn.currency,
      p_fee_cents: txn.fees ?? 0,
    });
    if (finalizeError) {
      console.error(`Charge ${claim.charge_reference} succeeded but could not be recorded:`, finalizeError);
      res.status(500).json({ error: 'The payment went through but the booking could not be recorded — Tutorlage has been alerted and will sort it out.' });
      return;
    }
    res.json({ status: 'booked', sessionId });
    return;
  }

  const declined =
    (charge.ok && ['failed', 'abandoned', 'reversed'].includes(txn?.status)) ||
    (charge.httpStatus >= 400 && charge.httpStatus < 500);
  if (declined) {
    const reason = txn?.gateway_response ?? charge.body?.message ?? 'The card was declined';
    if (!charge.ok) console.error(`Charge ${claim.charge_reference} refused by Paystack: ${reason}`);
    const { error: releaseError } = await db.rpc('release_session_charge', {
      p_request_id: requestId,
      p_charge_reference: claim.charge_reference,
      p_reason: reason,
    });
    if (releaseError) console.error(`Could not release ${claim.charge_reference}:`, releaseError);
    res.status(402).json({
      error: "The learner's card couldn't be charged, so this request has been cancelled and you haven't been booked. The learner has been told.",
    });
    return;
  }

  res.status(202).json({
    status: 'confirming',
    message: "Paystack is still confirming the learner's payment. The session appears in your list once it's confirmed — usually within a few minutes.",
  });
});

// --- Paystack webhook (backlogs 7a and 7z) ---
//
// Paystack signs each event with an HMAC-SHA512 of the raw body, keyed with the secret key. Only
// correctly signed events are acted on. This can only receive events once server/ is deployed at a
// public address (master backlog item 1) and the URL is entered in Paystack's dashboard; until then the
// database's polling jobs (poll_queued_refunds, reconcile_stale_charges) do the same work more slowly.
app.post('/api/paystack/webhook', async (req, res) => {
  const raw = (req as Request & { rawBody?: Buffer }).rawBody;
  const signature = req.headers['x-paystack-signature'];
  const expected = raw ? crypto.createHmac('sha512', PAYSTACK_SECRET_KEY).update(raw).digest('hex') : '';
  if (
    !raw ||
    typeof signature !== 'string' ||
    signature.length !== expected.length ||
    !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  ) {
    res.sendStatus(401);
    return;
  }
  // Record first, then acknowledge. On Cloudflare Workers, work left after the response is sent can be cut
  // off, so answering first could lose a payment update. The database calls take well under a second, so
  // Paystack still gets a quick 200; a failure is logged and still answered 200, because the database's
  // polling jobs settle anything missed, and a retry would only repeat the same failure.
  const { event, data } = (req.body ?? {}) as { event?: string; data?: any };
  try {
    if (event === 'charge.success' && typeof data?.reference === 'string' && SAFE_TOKEN.test(data.reference)) {
      if (data.reference.startsWith('chg_')) {
        const { data: row } = await db
          .from('session_requests')
          .select('id, payment_status')
          .eq('charge_reference', data.reference)
          .maybeSingle();
        if (row?.payment_status === 'charging') {
          const { error } = await db.rpc('finalize_session_charge', {
            p_request_id: row.id,
            p_charge_reference: data.reference,
            p_amount_cents: data.amount,
            p_currency: data.currency,
            p_fee_cents: data.fees ?? 0,
          });
          if (error) console.error(`Webhook could not finalize ${data.reference}:`, error);
        }
      } else {
        await settleCardCheck(data.reference);
      }
    } else if (typeof event === 'string' && event.startsWith('refund.')) {
      await db.rpc('apply_refund_webhook', {
        p_refund_id: Number.isInteger(data?.id) ? data.id : null,
        p_transaction_reference: typeof data?.transaction_reference === 'string' ? data.transaction_reference : null,
        p_status: event.slice('refund.'.length),
        p_refunded_at: data?.refunded_at ?? null,
      });
    }
  } catch (err) {
    console.error(`Webhook ${event} handling failed:`, err);
  }
  res.sendStatus(200);
});

// --- Guardians add learners (backlog 7k; legal spec Drake/legal/specs/7k-minors-consent-and-acceptance.md §3-4) ---
//
// A learner under 18 can't sign up alone; their parent or legal guardian adds them from their own
// account. Creating an account for someone else needs the service-role key, so it happens here. The
// guardian's identity comes from their own access token (never from the request body), and the
// database's signup trigger does the rest from app_metadata — which only the service role can set:
// it re-checks that the guardian is an adult parent, links the learner, and records the POPIA s35
// consent and the Terms/Privacy acceptance the guardian gave on the learner's behalf.
//
// The learner signs in with a password the guardian chooses, so no email has to reach the learner
// (and nothing depends on the email sender, backlog 7j). If the guardian doesn't give the learner's
// own email, a sign-in name is generated under the reserved .invalid domain, which can never receive
// mail or belong to anyone.

// Must match LEARNER_LOGIN_DOMAIN in src/lib/accountRules.ts (the sign-in form turns a typed
// sign-in name back into this address).
const LEARNER_LOGIN_DOMAIN = 'learners.tutorlage.invalid';
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const GUARDIAN_RELATIONSHIPS = ['mother', 'father', 'guardian'] as const;

function ageOn(isoDate: string, today = new Date()): number {
  const [y, m, d] = isoDate.split('-').map(Number);
  let age = today.getUTCFullYear() - y;
  if (today.getUTCMonth() + 1 < m || (today.getUTCMonth() + 1 === m && today.getUTCDate() < d)) age -= 1;
  return age;
}

function learnerSignInName(firstName: string): string {
  const slug = firstName.toLowerCase().normalize('NFKD').replace(/[^a-z]/g, '').slice(0, 12) || 'learner';
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${slug}-${suffix}`;
}

interface AddLearnerBody {
  firstName: string;
  surname: string;
  dateOfBirth: string;
  gradeLevel?: string;
  schoolId?: string | null;
  relationship: string;
  learnerEmail?: string;
  password: string;
  consentGiven: boolean;
  consentVersion: string;
  acceptedTermsVersion: string;
  acceptedPrivacyVersion: string;
}

app.post('/api/guardian/learners', rateLimit(5, 60_000), async (req, res) => {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!token) {
    res.status(401).json({ error: 'Sign in first.' });
    return;
  }
  const { data: authData, error: authError } = await db.auth.getUser(token);
  if (authError || !authData.user) {
    res.status(401).json({ error: 'Your sign-in has expired — sign in again.' });
    return;
  }
  const guardianId = authData.user.id;

  const body = req.body as Partial<AddLearnerBody>;
  const firstName = body.firstName?.trim() ?? '';
  const surname = body.surname?.trim() ?? '';
  const learnerEmail = body.learnerEmail?.trim().toLowerCase() || '';
  if (!firstName || !surname || firstName.length > 80 || surname.length > 80) {
    res.status(400).json({ error: "Enter the learner's first name and surname." });
    return;
  }
  if (!body.dateOfBirth || !ISO_DATE.test(body.dateOfBirth)) {
    res.status(400).json({ error: "Enter the learner's date of birth." });
    return;
  }
  const learnerAge = ageOn(body.dateOfBirth);
  if (learnerAge < 0 || learnerAge > 120) {
    res.status(400).json({ error: 'Enter a real date of birth.' });
    return;
  }
  if (learnerAge >= 18) {
    res.status(400).json({ error: 'Learners 18 or older create their own account.' });
    return;
  }
  if (!GUARDIAN_RELATIONSHIPS.includes(body.relationship as (typeof GUARDIAN_RELATIONSHIPS)[number])) {
    res.status(400).json({ error: 'Only a parent or legal guardian can add a learner.' });
    return;
  }
  if (!body.password || body.password.length < 8 || body.password.length > 72) {
    res.status(400).json({ error: 'Choose a password of at least 8 characters for the learner.' });
    return;
  }
  if (learnerEmail && !EMAIL_SHAPE.test(learnerEmail)) {
    res.status(400).json({ error: "The learner's email address doesn't look right." });
    return;
  }
  if (body.schoolId && !/^[0-9a-f-]{36}$/i.test(body.schoolId)) {
    res.status(400).json({ error: 'Choose the school again.' });
    return;
  }

  // Consent and acceptance must be for the documents in force right now.
  const { data: versions, error: versionError } = await db.rpc('current_policy_versions');
  const current = Array.isArray(versions) ? versions[0] : versions;
  if (versionError || !current) {
    console.error('current_policy_versions failed:', versionError);
    res.status(500).json({ error: 'Could not check the current consent wording — try again.' });
    return;
  }
  if (body.consentGiven !== true || body.consentVersion !== current.guardian_consent_version) {
    res.status(400).json({ error: 'Please read and tick the consent before adding a learner.' });
    return;
  }
  if (body.acceptedTermsVersion !== current.terms_version || body.acceptedPrivacyVersion !== current.privacy_version) {
    res.status(400).json({ error: 'Please accept the current Terms of Service and Privacy Policy for the learner.' });
    return;
  }

  // A friendly early answer; the signup trigger enforces the same rule regardless.
  const { data: guardian, error: guardianError } = await db
    .from('profiles')
    .select('role, date_of_birth')
    .eq('id', guardianId)
    .maybeSingle();
  if (guardianError) {
    console.error('Guardian lookup failed:', guardianError);
    res.status(500).json({ error: 'Could not check your account — try again.' });
    return;
  }
  if (!guardian || guardian.role !== 'parent' || !guardian.date_of_birth || ageOn(guardian.date_of_birth) < 18) {
    res.status(403).json({ error: 'Only an adult parent or guardian account can add a learner.' });
    return;
  }

  const signInName = learnerEmail ? null : learnerSignInName(firstName);
  const email = learnerEmail || `${signInName}@${LEARNER_LOGIN_DOMAIN}`;

  const { data: created, error: createError } = await db.auth.admin.createUser({
    email,
    password: body.password,
    email_confirm: true,
    user_metadata: {
      first_name: firstName,
      surname,
      role: 'student',
      date_of_birth: body.dateOfBirth,
      grade_level: body.gradeLevel?.trim() || null,
      school_id: body.schoolId || null,
      accepted_terms_version: body.acceptedTermsVersion,
      accepted_privacy_version: body.acceptedPrivacyVersion,
    },
    app_metadata: {
      created_by_guardian: guardianId,
      relationship: body.relationship,
      consent_version: body.consentVersion,
    },
  });

  if (createError || !created.user) {
    console.error('Learner account creation failed:', createError);
    const alreadyUsed = /already|registered|exists/i.test(createError?.message ?? '');
    res.status(alreadyUsed ? 409 : 500).json({
      error: alreadyUsed ? 'That email already has a Tutorlage account.' : 'Could not create the learner account — try again.',
    });
    return;
  }

  res.status(201).json({ learnerId: created.user.id, signIn: signInName ?? email });
});

app.listen(PORT, () => {
  console.log(`Payments API listening on http://localhost:${PORT}`);
});
