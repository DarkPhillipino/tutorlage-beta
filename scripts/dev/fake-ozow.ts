// Pretend Ozow and pretend database for the Worker's online-top-up tests (scripts/dev/ozow-test.ts and wallet-online-worker-test.ts).
// Nothing here touches the network or a real key: every "secret" is built from plain pieces at run time (never one literal that looks like a
// key), and FakeOzow answers the three calls the Worker makes from memory. FakeWalletDb mirrors the database functions of
// supabase/migrations/20261109110000_wallet_online_topups.sql (claim, attach, create_failed, apply, record_event, check_request,
// mark_checked, due_checks) closely enough to test the Worker's behaviour end to end; the SQL suite stays the authority on the rules themselves,
// and wallet-online-worker-test.ts checks that the argument names the Worker sends match that migration.
import crypto from 'node:crypto';
import type { DbReply } from '../../server/walletOnline';
import type { OzowFetch } from '../../server/ozow';

// ---- fake credentials, assembled from pieces --------------------------------------------------------------------------------------------------
export const join = (...parts: string[]) => parts.join('');
export const FAKE = {
  clientId: join('FAKE', '-client', '-id-', '0001'),
  clientSecret: join('FAKE', '-client', '-secret-', 'do-not-use', '-0002'),
  siteCode: join('SITE', 'CODE', '-FAKE', '-3'),
  signingBytes: join('fake signing ', 'bytes for ', 'tests only'),
  jobSecret: join('FAKE', '-job', '-secret-', 'long-random-', '0004'),
  userToken: join('FAKE', '.user', '.token', '.0005'),
  otherUserToken: join('FAKE', '.other', '.token', '.0006'),
};
export const webhookSecret = () => join('whsec', '_', Buffer.from(FAKE.signingBytes).toString('base64'));
export const secretsToHide = () => [FAKE.clientId, FAKE.clientSecret, FAKE.siteCode, webhookSecret(), Buffer.from(FAKE.signingBytes).toString('base64'), FAKE.jobSecret];

export class FakeClock {
  constructor(public ms = Date.UTC(2026, 10, 9, 12, 0, 0)) {}
  now = () => this.ms;
  advance(seconds: number) {
    this.ms += seconds * 1000;
  }
}

// ---- Ozow ---------------------------------------------------------------------------------------------------------------------------------------
export interface FakeTxn {
  id: string;
  merchantReference: string;
  siteCode: string;
  status: string;
  amount: unknown;
  institution?: string;
  createdDate?: string;
  reason?: string;
}
interface FakePayment {
  id: string;
  body: Record<string, any>;
  idemKey: string;
  transactions: FakeTxn[];
}
export interface OzowCall {
  method: string;
  path: string;
  query: Record<string, string>;
  headers: Record<string, string>;
  body: string;
}

export class FakeOzow {
  calls: OzowCall[] = [];
  tokenCalls = 0;
  validToken: string | null = null;
  tokenLifetime: string = '14400';
  failList = new Set<string>(); // payment ids whose transaction list answers 500
  payments = new Map<string, FakePayment>();
  private idem = new Map<string, { bodyJson: string; paymentId: string }>();
  mode: { token: 'ok' | '401' | '500'; create: 'ok' | '400' | '403' | '409' | '500' | 'hang' | 'garbled' | 'badlink' | 'nolink'; list: 'ok' | '500' | 'hang' | 'noresults' } = {
    token: 'ok',
    create: 'ok',
    list: 'ok',
  };
  constructor(private clock: FakeClock = new FakeClock()) {}

