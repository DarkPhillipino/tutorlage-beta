// Checks on the Worker side of the close-account tool: server/closeAccount.ts (run with fake clients: no network, no key), how
// server/index.ts wires its one route, and that it agrees with the database migration it talks to.
// Run: npx tsx scripts/dev/close-account-test.ts
import fs from 'node:fs';
import {
  MAX_FILES_PER_TASK,
  STORAGE_BUCKETS,
  jobSecretMatches,
  mailerFromEnv,
  runClosureRounds,
  runClosureTasks,
} from '../../server/closeAccount';
import type { CloseAccountDeps, ClosureTask, TaskOutcome } from '../../server/closeAccount';

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
};
const read = (f: string) => fs.readFileSync(f, 'utf8');

const UID = '11111111-2222-3333-4444-555555555555';

// A fake world: records every call, answers from the settings it is given.
function world(tasks: ClosureTask[][], opts: { storageError?: string; paystackStatus?: number; authError?: string; authNotFound?: boolean; mail?: TaskOutcome; throwOn?: string } = {}) {
  const calls: string[] = [];
  const reports: { id: number; outcome: TaskOutcome }[] = [];
  const batches = [...tasks];
  const deps: CloseAccountDeps = {
    claimTasks: async (limit) => {
      calls.push(`claim:${limit}`);
      return batches.shift() ?? [];
    },
    reportResult: async (id, outcome) => {
      reports.push({ id, outcome });
    },
    removeFiles: async (bucket, paths) => {
      calls.push(`remove:${bucket}:${paths.length}`);
      if (opts.throwOn === 'remove') throw new Error('network down');
      return { error: opts.storageError ?? null };
    },
    deleteAuthUser: async (id) => {
      calls.push(`auth:${id}`);
      return { error: opts.authError ?? null, notFound: opts.authNotFound };
    },
    paystack: async (path, init) => {
      calls.push(`paystack:${init?.method ?? 'GET'}:${path}:${JSON.stringify(init?.body)}`);
      const st = opts.paystackStatus ?? 200;
      return { ok: st >= 200 && st < 300, httpStatus: st, body: { message: 'm' } };
    },
    sendMail: async (m) => {
      calls.push(`mail:${m.to}`);
      return opts.mail ?? { ok: true };
    },
  };
  return { deps, calls, reports };
}
const task = (id: number, kind: string, payload: Record<string, unknown>, attempts = 1): ClosureTask => ({ id, closure_id: 'c1', kind, payload, attempts });

