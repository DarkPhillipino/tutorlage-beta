// Online (pay-by-bank) wallet top-ups: the provider-neutral half of the Worker (phase 2 of 3; design: Drake/programmer/reports/2026-11-09-ozow-design.md, part 1.4).
// The database (supabase/migrations/20261109110000_wallet_online_topups.sql) decides every money question; this file only
//   * asks a payment provider to start a payment (createPayment) or tells us what happened to one (checkPayment, verifyWebhook),
//   * passes what the provider said to the database's one decision point (wallet_online_apply) and turns the answer into an HTTP reply.
// Nothing here knows Ozow: server/ozow.ts is the only file that does. A second provider is one new file that fills in PaymentProvider
// plus one webhook route; the routes, the database and the screens do not change.
// Everything it touches comes in through `deps`, so scripts/dev/wallet-online-worker-test.ts runs it with a pretend provider and a pretend
// database: no network, no key.
//
// Rules this file keeps (CEO and design):
//  * Secrets never reach a log line or a reply. Provider error text is never copied (it can echo a client id); only status numbers and short codes are.
//  * A payment is created at most once per top-up. If the create call is unclear (timeout, lost reply, server error) we do NOT try again: the
//    top-up is closed so the payer starts afresh, and any payment that did get made at the provider is one nobody holds a link to.
//  * The webhook answers 200 only after the database wrote, 500 when it could not (so the provider sends it again), and 200 for every
//    definite outcome (credited, duplicate, needs a person) because a retry would only repeat it.
//  * A message that fails the signature check credits nothing, is recorded (the database caps this) and is answered 400 with no detail.
import crypto from 'node:crypto';
import type { Request, RequestHandler, Response, Application } from 'express';

// ---------------------------------------------------------------- the provider interface ----------------------------------------------------------

export interface CreatePaymentInput {
  topupId: string;
  reference: string; // our TL-XXXXXX reference
  amountRand: number; // whole rands, from the database (never from the browser)
  expiresAt: string; // ISO time stored at claim, so a retry of the same request is byte-identical
  idempotencyKey: string; // topup-<top-up id>
  returnPath: string; // path and query on our own site; the provider adds its configured origin
}

// created: a payment exists and we hold its id and link. refused: the provider definitely said no, so no payment exists.
// unclear: the answer was lost or garbled, so a payment MAY exist; never retried.
export type CreatePaymentOutcome =
  | { kind: 'created'; paymentId: string; redirectUrl: string }
  | { kind: 'refused'; detail: string }
  | { kind: 'unclear'; detail: string };

// What the provider says about one transaction, already in the shapes the database wants (strings passed through, never "fixed").
export interface ProviderTransaction {
  reference: string;
  txnId: string;
  status: string;
  amountText: string; // two decimals with a full stop, or '' when the provider's shape is not the expected one
  currency: string;
  siteOk: boolean; // the provider's site code equals ours (the code itself never leaves the Worker)
  isTest: string; // 'True' / 'False' as the provider wrote it, or '' when the provider does not say
  reason: string;
}

export type CheckOutcome = { kind: 'ok'; transactions: ProviderTransaction[] } | { kind: 'failed'; detail: string };

export type WebhookEvent =
  | { kind: 'transaction'; tx: ProviderTransaction }
  | { kind: 'thin' } // a signed message without the fields we need: the subscription is not the "full" kind
  | { kind: 'other'; type: string } // a signed message of another event type
  | { kind: 'unreadable' }; // signed, but the body is not the JSON we expect

export type WebhookResult =
  | { kind: 'rejected'; reason: string; messageIdHint: string } // failed the safety check
  | { kind: 'verified'; eventId: string; event: WebhookEvent };

export interface PaymentProvider {
  readonly name: string; // 'ozow'; the value stored on the top-up's attempt and passed to the database
  readonly allowTestPayments: boolean; // true only against the provider's staging system
  createPayment(input: CreatePaymentInput): Promise<CreatePaymentOutcome>;
  checkPayment(input: { paymentId: string; reference: string; createdAt: string }): Promise<CheckOutcome>;
  verifyWebhook(headers: Record<string, string | string[] | undefined>, rawBody: Buffer): WebhookResult;
}

// ---------------------------------------------------------------- the database interface -----------------------------------------------------------

export interface DbReply {
  data: unknown;
  error: { message: string; code?: string } | null;
}
export interface WalletDb {
  rpc(name: string, args: Record<string, unknown>): Promise<DbReply>;
}