  expireToken() {
    this.validToken = null;
  }
  count(method: string, pathStart: string) {
    return this.calls.filter((c) => c.method === method && c.path.startsWith(pathStart)).length;
  }
  addTransaction(paymentId: string, t: Partial<FakeTxn> & { status: string }) {
    const p = this.payments.get(paymentId);
    if (!p) throw new Error('no such payment');
    p.transactions.push({
      id: crypto.randomUUID(),
      merchantReference: p.body.merchantReference,
      siteCode: FAKE.siteCode,
      amount: { value: p.body.amount.value, currency: 'ZAR' },
      createdDate: new Date(this.clock.now()).toISOString(),
      ...t,
    });
  }
  paymentFor(reference: string): FakePayment | undefined {
    return [...this.payments.values()].find((p) => p.body.merchantReference === reference);
  }

  // The bait: Ozow's real error text can echo what we sent, so ours does too; the Worker must never copy it anywhere.
  private echoError(status: number, code: string) {
    return { status, body: { id: crypto.randomUUID(), code, title: code, detail: `Consumer could not be found for client id ${FAKE.clientId} (site ${FAKE.siteCode})`, links: null, source: null, meta: null } };
  }

  fetch: OzowFetch = async (url, init) => {
    const u = new URL(url);
    const path = u.pathname.replace(/^\/v1/, '');
    this.calls.push({ method: init.method, path: path + (u.search ? '' : ''), query: Object.fromEntries(u.searchParams), headers: { ...init.headers }, body: init.body ?? '' });
    const reply = (status: number, body: unknown) => ({ status, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });
    const hang = () => new Promise<never>((_, reject) => init.signal?.addEventListener('abort', () => reject(new Error('aborted'))));

    if (init.method === 'POST' && path === '/token') {
      const f = new URLSearchParams(init.body ?? '');
      if (this.mode.token === '500') return reply(500, { code: 'InternalServerError' });
      if (this.mode.token === '401' || f.get('client_id') !== FAKE.clientId || f.get('client_secret') !== FAKE.clientSecret || f.get('scope') !== 'payments' || f.get('grant_type') !== 'client_credentials') {
        const e = this.echoError(401, 'Unauthorized');
        return reply(e.status, e.body);
      }
      this.tokenCalls += 1;
      this.validToken = join('FAKE-ACCESS-', 'TOKEN-', String(this.tokenCalls));
      return reply(200, { access_token: this.validToken, token_type: 'Bearer', expires_in: this.tokenLifetime, scope: 'payments' });
    }
    if (init.headers.Authorization !== `Bearer ${this.validToken}` || !this.validToken) {
      const e = this.echoError(401, 'Unauthorized');
      return reply(e.status, e.body);
    }
    if (init.method === 'POST' && path === '/payments') {
      const body = JSON.parse(init.body ?? '{}');
      const key = init.headers['Idempotency-Key'] ?? '';
      const bodyJson = JSON.stringify(body);
      const seen = this.idem.get(key);
      if (key && seen && seen.bodyJson !== bodyJson) return reply(409, { code: 'Conflict', title: 'Conflict', detail: 'Idempotency key and request data do not match a previous request.' });
      if (this.mode.create === '400' || this.mode.create === '403' || this.mode.create === '409') {
        const e = this.echoError(Number(this.mode.create), this.mode.create === '400' ? 'BadRequest' : this.mode.create === '403' ? 'Forbidden' : 'Conflict');
        return reply(e.status, e.body);
      }
      let p: FakePayment | undefined = seen ? this.payments.get(seen.paymentId) : undefined;
      if (!p) {
        p = { id: crypto.randomUUID(), body, idemKey: key, transactions: [] };
        this.payments.set(p.id, p);
        if (key) this.idem.set(key, { bodyJson, paymentId: p.id });
      }
      if (this.mode.create === 'hang') return hang(); // the payment now exists at Ozow, but the answer never comes
      if (this.mode.create === '500') return reply(500, { code: 'InternalServerError' });
      if (this.mode.create === 'garbled') return reply(201, 'not json at all');
      if (this.mode.create === 'nolink') return reply(201, { id: p.id, status: 'Created', links: {} });
      if (this.mode.create === 'badlink') return reply(201, { id: p.id, status: 'Created', redirectUrl: 'https://evil.example.com/pay', links: {} });
      return reply(201, { id: p.id, status: 'Created', redirectUrl: `https://pay.ozow.com/${p.id}/secure`, links: {} });
    }
    const m = /^\/payments\/([^/]+)\/transactions$/.exec(path);
    if (init.method === 'GET' && m) {
      if (!u.searchParams.get('fromDate') || !u.searchParams.get('toDate')) return reply(400, { code: 'BadRequest', detail: 'fromDate and toDate are required' });
      if (this.mode.list === 'hang') return hang();
      if (this.mode.list === '500' || this.failList.has(m[1])) return reply(500, { code: 'InternalServerError' });
      if (this.mode.list === 'noresults') return reply(200, { links: {}, meta: {} });
      return reply(200, { links: {}, results: this.payments.get(m[1])?.transactions ?? [], meta: {} });
    }
    return reply(404, { code: 'NotFound' });
  };
}

