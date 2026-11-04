// WALLETS + MANUAL BANK TRANSFER (CEO's design, 2 Nov 2026; plan Drake/programmer/wallet-manual-eft-plan-2026-11-02.md, phase 3: the screens).
// A learner or parent has a wallet; money is added by bank transfer with a reference and a proof of payment that the CEO checks by hand;
// sending a request puts its price on hold; a tutor's share arrives in their wallet when a session is complete and is paid out on request.
// The switch is a database setting (system_settings.wallet_payments_enabled), OFF by default; wallet_open() says whether it is on (free sessions
// win while they are on). This file holds the words, the checks and the questions, and takes the database client as an argument so a test can
// hand in a fake (wallet-test.ts); walletHooks.ts binds them to the app's own client. Everything that asks "is the wallet open / is this paid
// from a wallet" is TOLERANT: a database without the wallet migrations, or any error, answers "no" and nothing about booking changes.
// Money is whole rands (integers) everywhere here. The tables are read with explicit column lists, never select *.

// The few things of the Supabase client used here, so a test can hand in a fake. `from` is loosely typed on purpose: the real query builder
// is far richer than the handful of calls made below.
interface DbError { code?: string; message?: string; details?: string; hint?: string; statusCode?: string | number }
interface DbResult { data: unknown; error: DbError | null }
export interface WalletClient {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<DbResult>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from(table: string): any;
  storage: {
    from(bucket: string): {
      upload(path: string, body: Blob, options: { contentType: string; upsert: boolean }): PromiseLike<{ data: unknown; error: DbError | null }>;
    };
  };
}

// ---- the words -------------------------------------------------------------------------------------------------------------------------------
export const WALLET_COPY = {
  // The CEO's wording for a learner who has sent proof (adapted: the money is added to the wallet once the transfer is checked).
  proofSentLine: 'We check transfers by hand. You could receive your money within one business day. If not, please contact support by clicking the Help button at the top of the page.',
  proofSentUsually: 'Proof sent. We are checking your transfer, usually within one business day.',
  moneyIsForLessons: 'Money in your wallet is for lessons. To take it out, contact support.',
  uploadHelp: 'After you pay, upload the proof of payment your bank gives you (PDF, JPG or PNG, up to 5 MB). Send the bank\'s proof as it is, and nothing else.',
  bankIntro: 'Pay this amount from your banking app. Use the reference exactly as shown, so we can find your payment.',
  // The CEO's wording for the tutor (the database's own notice says the same).
  payoutSent: (rand: number) => `Your request was sent. You could receive ${rand0(rand)} within one business day. If you do not, contact support with the Help button at the top of the page.`,
  payoutOpenNote: 'Your payout request is waiting to be paid. You can ask again, and change your bank details, once it is paid.',
  accountNumberNote: 'We keep your full account number private: only the last four digits are shown after you save it.',
  heldOnRequest: 'The price is put on hold in your wallet. If nobody accepts in time, or the tutor cannot take it, it goes straight back.',
  walletRandOnly: 'The wallet can only pay for requests in rand (ZAR).',
  // A request or session paid from a wallet, on the lists.
  waitingNote: 'Your request is waiting for a tutor to accept it. The price is on hold in your wallet. If nobody accepts in time it ends, and the money goes straight back.',
  sessionBadge: 'Paid from your wallet',
  cancelNote: 'Cancel this session? The payment goes back into your wallet as credit.',
  cancelRequestNote: 'Cancel this request? The price on hold goes straight back into your wallet.',
  tutorQueueNote: "Paid from the learner's wallet. Your share goes into your wallet when the session is complete.",
  tutorSessionNote: "Paid from the learner's wallet. Your share goes into your wallet when you mark the session complete (or 48 hours after it ends).",
  tutorCancelNote: "Cancel this session? The learner's payment goes back into their wallet as credit.",
} as const;

export const TOPUP_PROOF_MAX_BYTES = 5 * 1024 * 1024;

// ---- money text ------------------------------------------------------------------------------------------------------------------------------
// Whole rands, never cents: R180, R1 250 is not used (the app writes plain numbers: R1250).
export function rand0(n: number): string {
  const whole = Math.round(n);
  return whole < 0 ? `-R${Math.abs(whole)}` : `R${whole}`;
}

// What the database rounds a request's price to (nearest rand, halves up; prices are positive).
export function walletPrice(chargedAmount: number): number {
  return Math.round(chargedAmount);
}