(async () => {
  // ---- the shared secret ------------------------------------------------------------------------------------------------------
  check('the secret matches only itself', jobSecretMatches('abc123', 'abc123') && !jobSecretMatches('abc124', 'abc123') && !jobSecretMatches('abc123 ', 'abc123'));
  check('no header, no secret, or a header sent twice never matches', !jobSecretMatches(undefined, 'abc') && !jobSecretMatches('abc', undefined) && !jobSecretMatches('', '') && !jobSecretMatches(['abc', 'abc'], 'abc'));
  check('a header of another length does not match (and does not throw)', !jobSecretMatches('a', 'abc') && !jobSecretMatches('abcdef', 'abc'));

  // ---- each kind of step ------------------------------------------------------------------------------------------------------
  {
    const w = world([[
      task(1, 'email', { to: 'a@example.com', subject: 'S', text: 'T' }),
      task(2, 'storage_remove', { bucket: 'school-results', paths: [`${UID}/a.pdf`, `${UID}/b.pdf`] }),
      task(3, 'paystack_cards', { authorization_codes: ['AUTH_abc123', 'AUTH_def456'] }),
      task(4, 'paystack_subaccount', { subaccount_code: 'ACCT_xyz789' }),
      task(5, 'auth_delete', { user_id: UID }),
    ]]);
    const s = await runClosureTasks(w.deps, { limit: 50 });
    check('a run claims at most the limit it is given and reports one result per step', w.calls[0] === 'claim:50' && w.reports.length === 5, w.calls[0]);
    check('all five kinds are done and counted', s.claimed === 5 && s.done === 5 && s.failed === 0 && s.waiting === 0 && w.reports.every((r) => r.outcome.ok));
    check('the email goes to the address in the step', w.calls.includes('mail:a@example.com'));
    check('the files go to the bucket named, in one call', w.calls.includes('remove:school-results:2'));
    check('each card code is deactivated with a POST, one call each', w.calls.filter((c) => c.startsWith('paystack:POST:/customer/deactivate_authorization')).length === 2
      && w.calls.some((c) => c.endsWith('{"authorization_code":"AUTH_abc123"}')));
    check('the subaccount is switched off with a PUT and active:false', w.calls.includes('paystack:PUT:/subaccount/ACCT_xyz789:{"active":false}'));
    check('the Auth user is deleted by id', w.calls.includes(`auth:${UID}`));
    const lim = world([[]]);
    await runClosureTasks(lim.deps, { limit: 9999 });
    const lim2 = world([[]]);
    await runClosureTasks(lim2.deps, { limit: 0 });
    check('the limit is held between 1 and 100', lim.calls[0] === 'claim:100' && lim2.calls[0] === 'claim:1', `${lim.calls[0]} ${lim2.calls[0]}`);
  }

  // ---- refusals: a bad step is reported, never run -------------------------------------------------------------------------------
  {
    const long = Array.from({ length: MAX_FILES_PER_TASK + 1 }, (_, i) => `${UID}/f${i}`);
    const w = world([[
      task(1, 'storage_remove', { bucket: 'avatars', paths: [`${UID}/a`] }),
      task(2, 'storage_remove', { bucket: 'tutor-documents', paths: [] }),
      task(3, 'storage_remove', { bucket: 'tutor-documents', paths: [`${UID}/../other/a`] }),
      task(4, 'storage_remove', { bucket: 'tutor-documents', paths: long }),
      task(5, 'storage_remove', { bucket: 'tutor-documents', paths: [42] }),
      task(6, 'paystack_cards', { authorization_codes: ['bad code with spaces'] }),
      task(7, 'paystack_subaccount', { subaccount_code: '../../admin' }),
      task(8, 'auth_delete', { user_id: 'not-a-uuid' }),
      task(9, 'email', { to: 'not an address', subject: 'S', text: 'T' }),
      task(10, 'email', { to: 'a@example.com', subject: '', text: 'T' }),
      task(11, 'wipe_everything', {}),
    ]]);
    const s = await runClosureTasks(w.deps);
    check('eleven bad steps are all reported as failed and none touched Storage, Paystack, Auth or mail',
      s.failed === 11 && w.reports.every((r) => !r.outcome.ok && !r.outcome.waiting && (r.outcome.detail ?? '').length > 0) && w.calls.length === 1, w.calls.join(' | '));
    check('the buckets this can delete from are exactly the two the database queues', STORAGE_BUCKETS.length === 2 && STORAGE_BUCKETS.includes('school-results') && STORAGE_BUCKETS.includes('tutor-documents'));
  }

  // ---- failures and "already gone" --------------------------------------------------------------------------------------------
  {
    const w = world([[task(1, 'storage_remove', { bucket: 'school-results', paths: [`${UID}/a`] })]], { storageError: 'bucket busy' });
    await runClosureTasks(w.deps);
    check('a Storage error is a failure with its text', !w.reports[0].outcome.ok && /bucket busy/.test(w.reports[0].outcome.detail ?? ''));
    const p500 = world([[task(1, 'paystack_cards', { authorization_codes: ['AUTH_a'] }), task(2, 'paystack_subaccount', { subaccount_code: 'ACCT_a' })]], { paystackStatus: 500 });
    await runClosureTasks(p500.deps);
    check('Paystack errors (500) are failures to retry, not done', p500.reports.every((r) => !r.outcome.ok && /Paystack 500/.test(r.outcome.detail ?? '')));
    const p404 = world([[task(1, 'paystack_cards', { authorization_codes: ['AUTH_a'] }), task(2, 'paystack_subaccount', { subaccount_code: 'ACCT_a' })]], { paystackStatus: 404 });
    await runClosureTasks(p404.deps);
    check('Paystack "not found" counts as done (already gone)', p404.reports.every((r) => r.outcome.ok));
    const a1 = world([[task(1, 'auth_delete', { user_id: UID })]], { authError: 'User not found', authNotFound: true });
    await runClosureTasks(a1.deps);
    const a2 = world([[task(1, 'auth_delete', { user_id: UID })]], { authError: 'database error' });
    await runClosureTasks(a2.deps);
    check('an Auth user that is already gone is done; any other Auth error is a failure', a1.reports[0].outcome.ok && !a2.reports[0].outcome.ok && /database error/.test(a2.reports[0].outcome.detail ?? ''));
    const th = world([[task(1, 'storage_remove', { bucket: 'school-results', paths: [`${UID}/a`] }), task(2, 'auth_delete', { user_id: UID })]], { throwOn: 'remove' });
    const s = await runClosureTasks(th.deps);
    check('a step that throws is reported failed and the next one still runs', th.reports.length === 2 && !th.reports[0].outcome.ok && /network down/.test(th.reports[0].outcome.detail ?? '') && th.reports[1].outcome.ok && s.failed === 1 && s.done === 1);
  }

  // ---- mail ----------------------------------------------------------------------------------------------------------------------
  {
    const sent: { url: string; init: any }[] = [];
    const fakeFetch = (status: number) => async (url: string, init: any) => {
      sent.push({ url, init });
      return { ok: status < 300, status, text: async () => 'oops' };
    };
    const none = await mailerFromEnv({}, fakeFetch(200))({ to: 'a@example.com', subject: 'S', text: 'T' });
    check('without a mail key the email waits (not failed) and nothing is sent', !none.ok && none.waiting === true && sent.length === 0 && /RESEND_API_KEY/.test(none.detail ?? ''));
    const half = await mailerFromEnv({ RESEND_API_KEY: 'x' }, fakeFetch(200))({ to: 'a@example.com', subject: 'S', text: 'T' });
    check('a key without a sender address also waits', half.waiting === true && sent.length === 0);
    const ok = await mailerFromEnv({ RESEND_API_KEY: 'k-test', MAIL_FROM: 'Tutorlage <noreply@tutorlage.com>' }, fakeFetch(200))({ to: 'a@example.com', subject: 'Hello', text: 'Body' });
    const body = JSON.parse(sent[0]?.init.body ?? '{}');
    check('with both set, the mail is posted to Resend with a bearer key, the sender, one recipient, subject and text',
      ok.ok && sent[0].url === 'https://api.resend.com/emails' && sent[0].init.method === 'POST' && sent[0].init.headers.Authorization === 'Bearer k-test'
      && body.from === 'Tutorlage <noreply@tutorlage.com>' && body.to.length === 1 && body.to[0] === 'a@example.com' && body.subject === 'Hello' && body.text === 'Body');
    const bad = await mailerFromEnv({ RESEND_API_KEY: 'k', MAIL_FROM: 'a@b.co' }, fakeFetch(500))({ to: 'a@example.com', subject: 'S', text: 'T' });
    check('a Resend error is a failure with the status', !bad.ok && !bad.waiting && /Resend 500/.test(bad.detail ?? ''));
    const wm = world([[task(1, 'email', { to: 'a@example.com', subject: 'S', text: 'T' })]], { mail: { ok: false, waiting: true, detail: 'no key' } });
    const s = await runClosureTasks(wm.deps);
    check('a waiting email is counted as waiting, and is reported with waiting=true', s.waiting === 1 && s.failed === 0 && wm.reports[0].outcome.waiting === true);
  }

  // ---- rounds ----------------------------------------------------------------------------------------------------------------------
  {
    const w = world([[task(1, 'storage_remove', { bucket: 'school-results', paths: [`${UID}/a`] })], [task(2, 'auth_delete', { user_id: UID })], []]);
    const s = await runClosureRounds(w.deps);
    check('rounds go on while steps are handed out (the Auth delete comes in a later round) and stop at the first empty one', s.claimed === 2 && s.done === 2 && w.calls.filter((c) => c.startsWith('claim:')).length === 3);
    const endless: CloseAccountDeps = { ...w.deps, claimTasks: async () => [task(9, 'auth_delete', { user_id: UID })] };
    const e = await runClosureRounds(endless, { rounds: 999 });
    check('rounds are capped (20 at most)', e.claimed === 20, String(e.claimed));
  }

  // ---- how index.ts wires the one route ---------------------------------------------------------------------------------------------
  {
    const idx = read('server/index.ts');
    const route = idx.slice(idx.indexOf("app.post('/api/internal/close-account/run'"), idx.indexOf('app.listen(PORT'));
    check('there is exactly one close-account route, a POST', (idx.match(/\/api\/internal\/close-account/g) ?? []).length === 1 && route.length > 100);
    check('it answers 503 when the secret is not set, 401 when the header is wrong, and checks before it runs anything',
      /if \(!CLOSE_ACCOUNT_JOB_SECRET\)[\s\S]*503[\s\S]*jobSecretMatches\(req\.headers\['x-job-secret'\], CLOSE_ACCOUNT_JOB_SECRET\)[\s\S]*401[\s\S]*runClosureRounds/.test(route));
    check('it does not read a signed-in user and does not log the secret or the tasks', !/signedInUser/.test(route) && !/console\.\w+\([^)]*(SECRET|payload|authorization)/i.test(route));
    check('the database is called with the argument names the migration defines',
      /rpc\('close_account_claim_tasks', \{ p_limit: limit \}\)/.test(idx) && /rpc\('close_account_task_result', \{\s*p_task: taskId,\s*p_ok: outcome\.ok,\s*p_detail: outcome\.detail \?\? null,\s*p_waiting: outcome\.waiting \?\? false,/.test(idx));
    check('the route is rate limited', /app\.post\('\/api\/internal\/close-account\/run', rateLimit\(/.test(idx));
    check('the secret comes from the environment only', /const CLOSE_ACCOUNT_JOB_SECRET = process\.env\.CLOSE_ACCOUNT_JOB_SECRET;/.test(idx));
  }

  // ---- agreement with the migration ------------------------------------------------------------------------------------------------
  {
    const m = read('supabase/migrations/20261021140000_close_account.sql');
    const kinds = /kind text not null check \(kind in \(([^)]*)\)\)/.exec(m)?.[1].split(',').map((s) => s.trim().replace(/'/g, '')) ?? [];
    const mod = read('server/closeAccount.ts');
    const handled = [...mod.matchAll(/case '(\w+)':/g)].map((x) => x[1]);
    check('the Worker handles exactly the kinds the database can queue', kinds.length === 5 && kinds.every((k) => handled.includes(k)) && handled.length === 5, `${kinds.join(',')} / ${handled.join(',')}`);
    const buckets = [...m.matchAll(/closure_enqueue_files\(c\.id, p, '([\w-]+)'/g)].map((x) => x[1]);
    check('the buckets the database queues are the ones the Worker allows', buckets.length === 2 && buckets.every((b) => (STORAGE_BUCKETS as readonly string[]).includes(b)), buckets.join(','));
    check('only the server key may call the two Worker functions, and nothing is granted to browsers',
      /grant execute on function public\.close_account_claim_tasks\(integer\) to service_role;/.test(m) && /grant execute on function public\.close_account_task_result\(bigint, boolean, text, boolean\) to service_role;/.test(m)
      && !/close_account_(claim_tasks|task_result)[^;]*to (authenticated|anon)/.test(m));
    check('the database waits 10 minutes before a failed step is handed out again (so the rounds cannot burn its tries)', /t\.claimed_at < now\(\) - interval '10 minutes'/.test(m));
    check('the route the daily job wakes is the route index.ts serves', /'\/api\/internal\/close-account\/run'/.test(m) && /x-job-secret/.test(m));
  }

  // ---- no key-shaped text, no service key in a new file ---------------------------------------------------------------------------
  {
    const bad = [['sk', 'live', ''].join('_'), ['pk', 'live', ''].join('_'), ['whsec', ''].join('_'), ['sk', 'test', ''].join('_')];
    const files = ['server/closeAccount.ts', 'scripts/dev/close-account-test.ts', 'supabase/migrations/20261021140000_close_account.sql', 'supabase/migrations/20261021141000_close_account_auth_link.sql', 'supabase/tests/close_account.sql'];
    const hits = files.filter((f) => fs.existsSync(f) && bad.some((b) => read(f).includes(b)));
    check('no key-shaped text in any new file', hits.length === 0, hits.join(','));
    check('the module takes everything through deps: no environment, no database client, no fetch of its own except the mail helper it is given', !/process\.env|createClient|from '@supabase/.test(read('server/closeAccount.ts')));
  }

  console.log(failures === 0 ? '\nclose-account test: all checks passed' : `\nclose-account test: ${failures} check(s) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
})();
