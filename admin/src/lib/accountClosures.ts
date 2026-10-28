import { notSwitchedOn } from './subjectApprovals';

// The "Account closures" screen (migration 20261021140000_close_account.sql): everyone whose account was closed and has not been deleted
// yet, closing someone on a written request, undoing a closure and deferring a deletion. Every function below is for admins only (the
// database refuses anyone else). On a database without the migration the screen shows CLOSURES_NOT_ACTIVE: never an error.

export const CLOSURES_NOT_ACTIVE = 'Account closures are not active on this database yet.';

interface DbError { code?: string; message?: string }
export interface ClosuresClient {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: DbError | null }>;
}

export interface ClosureRow {
  closureId: string;
  profileId: string;
  role: string;
  name: string;
  email: string;
  status: string;
  startedHow: string;
  askedBy: string;
  howVerified: string;
  reference: string;
  note: string;
  householdOf: string;
  closedAt: string;
  dueAt: string;
  outerLimitAt: string;
  undoUntil: string;
  onHold: boolean;
  deferredUntil: string;
  deferredReason: string;
  openDispute: boolean;
  sessionsCancelled: number;
  cardsKept: boolean;
  payoutKept: boolean;
  openTasks: number;
  overdue: boolean;
  lastError: string;
}
export type ClosureList = { state: 'ok'; rows: ClosureRow[] } | { state: 'not_active'; note: string };

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const int = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

export async function fetchAccountClosures(client: ClosuresClient, includeFinished = false): Promise<ClosureList> {
  const { data, error } = await client.rpc('list_account_closures', { p_include_finished: includeFinished });
  if (error) {
    if (notSwitchedOn(error)) return { state: 'not_active', note: CLOSURES_NOT_ACTIVE };
    throw new Error(/admins only/i.test(error.message ?? '') ? 'Only admins can see this list.' : (error.message ?? 'Could not load the account closures.'));
  }
  const rows = ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    closureId: str(r.closure_id),
    profileId: str(r.profile_id),
    role: str(r.role),
    name: str(r.display_name),
    email: str(r.email),
    status: str(r.status),
    startedHow: str(r.started_how),
    askedBy: str(r.asked_by),
    howVerified: str(r.how_verified),
    reference: str(r.reference),
    note: str(r.note),
    householdOf: str(r.household_of),
    closedAt: str(r.closed_at),
    dueAt: str(r.due_at),
    outerLimitAt: str(r.outer_limit_at),
    undoUntil: str(r.undo_until),
    onHold: r.on_hold === true,
    deferredUntil: str(r.deferred_until),
    deferredReason: str(r.deferred_reason),
    openDispute: r.open_dispute === true,
    sessionsCancelled: int(r.sessions_cancelled),
    cardsKept: r.cards_kept === true,
    payoutKept: r.payout_kept === true,
    openTasks: int(r.open_tasks),
    overdue: r.overdue === true,
    lastError: str(r.last_error),
  }));
  return { state: 'ok', rows };
}

export const STATUS_LABELS: Record<string, string> = {
  closed: 'Closed, waiting for day 30',
  undone: 'Undone',
  db_deleted: 'Deleted from the database, finishing',
  done: 'Done',
};
export const STARTED_LABELS: Record<string, string> = {
  self: 'The person',
  guardian: 'Their guardian',
  admin_request: 'An admin, on a written request',
  admin_terms: 'An admin, under Terms §17.2',
};
export const ROLE_LABELS: Record<string, string> = { student: 'Learner', parent: 'Guardian', tutor: 'Tutor', admin: 'Admin' };

export const canUndo = (row: Pick<ClosureRow, 'status' | 'undoUntil'>, now: Date = new Date()): boolean =>
  row.status === 'closed' && new Date(row.undoUntil).getTime() > now.getTime();
export const canDefer = (row: Pick<ClosureRow, 'status'>): boolean => row.status === 'closed' || row.status === 'db_deleted';

// ---- the forms ----------------------------------------------------------------------------------------------------------------------

export interface CloseForm {
  profileId: string;
  askedBy: string;
  howVerified: string;
  reference: string;
  // YYYY-MM-DD, as a date field gives it.
  requestedOn: string;
  reason: string;
}
export const emptyCloseForm: CloseForm = { profileId: '', askedBy: '', howVerified: '', reference: '', requestedOn: '', reason: '' };

export interface UndoForm { askedBy: string; howVerified: string; note: string }
export const emptyUndoForm: UndoForm = { askedBy: '', howVerified: '', note: '' };

export interface DeferForm { until: string; reason: string }
export const emptyDeferForm: DeferForm = { until: '', reason: '' };

// Today's date in South Africa as YYYY-MM-DD.
export const todayInSa = (now: Date = new Date()): string => now.toLocaleDateString('en-CA', { timeZone: 'Africa/Johannesburg' });