// How much more the wallet needs for this price (0 when it already covers it).
export function shortfall(price: number, available: number): number {
  return Math.max(0, Math.round(price) - Math.round(available));
}

// The same sentence the database gives when a hold is refused (send_request_wallet), so the page can say it before the request exists.
export function shortfallSentence(price: number, available: number): string {
  return `Your wallet has ${rand0(available)}. This session is ${rand0(price)}. Add ${rand0(shortfall(price, available))} or more.`;
}

// The tutor's share of a wallet session as the database books it: whole-rand commission, the tutor gets the rest. `cardTutorPayout` is what
// the old card formula shows the tutor (price less commission to the cent), from which the commission to the cent is worked back.
export function walletTutorShare(chargedAmount: number, cardTutorPayout: number): number {
  const price = Math.round(chargedAmount);
  return price - Math.round(chargedAmount - cardTutorPayout);
}

// ---- typed answers ---------------------------------------------------------------------------------------------------------------------------
export interface PaymentDetails {
  bankName: string;
  accountHolder: string;
  accountNumber: string;
  branchCode: string;
  accountType: string;
  minRand: number;
  maxRand: number;
  capRand: number;
}
export interface Balance { available: number; held: number }
export type TopupStatus = 'awaiting_proof' | 'proof_sent' | 'successful' | 'unsuccessful' | 'cancelled';
export interface Topup {
  id: string;
  reference: string;
  amountRand: number;
  status: TopupStatus;
  receivedRand: number | null;
  comment: string | null;
  createdAt: string;
  decidedAt: string | null;
}
export type LedgerKind = 'topup' | 'hold' | 'release' | 'charge' | 'refund' | 'session_credit' | 'payout_hold' | 'payout_paid' | 'payout_release' | 'adjustment';
export interface LedgerLine {
  id: string;
  kind: LedgerKind;
  availableDelta: number;
  heldDelta: number;
  requestId: string | null;
  sessionId: string | null;
  note: string | null;
  createdAt: string;
}
export interface BankDetails { bankName: string; accountHolder: string; branchCode: string; last4: string; updatedAt: string }
export type PayoutStatus = 'requested' | 'paid' | 'could_not_pay';
export interface Payout {
  id: string;
  amountRand: number;
  status: PayoutStatus;
  bankName: string;
  last4: string;
  requestedAt: string;
  decidedAt: string | null;
  paidOn: string | null;
  comment: string | null;
}
export interface ComingMoney { rand: number; sessions: number }

const asNumber = (v: unknown): number => (typeof v === 'number' ? v : Number(v));
const asString = (v: unknown): string => (typeof v === 'string' ? v : '');
const rows = (data: unknown): Record<string, unknown>[] => (Array.isArray(data) ? (data as Record<string, unknown>[]) : []);

// ---- is the wallet open? every doubt answers "no" ---------------------------------------------------------------------------------------------
export async function fetchWalletOpen(db: WalletClient): Promise<boolean> {
  try {
    const { data, error } = await db.rpc('wallet_open');
    return !error && data === true;
  } catch {
    return false;
  }
}

// Tutorlage's bank details and the limits for "Add money". null when the wallet is closed or the answer cannot be read.
export async function fetchPaymentDetails(db: WalletClient): Promise<PaymentDetails | null> {
  try {
    const { data, error } = await db.rpc('wallet_payment_details');
    if (error || !data || typeof data !== 'object') return null;
    const d = data as Record<string, unknown>;
    if (d.open !== true) return null;
    return {
      bankName: asString(d.bank_name),
      accountHolder: asString(d.account_holder),
      accountNumber: asString(d.account_number),
      branchCode: asString(d.branch_code),
      accountType: asString(d.account_type),
      minRand: Number.isFinite(asNumber(d.min_rand)) ? asNumber(d.min_rand) : 50,
      maxRand: Number.isFinite(asNumber(d.max_rand)) ? asNumber(d.max_rand) : 5000,
      capRand: Number.isFinite(asNumber(d.cap_rand)) ? asNumber(d.cap_rand) : 10000,
    };
  } catch {
    return null;
  }
}

