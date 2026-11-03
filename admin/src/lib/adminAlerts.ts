// BACKGROUND ALERTS for the installed admin app (wallet phase 5; CEO, 2 Nov 2026: "notifications should appear at any moment a notification is set to appear
// ... even if the admin hasnt opened the admin app yet, so basically it should run in the background"). Plan: Drake/programmer/ops-errors-notification-proposal-2026-11-01.md.
//
// The installed app starts with Windows, lives in the tray, and every 2 minutes asks the database the same questions the admin pages already ask, with the
// admin's own sign-in (no database change, no new permission). A WATCHER is one such question: "which tutors / disputes / proofs ... are waiting right now?".
// It answers with a list of ids. The ids not announced yet are NEW, and a new one raises one Windows notification. What was announced is remembered on this PC
// (per admin), so nothing is announced twice, not even after a restart. Pure on purpose (no Supabase import, no React): the client, the clock, the store and the
// way of showing a notification are handed in, so scripts/dev/admin-alerts-test.ts can check every rule with a fake clock and fake answers.
//
// Rules (the CEO's and the proposal's):
//  - ROLE-AWARE: an admin gets a watcher only if their role may open that page (the same `roles` as the menu in AdminLayout; the database decides what it returns).
//  - PRIVATE: a notification carries a count and a page name only: no name, no document, no amount, no reference, no bank detail, no error text.
//  - NO REPEATS: a watcher remembers the ids it has announced; one notification per new item, never the same item twice.
//  - QUIET: if more than 3 watchers have news, or the PC was off / asleep / muted for a while, or more than 6 toasts were shown in the last hour, the news is
//    folded into ONE "N new" toast. The very first round on a PC is one toast too ("waiting now: ...").
//  - MUTE and per-watcher switches: while muted nothing is read and nothing is remembered, so on unmute what arrived is announced once, as a catch-up.
import type { AdminRole } from '../types';

export type WatcherId =
  | 'wallet_mismatch' | 'wallet_bank_changed' | 'wallet_topup' | 'wallet_payout'
  | 'tutor_verification' | 'dispute' | 'closure_stuck' | 'payment_attention' | 'subject_approval' | 'school_result' | 'tier1_record' | 'new_error' | 'error_spike';

// The admin client reduced to what the watchers use, so a test can hand in a fake. `from` is the PostgREST query builder.
export interface AlertClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from(table: string): any;
  auth: { getSession(): PromiseLike<{ data: { session: unknown | null } }> };
}

export interface Toast { title: string; body: string; route: string; tag: string }

export const CHECK_EVERY_MS = 120_000;          // the check every 2 minutes
export const CATCH_UP_AFTER_MS = 360_000;       // three missed checks: the PC was off, asleep, muted or offline
export const MAX_SEPARATE_TOASTS = 3;           // more watchers than this with news at once: one "N new" toast
export const MAX_TOASTS_PER_HOUR = 6;           // quiet limit across rounds
export const SEEN_CAP = 1000;                   // as many ids as a read may return, so a long list never repeats itself
export const RECENT_DAYS = 7;                   // errors and wallet notices older than this are not "new" on a first look
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
export const SPIKE_FROM = 16;                   // a known error's count must reach this before it can count as a spike
export const SPIKE_WINDOW_MS = 2 * HOUR_MS;     // and it must have been reported again within this long