export interface Reply {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

export interface WalletOnlineDeps {
  db: WalletDb;
  userIdFromToken(token: string): Promise<string | null>;
  providers: Record<string, PaymentProvider | undefined>; // only the providers that are fully set up
  jobSecret: string | undefined; // WALLET_JOB_SECRET
  log?: (line: string) => void;
  concurrency?: number; // how many top-ups the backstop asks the provider about at once
}

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SAFE_WORD = /[^A-Za-z0-9_.:-]/g;
export const WEBHOOK_PROVIDER = 'ozow';
export const MAX_WEBHOOK_BYTES = 64 * 1024;

// A few characters of something a stranger sent, safe to put in a log line or a database note.
export function cleanBit(value: unknown, max = 60): string {
  return typeof value === 'string' ? value.replace(SAFE_WORD, '').slice(0, max) : '';
}

// Compared in constant time; a missing header or secret never matches. (Same rule as server/closeAccount.ts.)
export function secretMatches(header: string | string[] | undefined, expected: string | undefined): boolean {
  if (typeof header !== 'string' || !expected) return false;
  const a = crypto.createHash('sha256').update(header).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

const MSG = {
  signIn: 'Sign in first.',
  expired: 'Your sign-in has expired — sign in again.',
  notFound: 'We could not find that top-up.',
  notSetUp: 'Paying with your bank is not available right now. Please pay by bank transfer instead.',
  closed: 'This payment can no longer be started. You can start a new one.',
  busy: 'We are still starting this payment. Please try again in a few seconds.',
  startFailed: 'We could not start your bank payment. Nothing was taken. You can try again, or pay by bank transfer instead.',
  server: 'Something went wrong on our side. Nothing was taken. Please try again.',
  wait: 'Please wait a few seconds before checking again.',
  checkFailed: 'We could not reach the payment service just now. We will keep checking, and we will tell you here and in your bell when your money arrives.',
} as const;

const fail = (status: number, error: string, code: string, extra: Record<string, unknown> = {}): Reply => ({ status, body: { error, code, ...extra } });

class DbFailure extends Error {
  code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.code = code;
  }
}

type Obj = Record<string, unknown>;
const asObj = (v: unknown): Obj | null => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : null);

