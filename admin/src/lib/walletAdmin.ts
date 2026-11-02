import { notSwitchedOn } from './subjectApprovals';
import { DocumentClient } from './documentAccess';
import { ViewedDocument, viewStoredDocument } from './documentViewing';
import type { AdminRole } from '../types';

// The ADMIN side of the wallet + manual bank transfer system (CEO's design, 2 Nov 2026; plan Drake/programmer/wallet-manual-eft-plan-2026-11-02.md,
// phase 4): the four tabs inside the Payments page. Top-ups to check (view the proof, type the amount received, Successful / Unsuccessful), payout
// requests (bank details hidden until opened, Mark paid / Cannot pay), wallets (the "held for others" total, the daily balance check, and for a
// super admin only "Adjust wallet") and wallet settings (Tutorlage's bank details, the limits, the master switch).
// Only finance_manager and super_admin see or use any of it; the database refuses everyone else too. Every question is TOLERANT: a database
// without the wallet, or any failing call, gives "not available" and never a crash. The client is passed in so a test can hand in a fake
// (scripts/dev/wallet-admin-test.ts); the screens (components/Wallet*.tsx) take the same client as a prop. Money is whole rands.
// Tables are read with explicit column lists, never select *: payout_requests and tutor_bank_details have an account-number column that is closed
// to the API on purpose, and this file does not even ask for the bank columns (the screen can only show them after admin_open_bank_details).

interface DbError { code?: string; message?: string; details?: string; hint?: string }
interface DbResult { data: unknown; error: DbError | null }
export interface WalletAdminClient {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<DbResult>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from(table: string): any;
  // Only needed to look at a proof file.
  storage?: DocumentClient['storage'];
}

export const WALLET_NOT_AVAILABLE = 'Not available: the wallet is not on this database yet.';

// ---- who may do what ----------------------------------------------------------------------------------------------------------------------------
export const canUseWallet = (role: AdminRole | null | undefined): boolean => role === 'finance_manager' || role === 'super_admin';
// "Adjust wallet" is for the super admin only (phase 1 decision).
export const canAdjustWallet = (role: AdminRole | null | undefined): boolean => role === 'super_admin';

// ---- words and small helpers ----------------------------------------------------------------------------------------------------------------------
export const rand0 = (n: number): string => {
  const whole = Math.round(n);
  return whole < 0 ? `-R${Math.abs(whole)}` : `R${whole}`;
};
const int = (v: unknown): number => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : 0);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const strOrNull = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const rows = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? (v as Record<string, unknown>[]) : []);