export interface WatcherContext { adminId: string; now: number }
export interface WatcherDef {
  id: WatcherId;
  label: string;                                // the switch on the Notifications page
  help: string;                                 // one line under it
  roles: AdminRole[];
  route: string;                                // the page a click opens
  title: string;                                // the toast title
  waiting(n: number): string;                   // "3 tutors are waiting to be verified"
  short(n: number): string;                     // "3 tutors to verify" (for the one-toast summaries)
  read(client: AlertClient, ctx: WatcherContext): Promise<string[]>;   // ids waiting now; throws when the question fails
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const sinceIso = (now: number) => new Date(now - RECENT_DAYS * DAY_MS).toISOString();
const MONEY: AdminRole[] = ['finance_manager', 'super_admin'];
const VERIFY: AdminRole[] = ['verification_officer', 'super_admin'];

async function idsOf(query: PromiseLike<{ data: unknown; error: unknown }>, key = 'id'): Promise<string[]> {
  const { data, error } = await query;
  if (error) throw error;
  const out = new Set<string>();
  if (Array.isArray(data)) for (const row of data as Record<string, unknown>[]) if (row && row[key] != null) out.add(String(row[key]));
  return [...out];
}

// Listed in the order a toast summary names them: money first, then people, then the quiet kinds.
export const WATCHERS: WatcherDef[] = [
  {
    id: 'wallet_mismatch', label: 'A wallet does not add up', help: 'The daily balance check found a wallet whose money does not match its ledger.',
    roles: MONEY, route: '/payouts?wallet=wallets', title: 'Wallet balance check',
    waiting: (n) => (n === 1 ? 'The balance check found a wallet that does not add up' : `The balance check found wallets that do not add up (${n} alerts)`),
    short: (n) => (n === 1 ? 'a wallet that does not add up' : `${n} wallet alerts`),
    read: (c, x) => idsOf(c.from('notifications').select('id').eq('profile_id', x.adminId).eq('type', 'wallet_mismatch').is('read_at', null).gte('created_at', sinceIso(x.now)).limit(100)),
  },
  {
    id: 'wallet_bank_changed', label: "Tutorlage's bank details were changed", help: 'Someone saved new bank details for learners to pay into.',
    roles: MONEY, route: '/payouts?wallet=settings', title: 'Bank details changed',
    waiting: (n) => (n === 1 ? "Tutorlage's bank details were changed" : `Tutorlage's bank details were changed ${n} times`),
    short: (n) => (n === 1 ? 'bank details changed' : `bank details changed ${n} times`),
    read: (c, x) => idsOf(c.from('notifications').select('id').eq('profile_id', x.adminId).eq('type', 'wallet_bank_changed').is('read_at', null).gte('created_at', sinceIso(x.now)).limit(100)),
  },
  {
    id: 'wallet_topup', label: 'A payment proof is waiting', help: 'A learner sent the proof of a bank transfer to check.',
    roles: MONEY, route: '/payouts?wallet=topups', title: 'Payment proof',
    waiting: (n) => (n === 1 ? '1 payment proof is waiting' : `${n} payment proofs are waiting`),
    short: (n) => plural(n, 'payment proof', 'payment proofs'),
    read: (c) => idsOf(c.from('wallet_topups').select('id').eq('status', 'proof_sent').limit(SEEN_CAP)),
  },
  {
    id: 'wallet_payout', label: 'A payout was requested', help: 'A tutor asked to be paid; the 24-hour promise starts.',
    roles: MONEY, route: '/payouts?wallet=payouts', title: 'Payout requested',
    waiting: (n) => (n === 1 ? '1 payout is waiting to be paid' : `${n} payouts are waiting to be paid`),
    short: (n) => plural(n, 'payout to pay', 'payouts to pay'),
    read: (c) => idsOf(c.from('payout_requests').select('id').eq('status', 'requested').limit(SEEN_CAP)),
  },
  {
    id: 'tutor_verification', label: 'A tutor needs verification', help: 'A tutor has a document waiting for review.',
    roles: VERIFY, route: '/verification', title: 'Tutor verification',
    waiting: (n) => (n === 1 ? '1 tutor is waiting to be verified' : `${n} tutors are waiting to be verified`),
    short: (n) => plural(n, 'tutor to verify', 'tutors to verify'),
    // Per tutor (not per document): a tutor with three documents waiting is one tutor waiting, as on the Verification page.
    read: (c) => idsOf(c.from('tutor_verification_documents').select('tutor_id').in('status', ['pending', 'under_review']).limit(SEEN_CAP), 'tutor_id'),
  },
  {
    id: 'dispute', label: 'A dispute is opened', help: 'A learner or tutor reported a problem with a session.',
    roles: ['support_agent', 'super_admin'], route: '/disputes', title: 'Dispute',
    waiting: (n) => (n === 1 ? '1 dispute is waiting for a decision' : `${n} disputes are waiting for a decision`),
    short: (n) => plural(n, 'dispute', 'disputes'),
    read: (c) => idsOf(c.from('platform_disputes').select('id').eq('status', 'open').limit(SEEN_CAP)),
  },
  {
    id: 'closure_stuck', label: 'An account closure needs a person', help: 'A closure step failed five times, or a closure is past its 90-day limit.',
    // The same roles as the "Account closures" menu entry. The database tells every active admin when a step is given up on or a closure is overdue (notify_active_admins),
    // so this reads the admin's own unread notices of those two kinds, like the wallet notices above.
    roles: ['support_agent', 'verification_officer', 'super_admin'], route: '/account-closures', title: 'Account closure',
    waiting: (n) => (n === 1 ? '1 account closure needs a person' : `${n} account closures need a person`),
    short: (n) => plural(n, 'closure to check', 'closures to check'),
    read: (c, x) => idsOf(c.from('notifications').select('id').eq('profile_id', x.adminId).in('type', ['closure_step_failed', 'closure_overdue']).is('read_at', null).gte('created_at', sinceIso(x.now)).limit(100)),
  },
  {
    id: 'payment_attention', label: 'A card payment needs a person', help: 'A refund Paystack could not finish, or an acceptance that could not be settled.',
    roles: MONEY, route: '/payouts', title: 'Card payment',
    waiting: (n) => (n === 1 ? '1 card payment needs a person' : `${n} card payments need a person`),
    short: (n) => plural(n, 'card payment to check', 'card payments to check'),
    // The same filter as the "Needs a person" list on the Payments page (fetchPaymentsNeedingAttention).
    read: (c) => idsOf(c.from('session_requests').select('id')
      .or('payment_status.in.(refund_needs_attention,refund_failed),charge_check_request_id.eq.-1,card_check_refund_status.like."not refunded*"').limit(200)),
  },
  {
    id: 'subject_approval', label: 'A subject needs approval', help: 'A tutor declared a subject that waits for an approval.',
    roles: VERIFY, route: '/subject-approvals', title: 'Subject approval',
    waiting: (n) => (n === 1 ? '1 subject is waiting for approval' : `${n} subjects are waiting for approval`),
    short: (n) => plural(n, 'subject to approve', 'subjects to approve'),
    // Waiting = pending, under review, or no status yet (competencyStatus() on the Subject Approvals page reads those as waiting).
    read: (c) => idsOf(c.from('tutor_subject_competencies').select('id').or('verification_status.is.null,verification_status.in.(pending,under_review)').limit(SEEN_CAP)),
  },
  {
    id: 'school_result', label: 'A school result is waiting', help: 'A parent added a mark that waits to be checked against its document.',
    roles: VERIFY, route: '/school-results', title: 'School result',
    waiting: (n) => (n === 1 ? '1 school result is waiting to be checked' : `${n} school results are waiting to be checked`),
    short: (n) => plural(n, 'school result to check', 'school results to check'),
    read: (c) => idsOf(c.from('school_results').select('id').eq('status', 'pending').limit(SEEN_CAP)),
  },
  {
    id: 'tier1_record', label: 'A Tier 1 record is waiting', help: 'A tutor added a Tier 1 academic record that waits to be checked.',
    roles: VERIFY, route: '/tier1', title: 'Tier 1 record',
    waiting: (n) => (n === 1 ? '1 Tier 1 record is waiting to be checked' : `${n} Tier 1 records are waiting to be checked`),
    short: (n) => plural(n, 'Tier 1 record to check', 'Tier 1 records to check'),
    read: (c) => idsOf(c.from('tier1_academic_records').select('id').eq('status', 'pending').limit(SEEN_CAP)),
  },
  {
    id: 'new_error', label: 'A new kind of error', help: 'The public app reported an error it had not reported before (shown for 7 days).',
    roles: ['super_admin'], route: '/errors', title: 'New error',
    waiting: (n) => (n === 1 ? '1 new kind of error was reported' : `${n} new kinds of error were reported`),
    short: (n) => plural(n, 'new kind of error', 'new kinds of error'),
    // client_errors keeps ONE row per kind (repeats only raise `occurrences`), so a new row is a kind not seen before. A kind purged after 30 quiet days that returns is new again.
    read: (c, x) => idsOf(c.from('client_errors').select('id').gte('first_seen', sinceIso(x.now)).order('first_seen', { ascending: false }).limit(200)),
  },
  {
    id: 'error_spike', label: 'A known error is repeating', help: 'An error that is not new keeps happening: its count passes 16, 32, 64 and so on while it is still being reported.',
    roles: ['super_admin'], route: '/errors', title: 'Error repeating',
    waiting: (n) => (n === 1 ? '1 known error is repeating a lot' : `${n} known errors are repeating a lot`),
    short: (n) => plural(n, 'repeating error', 'repeating errors'),
    // A SPIKE is a known kind (first seen over a day ago, so not a "new error") that was reported again in the last 2 hours and whose running count (`occurrences`) has passed
    // a doubling mark: 16, 32, 64 ... The id carries the mark, so each doubling is announced once and a chronic error with a huge count does not shout every round.
    read: async (c, x) => {
      const { data, error } = await c.from('client_errors').select('id, occurrences')
        .lt('first_seen', new Date(x.now - DAY_MS).toISOString()).gte('last_seen', new Date(x.now - SPIKE_WINDOW_MS).toISOString()).gte('occurrences', SPIKE_FROM)
        .order('last_seen', { ascending: false }).limit(200);
      if (error) throw error;
      const out = new Set<string>();
      if (Array.isArray(data)) for (const row of data as { id?: unknown; occurrences?: unknown }[]) {
        const n = Number(row?.occurrences);
        if (row?.id != null && Number.isFinite(n) && n >= SPIKE_FROM) out.add(`${String(row.id)}:${Math.floor(Math.log2(n))}`);
      }
      return [...out];
    },
  },
];
export const WATCHER_IDS: WatcherId[] = WATCHERS.map((w) => w.id);
export const watchersForRole = (role: AdminRole | null | undefined): WatcherDef[] => (role ? WATCHERS.filter((w) => w.roles.includes(role)) : []);

// ---- what a PC remembers --------------------------------------------------------------------------------------------------------------------------
export interface AlertState {
  v: 1;
  seen: Partial<Record<WatcherId, string[]>>;   // the ids already announced (= waiting at the last good look)
  lastCheckedAt: number | null;
  shown: number[];                               // when toasts were shown, for the hourly quiet limit
}
export interface AlertPrefs { disabled: WatcherId[] }
export interface AlertStore {
  loadState(adminId: string): AlertState;
  saveState(adminId: string, state: AlertState): void;
  loadPrefs(adminId: string): AlertPrefs;
  savePrefs(adminId: string, prefs: AlertPrefs): void;
}
export const emptyState = (): AlertState => ({ v: 1, seen: {}, lastCheckedAt: null, shown: [] });

interface StorageLike { getItem(key: string): string | null; setItem(key: string, value: string): void }
const stateKey = (adminId: string) => `tutorlage-admin-alerts-v1:${adminId}`;
const prefsKey = (adminId: string) => `tutorlage-admin-alert-prefs-v1:${adminId}`;

// The page's own storage (non-secret: ids and times only). Every read and write is guarded: if storage is blocked the alerts still run, they just
// cannot remember between restarts (the first round of the next start then names what is waiting, once).
export function storageAlertStore(storage: StorageLike | undefined): AlertStore {
  const read = (key: string): unknown => {
    try {
      const raw = storage?.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  };
  const write = (key: string, value: unknown) => {
    try {
      storage?.setItem(key, JSON.stringify(value));
    } catch {
      // blocked or full: carry on without remembering
    }
  };
  return {
    loadState(adminId) {
      const raw = read(stateKey(adminId)) as Partial<AlertState> | null;
      if (!raw || raw.v !== 1 || typeof raw.seen !== 'object' || raw.seen === null) return emptyState();
      const seen: AlertState['seen'] = {};
      for (const id of WATCHER_IDS) {
        const list = (raw.seen as Record<string, unknown>)[id];
        if (Array.isArray(list)) seen[id] = list.filter((x): x is string => typeof x === 'string').slice(0, SEEN_CAP);
      }
      return {
        v: 1, seen,
        lastCheckedAt: typeof raw.lastCheckedAt === 'number' && Number.isFinite(raw.lastCheckedAt) ? raw.lastCheckedAt : null,
        shown: Array.isArray(raw.shown) ? raw.shown.filter((x): x is number => typeof x === 'number').slice(-50) : [],
      };
    },
    saveState: (adminId, state) => write(stateKey(adminId), state),
    loadPrefs(adminId) {
      const raw = read(prefsKey(adminId)) as Partial<AlertPrefs> | null;
      const disabled = Array.isArray(raw?.disabled) ? (raw!.disabled as unknown[]).filter((x): x is WatcherId => WATCHER_IDS.includes(x as WatcherId)) : [];
      return { disabled };
    },
    savePrefs: (adminId, prefs) => write(prefsKey(adminId), prefs),
  };
}

// ---- words ----------------------------------------------------------------------------------------------------------------------------------------
const sastTime = (ms: number) => new Intl.DateTimeFormat('en-ZA', { timeZone: 'Africa/Johannesburg', hour: '2-digit', minute: '2-digit', hour12: false }).format(ms);
const sastDay = (ms: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit' }).format(ms);
// "14:10" when it was today, "2 Nov 14:10" otherwise (South African time, as the rest of the admin app).
export function sinceText(since: number, now: number): string {
  if (sastDay(since) === sastDay(now)) return sastTime(since);
  const day = new Intl.DateTimeFormat('en-ZA', { timeZone: 'Africa/Johannesburg', day: 'numeric', month: 'short' }).format(since);
  return `${day} ${sastTime(since)}`;
}
const clip = (s: string, max: number) => (s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`);

export const lapseToast = (): Toast => ({
  title: 'Tutorlage Admin: sign in again',
  body: 'Sign in to Tutorlage Admin to keep getting alerts.',
  route: '/login',
  tag: 'lapse',
});

export function isAuthError(e: unknown): boolean {
  const err = e as { status?: number; code?: string; message?: string } | null;
  if (!err) return false;
  return err.status === 401 || err.code === 'PGRST301' || /jwt (is )?(expired|invalid)|invalid jwt|not authenticated/i.test(err.message ?? '');
}

// ---- the sign-in that lapsed ----------------------------------------------------------------------------------------------------------------------
// If the stored sign-in stops working (password changed, admin switched off, a very long gap) the app cannot read anything. It says so ONCE, in one
// notification, instead of going quiet. `signedIn` = this PC had a working sign-in; `lapseAnnounced` = we already said it stopped.
export interface LinkState { signedIn: boolean; lapseAnnounced: boolean }
export type LinkEvent = 'session' | 'none' | 'manual_signout';
export function nextLink(prev: LinkState, event: LinkEvent): { link: LinkState; announce: boolean } {
  if (event === 'session') return { link: { signedIn: true, lapseAnnounced: false }, announce: false };
  if (event === 'manual_signout') return { link: { signedIn: false, lapseAnnounced: false }, announce: false };
  if (prev.signedIn && !prev.lapseAnnounced) return { link: { signedIn: true, lapseAnnounced: true }, announce: true };
  return { link: prev, announce: false };
}
const LINK_KEY = 'tutorlage-admin-alert-link-v1';
export function loadLink(storage: StorageLike | undefined): LinkState {
  try {
    const raw = JSON.parse(storage?.getItem(LINK_KEY) ?? 'null') as Partial<LinkState> | null;
    return { signedIn: raw?.signedIn === true, lapseAnnounced: raw?.lapseAnnounced === true };
  } catch {
    return { signedIn: false, lapseAnnounced: false };
  }
}
export function saveLink(storage: StorageLike | undefined, link: LinkState): void {
  try {
    storage?.setItem(LINK_KEY, JSON.stringify(link));
  } catch {
    // blocked or full
  }
}

// ---- one round ------------------------------------------------------------------------------------------------------------------------------------
export interface RoundDeps {
  client: AlertClient;
  adminId: string;
  role: AdminRole;
  now: () => number;
  store: AlertStore;
  show: (toast: Toast) => void | Promise<void>;
  isMuted: () => boolean | Promise<boolean>;
}
export interface RoundResult {
  skipped: null | 'muted' | 'no_session' | 'no_watchers';
  firstRun: boolean;
  catchUp: boolean;
  checked: WatcherId[];
  failed: WatcherId[];
  authFailed: boolean;
  toasts: Toast[];
}

export async function runAlertRound(deps: RoundDeps): Promise<RoundResult> {
  const result: RoundResult = { skipped: null, firstRun: false, catchUp: false, checked: [], failed: [], authFailed: false, toasts: [] };
  let muted = false;
  try {
    muted = await deps.isMuted();
  } catch {
    muted = false;
  }
  if (muted) return { ...result, skipped: 'muted' };

  let session: unknown = null;
  try {
    session = (await deps.client.auth.getSession()).data.session;
  } catch {
    session = null;
  }
  if (!session) return { ...result, skipped: 'no_session' };

  const prefs = deps.store.loadPrefs(deps.adminId);
  const active = watchersForRole(deps.role).filter((w) => !prefs.disabled.includes(w.id));
  if (active.length === 0) return { ...result, skipped: 'no_watchers' };

  const now = deps.now();
  const answers = await Promise.all(active.map(async (w) => {
    try {
      return { w, ids: await w.read(deps.client, { adminId: deps.adminId, now }), error: null as unknown };
    } catch (error) {
      return { w, ids: null as string[] | null, error };
    }
  }));
  const good = answers.filter((a) => a.ids !== null);
  result.failed = answers.filter((a) => a.ids === null).map((a) => a.w.id);
  result.authFailed = answers.some((a) => a.ids === null && isAuthError(a.error));
  // Nothing could be read (offline, signed out, database down): say nothing, remember nothing; the next round tries again.
  if (good.length === 0) return result;

  const state = deps.store.loadState(deps.adminId);
  result.firstRun = state.lastCheckedAt === null;
  result.catchUp = !result.firstRun && now - (state.lastCheckedAt as number) > CATCH_UP_AFTER_MS;

  const news: { w: WatcherDef; fresh: number; total: number }[] = [];
  for (const a of good) {
    const ids = a.ids as string[];
    const before = new Set(state.seen[a.w.id] ?? []);
    const fresh = ids.filter((id) => !before.has(id)).length;
    if (fresh > 0) news.push({ w: a.w, fresh, total: ids.length });
    state.seen[a.w.id] = ids.slice(0, SEEN_CAP);
    result.checked.push(a.w.id);
  }

  const since = state.lastCheckedAt;
  const recent = state.shown.filter((t) => now - t < HOUR_MS);
  const toasts: Toast[] = [];
  if (news.length > 0) {
    const combine = result.firstRun || result.catchUp || news.length > MAX_SEPARATE_TOASTS || recent.length + news.length > MAX_TOASTS_PER_HOUR;
    if (combine) {
      const list = news.map((n) => n.w.short(n.fresh)).join(', ');
      const totalNew = news.reduce((sum, n) => sum + n.fresh, 0);
      let title: string;
      let body: string;
      if (result.firstRun) {
        title = 'Tutorlage Admin will now alert you';
        body = `Waiting now: ${list}.`;
      } else if (result.catchUp) {
        title = 'Tutorlage Admin: while you were away';
        body = `Since ${sinceText(since as number, now)}: ${list}.`;
      } else {
        title = `${totalNew} new item${totalNew === 1 ? '' : 's'} need you`;
        body = `${list}.`;
      }
      toasts.push({ title, body: clip(body, 220), route: news[0].w.route, tag: 'summary' });
    } else {
      for (const n of news) {
        const extra = n.total > n.fresh ? ` (${n.total} waiting in all)` : '';
        toasts.push({ title: n.w.title, body: `${n.w.waiting(n.fresh)}${extra}.`, route: n.w.route, tag: `w:${n.w.id}` });
      }
    }
  }

  // Remember BEFORE showing: if the show fails or the app is killed, the same news is not announced twice (at most once, never twice).
  state.lastCheckedAt = now;
  state.shown = [...recent, ...toasts.map(() => now)];
  deps.store.saveState(deps.adminId, state);
  for (const t of toasts) {
    try {
      await deps.show(t);
    } catch {
      // a failed notification is not worth a crash; the item stays on its page
    }
  }
  result.toasts = toasts;
  return result;
}