// ---- the database ---------------------------------------------------------------------------------------------------------------------------------
type Row = Record<string, any>;
export class FakeWalletDb {
  topups = new Map<string, Row>();
  attempts = new Map<string, Row>();
  events: Row[] = [];
  ledger: { key: string; amount: number }[] = [];
  notifications: { profile: string; type: string }[] = [];
  finance: string[] = [];
  calls: { name: string; args: Record<string, unknown> }[] = [];
  users = new Map<string, string>();
  mode: 'off' | 'staff' | 'on' = 'on';
  provider = 'ozow'; // the database setting wallet_online_provider ('ozow' = One API, 'ozow_payments' = the Payments API)
  private failures: { name: string | null; remaining: number; how: 'error' | 'throw' }[] = [];
  private seq = 0;
  private lastRejectedAlert = -Infinity;
  constructor(private clock: FakeClock) {}

  iso = (ms = this.clock.now()) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
  failNext(name: string | null, times = 1, how: 'error' | 'throw' = 'error') {
    this.failures.push({ name, remaining: times, how });
  }
  clearFailures() {
    this.failures = [];
  }
  addUser(token: string, profile: string) {
    this.users.set(token, profile);
  }
  addTopup(profile: string, amount = 50, over: Row = {}): Row {
    this.seq += 1;
    const id = crypto.randomUUID();
    const t = { id, profile_id: profile, method: 'online', status: 'awaiting_payment', reference: `TL-${String(this.seq).padStart(6, 'A')}`, amount_rand: amount, created_at: this.iso(), ...over };
    this.topups.set(id, t);
    return t;
  }
  credits(topupId: string) {
    return this.ledger.filter((l) => l.key === `topup:${topupId}`).length;
  }
  private left = (s: unknown, n: number) => (s == null ? null : String(s).slice(0, n));

  private log(prov: string, source: string, eventId: unknown, topup: string | null, ref: unknown, txn: unknown, status: unknown, amount: unknown, currency: unknown, outcome: string, detail: string, dedupe = true) {
    const row = { provider: prov, event_id: this.left(eventId, 200), source, topup_id: topup, reference: this.left(ref, 20), provider_txn_id: this.left(txn, 100), provider_status: this.left(status, 40), amount_text: this.left(amount, 20), currency: this.left(currency, 10), outcome, detail: detail.slice(0, 400) };
    if (dedupe && outcome !== 'credited' && this.events.some((e) => e.provider === row.provider && e.topup_id === row.topup_id && e.reference === row.reference && e.provider_txn_id === row.provider_txn_id && String(e.provider_status ?? '').toLowerCase() === String(row.provider_status ?? '').toLowerCase() && e.outcome === outcome && e.detail === row.detail)) return false;
    if (row.event_id && this.events.some((e) => e.provider === prov && e.event_id === row.event_id)) return false;
    this.events.push(row);
    return true;
  }
  private credit(t: Row, comment: string) {
    if (t.status === 'successful') return { already: true };
    if (!this.ledger.some((l) => l.key === `topup:${t.id}`)) this.ledger.push({ key: `topup:${t.id}`, amount: t.amount_rand });
    t.status = 'successful';
    t.decision_comment = comment;
    this.notifications.push({ profile: t.profile_id, type: 'wallet_topup_successful' });
    return { already: false };
  }