// ---- reads (own rows only; the database's policies decide) ------------------------------------------------------------------------------------
// The signed-in person's wallet. No row yet means an empty wallet. Throws when the read fails (the screen shows "try again").
export async function fetchBalance(db: WalletClient, profileId: string): Promise<Balance> {
  const { data, error } = await db.from('wallets').select('available_rand, held_rand').eq('profile_id', profileId).maybeSingle();
  if (error) throw error;
  if (!data) return { available: 0, held: 0 };
  return { available: asNumber(data.available_rand) || 0, held: asNumber(data.held_rand) || 0 };
}

// Is anything of the wallet in flight (money in it, a top-up waiting, a payout waiting)? Used only while the wallet is CLOSED, so a person who
// already has something in flight can still see and finish it. Any error answers false.
export async function fetchInFlight(db: WalletClient, profileId: string): Promise<boolean> {
  try {
    const [wallet, topups, payouts] = await Promise.all([
      db.from('wallets').select('available_rand, held_rand').eq('profile_id', profileId).maybeSingle(),
      db.from('wallet_topups').select('id').eq('profile_id', profileId).in('status', ['awaiting_proof', 'proof_sent']).limit(1),
      db.from('payout_requests').select('id').eq('tutor_id', profileId).eq('status', 'requested').limit(1),
    ]);
    const money = !wallet.error && wallet.data && (asNumber(wallet.data.available_rand) > 0 || asNumber(wallet.data.held_rand) > 0);
    return !!money || (!topups.error && rows(topups.data).length > 0) || (!payouts.error && rows(payouts.data).length > 0);
  } catch {
    return false;
  }
}

export async function fetchTopups(db: WalletClient, profileId: string, limit = 20): Promise<Topup[]> {
  const { data, error } = await db
    .from('wallet_topups')
    .select('id, reference, amount_rand, status, received_rand, decision_comment, created_at, decided_at')
    .eq('profile_id', profileId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return rows(data).map((r) => ({
    id: asString(r.id),
    reference: asString(r.reference),
    amountRand: asNumber(r.amount_rand),
    status: r.status as TopupStatus,
    receivedRand: r.received_rand == null ? null : asNumber(r.received_rand),
    comment: r.decision_comment == null ? null : asString(r.decision_comment),
    createdAt: asString(r.created_at),
    decidedAt: r.decided_at == null ? null : asString(r.decided_at),
  }));
}

export async function fetchLedger(db: WalletClient, profileId: string, limit = 30): Promise<LedgerLine[]> {
  const { data, error } = await db
    .from('wallet_ledger')
    .select('id, kind, available_delta, held_delta, request_id, session_id, note, created_at')
    .eq('profile_id', profileId)
    .order('seq', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return rows(data).map((r) => ({
    id: asString(r.id),
    kind: r.kind as LedgerKind,
    availableDelta: asNumber(r.available_delta),
    heldDelta: asNumber(r.held_delta),
    requestId: r.request_id == null ? null : asString(r.request_id),
    sessionId: r.session_id == null ? null : asString(r.session_id),
    note: r.note == null ? null : asString(r.note),
    createdAt: asString(r.created_at),
  }));
}

// The subject of each request / session a ledger line names, so a line can read "On hold for your Maths request". Best effort: any error
// gives an empty map and the lines are worded without a subject.
export async function fetchSubjectNames(db: WalletClient, kind: 'request' | 'session', ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (ids.length === 0) return out;
  try {
    const table = kind === 'request' ? 'session_requests' : 'sessions';
    const { data, error } = await db.from(table).select('id, student_subject_enrollments ( subject_name )').in('id', ids);
    if (error) return out;
    for (const r of rows(data)) {
      const e = r.student_subject_enrollments as { subject_name?: unknown } | null;
      if (e && typeof e.subject_name === 'string' && e.subject_name) out.set(asString(r.id), e.subject_name);
    }
  } catch {
    // no subjects: the lines still read fine
  }
  return out;
}

// ---- which requests / sessions were paid from a wallet (tolerant: an error means "none were") ----------------------------------------------------
export async function fetchWalletRequestIds(ids: string[], db: WalletClient): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  try {
    const { data, error } = await db.from('session_requests').select('id').in('id', ids).eq('paid_from_wallet', true);
    if (error) return new Set();
    return new Set(rows(data).map((r) => r.id).filter((x): x is string => typeof x === 'string'));
  } catch {
    return new Set();
  }
}
export async function fetchWalletSessionIds(ids: string[], db: WalletClient): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  try {
    const { data, error } = await db.from('sessions').select('id').in('id', ids).eq('wallet_paid', true);
    if (error) return new Set();
    return new Set(rows(data).map((r) => r.id).filter((x): x is string => typeof x === 'string'));
  } catch {
    return new Set();
  }
}

