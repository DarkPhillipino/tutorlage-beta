// PAY BY BANK, INSTANT: the site half (Ozow phase 3 of 3; design Drake/programmer/reports/2026-11-09-ozow-design.md part 1.4; approved 9 Nov 2026).
// A parent or learner can add money to the wallet the usual way (bank transfer, proof, a person checks it) OR pay in their own bank's page and have the money
// arrive in minutes. This file holds the words, the checks and the questions for the second way. It NAMES NO PROCESSOR: the Worker and the top-up row's
// provider decide who is called (so a second processor changes nothing here).
//
// What the browser does, and what it never does:
//  - asks "is the online choice open for me?" (database function wallet_online_available(); false until the answer arrives, and for any doubt: a database
//    or Worker that does not have the feature yet, an error, an odd answer all mean "no", and the screen is exactly the old manual one, with no error);
//  - makes the top-up row (create_online_topup(amount): the database checks the amount and limits; the browser sends the amount ONCE, here, and never to the Worker);
//  - asks the Worker to start the payment (POST /api/wallet/topups/:id/start-online: no body, the payer comes from the token) and goes to the address it returns;
//  - on the return page reads the payer's OWN row every 3 seconds for up to 60 seconds, and offers "Check now" (POST /api/wallet/topups/:id/check).
//  - it NEVER credits anything: no function here writes to the wallet, the ledger or a top-up. Money arrives only when the Worker (the provider's message, or
//    its own status check) tells the database; this page just reads the result. scripts/dev/wallet-online-test.ts fails if a write or a credit call appears.
// Everything takes the database client or a `request` function as an argument so a test can hand in a fake (wallet-online-test.ts); walletOnlineHooks.ts binds
// them to the app's client and to the Worker. No Supabase, auth or `import.meta` in this file (it runs under Node in the script test).
import { WALLET_COPY, rand0, type Topup, type TopupStatus, type WalletClient } from './wallet';

// ---- the words -------------------------------------------------------------------------------------------------------------------------------
// The two names of the choice are the PM's wording of 9 Nov 2026 (the design's own were "Pay now with your bank" and "Pay by bank transfer and send proof").
export const ONLINE_COPY = {
  chooseHeading: 'How would you like to pay?',
  onlineTitle: 'Pay by bank, instant',
  onlineBody: 'You pay on your own bank\'s page, then come straight back here. Your money usually arrives within minutes.',
  manualTitle: 'Bank transfer, checked by a person',
  manualBody: 'You pay from your banking app and send us the proof. A person checks it before the money is added.',
  opening: 'Opening your bank…',
  openingHelp: 'Please wait. Do not close this page.',
  tryAgain: 'Try again',
  useTransfer: 'Pay by bank transfer instead',
  // The start failed before anything was paid.
  couldNotOpen: 'We could not open your bank\'s payment page. Nothing was taken from you. You can try again, or pay by bank transfer instead.',
  busy: 'Your payment is being set up. Please wait a few seconds and try again.',
  notAvailable: 'Paying with your bank is not available right now. Please pay by bank transfer instead.',
  checkFailed: 'We could not check just now. We will keep checking, and we will tell you here and in your bell when your money arrives.',
  closed: 'This payment can no longer be started. Nothing was taken from you. Start a new top-up, or pay by bank transfer instead.',
  signInAgain: 'Sign in again to continue.',
  // The wallet page's lines for an online top-up (never a raw status code).
  waitingForBank: WALLET_COPY.onlineWaiting,
  continueToBank: 'Continue to your bank',
  checkNow: 'Check now',
  paidOnline: WALLET_COPY.onlinePaid,
  notCompleted: WALLET_COPY.onlineNotCompleted,
  cancelledOnline: WALLET_COPY.onlineCancelled,
  // The return page.
  checkingTitle: 'Checking your payment',
  checkingBody: 'Please wait while we check that your payment has reached us. This usually takes a few seconds.',
  // After a minute without an answer the heading stays the same and the words below change.
  waitingTitle: 'Checking your payment',
  waitingBody: 'Still waiting. We will tell you here and in your bell the moment it arrives.',
  waitingNoRead: 'We could not read your payment just now. Your money is safe.',
  checkedNothing: 'We checked just now. Nothing has arrived yet.',
  notFoundTitle: 'We could not find this payment',
  notFoundBody: 'Open your wallet to see all your top-ups. If money left your account, contact support with the Help button at the top of the page.',
  otherTitle: 'This is not an online payment',
  otherBody: 'Open your wallet to see where this top-up stands.',
  notCompletedTitle: 'Payment not completed',
  cancelledTitle: 'Payment cancelled',
  goToWallet: 'Go to your wallet',
  signInTitle: 'Sign in to see your payment',
  signInBody: 'If you have paid, your money is added to your wallet as soon as your bank confirms it. Sign in to see it.',
  signIn: 'Sign in',
} as const;

export const paidTitle = 'Payment received';
export const paidBody = (amountRand: number): string => `${rand0(amountRand)} has been added to your wallet.`;
export const waitBody = (seconds: number): string => `Please wait ${seconds} second${seconds === 1 ? '' : 's'}, then try again.`;