  rpc = async (name: string, args: Record<string, unknown>): Promise<DbReply> => {
    this.calls.push({ name, args });
    const f = this.failures.find((x) => (x.name === null || x.name === name) && x.remaining > 0);
    if (f) {
      f.remaining -= 1;
      if (f.how === 'throw') throw new Error('network down');
      return { data: null, error: { message: 'connection to the database failed', code: '08006' } };
    }
    try {
      return { data: this.run(name, args), error: null };
    } catch (e: any) {
      return { data: null, error: { message: String(e?.message ?? e), code: e?.code } };
    }
  };

  private run(name: string, a: Row): unknown {
    const nowMs = this.clock.now();
    const raise = (message: string, code: string) => {
      throw Object.assign(new Error(message), { code });
    };
    switch (name) {
      case 'wallet_online_claim': {
        const t = this.topups.get(a.p_topup);
        if (!t || t.profile_id !== a.p_payer || t.method !== 'online') raise('No such top-up', 'P0002');
        if (t.status !== 'awaiting_payment') return { action: 'closed', status: t.status };
        const at = this.attempts.get(t.id);
        if (at) {
          if (at.provider_payment_id) {
            if (at.redirect_url && Date.parse(at.expires_at) > nowMs) return { action: 'resume', redirect_url: at.redirect_url, expires_at: at.expires_at };
            return { action: 'closed', status: t.status, why: 'expired' };
          }
          if (Date.parse(at.claimed_at) > nowMs - 120_000) return { action: 'busy' };
          t.status = 'unsuccessful';
          return { action: 'closed', status: 'unsuccessful' };
        }
        if (this.mode === 'off') return { action: 'closed', status: t.status, why: 'off' };
        const expires = this.iso(nowMs + 60 * 60_000);
        this.attempts.set(t.id, { topup_id: t.id, provider: this.provider, provider_payment_id: null, redirect_url: null, provider_txn_id: null, claimed_at: this.iso(), expires_at: expires, checked_at: null, check_requested_at: null });
        return { action: 'create', provider: this.provider, reference: t.reference, amount_rand: t.amount_rand, expires_at: expires, idempotency_key: `topup-${t.id}` };
      }
      case 'wallet_online_attach': {
        const t = this.topups.get(a.p_topup);
        if (!t) raise('No such top-up', 'P0002');
        const at = this.attempts.get(t!.id);
        if (!at) raise('No payment was started for this top-up', '55000');
        if (!/^https:\/\/\S+$/.test(String(a.p_redirect_url ?? ''))) raise('The payment link must be a web address starting with https://', '22023');
        if (at!.provider_payment_id) {
          if (at!.provider_payment_id === a.p_payment_id) return { attached: true, again: true, expires_at: at!.expires_at };
          raise('A different payment is already saved for this top-up', '23505');
        }
        at!.provider_payment_id = a.p_payment_id;
        at!.redirect_url = a.p_redirect_url;
        if (t!.status !== 'awaiting_payment') return { attached: false, status: t!.status };
        return { attached: true, again: false, expires_at: at!.expires_at };
      }
      case 'wallet_online_create_failed': {
        const t = this.topups.get(a.p_topup);
        if (!t) raise('No such top-up', 'P0002');
        const at = this.attempts.get(t!.id);
        if (t!.status !== 'awaiting_payment' || at?.provider_payment_id) return { closed: false, status: t!.status };
        t!.status = 'unsuccessful';
        this.log(at?.provider ?? 'unknown', 'system', null, t!.id, t!.reference, null, null, null, null, 'attempt_failed', `Could not start: ${a.p_reason}`, false);
        this.notifications.push({ profile: t!.profile_id, type: 'wallet_topup_cancelled' });
        return { closed: true, status: 'unsuccessful' };
      }
      case 'wallet_online_apply':
        return this.apply(a);
      case 'wallet_online_record_event': {
        if (!['rejected', 'needs_review', 'ignored'].includes(a.p_outcome)) raise('That outcome cannot be recorded here', '22023');
        if (a.p_outcome === 'rejected' && this.events.filter((e) => e.outcome === 'rejected').length >= 20) return { recorded: false, why: 'capped' };
        const wrote = this.log(String(a.p_provider).toLowerCase(), a.p_source, a.p_event_id, null, null, null, null, null, null, a.p_outcome, String(a.p_detail ?? ''), false);
        // rejected: at most one alert an hour (as the SQL does); needs_review: one alert per recorded event
        if (wrote && a.p_outcome === 'rejected' && this.lastRejectedAlert < nowMs - 3600_000) {
          this.lastRejectedAlert = nowMs;
          this.finance.push(`rejected: ${a.p_detail}`);
        } else if (wrote && a.p_outcome === 'needs_review') this.finance.push(`needs_review: ${a.p_detail}`);
        return { recorded: wrote };
      }
      case 'wallet_online_check_request': {
        const t = this.topups.get(a.p_topup);
        if (!t || t.profile_id !== a.p_payer || t.method !== 'online') raise('No such top-up', 'P0002');
        if (t!.status !== 'awaiting_payment') return { action: 'closed', status: t!.status };
        const at = this.attempts.get(t!.id);
        if (!at || !at.provider_payment_id) return { action: 'nothing_to_check' };
        if (at.check_requested_at && Date.parse(at.check_requested_at) > nowMs - 15_000) return { action: 'wait', retry_after_seconds: Math.max(1, Math.ceil(15 - (nowMs - Date.parse(at.check_requested_at)) / 1000)) };
        at.check_requested_at = this.iso();
        return { action: 'check', topup_id: t!.id, reference: t!.reference, amount_rand: t!.amount_rand, provider: at.provider, provider_payment_id: at.provider_payment_id, created_at: t!.created_at, expires_at: at.expires_at };
      }
      case 'wallet_online_mark_checked': {
        const at = this.attempts.get(a.p_topup);
        if (at) at.checked_at = this.iso();
        return null;
      }
      case 'wallet_online_due_checks': {
        const out: Row[] = [];
        for (const t of this.topups.values()) {
          const at = this.attempts.get(t.id);
          if (!at || t.method !== 'online' || t.status !== 'awaiting_payment' || !at.provider_payment_id) continue;
          if (Date.parse(t.created_at) >= nowMs - 10 * 60_000) continue;
          if (at.checked_at && Date.parse(at.checked_at) >= nowMs - 10 * 60_000) continue;
          out.push({ topup_id: t.id, reference: t.reference, provider: at.provider, provider_payment_id: at.provider_payment_id, amount_rand: t.amount_rand, created_at: t.created_at, expires_at: at.expires_at });
        }
        return out.slice(0, Math.min(Math.max(Number(a.p_limit ?? 20), 1), 100));
      }
      default:
        raise(`function ${name} does not exist`, '42883');
    }
  }