// ---- sending a request from the wallet --------------------------------------------------------------------------------------------------------
// Thrown when the database refuses the hold; `message` is its plain sentence (for a short wallet: "Your wallet has R120. This session is R180.
// Add R60 or more."), `shortRand` the missing amount when the reason is a wallet that is too small.
export class WalletRefusal extends Error {
  shortRand: number | null;
  constructor(message: string, shortRand: number | null) {
    super(message);
    this.name = 'WalletRefusal';
    this.shortRand = shortRand;
  }
}

export async function sendRequestWallet(requestId: string, db: WalletClient): Promise<void> {
  const { error } = await db.rpc('send_request_wallet', { p_request_id: requestId });
  if (!error) return;
  const missing = error.details === 'wallet_too_low' ? Number(error.hint) : NaN;
  throw new WalletRefusal(error.message ?? 'Could not send the request from your wallet.', Number.isFinite(missing) ? missing : null);
}

// ---- adding money ------------------------------------------------------------------------------------------------------------------------------
// The amount typed in the box: whole rands only, inside the limits. Returns the number, or the sentence to show.
export function parseTopupAmount(text: string, minRand: number, maxRand: number): { ok: true; rand: number } | { ok: false; message: string } {
  const cleaned = text.trim().replace(/^R\s*/i, '').replace(/[\s,]/g, '');
  if (cleaned === '') return { ok: false, message: `Enter how much to add, from ${rand0(minRand)} to ${rand0(maxRand)}.` };
  if (!/^\d+$/.test(cleaned)) return { ok: false, message: 'Use whole rands only, for example 200.' };
  const rand = Number(cleaned);
  if (rand < minRand || rand > maxRand) return { ok: false, message: `Add between ${rand0(minRand)} and ${rand0(maxRand)} at a time.` };
  return { ok: true, rand };
}

// The amount to put in the box when the learner arrives from the booking page: exactly what is missing, but never below the minimum.
export function suggestedTopup(shortRand: number | null, minRand: number, maxRand: number): number | null {
  if (!shortRand || shortRand <= 0) return null;
  return Math.min(Math.max(shortRand, minRand), maxRand);
}

export interface CreatedTopup { topupId: string; reference: string; amountRand: number }
export async function createTopup(db: WalletClient, amountRand: number): Promise<CreatedTopup> {
  const { data, error } = await db.rpc('create_wallet_topup', { p_amount: amountRand });
  if (error) throw new Error(error.message ?? 'Could not start the top-up.');
  const d = (data ?? {}) as Record<string, unknown>;
  if (typeof d.topup_id !== 'string' || typeof d.reference !== 'string') throw new Error('Could not start the top-up.');
  return { topupId: d.topup_id, reference: d.reference, amountRand: asNumber(d.amount_rand) };
}

export async function cancelTopup(db: WalletClient, topupId: string): Promise<void> {
  const { error } = await db.rpc('cancel_my_topup', { p_topup: topupId });
  if (error) throw new Error(error.message ?? 'Could not cancel the top-up.');
}