// ---- is the online choice open for this person? every doubt answers "no" ------------------------------------------------------------------------
// The database function is true only when the wallet is open, the person is an adult, and the platform setting wallet_online_mode lets them in:
// `off` nobody, `staff` only the people listed in wallet_online_staff (the first real payment is the CEO's own), `on` everyone.
export async function fetchOnlineAvailable(db: WalletClient): Promise<boolean> {
  try {
    const { data, error } = await db.rpc('wallet_online_available');
    return !error && data === true;
  } catch {
    return false;
  }
}

// ---- making the row, then starting the payment -------------------------------------------------------------------------------------------------
export interface CreatedOnlineTopup { topupId: string; reference: string; amountRand: number }
// Throws the database's plain sentence ("Add between R50 and R5000 at a time, in whole rands.", "You already have 3 online payments waiting...").
export async function createOnlineTopup(db: WalletClient, amountRand: number): Promise<CreatedOnlineTopup> {
  const { data, error } = await db.rpc('create_online_topup', { p_amount: amountRand });
  if (error) throw new Error(error.message ?? 'Could not start the payment.');
  const d = (data ?? {}) as Record<string, unknown>;
  if (typeof d.topup_id !== 'string' || typeof d.reference !== 'string') throw new Error('Could not start the payment.');
  const amount = typeof d.amount_rand === 'number' ? d.amount_rand : Number(d.amount_rand);
  return { topupId: d.topup_id, reference: d.reference, amountRand: Number.isFinite(amount) ? amount : amountRand };
}

// One call to the Worker: its status and its JSON body (null when there is none or it is not JSON). Never throws for a bad status; a lost connection throws.
export type OnlineRequest = (path: string) => Promise<{ status: number; body: unknown }>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isTopupId = (value: unknown): value is string => typeof value === 'string' && UUID.test(value);

const asObject = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

// Only a plain https address is ever followed (the Worker passes on the link the provider gave; a script address or anything else is dropped).
export function safeRedirectUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (text.length < 12 || text.length > 2000 || /\s/.test(text)) return null;
  try {
    const url = new URL(text);
    return url.protocol === 'https:' && url.hostname.includes('.') ? url.toString() : null;
  } catch {
    return null;
  }
}

export type StartResult =
  | { ok: true; redirectUrl: string }
  // `rowClosed`: the Worker (or the database) has closed this top-up, so it cannot be tried again; the next try must make a fresh one.
  | { ok: false; reason: 'busy' | 'closed' | 'unavailable' | 'signin'; message: string; rowClosed: boolean };

const failure = (reason: 'busy' | 'closed' | 'unavailable' | 'signin', message: string, rowClosed = false): StartResult => ({ ok: false, reason, message, rowClosed });

// Asks the Worker to start (or resume) the payment of this top-up. The answer is the address of the bank's payment page (`redirect_url`). The browser sends
// no amount and no payer: the Worker reads the payer from the token and the amount from the row. The Worker's error answers carry a short `code` (busy,
// closed, not_found, not_configured, start_failed, server_error, sign_in...); the words shown are OUR OWN, chosen by that code and the status, so no text of
// the Worker's or the processor's ever reaches a person. A "busy" answer (another click or tab is creating it) is not an error.
export async function startOnlinePayment(request: OnlineRequest, topupId: string): Promise<StartResult> {
  if (!isTopupId(topupId)) return failure('closed', ONLINE_COPY.closed, true);
  let answer: { status: number; body: unknown };
  try {
    answer = await request(`/api/wallet/topups/${topupId}/start-online`);
  } catch {
    return failure('unavailable', ONLINE_COPY.couldNotOpen);
  }
  const body = asObject(answer.body);
  const code = typeof body.code === 'string' ? body.code : '';
  if (answer.status >= 200 && answer.status < 300) {
    const url = safeRedirectUrl(body.redirect_url ?? body.redirectUrl ?? body.url);
    return url ? { ok: true, redirectUrl: url } : failure('unavailable', ONLINE_COPY.couldNotOpen);
  }
  if (answer.status === 401 || code.startsWith('sign_in')) return failure('signin', ONLINE_COPY.signInAgain);
  if (code === 'busy' || answer.status === 423 || answer.status === 429) return failure('busy', ONLINE_COPY.busy);
  if (code === 'closed' || code === 'not_found' || answer.status === 403 || answer.status === 404 || answer.status === 410) return failure('closed', ONLINE_COPY.closed, true);
  if (code === 'not_configured' || answer.status === 503) return failure('unavailable', ONLINE_COPY.notAvailable);
  // start_failed: the Worker could not get a payment page and has closed the top-up itself
  if (code === 'start_failed') return failure('unavailable', ONLINE_COPY.couldNotOpen, true);
  if (answer.status === 409) return failure('busy', ONLINE_COPY.busy);
  return failure('unavailable', ONLINE_COPY.couldNotOpen);
}

