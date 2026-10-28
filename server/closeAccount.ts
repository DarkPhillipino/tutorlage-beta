// The steps of closing an account that happen OUTSIDE the database (design: Drake/programmer/close-account-design-2026-10-21.md;
// database part: supabase/migrations/20261021140000_close_account.sql and 20261021141000_close_account_auth_link.sql).
// The daily database job queues tasks; this module takes them through the database (close_account_claim_tasks), does each with the
// service key held by the Worker, and reports each (close_account_task_result). Everything it touches comes in through `deps`, so
// scripts/dev/close-account-test.ts runs it with fakes: no network, no key.
import crypto from 'node:crypto';

export type ClosureTaskKind = 'email' | 'paystack_cards' | 'paystack_subaccount' | 'storage_remove' | 'auth_delete';

export interface ClosureTask {
  id: number;
  closure_id: string;
  kind: ClosureTaskKind | string;
  payload: Record<string, unknown>;
  attempts: number;
}

// ok: done. waiting: not the task's fault (for example no mail key yet), try again later and do not count the try.
export interface TaskOutcome {
  ok: boolean;
  detail?: string;
  waiting?: boolean;
}

export interface PaystackReply {
  ok: boolean;
  httpStatus: number;
  body: any;
}

export interface CloseAccountDeps {
  claimTasks(limit: number): Promise<ClosureTask[]>;
  reportResult(taskId: number, outcome: TaskOutcome): Promise<void>;
  removeFiles(bucket: string, paths: string[]): Promise<{ error?: string | null }>;
  deleteAuthUser(userId: string): Promise<{ error?: string | null; notFound?: boolean }>;
  paystack(path: string, init?: { method?: string; body?: unknown }): Promise<PaystackReply>;
  sendMail(mail: { to: string; subject: string; text: string }): Promise<TaskOutcome>;
}

export interface RunSummary {
  claimed: number;
  done: number;
  failed: number;
  waiting: number;
}

export const STORAGE_BUCKETS = ['school-results', 'tutor-documents'] as const;
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODE_SHAPE = /^[A-Za-z0-9_-]{1,100}$/;
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const MAX_FILES_PER_TASK = 100;

// Compared in constant time; a missing header or secret never matches.
export function jobSecretMatches(header: string | string[] | undefined, expected: string | undefined): boolean {
  if (typeof header !== 'string' || !expected) return false;
  const a = crypto.createHash('sha256').update(header).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

const failed = (detail: string): TaskOutcome => ({ ok: false, detail });
const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);

// Paystack calls are best effort: one that fails is tried again later (up to 5 tries, set by the database) and then given up.
// "Not found" counts as done: the thing is already gone.
async function runOne(task: ClosureTask, deps: CloseAccountDeps): Promise<TaskOutcome> {
  const p = task.payload ?? {};
  switch (task.kind) {
    case 'email': {
      const to = text(p.to);
      const subject = text(p.subject);
      const body = text(p.text);
      if (!to || !EMAIL_SHAPE.test(to) || !subject || !body) return failed('the email task is missing its address, subject or text');
      return deps.sendMail({ to, subject, text: body });
    }
    case 'storage_remove': {
      const bucket = text(p.bucket);
      const paths = p.paths;
      if (!bucket || !(STORAGE_BUCKETS as readonly string[]).includes(bucket)) return failed('unknown storage bucket');
      if (!Array.isArray(paths) || paths.length === 0 || paths.length > MAX_FILES_PER_TASK) return failed('the list of files is empty or too long');
      if (!paths.every((x) => typeof x === 'string' && x.length > 0 && x.length <= 500 && !/(^|\/)\.\.(\/|$)/.test(x))) return failed('a file path is not valid');
      const { error } = await deps.removeFiles(bucket, paths as string[]);
      return error ? failed(`Storage said: ${error}`) : { ok: true };
    }
    case 'paystack_cards': {
      const codes = p.authorization_codes;
      if (!Array.isArray(codes) || codes.length === 0 || !codes.every((x) => typeof x === 'string' && CODE_SHAPE.test(x))) return failed('the list of card codes is not valid');
      let bad: string | null = null;
      for (const code of codes as string[]) {
        const r = await deps.paystack('/customer/deactivate_authorization', { method: 'POST', body: { authorization_code: code } });
        if (!r.ok && r.httpStatus !== 404) bad = `Paystack ${r.httpStatus}: ${String(r.body?.message ?? 'no message').slice(0, 120)}`;
      }
      return bad ? failed(bad) : { ok: true };
    }
    case 'paystack_subaccount': {
      const code = text(p.subaccount_code);
      if (!code || !CODE_SHAPE.test(code)) return failed('the subaccount code is not valid');
      const r = await deps.paystack(`/subaccount/${encodeURIComponent(code)}`, { method: 'PUT', body: { active: false } });
      return r.ok || r.httpStatus === 404 ? { ok: true } : failed(`Paystack ${r.httpStatus}: ${String(r.body?.message ?? 'no message').slice(0, 120)}`);
    }
    case 'auth_delete': {
      const id = text(p.user_id);
      if (!id || !UUID_SHAPE.test(id)) return failed('the user id is not valid');
      const r = await deps.deleteAuthUser(id);
      return !r.error || r.notFound ? { ok: true } : failed(`Auth said: ${r.error}`);
    }
    default:
      return failed(`unknown step "${String(task.kind)}"`);
  }
}