  // Mirrors wallet_online_apply (the one decision point). Branch for branch, in the same order.
  private apply(a: Row) {
    const prov = String(a.p_provider ?? '').trim().toLowerCase();
    const ref = String(a.p_reference ?? '').trim().toUpperCase();
    const txn = String(a.p_txn_id ?? '').trim() || null;
    const st = String(a.p_status ?? '').trim().toLowerCase();
    if (!prov) throw Object.assign(new Error('Say which provider'), { code: '22023' });
    if (!['webhook', 'status_check'].includes(a.p_source)) throw Object.assign(new Error('Unknown source'), { code: '22023' });
    if (a.p_event_id != null && this.events.some((e) => e.provider === prov && e.event_id === String(a.p_event_id).slice(0, 200))) return { outcome: 'duplicate', same_event: true };
    const t = [...this.topups.values()].find((x) => x.reference === ref && x.method === 'online' && this.attempts.get(x.id)?.provider === prov);
    let outcome = '';
    let detail: string | null = null;
    if (!t) {
      outcome = 'needs_review';
      detail = 'No online top-up has this reference';
    } else {
      const at = this.attempts.get(t.id)!;
      if (t.status === 'awaiting_payment') {
        at.last_status = String(a.p_status ?? '').trim().slice(0, 40);
        at.last_reason = String(a.p_reason ?? '').trim().slice(0, 200);
      }
      const amountText = String(a.p_amount_text ?? '').trim();
      if (st === 'successful') {
        if (a.p_site_ok !== true) detail = 'The site code does not match ours';
        else if (String(a.p_currency ?? '').trim().toUpperCase() !== 'ZAR') detail = `The currency is not ZAR (${String(a.p_currency ?? '').trim().slice(0, 10) || 'none'})`;
        else if (!/^[0-9]{1,9}\.[0-9]{2}$/.test(amountText)) detail = 'The amount is not in the expected form';
        else if (Number(amountText) !== t.amount_rand) detail = `Paid R${amountText} but the top-up is R${t.amount_rand}`;
        else if (['true', '1', 'yes'].includes(String(a.p_is_test ?? '').trim().toLowerCase()) && !a.p_allow_test) detail = 'A test payment arrived on the live site';
        else if (!txn) detail = 'There is no transaction id';
        else if ([...this.attempts.values()].some((x) => x.provider === prov && x.provider_txn_id === txn && x.topup_id !== t.id)) detail = 'This transaction is already on another top-up';
        if (detail) outcome = 'needs_review';
        else if (t.status === 'awaiting_payment') {
          at.provider_txn_id = txn;
          const r = this.credit(t, `Paid online (${prov}), transaction ${txn}`);
          outcome = r.already ? 'already' : 'credited';
          detail = `R${t.amount_rand} added to the wallet`;
        } else if (t.status === 'successful') {
          if (at.provider_txn_id === txn) {
            outcome = 'already';
            detail = 'Already credited';
          } else {
            outcome = 'needs_review';
            detail = 'Paid twice: a second successful transaction for a top-up that was already credited. A refund is needed.';
          }
        } else {
          outcome = 'needs_review';
          detail = `Late payment: the top-up was already ${t.status}. Add it by hand if the money arrived.`;
        }
      } else if (!['pending', 'incomplete', 'error', 'voided', 'cancelled', 'abandoned', 'expired'].includes(st)) {
        outcome = 'needs_review';
        detail = `The provider sent a status we do not know: ${st.slice(0, 40) || 'none'}`;
      } else if (t.status !== 'awaiting_payment') {
        outcome = 'ignored';
        detail = `The top-up is already ${t.status}; the provider says ${st}`;
      } else if (st === 'pending' || st === 'incomplete') {
        outcome = 'ignored';
        detail = `Not finished yet (${st})`;
      } else if (st === 'error') {
        outcome = 'attempt_failed';
        detail = `This attempt did not go through${String(a.p_reason ?? '').trim() ? `: ${String(a.p_reason).trim().slice(0, 150)}` : ''}`;
      } else {
        outcome = 'ignored';
        detail = `Ended without a payment (${st})`;
      }
    }
    const wrote = this.log(prov, a.p_source, a.p_event_id, t?.id ?? null, t?.reference ?? ref, txn, a.p_status, a.p_amount_text, a.p_currency, outcome, detail ?? '');
    if (outcome === 'needs_review' && wrote) this.finance.push(`needs_review: ${detail}`);
    return { outcome, topup_id: t?.id ?? null, status: t ? this.topups.get(t.id)!.status : null, reference: t?.reference ?? ref, detail };
  }
}
