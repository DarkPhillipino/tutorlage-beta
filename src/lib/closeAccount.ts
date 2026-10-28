// Closing an account, as the person (and a guardian) sees it. The database half is migrations 20261021140000_close_account.sql and
// 20261021141000_close_account_auth_link.sql; the interface these screens use is Part 4 of Drake/programmer/reports/2026-10-21-close-account.md.
// Nothing here talks to the Worker or to Storage: the database does the cancelling, the refunds and the later deletion by itself.
// This file imports no Supabase client on purpose; the caller hands one in, so a test can hand in a fake.

export const CLOSE_WORD = 'CLOSE';

// The same wording the database sends everyone. A person who is held or in a dispute sees exactly this and nothing more (legal B5.4).
export const GENERIC_KEPT_LINE =
  'We must keep some records for longer, because the law or an open matter requires it. Privacy Policy §14 says which.';

export const CLOSE_COPY = {
  sectionTitle: 'Close my account',
  sectionLead: 'Closing stops your sign-in straight away. Your details are deleted within 30 days, and you can change your mind until then.',
  openButton: 'Close my account…',
  minorNote: 'Your parent or guardian looks after your account. If you would like it closed, please ask them.',
  closeLearnerButton: (name: string) => `Close ${name}'s account`,
  previewTitle: 'Before you close',
  previewTitleLearner: (name: string) => `Before you close ${name}'s account`,
  loading: 'Checking what closing would do…',
  householdLead: 'Closing your account also closes the account of each learner you look after:',
  noSessions: 'No upcoming sessions will be cancelled.',
  sessions: (n: number, role: string) =>
    role === 'tutor'
      ? `${n} upcoming ${n === 1 ? 'session' : 'sessions'} will be cancelled. Each learner is refunded in full and told.`
      : `${n} upcoming ${n === 1 ? 'session' : 'sessions'} will be cancelled and refunded in full.`,
  payoutOwed: (amount: string) => `You are owed ${amount}. Closing keeps your bank details until it is paid. You can still go ahead.`,
  deletedTitle: 'What we delete',
  deletedLead: (after: number, by: number) => `We delete these ${after} days after you close, and always within ${by} days:`,
  keptTitle: 'What we keep, and for how long',
  undo: (days: number) =>
    `You can change your mind for ${days} days: write to support and we will open the account again. Sessions that were cancelled stay cancelled and refunded.`,
  continueButton: 'Continue',
  cancelButton: 'Keep my account',
  backButton: 'Back',
  confirmTitle: 'Confirm',
  confirmLead: (name: string | null, needsPassword: boolean) => {
    const what = name ? `${name}'s account` : 'your account';
    if (!needsPassword) return `To close ${what}, type ${CLOSE_WORD}.`;
    return `To close ${what}, type ${CLOSE_WORD} and enter ${name ? 'your own' : 'your'} password.`;
  },
  googleNote: 'You signed in with Google, so there is no password to check. If we ask you to sign in again, sign out, sign in with Google, and come back within 10 minutes.',
  wordLabel: `Type ${CLOSE_WORD}`,
  passwordLabel: 'Your password',
  confirmButton: 'Close the account',
  confirmButtonSelf: 'Close my account',
  working: 'Closing…',
  needWord: `Type ${CLOSE_WORD} to confirm.`,
  needPassword: 'Enter your password.',
  wrongPassword: "That password isn't right. Nothing was closed.",
  busy: 'Try again after your session',
  busyWhy: 'A session is about to start or is on now, or a video room is open.',
  failed: 'Something went wrong and nothing was closed. Please try again, or contact support.',
  notAvailable: "Closing an account isn't available here yet. Please email support and we will do it for you.",
  learnerClosed: (name: string, deleteBy: string, undoUntil: string) =>
    `${name}'s account is closed. Their details are deleted by ${deleteBy}. You can change your mind until ${undoUntil}: write to support.`,
  // The closing page (src/pages/AccountClosed.tsx).
  closedTitle: 'Your account is closed',
  closedLead: 'We have signed you out. Here is what happens next.',
  closedSessions: (n: number) => `${n} upcoming ${n === 1 ? 'session was' : 'sessions were'} cancelled and refunded in full.`,
  closedDelete: (deleteAfter: string, deleteBy: string) => `We delete your details on ${deleteAfter}, and always by ${deleteBy}.`,
  closedUndo: (undoUntil: string) => `You can change your mind until ${undoUntil}: write to support and we will open your account again.`,
  closedSignIn: 'Back to sign in',
};

// ---- what the database sends back --------------------------------------------------------------------------------------------------