// "Check now": asks the Worker to ask the provider about this top-up. It never credits by itself on this page: whatever the Worker finds goes through the
// database's one door, and this page then READS the row again. Allowed at most once per 15 seconds per top-up (the Worker answers with a wait).
export type CheckResult = { ok: true } | { ok: false; message: string };
export async function checkOnlineTopup(request: OnlineRequest, topupId: string): Promise<CheckResult> {
  if (!isTopupId(topupId)) return { ok: false, message: ONLINE_COPY.notFoundBody };
  let answer: { status: number; body: unknown };
  try {
    answer = await request(`/api/wallet/topups/${topupId}/check`);
  } catch {
    return { ok: false, message: ONLINE_COPY.checkFailed };
  }
  const body = asObject(answer.body);
  const code = typeof body.code === 'string' ? body.code : '';
  const retry = Number(body.retry_after_seconds ?? body.retryAfterSeconds);
  if (answer.status === 401 || code.startsWith('sign_in')) return { ok: false, message: ONLINE_COPY.signInAgain };
  if (answer.status === 429 || code === 'wait') {
    return { ok: false, message: Number.isFinite(retry) && retry > 0 && retry <= 60 ? waitBody(Math.ceil(retry)) : 'Please wait a few seconds, then try again.' };
  }
  if (answer.status >= 200 && answer.status < 300) return { ok: true };
  return { ok: false, message: ONLINE_COPY.checkFailed };
}

// ---- reading the payer's own top-up row (the database's policies decide who may) -------------------------------------------------------------
// null = no such row for this person. Throws when the read fails. The id comes from the address, so it is checked before it is used.
export async function fetchTopupById(db: WalletClient, profileId: string, topupId: string): Promise<Topup | null> {
  if (!isTopupId(topupId)) return null;
  const { data, error } = await db
    .from('wallet_topups')
    .select('id, reference, amount_rand, status, method, received_rand, decision_comment, created_at, decided_at, proof_attached_at')
    .eq('id', topupId)
    .eq('profile_id', profileId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const r = data as Record<string, unknown>;
  const str = (v: unknown): string => (typeof v === 'string' ? v : '');
  return {
    id: str(r.id),
    reference: str(r.reference),
    amountRand: Number(r.amount_rand),
    status: r.status as TopupStatus,
    method: r.method === 'online' ? 'online' : r.method === 'card' ? 'card' : 'eft',
    receivedRand: r.received_rand == null ? null : Number(r.received_rand),
    comment: r.decision_comment == null ? null : str(r.decision_comment),
    createdAt: str(r.created_at),
    decidedAt: r.decided_at == null ? null : str(r.decided_at),
    proofSentAt: r.proof_attached_at == null ? null : str(r.proof_attached_at),
  };
}

// ---- the return page ---------------------------------------------------------------------------------------------------------------------------
export const POLL_INTERVAL_MS = 3000;
export const POLL_MAX_MS = 60_000;

export type ReturnView =
  | { kind: 'checking' }
  | { kind: 'paid'; amountRand: number }
  | { kind: 'waiting'; readFailed: boolean }
  | { kind: 'not_completed' }
  | { kind: 'cancelled' }
  | { kind: 'not_found' }
  | { kind: 'other' };

// What the page says, from the latest read of the payer's own row. `row` is undefined when the read failed. Only the database's status moves the page on;
// the address and the time never decide that money has arrived.
export function decideReturn(row: Topup | null | undefined, elapsedMs: number, maxMs: number = POLL_MAX_MS): ReturnView {
  if (row === null) return { kind: 'not_found' };
  if (row && row.method !== 'online') return { kind: 'other' };
  if (row) {
    if (row.status === 'successful') return { kind: 'paid', amountRand: row.receivedRand ?? row.amountRand };
    if (row.status === 'unsuccessful') return { kind: 'not_completed' };
    if (row.status === 'cancelled') return { kind: 'cancelled' };
  }
  // still waiting for the bank (or the read failed): keep looking until the time is up
  if (elapsedMs >= maxMs) return { kind: 'waiting', readFailed: row === undefined };
  return { kind: 'checking' };
}

export interface PollDeps {
  read: () => Promise<Topup | null>;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  isCancelled: () => boolean;
  onView: (view: ReturnView) => void;
  intervalMs?: number;
  maxMs?: number;
}
// Reads the row at once, then every 3 seconds, until it is settled or 60 seconds have passed. A failed read is not fatal: it is tried again.
// Resolves with the last view (or null if the page went away).
export async function pollReturn(deps: PollDeps): Promise<ReturnView | null> {
  const interval = deps.intervalMs ?? POLL_INTERVAL_MS;
  const max = deps.maxMs ?? POLL_MAX_MS;
  const started = deps.now();
  for (;;) {
    let row: Topup | null | undefined;
    try {
      row = await deps.read();
    } catch {
      row = undefined;
    }
    if (deps.isCancelled()) return null;
    const view = decideReturn(row, deps.now() - started, max);
    deps.onView(view);
    if (view.kind !== 'checking') return view;
    await deps.sleep(interval);
    if (deps.isCancelled()) return null;
  }
}