// The database wants at least 3 characters in each written field; a blank or 1-2 letter entry is stopped here with a plain sentence.
function missing(value: string, what: string): string | null {
  const v = value.trim();
  if (v.length === 0) return `${what}.`;
  if (v.length < 3) return `${what} (at least 3 characters).`;
  return null;
}
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// The first thing wrong with the "Close on a written request" form, or null when every field is filled in.
export function closeFormProblem(form: CloseForm, now: Date = new Date()): string | null {
  if (form.profileId.trim().length === 0) return 'Find and choose the person first.';
  const written = missing(form.askedBy, 'Write who asked') ?? missing(form.howVerified, 'Write how you checked it was them') ?? missing(form.reference, 'Write the reference of the request');
  if (written) return written;
  if (!DATE_RE.test(form.requestedOn)) return 'Say the date they asked.';
  if (form.requestedOn > todayInSa(now)) return 'The date they asked cannot be in the future.';
  return missing(form.reason, 'Write why the account is being closed');
}
export function undoFormProblem(form: UndoForm): string | null {
  return missing(form.askedBy, 'Write who asked') ?? missing(form.howVerified, 'Write how you checked it was them') ?? missing(form.note, 'Write a short note');
}
export function deferFormProblem(form: DeferForm, now: Date = new Date()): string | null {
  if (!DATE_RE.test(form.until)) return 'Give the date to wait until.';
  if (form.until <= todayInSa(now)) return 'The date must be in the future.';
  return missing(form.reason, 'Write a short reason');
}

// ---- the actions ---------------------------------------------------------------------------------------------------------------------

export type ActionResult = { ok: true; message: string } | { ok: false; message: string };

function refusal(e: DbError | Error | unknown): ActionResult {
  if (notSwitchedOn(e)) return { ok: false, message: CLOSURES_NOT_ACTIVE };
  const message = String((e as { message?: unknown } | null)?.message ?? '');
  if (/admins only/i.test(message)) return { ok: false, message: 'Only admins can do this.' };
  return { ok: false, message: message || 'That did not work. Nothing was changed.' };
}

// A date field gives a day; the database wants the moment. Midnight at the start of that day in South Africa is never in the future
// for a day that is today or earlier.
export const requestedOnMoment = (date: string): string => `${date}T00:00:00+02:00`;

export async function closeOnRequest(client: ClosuresClient, form: CloseForm, now: Date = new Date()): Promise<ActionResult> {
  const problem = closeFormProblem(form, now);
  if (problem) return { ok: false, message: problem };
  try {
    const { data, error } = await client.rpc('admin_close_account', {
      p_profile: form.profileId,
      p_basis: 'person_request',
      p_requested_by: form.askedBy.trim(),
      p_requested_on: requestedOnMoment(form.requestedOn),
      p_how_verified: form.howVerified.trim(),
      p_reference: form.reference.trim(),
      p_note: form.reason.trim(),
    });
    if (error) return refusal(error);
    const d = (data ?? {}) as Record<string, unknown>;
    return { ok: true, message: `Closed. Accounts closed: ${int(d.accounts_closed)}. Sessions cancelled and refunded: ${int(d.sessions_cancelled)}.` };
  } catch (e) {
    return refusal(e);
  }
}

export async function undoClosure(client: ClosuresClient, closureId: string, form: UndoForm): Promise<ActionResult> {
  const problem = undoFormProblem(form);
  if (problem) return { ok: false, message: problem };
  try {
    const { data, error } = await client.rpc('undo_account_closure', {
      p_closure: closureId,
      p_asked_by: form.askedBy.trim(),
      p_how_verified: form.howVerified.trim(),
      p_note: form.note.trim(),
    });
    if (error) return refusal(error);
    return { ok: true, message: `Reopened ${int((data as Record<string, unknown> | null)?.reopened)} account(s).` };
  } catch (e) {
    return refusal(e);
  }
}

export async function deferClosure(client: ClosuresClient, closureId: string, form: DeferForm, now: Date = new Date()): Promise<ActionResult> {
  const problem = deferFormProblem(form, now);
  if (problem) return { ok: false, message: problem };
  try {
    const { error } = await client.rpc('defer_account_closure', { p_closure: closureId, p_until: form.until, p_reason: form.reason.trim() });
    if (error) return refusal(error);
    return { ok: true, message: 'Deletion will wait until that date.' };
  } catch (e) {
    return refusal(e);
  }
}

export async function clearDeferral(client: ClosuresClient, closureId: string): Promise<ActionResult> {
  try {
    const { error } = await client.rpc('defer_account_closure', { p_closure: closureId, p_until: null, p_reason: null });
    if (error) return refusal(error);
    return { ok: true, message: 'The waiting date is cleared.' };
  } catch (e) {
    return refusal(e);
  }
}