// The proof file: PDF, JPG or PNG by its FIRST BYTES (not the name or the type the browser guessed), up to 5 MB. The path is
// <payer id>/<top-up id>.<ext> in the private bucket payment-proofs (the database refuses any other path).
export type ProofKind = { ext: 'pdf' | 'jpg' | 'png'; contentType: string };
export function sniffProof(head: Uint8Array): ProofKind | null {
  const startsWith = (...bytes: number[]) => bytes.every((b, i) => head[i] === b);
  if (head.length >= 4 && startsWith(0x25, 0x50, 0x44, 0x46)) return { ext: 'pdf', contentType: 'application/pdf' };
  if (head.length >= 3 && startsWith(0xff, 0xd8, 0xff)) return { ext: 'jpg', contentType: 'image/jpeg' };
  if (head.length >= 8 && startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return { ext: 'png', contentType: 'image/png' };
  return null;
}
export async function checkProofFile(file: Blob): Promise<{ ok: true; kind: ProofKind } | { ok: false; message: string }> {
  if (file.size === 0) return { ok: false, message: 'That file is empty. Choose the proof of payment from your bank.' };
  if (file.size > TOPUP_PROOF_MAX_BYTES) return { ok: false, message: 'That file is too big. The proof must be 5 MB or smaller.' };
  const kind = sniffProof(new Uint8Array(await file.slice(0, 8).arrayBuffer()));
  if (!kind) return { ok: false, message: 'Send the proof as a PDF, JPG or PNG file.' };
  return { ok: true, kind };
}

// Upload FIRST, then attach (the database checks the file really exists). If the file is already there from an earlier try whose attach did not
// go through, it is attached as it is. Throws a plain sentence on any refusal.
export async function sendProof(db: WalletClient, payerId: string, topupId: string, file: Blob): Promise<void> {
  const checked = await checkProofFile(file);
  if ('message' in checked) throw new Error(checked.message);
  const path = `${payerId}/${topupId}.${checked.kind.ext}`;
  const { error: uploadError } = await db.storage.from('payment-proofs').upload(path, file, { contentType: checked.kind.contentType, upsert: false });
  if (uploadError && !/already exists|duplicate/i.test(uploadError.message ?? '') && String(uploadError.statusCode) !== '409') {
    throw new Error(uploadError.message ?? 'Could not upload the file. Please try again.');
  }
  const { error } = await db.rpc('attach_topup_proof', { p_topup: topupId, p_path: path });
  if (error) throw new Error(error.message ?? 'Could not attach the proof. Please try again.');
}

// ---- words for the lists --------------------------------------------------------------------------------------------------------------------
export function topupStatusLine(t: Pick<Topup, 'status' | 'comment' | 'receivedRand' | 'amountRand'>): string {
  switch (t.status) {
    case 'awaiting_proof': return 'Waiting for your proof of payment';
    case 'proof_sent': return WALLET_COPY.proofSentUsually;
    case 'successful': return t.receivedRand != null && t.receivedRand !== t.amountRand ? `Added to your wallet: ${rand0(t.receivedRand)} received` : 'Added to your wallet';
    case 'unsuccessful': return `Not received${t.comment ? `: ${t.comment}` : ''}`;
    case 'cancelled': return 'Cancelled';
    default: return '';
  }
}

// A ledger line in plain words. `subject` is the request's or session's subject when it could be read.
export function ledgerLineText(line: Pick<LedgerLine, 'kind' | 'note'>, subject: string | null, tutorView: boolean): string {
  const forRequest = subject ? `your ${subject} request` : 'your request';
  const forSession = subject ? `your ${subject} session` : 'your session';
  switch (line.kind) {
    case 'topup': return 'Top-up added';
    case 'hold': return `On hold for ${forRequest}`;
    case 'release':
      return /expired/i.test(line.note ?? '') ? 'Returned: nobody accepted in time'
        : /declined/i.test(line.note ?? '') ? 'Returned: the tutor could not take it'
        : 'Returned: the request ended';
    case 'charge': return `Paid for ${forSession}`;
    case 'refund': return 'Refund: session cancelled';
    case 'session_credit': return tutorView ? `Earned from ${subject ? `a ${subject}` : 'a'} session` : 'Credit from a session';
    case 'payout_hold': return 'Payout requested';
    case 'payout_paid': return 'Payout paid';
    case 'payout_release': return 'Payout could not be paid: the money is back in your wallet';
    case 'adjustment': return `Adjustment by Tutorlage${line.note ? `: ${line.note}` : ''}`;
    default: return '';
  }
}
// The figure shown beside a line: what moved in the available balance, or (for a charge or a payout paid) what left the held money.
export function ledgerAmount(line: Pick<LedgerLine, 'availableDelta' | 'heldDelta'>): number {
  return line.availableDelta !== 0 ? line.availableDelta : line.heldDelta;
}

// ---- the tutor ---------------------------------------------------------------------------------------------------------------------------------
export const SA_BANKS = ['ABSA', 'African Bank', 'Bank Zero', 'Capitec Bank', 'Discovery Bank', 'FNB (First National Bank)', 'Investec', 'Nedbank', 'Standard Bank', 'TymeBank'] as const;
export const OTHER_BANK = 'Other bank';

export interface BankForm { bank: string; otherBank: string; accountNumber: string; branchCode: string; holder: string }
// The same rules the database applies (so the person is told before sending): digits only, 6 to 16 for the account, 6 for the branch.
export function checkBankForm(f: BankForm): { ok: true; bankName: string; accountNumber: string; branchCode: string; holder: string } | { ok: false; message: string } {
  const bankName = (f.bank === OTHER_BANK ? f.otherBank : f.bank).trim();
  const accountNumber = f.accountNumber.replace(/[\s-]/g, '');
  const branchCode = f.branchCode.replace(/[\s-]/g, '');
  const holder = f.holder.trim();
  if (bankName.length < 2 || bankName.length > 80) return { ok: false, message: 'Choose your bank.' };
  if (!/^\d{6,16}$/.test(accountNumber)) return { ok: false, message: 'The account number should be 6 to 16 digits, numbers only.' };
  if (!/^\d{6}$/.test(branchCode)) return { ok: false, message: 'The branch code should be 6 digits.' };
  if (holder.length < 2 || holder.length > 120) return { ok: false, message: "Enter the account holder's name." };
  return { ok: true, bankName, accountNumber, branchCode, holder };
}

export async function fetchBankDetails(db: WalletClient, tutorId: string): Promise<BankDetails | null> {
  const { data, error } = await db
    .from('tutor_bank_details')
    .select('bank_name, branch_code, account_holder, account_last4, updated_at')
    .eq('tutor_id', tutorId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return { bankName: asString(data.bank_name), accountHolder: asString(data.account_holder), branchCode: asString(data.branch_code), last4: asString(data.account_last4), updatedAt: asString(data.updated_at) };
}

export async function saveBankDetails(db: WalletClient, f: { bankName: string; accountNumber: string; branchCode: string; holder: string }): Promise<void> {
  const { error } = await db.rpc('save_my_bank_details', {
    p_bank_name: f.bankName,
    p_account_number: f.accountNumber,
    p_branch_code: f.branchCode,
    p_account_holder: f.holder,
  });
  if (error) throw new Error(error.message ?? 'Could not save your bank details.');
}

export async function requestPayout(db: WalletClient): Promise<{ amountRand: number }> {
  const { data, error } = await db.rpc('request_my_payout');
  if (error) throw new Error(error.message ?? 'Could not send your request.');
  return { amountRand: asNumber((data as Record<string, unknown> | null)?.amount_rand) };
}

export async function fetchPayouts(db: WalletClient, tutorId: string, limit = 10): Promise<Payout[]> {
  const { data, error } = await db
    .from('payout_requests')
    .select('id, amount_rand, status, bank_name, account_last4, requested_at, decided_at, paid_on, decision_comment')
    .eq('tutor_id', tutorId)
    .order('requested_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return rows(data).map((r) => ({
    id: asString(r.id),
    amountRand: asNumber(r.amount_rand),
    status: r.status as PayoutStatus,
    bankName: asString(r.bank_name),
    last4: asString(r.account_last4),
    requestedAt: asString(r.requested_at),
    decidedAt: r.decided_at == null ? null : asString(r.decided_at),
    paidOn: r.paid_on == null ? null : asString(r.paid_on),
    comment: r.decision_comment == null ? null : asString(r.decision_comment),
  }));
}