export function createWalletOnline(deps: WalletOnlineDeps) {
  const log = deps.log ?? ((line: string) => console.error(line));

  // One database call. Throws DbFailure (message = the database's own text, which never holds a secret) so callers can answer 500.
  async function rpc(name: string, args: Record<string, unknown>): Promise<unknown> {
    let reply: DbReply;
    try {
      reply = await deps.db.rpc(name, args);
    } catch (e) {
      throw new DbFailure(`${name}: ${e instanceof Error ? e.message.slice(0, 120) : 'call failed'}`);
    }
    if (reply.error) throw new DbFailure(`${name}: ${reply.error.message.slice(0, 160)}`, reply.error.code);
    return reply.data;
  }

  async function payerFrom(token: string | undefined): Promise<{ id: string } | Reply> {
    if (!token) return fail(401, MSG.signIn, 'sign_in');
    let id: string | null = null;
    try {
      id = await deps.userIdFromToken(token);
    } catch {
      id = null;
    }
    return id ? { id } : fail(401, MSG.expired, 'sign_in_expired');
  }

  function applyArgs(provider: PaymentProvider, source: 'webhook' | 'status_check', eventId: string | null, tx: ProviderTransaction): Record<string, unknown> {
    return {
      p_provider: provider.name,
      p_source: source,
      p_event_id: eventId,
      p_reference: tx.reference,
      p_txn_id: tx.txnId,
      p_status: tx.status,
      p_amount_text: tx.amountText,
      p_currency: tx.currency,
      p_site_ok: tx.siteOk,
      p_is_test: tx.isTest,
      p_allow_test: provider.allowTestPayments,
      p_reason: tx.reason,
    };
  }

  // ---------------------------------------------------------------- POST /api/wallet/topups/:id/start-online -----------------------------------

  async function startOnline(token: string | undefined, topupId: string): Promise<Reply> {
    const payer = await payerFrom(token);
    if ('status' in payer) return payer;
    if (!UUID_SHAPE.test(topupId)) return fail(404, MSG.notFound, 'not_found');
    if (!Object.values(deps.providers).some(Boolean)) return fail(503, MSG.notSetUp, 'not_configured');
    try {
      const claim = asObj(await rpc('wallet_online_claim', { p_topup: topupId, p_payer: payer.id }));
      const action = claim && typeof claim.action === 'string' ? claim.action : '';
      if (action === 'resume' && typeof claim?.redirect_url === 'string') {
        return { status: 200, body: { redirect_url: claim.redirect_url, expires_at: claim.expires_at ?? null, resumed: true } };
      }
      if (action === 'busy') return fail(409, MSG.busy, 'busy', { retry_after_seconds: 3 });
      if (action === 'closed') return fail(409, MSG.closed, 'closed', { status: claim?.status ?? null, why: claim?.why ?? null });
      if (action !== 'create' || !claim) {
        log(`start-online: unexpected claim answer for ${topupId}`);
        return fail(500, MSG.server, 'server_error');
      }
      const provider = deps.providers[String(claim.provider ?? '').toLowerCase()];
      const reference = String(claim.reference ?? '');
      const amountRand = Number(claim.amount_rand);
      const expiresAt = String(claim.expires_at ?? '');
      const idempotencyKey = String(claim.idempotency_key ?? '');
      if (!provider || !reference || !Number.isInteger(amountRand) || amountRand <= 0 || !expiresAt || !idempotencyKey) {
        await closeStart(topupId, provider ? 'The database gave an unexpected claim' : 'The payment provider is not set up');
        return fail(provider ? 500 : 503, provider ? MSG.server : MSG.notSetUp, provider ? 'server_error' : 'not_configured');
      }
      // The one and only create call for this top-up. A second request cannot get here: the claim above is taken under a row lock.
      let made: CreatePaymentOutcome;
      try {
        made = await provider.createPayment({
          topupId,
          reference,
          amountRand,
          expiresAt,
          idempotencyKey,
          returnPath: `/wallet/topup-return?topup=${topupId}`,
        });
      } catch {
        made = { kind: 'unclear', detail: 'unexpected error' };
      }
      if (made.kind !== 'created') {
        log(`start-online: ${made.kind} for top-up ${topupId}: ${made.detail}`);
        await closeStart(topupId, made.kind === 'refused' ? `The provider refused the request (${made.detail})` : `The provider gave no clear answer (${made.detail})`);
        return fail(502, MSG.startFailed, 'start_failed');
      }
      // Save the payment id first, so a second payment can never be made for this top-up. One retry for a passing database hiccup.
      let attached: Obj | null = null;
      for (let i = 0; i < 2 && !attached; i += 1) {
        try {
          attached = asObj(await rpc('wallet_online_attach', { p_topup: topupId, p_payment_id: made.paymentId, p_redirect_url: made.redirectUrl }));
        } catch (e) {
          if (i === 1) throw e;
        }
      }
      if (!attached || attached.attached !== true) return fail(409, MSG.closed, 'closed', { status: attached?.status ?? null });
      return { status: 200, body: { redirect_url: made.redirectUrl, expires_at: attached.expires_at ?? expiresAt, resumed: false } };
    } catch (e) {
      return dbDown('start-online', e, topupId);
    }
  }

  // The provider said no, or said nothing clear: close the top-up so the payer can start again or use the bank transfer. Never throws.
  async function closeStart(topupId: string, reason: string): Promise<void> {
    try {
      await rpc('wallet_online_create_failed', { p_topup: topupId, p_reason: reason.slice(0, 200) });
    } catch (e) {
      log(`start-online: could not close top-up ${topupId}: ${e instanceof Error ? e.message : 'error'}`);
    }
  }

  function dbDown(where: string, e: unknown, topupId?: string): Reply {
    const code = e instanceof DbFailure ? e.code : undefined;
    if (code === 'P0002') return fail(404, MSG.notFound, 'not_found');
    log(`${where}: database call failed${topupId ? ` for top-up ${topupId}` : ''}: ${e instanceof Error ? e.message : 'error'}`);
    return fail(500, MSG.server, 'server_error');
  }

  // ---------------------------------------------------------------- checking a payment with the provider (route, backstop) -----------------------

  type CheckRow = { topup_id: string; reference: string; provider: string; provider_payment_id: string; created_at: string };
  type CheckResult =
    | { kind: 'ok'; transactions: number; outcomes: string[]; status: string | null }
    | { kind: 'provider_failed'; detail: string }
    | { kind: 'db_failed'; error: unknown };

  // Ask the provider about one top-up and give EVERY transaction it lists to the database's decision point (successful ones first, so
  // a credit is never starved by anything else). A failed call is not marked as checked: only a real answer lets an old top-up be closed.
  async function checkOne(row: CheckRow): Promise<CheckResult> {
    const provider = deps.providers[String(row.provider).toLowerCase()];
    if (!provider) return { kind: 'provider_failed', detail: 'the provider is not set up' };
    const answer = await provider.checkPayment({ paymentId: row.provider_payment_id, reference: row.reference, createdAt: row.created_at });
    if (answer.kind === 'failed') return { kind: 'provider_failed', detail: answer.detail };
    const ordered = [...answer.transactions].sort((a, b) => Number(isSuccessful(b)) - Number(isSuccessful(a)));
    const outcomes: string[] = [];
    let status: string | null = null;
    try {
      for (const tx of ordered) {
        if (tx.reference.trim().toUpperCase() !== row.reference.trim().toUpperCase()) {
          // The provider listed, under this payment, a transaction that carries another reference: never act on it, tell a person.
          await rpc('wallet_online_record_event', {
            p_provider: provider.name,
            p_source: 'status_check',
            p_event_id: null,
            p_outcome: 'needs_review',
            p_detail: `A status check for ${cleanBit(row.reference, 20)} listed a transaction with another reference`,
          });
          outcomes.push('needs_review');
          continue;
        }
        const res = asObj(await rpc('wallet_online_apply', applyArgs(provider, 'status_check', null, tx)));
        outcomes.push(typeof res?.outcome === 'string' ? res.outcome : 'unknown');
        if (typeof res?.status === 'string') status = res.status;
      }
      await rpc('wallet_online_mark_checked', { p_topup: row.topup_id });
    } catch (error) {
      return { kind: 'db_failed', error };
    }
    return { kind: 'ok', transactions: answer.transactions.length, outcomes, status };
  }
  const isSuccessful = (tx: ProviderTransaction) => tx.status.trim().toLowerCase() === 'successful';

  // ---------------------------------------------------------------- POST /api/wallet/topups/:id/check -------------------------------------------

  async function check(token: string | undefined, topupId: string): Promise<Reply> {
    const payer = await payerFrom(token);
    if ('status' in payer) return payer;
    if (!UUID_SHAPE.test(topupId)) return fail(404, MSG.notFound, 'not_found');
    try {
      // The database enforces "owner only" and "at most once per 15 seconds per top-up" (it stamps the time before we call the provider).
      const req = asObj(await rpc('wallet_online_check_request', { p_topup: topupId, p_payer: payer.id }));
      const action = req && typeof req.action === 'string' ? req.action : '';
      if (action === 'closed') return { status: 200, body: { result: 'closed', status: req?.status ?? null } };
      if (action === 'nothing_to_check') return { status: 200, body: { result: 'nothing_to_check', status: 'awaiting_payment' } };
      if (action === 'wait') {
        const secs = Math.max(1, Math.min(Number(req?.retry_after_seconds) || 15, 15));
        return { status: 429, headers: { 'Retry-After': String(secs) }, body: { error: MSG.wait, code: 'wait', retry_after_seconds: secs } };
      }
      if (action !== 'check' || !req) {
        log(`check: unexpected answer for top-up ${topupId}`);
        return fail(500, MSG.server, 'server_error');
      }
      if (!deps.providers[String(req.provider ?? '').toLowerCase()]) return fail(503, MSG.notSetUp, 'not_configured');
      const result = await checkOne({
        topup_id: topupId,
        reference: String(req.reference ?? ''),
        provider: String(req.provider ?? ''),
        provider_payment_id: String(req.provider_payment_id ?? ''),
        created_at: String(req.created_at ?? ''),
      });
      if (result.kind === 'provider_failed') {
        log(`check: the provider could not be asked for top-up ${topupId}: ${result.detail}`);
        return fail(502, MSG.checkFailed, 'check_failed');
      }
      if (result.kind === 'db_failed') return dbDown('check', result.error, topupId);
      return { status: 200, body: { result: 'checked', status: result.status ?? 'awaiting_payment', transactions: result.transactions } };
    } catch (e) {
      return dbDown('check', e, topupId);
    }
  }

  // ---------------------------------------------------------------- POST /api/wallet/webhook/<provider> --------------------------------------------

  // A safety-check failure or an unusable message: record it (the database caps these and alerts finance at most once an hour), log one line.
  // The unverified message id is NEVER used as the event id (a stranger could use up a real id), only quoted, cleaned, in the note.
  async function recordProblem(provider: PaymentProvider, outcome: 'rejected' | 'needs_review' | 'ignored', eventId: string | null, detail: string): Promise<void> {
    await rpc('wallet_online_record_event', { p_provider: provider.name, p_source: 'webhook', p_event_id: eventId, p_outcome: outcome, p_detail: detail.slice(0, 380) });
  }

  async function webhook(headers: Record<string, string | string[] | undefined>, raw: Buffer | null, tooBig: boolean): Promise<Reply> {
    const provider = deps.providers[WEBHOOK_PROVIDER];
    if (!provider) {
      log('webhook: refused with 503 because the provider is not set up');
      return { status: 503, body: { error: 'Not set up.' } };
    }
    const bytes = raw ? raw.length : 0;
    if (tooBig || !raw) {
      log(`webhook: rejected (too_large) bytes>${MAX_WEBHOOK_BYTES}`);
      try {
        await recordProblem(provider, 'rejected', null, `Refused: the message was larger than ${MAX_WEBHOOK_BYTES} bytes`);
      } catch (e) {
        log(`webhook: could not record the refusal: ${e instanceof Error ? e.message : 'error'}`);
      }
      return { status: tooBig ? 413 : 400, body: { error: 'Not accepted.' } };
    }
    const seen = provider.verifyWebhook(headers, raw);
    if (seen.kind === 'rejected') {
      log(`webhook: rejected (${seen.reason}) id=${seen.messageIdHint || 'none'} bytes=${bytes}`);
      try {
        await recordProblem(provider, 'rejected', null, `Failed the safety check (${seen.reason}); message ${seen.messageIdHint || 'without an id'}`);
      } catch (e) {
        log(`webhook: could not record the refusal: ${e instanceof Error ? e.message : 'error'}`);
      }
      return { status: 400, body: { error: 'Not accepted.' } };
    }
    const { eventId, event } = seen;
    try {
      if (event.kind === 'transaction') {
        const res = asObj(await rpc('wallet_online_apply', applyArgs(provider, 'webhook', eventId, event.tx)));
        const outcome = typeof res?.outcome === 'string' ? res.outcome : 'unknown';
        log(`webhook: ${outcome} id=${cleanBit(eventId, 40)} bytes=${bytes}`);
        return { status: 200 };
      }
      if (event.kind === 'other') {
        await recordProblem(provider, 'ignored', eventId, `Ignored an event of another type (${cleanBit(event.type, 40) || 'none'})`);
        log(`webhook: ignored (other_type) id=${cleanBit(eventId, 40)} bytes=${bytes}`);
        return { status: 200 };
      }
      const why = event.kind === 'thin' ? 'The message has too little in it: the webhook subscription must be set to full' : 'The message was signed but could not be read';
      await recordProblem(provider, 'needs_review', eventId, why);
      log(`webhook: needs_review (${event.kind}) id=${cleanBit(eventId, 40)} bytes=${bytes}`);
      return { status: 200 };
    } catch (e) {
      // The database could not be written: 500, so the provider sends the same message again. Nothing was credited.
      log(`webhook: database failure id=${cleanBit(eventId, 40)} bytes=${bytes}: ${e instanceof Error ? e.message : 'error'}`);
      return { status: 500, body: { error: 'Try again.' } };
    }
  }

  // ---------------------------------------------------------------- POST /api/internal/wallet/online-check (the backstop) ----------------------

  async function backstop(secretHeader: string | string[] | undefined): Promise<Reply> {
    if (!deps.jobSecret) return fail(503, 'Online payments are not set up on this server yet.', 'not_configured');
    if (!secretMatches(secretHeader, deps.jobSecret)) return fail(401, 'Not allowed.', 'not_allowed');
    if (!Object.values(deps.providers).some(Boolean)) return fail(503, 'Online payments are not set up on this server yet.', 'not_configured');
    let rows: CheckRow[];
    try {
      const data = await rpc('wallet_online_due_checks', { p_limit: 20 });
      rows = (Array.isArray(data) ? data : []).filter((r): r is CheckRow => asObj(r) !== null && typeof (r as Obj).topup_id === 'string');
    } catch (e) {
      return dbDown('online-check', e);
    }
    const summary = { due: rows.length, checked: 0, provider_failed: 0, db_failed: 0, outcomes: {} as Record<string, number> };
    const width = Math.max(1, Math.min(deps.concurrency ?? 5, 10));
    let next = 0;
    const worker = async () => {
      while (next < rows.length) {
        const row = rows[next];
        next += 1;
        let result: CheckResult;
        try {
          result = await checkOne(row);
        } catch (e) {
          result = { kind: 'provider_failed', detail: e instanceof Error ? e.message.slice(0, 80) : 'error' };
        }
        if (result.kind === 'ok') {
          summary.checked += 1;
          for (const o of result.outcomes) summary.outcomes[o] = (summary.outcomes[o] ?? 0) + 1;
        } else if (result.kind === 'provider_failed') {
          summary.provider_failed += 1;
          log(`online-check: the provider could not be asked for top-up ${row.topup_id}: ${result.detail}`);
        } else {
          summary.db_failed += 1;
          log(`online-check: database failure for top-up ${row.topup_id}: ${result.error instanceof Error ? result.error.message : 'error'}`);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(width, Math.max(rows.length, 1)) }, worker));
    return { status: 200, body: summary };
  }

  return { startOnline, check, webhook, backstop };
}