export async function runClosureTasks(deps: CloseAccountDeps, opts: { limit?: number } = {}): Promise<RunSummary> {
  const summary: RunSummary = { claimed: 0, done: 0, failed: 0, waiting: 0 };
  const tasks = await deps.claimTasks(Math.max(1, Math.min(opts.limit ?? 20, 100)));
  for (const task of tasks) {
    summary.claimed += 1;
    let outcome: TaskOutcome;
    try {
      outcome = await runOne(task, deps);
    } catch (e) {
      outcome = failed(e instanceof Error ? e.message.slice(0, 200) : 'unexpected error');
    }
    await deps.reportResult(task.id, outcome);
    if (outcome.ok) summary.done += 1;
    else if (outcome.waiting) summary.waiting += 1;
    else summary.failed += 1;
  }
  return summary;
}

// Several rounds in one wake-up (a later step, such as deleting the Auth user, only becomes available when the earlier ones are done).
// A step that failed is not handed out again for 10 minutes (the database sees to that), so the rounds stop when nothing is left.
export async function runClosureRounds(deps: CloseAccountDeps, opts: { rounds?: number; limit?: number } = {}): Promise<RunSummary> {
  const total: RunSummary = { claimed: 0, done: 0, failed: 0, waiting: 0 };
  for (let i = 0; i < Math.max(1, Math.min(opts.rounds ?? 10, 20)); i += 1) {
    const s = await runClosureTasks(deps, { limit: opts.limit });
    total.claimed += s.claimed;
    total.done += s.done;
    total.failed += s.failed;
    total.waiting += s.waiting;
    if (s.claimed === 0) break;
  }
  return total;
}

// Mail goes out through Resend's HTTPS API when RESEND_API_KEY and MAIL_FROM are set as Worker secrets. Without them the Worker has no
// mail path (Resend is otherwise only Supabase Auth's SMTP): the email tasks wait, and closing still works.
export function mailerFromEnv(
  env: Record<string, string | undefined>,
  fetchFn: (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>,
): CloseAccountDeps['sendMail'] {
  return async ({ to, subject, text: body }) => {
    const key = env.RESEND_API_KEY;
    const from = env.MAIL_FROM;
    if (!key || !from) return { ok: false, waiting: true, detail: 'No mail path yet: set RESEND_API_KEY and MAIL_FROM as Worker secrets' };
    const r = await fetchFn('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [to], subject, text: body }),
    });
    if (r.ok) return { ok: true };
    const msg = (await r.text().catch(() => '')).slice(0, 120);
    return failed(`Resend ${r.status}: ${msg}`);
  };
}