export function payoutStatusLine(p: Pick<Payout, 'status' | 'paidOn' | 'comment'>, formatDay: (iso: string) => string): string {
  switch (p.status) {
    case 'requested': return 'Requested: you could receive it within one business day';
    case 'paid': return p.paidOn ? `Paid on ${formatDay(p.paidOn)}` : 'Paid';
    case 'could_not_pay': return `Could not pay${p.comment ? `: ${p.comment}` : ''}. The money is back in your wallet.`;
    default: return '';
  }
}

// "Coming: R360" = the tutor's share of wallet sessions that are booked and not yet complete (the tutor is credited only on completion).
export async function fetchComing(db: WalletClient, tutorId: string): Promise<ComingMoney> {
  const { data, error } = await db
    .from('sessions')
    .select('id, tutor_payout_amount')
    .eq('tutor_id', tutorId)
    .eq('wallet_paid', true)
    .eq('status', 'scheduled');
  if (error) throw error;
  const list = rows(data);
  return { rand: list.reduce((sum, r) => sum + (asNumber(r.tutor_payout_amount) || 0), 0), sessions: list.length };
}
export function comingLine(c: ComingMoney): string {
  return `Coming: ${rand0(c.rand)} from ${c.sessions} session${c.sessions === 1 ? '' : 's'} waiting to be completed`;
}