// South African time, as the CEO reads it ("3 Nov, 14:05").
export function formatSast(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('en-ZA', { timeZone: 'Africa/Johannesburg', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
}
export const todayIsoSast = (now = new Date()): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);

// The promise made to learners and tutors is "usually within 24 hours": an item older than that goes red.
export const OVERDUE_HOURS = 24;
export const isOverdue = (since: string | null | undefined, now = new Date()): boolean => {
  if (!since) return false;
  const t = new Date(since).getTime();
  return Number.isFinite(t) && now.getTime() - t > OVERDUE_HOURS * 3_600_000;
};
export function waitingFor(since: string | null | undefined, now = new Date()): string {
  const t = since ? new Date(since).getTime() : NaN;
  if (!Number.isFinite(t)) return '';
  const minutes = Math.max(0, Math.round((now.getTime() - t) / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = minutes / 60;
  return hours < 48 ? `${Math.floor(hours)} h` : `${Math.floor(hours / 24)} days`;
}

// What an admin is told when a call fails: the database's own reason, with the two cases people hit in words.
export function walletErrorMessage(e: unknown, fallback = 'That did not work. Try again.'): string {
  const err = e as DbError | null;
  if (notSwitchedOn(err)) return WALLET_NOT_AVAILABLE;
  if (err?.code === '42501') return 'Only a finance manager or a super admin can do this.';
  const message = typeof err?.message === 'string' && err.message ? err.message : '';
  return message || fallback;
}

// ---- names -------------------------------------------------------------------------------------------------------------------------------------
interface Person { name: string; role: string | null }
async function fetchPeople(client: WalletAdminClient, ids: string[]): Promise<Map<string, Person>> {
  const out = new Map<string, Person>();
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return out;
  try {
    const { data, error } = await client.from('profiles').select('id, full_name, role').in('id', unique);
    if (!error) for (const r of rows(data)) out.set(str(r.id), { name: str(r.full_name) || 'Unknown', role: strOrNull(r.role) });
  } catch {
    // Names are a convenience: the screen still works with "Unknown".
  }
  return out;
}
const personName = (people: Map<string, Person>, id: string) => people.get(id)?.name ?? 'Unknown';

// ---- 1. top-ups to check -----------------------------------------------------------------------------------------------------------------------
export interface TopupRow {
  id: string;
  payerId: string;
  payerName: string;
  // true for a parent, false for a learner or anyone else; null when the role could not be read
  payerIsParent: boolean | null;
  reference: string;
  claimedRand: number;
  status: string;
  proofPath: string | null;
  // when the proof was sent; null while still waiting for it
  proofSentAt: string | null;
  createdAt: string;
  receivedRand: number | null;
  decidedAt: string | null;
  comment: string | null;
}
export type TopupQueue =
  | { state: 'ok'; proofSent: TopupRow[]; awaiting: TopupRow[]; recent: TopupRow[] }
  | { state: 'not_available'; note: string }
  | { state: 'error'; message: string };

const TOPUP_COLUMNS = 'id, profile_id, reference, amount_rand, status, proof_path, proof_attached_at, received_rand, decided_at, decision_comment, created_at';

export async function fetchTopupQueue(client: WalletAdminClient): Promise<TopupQueue> {
  try {
    const open = await client.from('wallet_topups').select(TOPUP_COLUMNS).in('status', ['awaiting_proof', 'proof_sent']).order('created_at', { ascending: true }).limit(200);
    if (open.error) return failure(open.error);
    const decided = await client.from('wallet_topups').select(TOPUP_COLUMNS).in('status', ['successful', 'unsuccessful']).order('decided_at', { ascending: false }).limit(15);
    if (decided.error) return failure(decided.error);
    const all = [...rows(open.data), ...rows(decided.data)];
    const people = await fetchPeople(client, all.map((r) => str(r.profile_id)));
    const map = (r: Record<string, unknown>): TopupRow => {
      const person = people.get(str(r.profile_id));
      return {
        id: str(r.id), payerId: str(r.profile_id), payerName: person?.name ?? 'Unknown',
        payerIsParent: person?.role ? person.role === 'parent' : null,
        reference: str(r.reference), claimedRand: int(r.amount_rand), status: str(r.status), proofPath: strOrNull(r.proof_path),
        proofSentAt: strOrNull(r.proof_attached_at), createdAt: str(r.created_at),
        receivedRand: r.received_rand == null ? null : int(r.received_rand), decidedAt: strOrNull(r.decided_at), comment: strOrNull(r.decision_comment),
      };
    };
    const openRows = rows(open.data).map(map);
    return {
      state: 'ok',
      // Oldest proof first: the one that has waited longest is on top.
      proofSent: openRows.filter((r) => r.status === 'proof_sent').sort((a, b) => (a.proofSentAt ?? a.createdAt).localeCompare(b.proofSentAt ?? b.createdAt)),
      awaiting: openRows.filter((r) => r.status === 'awaiting_proof'),
      recent: rows(decided.data).map(map),
    };
  } catch (e) {
    return { state: 'error', message: walletErrorMessage(e) };
  }
}
function failure(e: DbError): { state: 'not_available'; note: string } | { state: 'error'; message: string } {
  return notSwitchedOn(e) ? { state: 'not_available', note: WALLET_NOT_AVAILABLE } : { state: 'error', message: walletErrorMessage(e) };
}

// "Successful": the amount is what the finance admin actually found in the bank (prefilled with the claim); a comment is required when it differs.
export type Checked<T> = ({ ok: true } & T) | { ok: false; error: string };
export function checkSuccessful(claimedRand: number, receivedText: string, comment: string): Checked<{ received: number; comment: string | null }> {
  const text = receivedText.trim();
  if (!/^[0-9]{1,7}$/.test(text) || Number(text) < 1) return { ok: false, error: 'Type the amount you received, in whole rands (for example 200).' };
  const received = Number(text);
  const note = comment.trim();
  if (received !== claimedRand && note.length < 3) {
    return { ok: false, error: `You typed ${rand0(received)} but ${rand0(claimedRand)} was claimed. Write a comment saying why.` };
  }
  if (note.length > 1000) return { ok: false, error: 'The comment is too long (1000 characters at most).' };
  return { ok: true, received, comment: note || null };
}
export function checkUnsuccessful(comment: string): Checked<{ comment: string }> {
  const note = comment.trim();
  if (note.length < 3) return { ok: false, error: 'Write a comment: the learner will read it.' };
  if (note.length > 1000) return { ok: false, error: 'The comment is too long (1000 characters at most).' };
  return { ok: true, comment: note };
}
export const successConfirmText = (payerName: string, received: number, claimed: number): string =>
  `Add ${rand0(received)} to ${payerName}'s wallet?${received !== claimed ? ` (They said ${rand0(claimed)}.)` : ''} This cannot be undone from here.`;
export const unsuccessConfirmText = (payerName: string): string =>
  `Tell ${payerName} their transfer was not received? They will read your comment.`;

export interface Decision { already: boolean }
async function decide(client: WalletAdminClient, fn: string, args: Record<string, unknown>): Promise<Decision> {
  const { data, error } = await client.rpc(fn, args);
  if (error) throw new Error(walletErrorMessage(error));
  return { already: (data as { already?: unknown } | null)?.already === true };
}
export const markTopupSuccessful = (client: WalletAdminClient, topupId: string, received: number, comment: string | null) =>
  decide(client, 'admin_mark_topup_successful', { p_topup: topupId, p_received: received, p_comment: comment });
export const markTopupUnsuccessful = (client: WalletAdminClient, topupId: string, comment: string) =>
  decide(client, 'admin_mark_topup_unsuccessful', { p_topup: topupId, p_comment: comment });

// Looking at the proof: inside the app, in the existing viewer, after the opening is recorded (documentAccess.ts). Finance admins only.
export function viewProof(client: WalletAdminClient, path: string, payerId: string): Promise<ViewedDocument> {
  if (!client.storage) return Promise.reject(new Error('Files cannot be opened here.'));
  return viewStoredDocument(client as unknown as DocumentClient, 'payment-proofs', path, { subject: payerId });
}

// ---- 2. payout requests -----------------------------------------------------------------------------------------------------------------------
export interface PayoutRow {
  id: string;
  tutorId: string;
  tutorName: string;
  amountRand: number;
  status: string;
  requestedAt: string;
  sessionCount: number;
  // the tutor changed their bank details in the 48 hours before asking: check before paying
  bankChangedRecently: boolean;
  decidedAt: string | null;
  paidOn: string | null;
  bankReference: string | null;
  comment: string | null;
}
export type PayoutQueue =
  | { state: 'ok'; requested: PayoutRow[]; recent: PayoutRow[] }
  | { state: 'not_available'; note: string }
  | { state: 'error'; message: string };

// No bank column here on purpose: bank, holder, branch and number appear only after "Open bank details".
const PAYOUT_COLUMNS = 'id, tutor_id, amount_rand, status, bank_details_changed_at, session_ids, requested_at, decided_at, paid_on, bank_reference, decision_comment';

export const bankChangedRecently = (changedAt: string | null, requestedAt: string): boolean => {
  if (!changedAt) return false;
  const gap = new Date(requestedAt).getTime() - new Date(changedAt).getTime();
  return Number.isFinite(gap) && gap < 48 * 3_600_000;
};

export async function fetchPayoutQueue(client: WalletAdminClient): Promise<PayoutQueue> {
  try {
    const open = await client.from('payout_requests').select(PAYOUT_COLUMNS).eq('status', 'requested').order('requested_at', { ascending: true }).limit(200);
    if (open.error) return failure(open.error);
    const decided = await client.from('payout_requests').select(PAYOUT_COLUMNS).in('status', ['paid', 'could_not_pay']).order('decided_at', { ascending: false }).limit(15);
    if (decided.error) return failure(decided.error);
    const all = [...rows(open.data), ...rows(decided.data)];
    const people = await fetchPeople(client, all.map((r) => str(r.tutor_id)));
    const map = (r: Record<string, unknown>): PayoutRow => ({
      id: str(r.id), tutorId: str(r.tutor_id), tutorName: personName(people, str(r.tutor_id)), amountRand: int(r.amount_rand), status: str(r.status),
      requestedAt: str(r.requested_at), sessionCount: Array.isArray(r.session_ids) ? r.session_ids.length : 0,
      bankChangedRecently: bankChangedRecently(strOrNull(r.bank_details_changed_at), str(r.requested_at)),
      decidedAt: strOrNull(r.decided_at), paidOn: strOrNull(r.paid_on), bankReference: strOrNull(r.bank_reference), comment: strOrNull(r.decision_comment),
    });
    return { state: 'ok', requested: rows(open.data).map(map), recent: rows(decided.data).map(map) };
  } catch (e) {
    return { state: 'error', message: walletErrorMessage(e) };
  }
}

export interface BankDetails { bankName: string; accountHolder: string; branchCode: string; accountNumber: string; amountRand: number; status: string }
// Every opening writes one audit line in the database. The details live only in the screen's state; they are not saved anywhere here.
export async function openBankDetails(client: WalletAdminClient, payoutId: string): Promise<BankDetails> {
  const { data, error } = await client.rpc('admin_open_bank_details', { p_payout: payoutId });
  if (error) throw new Error(walletErrorMessage(error));
  const d = (data ?? {}) as Record<string, unknown>;
  return { bankName: str(d.bank_name), accountHolder: str(d.account_holder), branchCode: str(d.branch_code), accountNumber: str(d.account_number), amountRand: int(d.amount_rand), status: str(d.status) };
}

export function checkPaid(reference: string, paidOn: string, today = todayIsoSast()): Checked<{ reference: string | null; paidOn: string | null }> {
  const ref = reference.trim();
  if (ref.length > 100) return { ok: false, error: 'The bank reference is too long (100 characters at most).' };
  if (paidOn && !/^\d{4}-\d{2}-\d{2}$/.test(paidOn)) return { ok: false, error: 'Give the date the money was sent.' };
  if (paidOn && paidOn > today) return { ok: false, error: 'The date paid cannot be in the future.' };
  return { ok: true, reference: ref || null, paidOn: paidOn || null };
}
export const paidConfirmText = (tutorName: string, amount: number): string => `Mark ${rand0(amount)} as paid to ${tutorName}? Only do this after the money has left the bank account.`;
export const markPayoutPaid = (client: WalletAdminClient, payoutId: string, reference: string | null, paidOn: string | null) =>
  decide(client, 'admin_mark_payout_paid', { p_payout: payoutId, p_bank_reference: reference, p_paid_on: paidOn });
export const markPayoutCannotPay = (client: WalletAdminClient, payoutId: string, comment: string) =>
  decide(client, 'admin_mark_payout_cannot_pay', { p_payout: payoutId, p_comment: comment });
export function checkCannotPay(comment: string): Checked<{ comment: string }> {
  const note = comment.trim();
  if (note.length < 3) return { ok: false, error: 'Write a comment: the tutor will read it.' };
  if (note.length > 1000) return { ok: false, error: 'The comment is too long (1000 characters at most).' };
  return { ok: true, comment: note };
}

// ---- 3. wallets --------------------------------------------------------------------------------------------------------------------------------
export interface WalletTotals {
  walletCount: number;
  availableRand: number;
  heldRand: number;
  // everything in wallets (learners' and tutors')
  inWalletsRand: number;
  tutorWalletsRand: number;
  bookedSessions: number;
  bookedTutorShareRand: number;
  // the figure to always find in the bank for other people
  heldForOthersRand: number;
  topupsWaiting: number;
  proofSent: number;
  payoutsRequested: number;
  payoutsRequestedRand: number;
  oldestProofSentAt: string | null;
  oldestPayoutRequestedAt: string | null;
}
export type TotalsResult = { state: 'ok'; totals: WalletTotals } | { state: 'not_available'; note: string } | { state: 'error'; message: string };

export function parseTotals(data: unknown): WalletTotals {
  const d = (data ?? {}) as Record<string, unknown>;
  return {
    walletCount: int(d.wallets), availableRand: int(d.available_rand), heldRand: int(d.held_rand), inWalletsRand: int(d.total_rand),
    tutorWalletsRand: int(d.tutor_wallets_rand), bookedSessions: int(d.booked_sessions), bookedTutorShareRand: int(d.booked_tutor_share_rand),
    // Before the booking migration the database has no held_for_others figure: fall back to what is in wallets.
    heldForOthersRand: d.held_for_others_rand == null ? int(d.total_rand) : int(d.held_for_others_rand),
    topupsWaiting: int(d.topups_waiting), proofSent: int(d.topups_proof_sent), payoutsRequested: int(d.payouts_requested),
    payoutsRequestedRand: int(d.payouts_requested_rand), oldestProofSentAt: strOrNull(d.oldest_proof_sent_at), oldestPayoutRequestedAt: strOrNull(d.oldest_payout_requested_at),
  };
}
export async function fetchTotals(client: WalletAdminClient): Promise<TotalsResult> {
  try {
    const { data, error } = await client.rpc('wallet_totals', {});
    if (error) return failure(error);
    return { state: 'ok', totals: parseTotals(data) };
  } catch (e) {
    return { state: 'error', message: walletErrorMessage(e) };
  }
}

export interface BalanceCheck {
  checked: number;
  mismatchCount: number;
  mismatches: { profileId: string; storedAvailable: number; ledgerAvailable: number; storedHeld: number; ledgerHeld: number; brokenLinks: number }[];
  checkedAt: string | null;
}
export async function runBalanceCheck(client: WalletAdminClient): Promise<BalanceCheck> {
  const { data, error } = await client.rpc('admin_wallet_balance_check', {});
  if (error) throw new Error(walletErrorMessage(error));
  const d = (data ?? {}) as Record<string, unknown>;
  return {
    checked: int(d.checked), mismatchCount: int(d.mismatch_count), checkedAt: strOrNull(d.checked_at),
    mismatches: rows(d.mismatches).map((m) => ({
      profileId: str(m.profile_id), storedAvailable: int(m.stored_available), ledgerAvailable: int(m.ledger_available),
      storedHeld: int(m.stored_held), ledgerHeld: int(m.ledger_held), brokenLinks: int(m.broken_links),
    })),
  };
}
export const balanceCheckSentence = (c: BalanceCheck): string =>
  c.mismatchCount === 0
    ? `All ${c.checked} wallet${c.checked === 1 ? '' : 's'} add up to their ledgers.`
    : `${c.mismatchCount} of ${c.checked} wallet${c.checked === 1 ? '' : 's'} do not add up. Do not adjust anything until you know why.`;

export interface WalletListRow { profileId: string; name: string; role: string | null; availableRand: number; heldRand: number; hasWallet: boolean }
export type WalletList = { state: 'ok'; wallets: WalletListRow[] } | { state: 'not_available'; note: string } | { state: 'error'; message: string };

// No search text: the biggest wallets. With a name or email: the people found, with their wallet (or "no wallet yet").
export async function fetchWalletList(client: WalletAdminClient, term = ''): Promise<WalletList> {
  try {
    const search = term.trim();
    let ids: string[] | null = null;
    const found = new Map<string, Person>();
    if (search) {
      const people = await client.rpc('admin_search_profiles', { p_term: search });
      if (people.error) return { state: 'error', message: walletErrorMessage(people.error, 'The search did not work.') };
      for (const p of rows(people.data).slice(0, 20)) found.set(str(p.id), { name: str(p.full_name) || 'Unknown', role: strOrNull(p.role) });
      ids = [...found.keys()];
      if (ids.length === 0) return { state: 'ok', wallets: [] };
    }
    let query = client.from('wallets').select('profile_id, available_rand, held_rand').order('available_rand', { ascending: false }).limit(50);
    if (ids) query = client.from('wallets').select('profile_id, available_rand, held_rand').in('profile_id', ids);
    const result = await query;
    if (result.error) return failure(result.error);
    const walletRows = rows(result.data);
    const people = ids ? found : await fetchPeople(client, walletRows.map((r) => str(r.profile_id)));
    const byId = new Map(walletRows.map((r) => [str(r.profile_id), r]));
    const listed = ids ?? walletRows.map((r) => str(r.profile_id));
    return {
      state: 'ok',
      wallets: listed.map((id) => ({
        profileId: id, name: personName(people, id), role: people.get(id)?.role ?? null,
        availableRand: int(byId.get(id)?.available_rand), heldRand: int(byId.get(id)?.held_rand), hasWallet: byId.has(id),
      })),
    };
  } catch (e) {
    return { state: 'error', message: walletErrorMessage(e) };
  }
}

export interface LedgerLine { id: string; kind: string; availableDelta: number; heldDelta: number; availableAfter: number; heldAfter: number; note: string | null; createdAt: string }
export interface WalletDetail { ledger: LedgerLine[]; topups: TopupRow[]; payouts: PayoutRow[] }

export const LEDGER_KIND_LABELS: Record<string, string> = {
  topup: 'Top-up added', hold: 'Put on hold for a request', release: 'Hold returned', charge: 'Paid for a session', refund: 'Refund as credit',
  session_credit: 'Session earnings credited', payout_hold: 'Payout requested', payout_paid: 'Payout paid', payout_release: 'Payout could not be paid, money returned',
  adjustment: 'Adjusted by hand',
};
export const ledgerKindLabel = (kind: string): string => LEDGER_KIND_LABELS[kind] ?? kind;

// One person's last lines, top-ups and payouts. Each part is read on its own: a failing part is left out, the others still show.
export async function fetchWalletDetail(client: WalletAdminClient, profileId: string): Promise<WalletDetail> {
  const safe = async (build: () => PromiseLike<DbResult>): Promise<Record<string, unknown>[]> => {
    try {
      const r = await build();
      return r.error ? [] : rows(r.data);
    } catch {
      return [];
    }
  };
  const [ledger, topups, payouts] = await Promise.all([
    safe(() => client.from('wallet_ledger').select('id, kind, available_delta, held_delta, available_after, held_after, note, created_at').eq('profile_id', profileId).order('seq', { ascending: false }).limit(15)),
    safe(() => client.from('wallet_topups').select(TOPUP_COLUMNS).eq('profile_id', profileId).order('created_at', { ascending: false }).limit(10)),
    safe(() => client.from('payout_requests').select(PAYOUT_COLUMNS).eq('tutor_id', profileId).order('requested_at', { ascending: false }).limit(10)),
  ]);
  return {
    ledger: ledger.map((r) => ({
      id: str(r.id), kind: str(r.kind), availableDelta: int(r.available_delta), heldDelta: int(r.held_delta), availableAfter: int(r.available_after),
      heldAfter: int(r.held_after), note: strOrNull(r.note), createdAt: str(r.created_at),
    })),
    topups: topups.map((r) => ({
      id: str(r.id), payerId: profileId, payerName: '', payerIsParent: null, reference: str(r.reference), claimedRand: int(r.amount_rand), status: str(r.status),
      proofPath: null, proofSentAt: strOrNull(r.proof_attached_at), createdAt: str(r.created_at), receivedRand: r.received_rand == null ? null : int(r.received_rand),
      decidedAt: strOrNull(r.decided_at), comment: strOrNull(r.decision_comment),
    })),
    payouts: payouts.map((r) => ({
      id: str(r.id), tutorId: profileId, tutorName: '', amountRand: int(r.amount_rand), status: str(r.status), requestedAt: str(r.requested_at),
      sessionCount: Array.isArray(r.session_ids) ? r.session_ids.length : 0, bankChangedRecently: false, decidedAt: strOrNull(r.decided_at),
      paidOn: strOrNull(r.paid_on), bankReference: strOrNull(r.bank_reference), comment: strOrNull(r.decision_comment),
    })),
  };
}
export const ledgerAmountText = (l: Pick<LedgerLine, 'availableDelta' | 'heldDelta'>): string => {
  const sign = (n: number) => (n > 0 ? `+${rand0(n)}` : rand0(n));
  const parts: string[] = [];
  if (l.availableDelta !== 0) parts.push(`${sign(l.availableDelta)} available`);
  if (l.heldDelta !== 0) parts.push(`${sign(l.heldDelta)} on hold`);
  return parts.join(', ');
};

// "Adjust wallet" (super admin only): a NEW ledger line, a written reason, never below zero; the key makes a double click post once.
export const ADJUST_MAX_RAND = 100000;
export function checkAdjustment(direction: 'add' | 'remove', amountText: string, reason: string): Checked<{ amount: number; reason: string }> {
  const text = amountText.trim();
  if (!/^[0-9]{1,6}$/.test(text) || Number(text) < 1 || Number(text) > ADJUST_MAX_RAND) return { ok: false, error: `Give the amount in whole rands, from 1 to ${ADJUST_MAX_RAND}.` };
  const why = reason.trim();
  if (why.length < 5) return { ok: false, error: 'Write the reason (at least 5 characters). It is kept with the adjustment.' };
  if (why.length > 500) return { ok: false, error: 'The reason is too long (500 characters at most).' };
  return { ok: true, amount: direction === 'remove' ? -Number(text) : Number(text), reason: why };
}
export const adjustConfirmText = (name: string, amount: number): string =>
  amount > 0 ? `Add ${rand0(amount)} to ${name}'s wallet? They will be told.` : `Take ${rand0(-amount)} out of ${name}'s wallet? They will be told.`;
export const newAdjustKey = (): string => globalThis.crypto.randomUUID();
export async function adjustWallet(client: WalletAdminClient, profileId: string, amount: number, reason: string, key: string): Promise<Decision> {
  return decide(client, 'admin_adjust_wallet', { p_profile: profileId, p_amount: amount, p_reason: reason, p_key: key });
}

// ---- 4. wallet settings ------------------------------------------------------------------------------------------------------------------------
export const SWITCH_KEY = 'wallet_payments_enabled';
export const FREE_KEY = 'free_sessions_enabled';
export const BANK_KEYS = [
  { key: 'wallet_bank_name', label: 'Bank', required: true },
  { key: 'wallet_bank_account_holder', label: 'Account holder', required: true },
  { key: 'wallet_bank_account_number', label: 'Account number', required: true },
  { key: 'wallet_bank_branch_code', label: 'Branch code', required: true },
  { key: 'wallet_bank_account_type', label: 'Account type (optional, for example Cheque)', required: false },
] as const;
export const LIMIT_KEYS = [
  { key: 'wallet_topup_min_rand', label: 'Smallest transfer (R)', group: 'amount' },
  { key: 'wallet_topup_max_rand', label: 'Largest transfer (R)', group: 'amount' },
  { key: 'wallet_balance_cap_rand', label: 'Most a wallet may hold (R)', group: 'amount' },
  { key: 'wallet_topup_max_waiting', label: 'Top-ups one person may have waiting for proof', group: 'count' },
  { key: 'wallet_topup_max_per_day', label: 'Top-ups one person may start in 24 hours', group: 'count' },
  { key: 'wallet_topup_stale_days', label: 'Days before a top-up with no proof is cancelled', group: 'count' },
  { key: 'wallet_proof_keep_days_successful', label: 'Days a proof is kept after a successful transfer', group: 'keep' },
  { key: 'wallet_proof_keep_days_unsuccessful', label: 'Days a proof is kept after an unsuccessful transfer', group: 'keep' },
] as const;
export const SETTING_KEYS: string[] = [SWITCH_KEY, FREE_KEY, ...BANK_KEYS.map((b) => b.key), ...LIMIT_KEYS.map((l) => l.key)];

export const SWITCH_WARNING =
  'The wallet opens for learners and tutors only when this switch is ON and free sessions are OFF. While free sessions are ON they win, and the wallet stays hidden. Turn it on only after Tutorlage\'s bank details below are filled in and you have tested a R50 transfer yourself.';

export interface WalletSettingsValues {
  enabled: boolean;
  // null when the free-sessions setting could not be read
  freeOn: boolean | null;
  bank: Record<string, string>;
  limits: Record<string, string>;
  descriptions: Record<string, string | null>;
  // false when the wallet keys are not in this database at all
  present: boolean;
}
type SettingRow = { settingKey: string; settingValue: unknown; description: string | null };

const isTrue = (v: unknown) => v === true || String(v).toLowerCase() === 'true';
export function readWalletSettings(settings: SettingRow[]): WalletSettingsValues {
  const by = new Map(settings.map((s) => [s.settingKey, s]));
  const text = (key: string) => (by.has(key) && by.get(key)!.settingValue != null ? String(by.get(key)!.settingValue) : '');
  return {
    present: by.has(SWITCH_KEY),
    enabled: isTrue(by.get(SWITCH_KEY)?.settingValue),
    freeOn: by.has(FREE_KEY) ? isTrue(by.get(FREE_KEY)?.settingValue) : null,
    bank: Object.fromEntries(BANK_KEYS.map((b) => [b.key, text(b.key)])),
    limits: Object.fromEntries(LIMIT_KEYS.map((l) => [l.key, text(l.key)])),
    descriptions: Object.fromEntries(SETTING_KEYS.map((k) => [k, by.get(k)?.description ?? null])),
  };
}
export type SettingsLoad = { state: 'ok'; values: WalletSettingsValues } | { state: 'not_available'; note: string } | { state: 'error'; message: string };
export async function fetchWalletSettings(client: WalletAdminClient): Promise<SettingsLoad> {
  try {
    const { data, error } = await client.from('system_settings').select('setting_key, setting_value, description').in('setting_key', SETTING_KEYS);
    if (error) return failure(error);
    const values = readWalletSettings(rows(data).map((r) => ({ settingKey: str(r.setting_key), settingValue: r.setting_value, description: strOrNull(r.description) })));
    return values.present ? { state: 'ok', values } : { state: 'not_available', note: WALLET_NOT_AVAILABLE };
  } catch (e) {
    return { state: 'error', message: walletErrorMessage(e) };
  }
}

// Is the wallet visible to learners and tutors right now, and what is still missing before the switch should go on?
export function switchSummary(v: Pick<WalletSettingsValues, 'enabled' | 'freeOn' | 'bank'>): { state: string; opens: boolean; line: string; missing: string[] } {
  const missing = BANK_KEYS.filter((b) => b.required && !v.bank[b.key]?.trim()).map((b) => b.label);
  const opens = v.enabled && v.freeOn === false;
  const line = !v.enabled
    ? 'The wallet is OFF. Learners and tutors do not see it.'
    : v.freeOn === false
      ? 'The wallet is ON and open to learners and tutors.'
      : v.freeOn === true
        ? 'The switch is ON, but free sessions are also ON, so the wallet is still hidden.'
        : 'The switch is ON. Free sessions could not be read, so check them in System Settings.';
  return { state: v.enabled ? 'ON' : 'OFF', opens, line, missing };
}

export type LimitErrors = Record<string, string>;
// The same rules as the database guard (wallet_settings_guard), so the person is told before the database refuses.
export function checkLimits(values: Record<string, string>): LimitErrors {
  const errors: LimitErrors = {};
  for (const { key, label } of LIMIT_KEYS) {
    const v = (values[key] ?? '').trim();
    if (!/^[0-9]{1,7}$/.test(v) || Number(v) < 1) errors[key] = `${label}: a whole number of 1 or more.`;
  }
  const n = (k: string) => Number(values[k]);
  if (!errors.wallet_topup_min_rand && !errors.wallet_topup_max_rand && n('wallet_topup_min_rand') > n('wallet_topup_max_rand')) errors.wallet_topup_min_rand = 'The smallest transfer cannot be more than the largest.';
  if (!errors.wallet_topup_max_rand && !errors.wallet_balance_cap_rand && n('wallet_topup_max_rand') > n('wallet_balance_cap_rand')) errors.wallet_topup_max_rand = 'The largest transfer cannot be more than what a wallet may hold.';
  return errors;
}
export function checkBank(values: Record<string, string>): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const { key, label } of BANK_KEYS) {
    const v = (values[key] ?? '').trim();
    if (v.length > 120) errors[key] = `${label}: 120 characters at most.`;
  }
  const number = (values.wallet_bank_account_number ?? '').replace(/[\s-]/g, '');
  if (number && !/^[0-9]{6,16}$/.test(number)) errors.wallet_bank_account_number = 'The account number is 6 to 16 digits.';
  const branch = (values.wallet_bank_branch_code ?? '').replace(/[\s-]/g, '');
  if (branch && !/^[0-9]{6}$/.test(branch)) errors.wallet_bank_branch_code = 'The branch code is 6 digits.';
  return errors;
}

export interface SettingWrite { key: string; value: string | number | boolean }
// What to save: only what changed. The limits go in an order that keeps "smallest <= largest <= wallet cap" true after every single write,
// because the database checks each write against the values it holds at that moment.
export function planSettingSaves(current: WalletSettingsValues, next: { bank: Record<string, string>; limits: Record<string, string> }): SettingWrite[] {
  const writes: SettingWrite[] = [];
  for (const { key } of BANK_KEYS) {
    const typed = (next.bank[key] ?? '').trim();
    // Spaces and hyphens in a number are only for reading: store the digits.
    const wanted = key === 'wallet_bank_account_number' || key === 'wallet_bank_branch_code' ? typed.replace(/[\s-]/g, '') : typed;
    if (wanted !== current.bank[key]) writes.push({ key, value: wanted });
  }
  const changed = LIMIT_KEYS.filter(({ key }) => (next.limits[key] ?? '').trim() !== current.limits[key]).map(({ key }) => key);
  const amounts = changed.filter((k) => ['wallet_topup_min_rand', 'wallet_topup_max_rand', 'wallet_balance_cap_rand'].includes(k));
  const others = changed.filter((k) => !amounts.includes(k));
  writes.push(...orderAmountSaves(current.limits, next.limits, amounts).map((key) => ({ key, value: Number(next.limits[key].trim()) })));
  writes.push(...others.map((key) => ({ key, value: Number(next.limits[key].trim()) })));
  return writes;
}
function orderAmountSaves(from: Record<string, string>, to: Record<string, string>, keys: string[]): string[] {
  const valid = (s: Record<string, number>) => s.wallet_topup_min_rand <= s.wallet_topup_max_rand && s.wallet_topup_max_rand <= s.wallet_balance_cap_rand;
  const start = (): Record<string, number> => ({ wallet_topup_min_rand: Number(from.wallet_topup_min_rand), wallet_topup_max_rand: Number(from.wallet_topup_max_rand), wallet_balance_cap_rand: Number(from.wallet_balance_cap_rand) });
  const orders = permutations(keys);
  for (const order of orders) {
    const state = start();
    let ok = true;
    for (const key of order) {
      state[key] = Number(to[key].trim());
      if (!valid(state)) { ok = false; break; }
    }
    if (ok) return order;
  }
  return keys;
}
function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items];
  return items.flatMap((item, i) => permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [item, ...rest]));
}

// Writes go through the System Settings write path the admin app already has (queries.ts upsertSystemSetting, which also writes the audit line).
export type SettingWriter = (key: string, value: unknown, description: string | null) => Promise<void>;
export async function saveSettingWrites(write: SettingWriter, writes: SettingWrite[], descriptions: Record<string, string | null>): Promise<{ saved: string[]; failed: { key: string; message: string } | null }> {
  const saved: string[] = [];
  for (const w of writes) {
    try {
      await write(w.key, w.value, descriptions[w.key] ?? null);
      saved.push(w.key);
    } catch (e) {
      return { saved, failed: { key: w.key, message: walletErrorMessage(e, 'Could not save that setting.') } };
    }
  }
  return { saved, failed: null };
}
export const settingLabel = (key: string): string =>
  [...BANK_KEYS, ...LIMIT_KEYS].find((s) => s.key === key)?.label.replace(/ \(optional.*$/, '') ?? (key === SWITCH_KEY ? 'The wallet switch' : key);