export type WalletOnline = ReturnType<typeof createWalletOnline>;

// ---------------------------------------------------------------- Express glue (thin; the tests also run it for real) ------------------------------

export function sendReply(res: Response, reply: Reply): void {
  for (const [k, v] of Object.entries(reply.headers ?? {})) res.setHeader(k, v);
  if (reply.body === undefined) res.status(reply.status).end();
  else res.status(reply.status).json(reply.body);
}

// Every byte of the body, whatever the content type, up to `max` (the rest is read and thrown away so the connection ends cleanly).
export function readRawBody(req: Request, max: number): Promise<{ raw: Buffer; tooBig: boolean }> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size <= max) chunks.push(chunk);
    });
    req.on('error', reject);
    req.on('end', () => resolve({ raw: Buffer.concat(chunks), tooBig: size > max }));
  });
}

export interface MountOptions {
  rateLimit: (maxRequests: number, windowMs: number) => RequestHandler;
  // Returns a message while the server as a whole is not configured (the Paystack/Supabase check), else null.
  unavailable?: () => string | null;
}

const bearer = (req: Request): string | undefined => {
  const h = req.headers.authorization;
  return typeof h === 'string' ? h.replace(/^Bearer\s+/i, '') || undefined : undefined;
};

// MUST be mounted BEFORE the generic JSON reader in server/index.ts: the provider signs the exact bytes, and that reader refuses a
// non-JSON body (400) or a large one (413) before any route sees it, and parses what it keeps.
export function mountOnlineWebhook(app: Application, wo: WalletOnline, opts: MountOptions): void {
  app.post(`/api/wallet/webhook/${WEBHOOK_PROVIDER}`, opts.rateLimit(120, 60_000), async (req: Request, res: Response) => {
    const down = opts.unavailable?.();
    if (down) {
      res.status(503).json({ error: 'Not set up.' });
      return;
    }
    try {
      const { raw, tooBig } = await readRawBody(req, MAX_WEBHOOK_BYTES);
      sendReply(res, await wo.webhook(req.headers, raw, tooBig));
    } catch (e) {
      console.error('webhook: the request could not be read:', e instanceof Error ? e.message : 'error');
      if (!res.headersSent) res.status(500).json({ error: 'Try again.' });
    }
  });
}

export function mountOnlineRoutes(app: Application, wo: WalletOnline, opts: MountOptions): void {
  app.post('/api/wallet/topups/:id/start-online', opts.rateLimit(10, 60_000), async (req: Request, res: Response) => {
    sendReply(res, await wo.startOnline(bearer(req), String(req.params.id)));
  });
  app.post('/api/wallet/topups/:id/check', opts.rateLimit(30, 60_000), async (req: Request, res: Response) => {
    sendReply(res, await wo.check(bearer(req), String(req.params.id)));
  });
  app.post('/api/internal/wallet/online-check', opts.rateLimit(6, 60_000), async (req: Request, res: Response) => {
    sendReply(res, await wo.backstop(req.headers['x-job-secret']));
  });
}