export interface ClosureSession {
  sessionId: string;
  scheduledStart: string;
  durationHours: number;
  amount: number;
  currency: string;
}
export interface ClosureAccount {
  profileId: string;
  name: string;
  role: string;
  sessions: ClosureSession[];
  payoutOwed: number | null;
}
export interface ClosureKept {
  what: string;
  howLong: string;
}
export interface ClosurePreview {
  accounts: ClosureAccount[];
  blocked: boolean;
  blockedMessage: string | null;
  deleteAfterDays: number;
  deleteByDays: number;
  undoDays: number;
  deleted: string[];
  kept: ClosureKept[];
  note: string;
}
export interface ClosureResult {
  accountsClosed: number;
  sessionsCancelled: number;
  deleteAfter: string;
  deleteBy: string;
  undoUntil: string;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown, fallback = 0): number => {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : fallback;
};
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});

export function parseClosurePreview(data: unknown): ClosurePreview {
  const d = obj(data);
  return {
    accounts: arr(d.accounts).map((a) => {
      const o = obj(a);
      return {
        profileId: str(o.profile_id),
        name: str(o.name),
        role: str(o.role),
        sessions: arr(o.sessions_to_cancel).map((s) => {
          const x = obj(s);
          return {
            sessionId: str(x.session_id),
            scheduledStart: str(x.scheduled_start),
            durationHours: num(x.duration_hours),
            amount: num(x.amount),
            currency: str(x.currency) || 'ZAR',
          };
        }),
        payoutOwed: o.payout_owed === null || o.payout_owed === undefined ? null : num(o.payout_owed),
      };
    }),
    blocked: d.blocked === true,
    blockedMessage: typeof d.blocked_message === 'string' ? d.blocked_message : null,
    deleteAfterDays: num(d.delete_after_days, 30),
    deleteByDays: num(d.delete_by_days, 90),
    undoDays: num(d.undo_days, 30),
    deleted: arr(d.deleted).map(str).filter(Boolean),
    kept: arr(d.kept).map((k) => ({ what: str(obj(k).what), howLong: str(obj(k).how_long) })),
    note: str(d.note) || GENERIC_KEPT_LINE,
  };
}

export function parseClosureResult(data: unknown): ClosureResult {
  const d = obj(data);
  return {
    accountsClosed: num(d.accounts_closed),
    sessionsCancelled: num(d.sessions_cancelled),
    deleteAfter: str(d.delete_after),
    deleteBy: str(d.delete_by),
    undoUntil: str(d.undo_until),
  };
}

// ---- plain words for every refusal --------------------------------------------------------------------------------------------------

// The database's refusals (migration text) matched by a piece of each, in plain words. An unknown error never shows its raw text.
const REFUSALS: [needle: string, sentence: string][] = [
  ['try again after your session', `${CLOSE_COPY.busy}. ${CLOSE_COPY.busyWhy}`],
  ['type close to confirm', CLOSE_COPY.needWord],
  ['sign in again to confirm', 'Please sign in again to confirm this: sign out, sign back in, and try again within 10 minutes.'],
  ['under 18 can', "A learner under 18 can't close their own account. Ask your parent or guardian."],
  ['admin accounts are closed', "Admin accounts can't be closed here. Please contact support."],
  ['linked to your account', 'You can only close the account of a learner under 18 who is linked to yours.'],
  ['already closed', 'This account is already closed.'],
  ["refunds aren't set up", "We can't cancel and refund your sessions just now, so nothing was closed. Please contact support."],
  ['sign in first', 'Please sign in first.'],
  ['no such account', "We couldn't find that account."],
  ['could not find the function', CLOSE_COPY.notAvailable],
  ['does not exist', CLOSE_COPY.notAvailable],
  ['schema cache', CLOSE_COPY.notAvailable],
];

export function plainClosureError(e: unknown): string {
  const raw = String((e as { message?: unknown } | null)?.message ?? '').replace(/[‘’]/g, "'").toLowerCase();
  const code = (e as { code?: string } | null)?.code;
  if (code === 'PGRST202' || code === '42883') return CLOSE_COPY.notAvailable;
  const hit = REFUSALS.find(([needle]) => raw.includes(needle));
  return hit ? hit[1] : CLOSE_COPY.failed;
}

// ---- the two steps ------------------------------------------------------------------------------------------------------------------

interface DbError { code?: string; message?: string }
export interface ClosureClient {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: DbError | null }>;
  auth: { signInWithPassword(credentials: { email: string; password: string }): PromiseLike<{ error: DbError | null }> };
}

// An error whose message is already in plain words, safe to show as it is. Anything else that goes wrong is turned into one.
export class PlainClosureError extends Error {}
export const plainMessage = (e: unknown): string => (e instanceof PlainClosureError ? e.message : plainClosureError(e));

export async function fetchClosurePreview(client: ClosureClient, learnerId?: string | null): Promise<ClosurePreview> {
  try {
    const { data, error } = await client.rpc('preview_account_closure', { p_learner: learnerId ?? null });
    if (error) throw new PlainClosureError(plainClosureError(error));
    return parseClosurePreview(data);
  } catch (e) {
    throw new PlainClosureError(plainMessage(e));
  }
}

// Why the confirm button stays off, or null when it may be pressed. The word's case and spaces do not matter (the database agrees).
export function confirmationProblem(word: string, password: string, needsPassword = true): string | null {
  if (word.trim().toUpperCase() !== CLOSE_WORD) return CLOSE_COPY.needWord;
  if (needsPassword && password.length === 0) return CLOSE_COPY.needPassword;
  return null;
}

export interface CloseRequest {
  word: string;
  password: string;
  // The address the person signs in with; null for someone who signs in with Google only (no password to check).
  email: string | null;
  learnerId?: string | null;
}

// Step 2: the typed word, a fresh password check (the database refuses a sign-in older than ten minutes), then the closing itself.
export async function requestClosure(client: ClosureClient, req: CloseRequest): Promise<ClosureResult> {
  const needsPassword = req.email !== null;
  const problem = confirmationProblem(req.word, req.password, needsPassword);
  if (problem) throw new PlainClosureError(problem);
  try {
    if (needsPassword) {
      const { error: signInError } = await client.auth.signInWithPassword({ email: req.email as string, password: req.password });
      if (signInError) throw new PlainClosureError(CLOSE_COPY.wrongPassword);
    }
    const { data, error } = await client.rpc('request_account_closure', { p_confirmation: req.word, p_learner: req.learnerId ?? null });
    if (error) throw new PlainClosureError(plainClosureError(error));
    return parseClosureResult(data);
  } catch (e) {
    throw new PlainClosureError(plainMessage(e));
  }
}

// ---- small display helpers ----------------------------------------------------------------------------------------------------------

export function formatAmount(amount: number, currency: string, symbolOf: (code: string) => string = defaultSymbol): string {
  return `${symbolOf(currency)}${amount.toFixed(2)}`;
}
const defaultSymbol = (code: string): string => (code.trim() === 'ZAR' ? 'R' : code.trim());

export function formatHours(hours: number): string {
  return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
}

export function formatClosureDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-ZA', { timeZone: 'Africa/Johannesburg', day: 'numeric', month: 'long', year: 'numeric' });
}

export function formatSessionTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

// How the account modal and the learners panel decide what to show (App.tsx fills it in; the database decides in the end).
//  'self'  an adult learner, a guardian or a tutor: the whole flow.
//  'minor' a learner under 18 with their own sign-in: no button, a line pointing to the guardian.
//  'none'  an admin: admin accounts are closed another way.
export type CloseAccountMode = 'self' | 'minor' | 'none';
export interface CloseAccountSetup {
  mode: CloseAccountMode;
  // The address that signs the person in, for the password check; null when they sign in with Google only.
  signInEmail: string | null;
}

export function closeAccountSetup(params: { role: string | undefined; isViewOnlyLearner: boolean; email: string | undefined; providers: string[] | undefined }): CloseAccountSetup {
  const mode: CloseAccountMode = params.role === 'admin' ? 'none' : params.isViewOnlyLearner ? 'minor' : 'self';
  const hasPassword = !params.providers || params.providers.length === 0 || params.providers.includes('email');
  return { mode, signInEmail: hasPassword && params.email ? params.email : null };
}

// The closing page runs after sign-out, in a fresh page load, so what it shows is handed over in the browser's session storage.
const CLOSED_KEY = 'tutorlage.accountClosed';
export function rememberClosure(result: ClosureResult, storage: Pick<Storage, 'setItem'> | null = safeSession()): void {
  try {
    storage?.setItem(CLOSED_KEY, JSON.stringify(result));
  } catch {
    // The closing page still works without it, just without the dates.
  }
}
export function recallClosure(storage: Pick<Storage, 'getItem'> | null = safeSession()): ClosureResult | null {
  try {
    const raw = storage?.getItem(CLOSED_KEY);
    if (!raw) return null;
    // Stored in this file's own (camelCase) shape, not the database's.
    const s = obj(JSON.parse(raw));
    return {
      accountsClosed: num(s.accountsClosed),
      sessionsCancelled: num(s.sessionsCancelled),
      deleteAfter: str(s.deleteAfter),
      deleteBy: str(s.deleteBy),
      undoUntil: str(s.undoUntil),
    };
  } catch {
    return null;
  }
}
function safeSession(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}
