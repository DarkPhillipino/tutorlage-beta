// Checks the three sets of close-account screens (the person's, the guardian's, the admin's) with fake clients and rendered markup.
// Run: npx tsx scripts/dev/close-account-screens-test.ts
// The database half is proved by supabase/tests/close_account.sql and the Worker half by scripts/dev/close-account-test.ts; nothing here touches a
// database. This checks: the preview text lists counts correctly; the confirmation is refused until the word and password are right (and the
// closing call never runs after a wrong password); each refused case shows its plain sentence; a held person sees exactly the generic line and
// the very same screen as anyone; the guardian's confirmation lists each learner; a learner under 18 sees no close button; the admin form blocks
// on any blank field; every call uses the function and argument names the migration defines (read out of the migration text); the screens
// never call the Worker or Storage; the new screens tolerate the migration being absent; no key-shaped text in the new files.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import {
  CLOSE_COPY,
  CLOSE_WORD,
  GENERIC_KEPT_LINE,
  ClosureClient,
  closeAccountSetup,
  confirmationProblem,
  fetchClosurePreview,
  parseClosurePreview,
  plainClosureError,
  recallClosure,
  rememberClosure,
  requestClosure,
} from '../../src/lib/closeAccount';
import { CloseAccountView, CloseAccountViewProps } from '../../src/components/CloseAccountView';
import { CloseAccountSection } from '../../src/components/CloseAccountSection';
import { AccountClosedView } from '../../src/components/AccountClosedView';
import {
  CLOSURES_NOT_ACTIVE,
  ClosuresClient,
  clearDeferral,
  closeFormProblem,
  closeOnRequest,
  deferClosure,
  fetchAccountClosures,
  undoClosure,
} from '../../admin/src/lib/accountClosures';
import { AccountClosuresBody } from '../../admin/src/components/AccountClosuresBody';
import { CloseOnRequestForm } from '../../admin/src/components/CloseOnRequestForm';

const rootRequire = createRequire(new URL('../../package.json', import.meta.url));
const adminRequire = createRequire(new URL('../../admin/package.json', import.meta.url));
const RootReact = rootRequire('react') as typeof import('react');
const renderRoot = (rootRequire('react-dom/server') as typeof import('react-dom/server')).renderToStaticMarkup;
const AdminReact = adminRequire('react') as typeof import('react');
const renderAdmin = (adminRequire('react-dom/server') as typeof import('react-dom/server')).renderToStaticMarkup;

let failed = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) failed += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && detail ? ` [${detail}]` : ''}`);
}
const read = (p: string) => readFileSync(p, 'utf8');
const MIGRATION = read('supabase/migrations/20261021140000_close_account.sql');

// What the migration defines: a function's argument names, and its body (up to the next function).
function paramsOf(fn: string): string[] | null {
  const m = new RegExp(`create or replace function public\\.${fn}\\(([\\s\\S]*?)\\)\\s*returns`, 'i').exec(MIGRATION);
  return m ? m[1].split(',').map((s) => s.trim().split(/\s+/)[0]).filter(Boolean) : null;
}
function bodyOf(fn: string): string {
  const start = MIGRATION.search(new RegExp(`create or replace function public\\.${fn}\\(`, 'i'));
  if (start < 0) return '';
  const rest = MIGRATION.slice(start + 10);
  const next = rest.search(/create or replace function /i);
  return next < 0 ? rest : rest.slice(0, next);
}
const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

// ---------------------------------------------------------------------------------------------------------------------------------
// Fixtures and fakes
// ---------------------------------------------------------------------------------------------------------------------------------
const DELETED = [
  'your name, email, phone number and picture', 'your sign-in', 'saved cards', 'messages and notifications',
  "a learner's school, grade and school results", "a tutor's profile, availability, subjects and bio", 'free-text review comments',
];
const KEPT = [
  ['Bookings, payments and refunds, without your name', '7 years after the end of the financial year'],
  ['Records of what you agreed to (terms, consents)', '5 years after the account closes'],
  ["A tutor's ID copy, police clearance and verification documents", '3 years after they stop tutoring or close'],
  ['Problem reports and safety reports', '5 years, longer if a matter is open'],
  ['Anything the law or an open matter requires us to keep', 'as long as that requires'],
];
const sess = (id: string, start: string, hours: number, amount: number) => ({ session_id: id, scheduled_start: start, duration_hours: hours, amount, currency: 'ZAR' });
const acct = (id: string, name: string, role: string, sessions: unknown[] = [], owed: number | null = null) =>
  ({ profile_id: id, name, role, sessions_to_cancel: sessions, payout_owed: owed });
const rawPreview = (accounts: unknown[], blocked = false) => ({
  accounts, blocked, blocked_message: blocked ? 'Try again after your session' : null,
  delete_after_days: 30, delete_by_days: 90, undo_days: 30,
  deleted: DELETED, kept: KEPT.map(([what, how_long]) => ({ what, how_long })), note: GENERIC_KEPT_LINE,
});
const GUARDIAN = acct('g-1', 'Nomsa Dlamini', 'parent', [sess('s-1', '2026-10-26T13:00:00Z', 1, 250), sess('s-2', '2026-10-27T13:00:00Z', 1.5, 375)]);
const AYANDA = acct('l-1', 'Ayanda', 'student', [sess('s-3', '2026-10-28T13:00:00Z', 1, 250)]);
const THABO = acct('l-2', 'Thabo', 'student');
const HOUSEHOLD = rawPreview([GUARDIAN, AYANDA, THABO]);
const SINGLE = rawPreview([acct('a-1', 'Lerato Mokoena', 'student', [sess('s-9', '2026-10-26T09:00:00Z', 2, 500)])]);
const TUTOR = rawPreview([acct('t-1', 'Sipho Khumalo', 'tutor', [sess('s-4', '2026-10-26T09:00:00Z', 1, 300)], 1250)]);

type Reply = { data?: unknown; error?: { code?: string; message?: string } | null };
function fakeClient(replies: Record<string, Reply> = {}, signIn: 'ok' | 'bad' = 'ok') {
  const calls: string[] = [];
  const args: Record<string, Record<string, unknown>> = {};
  const signIns: { email: string; password: string }[] = [];
  const client: ClosureClient & ClosuresClient = {
    rpc: async (fn, a) => {
      calls.push(`rpc:${fn}`);
      args[fn] = a;
      const r = replies[fn] ?? {};
      return { data: r.data ?? null, error: r.error ?? null };
    },
    auth: {
      signInWithPassword: async (c) => {
        calls.push('auth:signInWithPassword');
        signIns.push(c);
        return { error: signIn === 'ok' ? null : { message: 'Invalid login credentials' } };
      },
    },
  };
  return { client, calls, args, signIns };
}
const RESULT_DATA = { closure_ids: ['c-1'], accounts_closed: 1, sessions_cancelled: 1, delete_after: '2026-11-21T01:10:00Z', delete_by: '2027-01-19T01:10:00Z', undo_until: '2026-11-21T01:10:00Z', note: GENERIC_KEPT_LINE };

function view(over: Partial<CloseAccountViewProps>): string {
  const props: CloseAccountViewProps = {
    stage: 'preview', subject: 'self', preview: parseClosurePreview(SINGLE), needsPassword: true, word: '', password: '', error: null,
    onWord: () => {}, onPassword: () => {}, onContinue: () => {}, onBack: () => {}, onConfirm: () => {}, onCancel: () => {},
    ...over,
  };
  return renderRoot(RootReact.createElement(CloseAccountView, props));
}
const buttonTag = (html: string, action: string): string => (new RegExp(`<button[^>]*data-action="${action}"[^>]*>`).exec(html) ?? [''])[0];
const isDisabled = (html: string, action: string) => /\sdisabled=""/.test(buttonTag(html, action));
const words = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;|&apos;/g, "'").replace(/\s+/g, ' ');

async function main() {
  // ================================================================ 1. THE PERSON: step 1, the preview
  {
    const p = parseClosurePreview(HOUSEHOLD);
    check('the preview is read as the migration shapes it: three accounts with 2, 1 and 0 sessions to cancel, 7 deleted lines, 5 kept lines',
      p.accounts.length === 3 && p.accounts.map((a) => a.sessions.length).join() === '2,1,0' && p.deleted.length === 7 && p.kept.length === 5 && p.deleteAfterDays === 30 && p.deleteByDays === 90 && p.undoDays === 30);

    const html = words(view({ preview: parseClosurePreview(SINGLE) }));
    check('step 1 lists the sessions that will be cancelled and refunded, with count, length and amount', /1 upcoming session will be cancelled and refunded in full\./.test(html) && /2 hours/.test(html) && /R500\.00/.test(html), html.slice(0, 300));
    const two = words(view({ preview: parseClosurePreview(rawPreview([GUARDIAN])) }));
    check('two sessions are counted as "2 upcoming sessions", a half hour is written as 1.5 hours, each with its own amount', /2 upcoming sessions will be cancelled and refunded in full\./.test(two) && /1\.5 hours/.test(two) && /R250\.00/.test(two) && /R375\.00/.test(two));
    const none = words(view({ preview: parseClosurePreview(rawPreview([acct('x', 'Thabo', 'student')])) }));
    check('no upcoming sessions says so', new RegExp(CLOSE_COPY.noSessions).test(none) && !/will be cancelled and refunded/.test(none));
    check('step 1 says what is deleted and when (30 days, always within 90), listing all 7 lines', /We delete these 30 days after you close, and always within 90 days/.test(html) && DELETED.every((d) => html.includes(d)));
    check('step 1 says what is kept and for how long, all 5 lines', KEPT.every(([what, howLong]) => html.includes(what) && html.includes(howLong)));
    check('step 1 says they can change their mind for 30 days', /You can change your mind for 30 days/.test(html));
    const t = words(view({ preview: parseClosurePreview(TUTOR) }));
    check('a tutor is told the learner is refunded, and a payout owed is shown as a soft block they can go past', /Each learner is refunded in full and told/.test(t) && /You are owed R1250\.00/.test(t) && /You can still go ahead/.test(t) && !isDisabled(view({ preview: parseClosurePreview(TUTOR) }), 'continue'));
    const busy = view({ preview: parseClosurePreview(rawPreview([GUARDIAN], true)) });
    check('a session about to start or an open video room: "Try again after your session" is shown and Continue is off', /Try again after your session/.test(busy) && isDisabled(busy, 'continue'));
    check('with nothing blocking, Continue is on', !isDisabled(view({}), 'continue'));
    check('the stage while loading and the stage after a failed preview are plain', /Checking what closing would do/.test(view({ stage: 'loading', preview: null })) && /role="alert"/.test(view({ stage: 'failed', preview: null, error: CLOSE_COPY.notAvailable })));
  }

  // ================================================================ 2. THE PERSON: step 2, word and password
  {
    check('confirmation is refused until the word is typed (any case, spaces ignored)',
      confirmationProblem('', 'pw') === CLOSE_COPY.needWord && confirmationProblem('CLOS', 'pw') === CLOSE_COPY.needWord && confirmationProblem('CLOSEE', 'pw') === CLOSE_COPY.needWord
      && confirmationProblem('close', 'pw') === null && confirmationProblem('  Close ', 'pw') === null);
    check('...and until a password is entered', confirmationProblem('CLOSE', '') === CLOSE_COPY.needPassword && confirmationProblem('CLOSE', 'x') === null);
    check('someone who signs in with Google only is asked for the word only', confirmationProblem('CLOSE', '', false) === null && confirmationProblem('', '', false) === CLOSE_COPY.needWord);
    const base = { stage: 'confirm' as const, preview: parseClosurePreview(SINGLE) };
    check('the confirm button is off with nothing typed, off with the word but no password, off with a password but a wrong word, on with both',
      isDisabled(view({ ...base, word: '', password: '' }), 'confirm') && isDisabled(view({ ...base, word: 'CLOSE', password: '' }), 'confirm')
      && isDisabled(view({ ...base, word: 'nope', password: 'pw' }), 'confirm') && !isDisabled(view({ ...base, word: 'close', password: 'pw' }), 'confirm'));
    const g = view({ ...base, needsPassword: false, word: 'CLOSE' });
    check('for a Google-only person there is no password box and the button is on once the word is typed', !/closeAccountPassword/.test(g) && !isDisabled(g, 'confirm') && /signed in with Google/.test(g));
    check('the box is asked for as "Type CLOSE" and the password as a password field', /Type CLOSE/.test(view(base)) && /type="password"/.test(view(base)));

    // The calls, in order, against the names the migration defines.
    const ok = fakeClient({ request_account_closure: { data: RESULT_DATA } });
    const r = await requestClosure(ok.client, { word: 'close', password: 'pw', email: 'a@example.invalid' });
    check('a correct word and password: the password is checked first, then request_account_closure runs once', ok.calls.join() === 'auth:signInWithPassword,rpc:request_account_closure' && ok.signIns[0].email === 'a@example.invalid' && ok.args.request_account_closure.p_confirmation === 'close' && ok.args.request_account_closure.p_learner === null);
    check('...and the result is read: 1 account, 1 session, the three dates', r.accountsClosed === 1 && r.sessionsCancelled === 1 && r.deleteBy.startsWith('2027-01-19') && r.undoUntil.startsWith('2026-11-21'));

    const bad = fakeClient({ request_account_closure: { data: RESULT_DATA } }, 'bad');
    let msg = '';
    await requestClosure(bad.client, { word: 'CLOSE', password: 'wrong', email: 'a@example.invalid' }).catch((e) => { msg = e.message; });
    check('a wrong password stops everything: the closing function is never called', msg === CLOSE_COPY.wrongPassword && !bad.calls.includes('rpc:request_account_closure'));
    const blank = fakeClient({});
    let m2 = '';
    await requestClosure(blank.client, { word: 'CLOSE', password: '', email: 'a@example.invalid' }).catch((e) => { m2 = e.message; });
    let m3 = '';
    await requestClosure(blank.client, { word: '', password: 'pw', email: 'a@example.invalid' }).catch((e) => { m3 = e.message; });
    check('a missing password or word makes no call at all', m2 === CLOSE_COPY.needPassword && m3 === CLOSE_COPY.needWord && blank.calls.length === 0);
    const gg = fakeClient({ request_account_closure: { data: RESULT_DATA } });
    await requestClosure(gg.client, { word: 'CLOSE', password: '', email: null });
    check('a Google-only person: no password call, the closing call runs (the database checks the sign-in is fresh)', gg.calls.join() === 'rpc:request_account_closure');
    const prev = fakeClient({ preview_account_closure: { data: SINGLE } });
    await fetchClosurePreview(prev.client);
    check('the preview is asked for with p_learner null for your own account', prev.calls.join() === 'rpc:preview_account_closure' && prev.args.preview_account_closure.p_learner === null);

    // Every refused case, in plain words.
    const refusals: [string, RegExp][] = [
      ['Try again after your session', /^Try again after your session\. A session is about to start or is on now, or a video room is open\.$/],
      ['Type CLOSE to confirm', /^Type CLOSE to confirm\.$/],
      ['Please sign in again to confirm this', /sign out, sign back in, and try again within 10 minutes/],
      ["A learner under 18 can't close their own account. Ask your parent or guardian.", /^A learner under 18 can't close their own account\. Ask your parent or guardian\.$/],
      ['A learner under 18 can’t close their own account. Ask your parent or guardian.', /Ask your parent or guardian/],
      ['Admin accounts are closed another way', /can't be closed here/],
      ['You can only close a learner under 18 who is linked to your account', /linked to yours/],
      ['This account is already closed', /^This account is already closed\.$/],
      ["Refunds aren't set up on this server yet — contact support", /nothing was closed/],
      ['Sign in first', /Please sign in first/],
      ['No such account', /couldn't find that account/],
    ];
    for (const [raw, expected] of refusals) {
      const w = fakeClient({ request_account_closure: { error: { code: 'P0001', message: raw } } });
      let shown = '';
      await requestClosure(w.client, { word: 'CLOSE', password: 'pw', email: 'a@example.invalid' }).catch((e) => { shown = e.message; });
      check(`refused "${raw.slice(0, 48)}" shows its plain sentence`, expected.test(shown), shown);
    }
    const unknown = plainClosureError({ message: 'weird internal failure xyz_secret_table' });
    check('an error the screen does not know never shows its raw text', unknown === CLOSE_COPY.failed && !/xyz_secret/.test(unknown));
    check('a database without the functions (PGRST202) gets the "not available here yet" sentence', plainClosureError({ code: 'PGRST202', message: 'Could not find the function public.preview_account_closure' }) === CLOSE_COPY.notAvailable);
    const throwing = { rpc: async () => { throw new Error('Failed to fetch'); }, auth: { signInWithPassword: async () => ({ error: null }) } } as ClosureClient;
    let net = '';
    await requestClosure(throwing, { word: 'CLOSE', password: 'pw', email: 'a@example.invalid' }).catch((e) => { net = e.message; });
    check('a network failure shows the general sentence, not "Failed to fetch"', net === CLOSE_COPY.failed);
    check('the refusal sentence is drawn as an alert in the confirm step', /role="alert"[^>]*>[\s\S]*Try again after your session/.test(view({ stage: 'confirm', error: plainClosureError({ message: 'Try again after your session' }), word: 'CLOSE', password: 'pw' })));
    const need = ['Try again after your session', "A learner under 18 can''t close their own account. Ask your parent or guardian.", 'Admin accounts are closed another way', 'You can only close a learner under 18 who is linked to your account',
      'This account is already closed', 'Please sign in again to confirm this', 'Type CLOSE to confirm', 'Sign in first', 'No such account'];
    check('every refusal the screens expect is a real message in the migration', need.every((t) => MIGRATION.includes(t)), need.filter((t) => !MIGRATION.includes(t)).join(' | '));
  }

  // ================================================================ 3. A held person
  {
    const pb = bodyOf('preview_account_closure');
    check('the migration gives a held or disputed person the very same preview: the preview function never reads a hold or a dispute, and takes its three text blocks from one shared function',
      pb.length > 0 && !/safety_hold|dispute|on_hold/i.test(pb) && /public\.closure_text\(\) -> 'deleted'/.test(pb) && /public\.closure_text\(\) -> 'kept'/.test(pb) && /public\.closure_text\(\) ->> 'note'/.test(pb));
    check('the generic line in the migration is exactly the sentence legal asked for', MIGRATION.includes(GENERIC_KEPT_LINE.replace(/'/g, "''")) && GENERIC_KEPT_LINE === 'We must keep some records for longer, because the law or an open matter requires it. Privacy Policy §14 says which.');
    const anyone = parseClosurePreview(SINGLE);
    const held = parseClosurePreview({ ...SINGLE }); // the database returns the same object for a held person; the screen has nothing else to go on
    check('the preview a held person gets has exactly the same keys and the same lines as anyone\'s', JSON.stringify(Object.keys(held)) === JSON.stringify(Object.keys(anyone)) && JSON.stringify(held) === JSON.stringify(anyone));
    const heldHtml = view({ preview: held });
    check('the screen shows that one generic line, once, and draws a held person exactly as anyone else', words(heldHtml).split(GENERIC_KEPT_LINE).length === 2 && heldHtml === view({ preview: anyone }));
    // The screen's own words never mention a hold, a report, a dispute or safeguarding (the five kept lines come from the database, the same for everyone).
    const sample = Object.values(CLOSE_COPY).map((v) => (typeof v === 'function' ? String((v as (...a: unknown[]) => unknown)('Ayanda', 1, 'tutor', 'x')) : String(v))).join(' | ');
    const own = sample + ' ' + [CLOSE_COPY.closedTitle, CLOSE_COPY.closedLead].join(' ');
    check('the screens\' own wording never says hold, report, dispute or safeguarding', !/\b(hold|held|report|reports|dispute|safeguard\w*)\b/i.test(own), own.match(/\b(hold|held|reports?|dispute|safeguard\w*)\b/i)?.[0]);
    const closed = words(renderRoot(RootReact.createElement(AccountClosedView, { result: parseResult(), signInHref: '/login', supportEmail: 'support@tutorlage.com' })));
    check('the closing page gives everyone the same generic line, the dates, the undo, and nothing about why', closed.includes(GENERIC_KEPT_LINE) && /Your account is closed/.test(closed) && /1 upcoming session was cancelled and refunded in full/.test(closed) && /support@tutorlage\.com/.test(closed) && !/\b(hold|held|dispute|safeguard\w*)\b/i.test(closed.replace(GENERIC_KEPT_LINE, '')));
    check('without the remembered dates the closing page still reads in full', /within 30 days, and always within 90/.test(words(renderRoot(RootReact.createElement(AccountClosedView, { result: null, signInHref: '/login', supportEmail: 'support@tutorlage.com' })))));
  }

  // ================================================================ 4. THE GUARDIAN
  {
    const p = parseClosurePreview(HOUSEHOLD);
    const pre = words(view({ preview: p }));
    const conf = words(view({ stage: 'confirm', preview: p, word: 'CLOSE', password: 'pw' }));
    check('the household preview and the confirmation list each learner by name', /Closing your account also closes the account of each learner you look after/.test(pre) && /Ayanda/.test(pre) && /Thabo/.test(pre) && /Ayanda/.test(conf) && /Thabo/.test(conf));
    check('...and the sessions of each are counted separately (2, 1 and none)', /2 upcoming sessions/.test(pre) && /1 upcoming session will/.test(pre) && new RegExp(CLOSE_COPY.noSessions).test(pre));
    const one = parseClosurePreview(rawPreview([AYANDA]));
    const learnerPre = words(view({ subject: 'learner', learnerName: 'Ayanda', preview: one }));
    const learnerConf = words(view({ subject: 'learner', learnerName: 'Ayanda', stage: 'confirm', preview: one, word: 'CLOSE', password: 'pw' }));
    check('closing one child: the title and the confirmation name the child and ask for the guardian\'s own password; no household list', /Before you close Ayanda's account/.test(learnerPre) && /To close Ayanda's account, type CLOSE and enter your own password\./.test(learnerConf) && !/each learner you look after/.test(learnerPre + learnerConf));
    const child = fakeClient({ request_account_closure: { data: RESULT_DATA }, preview_account_closure: { data: rawPreview([AYANDA]) } });
    await fetchClosurePreview(child.client, 'l-1');
    await requestClosure(child.client, { word: 'CLOSE', password: 'pw', email: 'guardian@example.invalid', learnerId: 'l-1' });
    check('closing one child passes the child (p_learner) to both calls and checks the guardian\'s own password',
      child.args.preview_account_closure.p_learner === 'l-1' && child.args.request_account_closure.p_learner === 'l-1' && child.signIns[0].email === 'guardian@example.invalid');

    const section = (setup: { mode: 'self' | 'minor' | 'none'; signInEmail: string | null }) =>
      renderRoot(RootReact.createElement(CloseAccountSection, { client: fakeClient().client, setup, onClosed: () => {} }));
    const minor = section({ mode: 'minor', signInEmail: null });
    check('a learner under 18 sees no close button at all, only the line pointing to their guardian', !/<button/.test(minor) && words(minor).includes(CLOSE_COPY.minorNote));
    check('an admin sees nothing (admin accounts are closed another way)', section({ mode: 'none', signInEmail: null }) === '');
    check('an adult learner, a guardian or a tutor sees "Close my account…"', /<button[^>]*>Close my account…<\/button>/.test(section({ mode: 'self', signInEmail: 'a@example.invalid' })));

    const s = (role: string | undefined, minorLearner: boolean, email: string | undefined, providers?: string[]) => closeAccountSetup({ role, isViewOnlyLearner: minorLearner, email, providers });
    check('who gets what: admin none, learner under 18 minor, everyone else self', s('admin', false, 'a@x.invalid').mode === 'none' && s('student', true, 'a@x.invalid').mode === 'minor' && ['student', 'parent', 'tutor'].every((r) => s(r, false, 'a@x.invalid').mode === 'self'));
    check('the password check uses the sign-in address, and is skipped for Google-only people', s('parent', false, 'a@x.invalid', ['email']).signInEmail === 'a@x.invalid' && s('parent', false, 'a@x.invalid', ['email', 'google']).signInEmail === 'a@x.invalid'
      && s('parent', false, 'a@x.invalid', undefined).signInEmail === 'a@x.invalid' && s('parent', false, 'a@x.invalid', ['google']).signInEmail === null && s('parent', false, undefined, ['email']).signInEmail === null);

    const learnersSrc = read('src/components/LearnersPanel.tsx');
    check('the learners panel offers "Close this learner\'s account" only to a signed-in person who may close (mode "self"), opens the flow for that child, and does not sign the guardian out',
      /closeSetup && closeSetup\.mode === 'self' && closeLearnerId !== learner\.id/.test(learnersSrc) && /Close this learner&apos;s account/.test(learnersSrc)
      && /learner=\{\{ id: learner\.id, name: learner\.firstName \}\}/.test(learnersSrc) && !/signOut|rememberClosure/.test(learnersSrc));
    const appSrc = read('src/App.tsx');
    const hook = appSrc.indexOf('const handleAccountClosed');
    const seg = appSrc.slice(hook, hook + 400);
    check('closing your own account: App remembers the result, signs out, then lands on the public closing page (in that order)', hook > 0 && seg.indexOf('rememberClosure') < seg.indexOf('signOut()') && seg.indexOf('signOut()') < seg.indexOf("siteUrl('/account-closed')"));
    check('the closing page is a public route, and the modal and the learners panel are given the setup', /path="\/account-closed"/.test(read('src/main.tsx')) && /closeSetup=\{closeSetup\}\s+onAccountClosed=\{handleAccountClosed\}/.test(appSrc) && /closeSetup=\{closeSetup\}/.test(appSrc));
    check('the modal puts the section on the Account Details tab', /<CloseAccountSection[\s\S]*onClosed=\{onAccountClosed\}/.test(read('src/components/ManageAccountModal.tsx')));
    const store: Record<string, string> = {};
    rememberClosure(parseResult(), { setItem: (k, v) => { store[k] = v; } });
    const back = recallClosure({ getItem: (k) => store[k] ?? null });
    check('the dates survive the sign-out through session storage; with no storage, or storage that throws, the page still works', back?.deleteBy === '2027-01-19T01:10:00Z' && recallClosure(null) === null
      && recallClosure({ getItem: () => { throw new Error('blocked'); } }) === null && (() => { try { rememberClosure(parseResult(), { setItem: () => { throw new Error('full'); } }); return true; } catch { return false; } })());
  }

  // ================================================================ 5. THE ADMIN
  {
    const row = (over: Record<string, unknown> = {}) => ({
      closure_id: 'c-1', profile_id: 'p-1', role: 'student', display_name: 'Lerato Mokoena', email: 'lerato@example.invalid', status: 'closed', started_how: 'self', asked_by: null,
      how_verified: null, reference: null, note: null, household_of: null, closed_at: '2026-10-20T08:00:00Z', due_at: '2026-11-19T01:10:00Z', outer_limit_at: '2027-01-18T01:10:00Z',
      undo_until: '2026-11-19T01:10:00Z', on_hold: false, deferred_until: null, deferred_reason: null, open_dispute: false, sessions_cancelled: 2, cards_kept: false, payout_kept: false,
      open_tasks: 0, overdue: false, last_error: null, record: null, ...over,
    });
    const NOW = new Date('2026-10-22T10:00:00Z');
    const list = fakeClient({ list_account_closures: { data: [
      row(),
      row({ closure_id: 'c-2', display_name: 'Held Person', role: 'tutor', started_how: 'admin_request', asked_by: 'Held Person', how_verified: 'registered email', reference: 'MAIL-1', on_hold: true, open_dispute: true }),
      row({ closure_id: 'c-3', display_name: 'Deferred Parent', role: 'parent', deferred_until: '2026-12-01T00:00:00Z', deferred_reason: 'refund unconfirmed' }),
      row({ closure_id: 'c-4', display_name: 'Finished Person', status: 'done', undo_until: '2026-10-01T00:00:00Z' }),
      row({ closure_id: 'c-5', display_name: 'Late Person', status: 'db_deleted', overdue: true, last_error: 'paystack said no' }),
    ] } });
    const got = await fetchAccountClosures(list.client);
    check('the list is asked for with list_account_closures and p_include_finished, and read row by row', list.calls.join() === 'rpc:list_account_closures' && list.args.list_account_closures.p_include_finished === false && got.state === 'ok' && got.rows.length === 5 && got.rows[1].onHold === true);
    const html = renderAdmin(AdminReact.createElement(AccountClosuresBody, { list: got, client: list.client, onChanged: () => {}, now: NOW }));
    const text = words(html);
    check('each closure shows who, role, who started it, closed on, the day-30 date, the status', /Lerato Mokoena/.test(text) && /Learner · started by The person/.test(text) && /Tutor · started by An admin, on a written request/.test(text) && /Day 30:/.test(text) && /Closed, waiting for day 30/.test(text) && /Done/.test(text));
    check('held, disputed and deferred closures say so (the admin may see it); a finished one cannot be undone or deferred; a late one shows its error',
      /On a safety hold: nothing about them is deleted/.test(text) && /Open dispute/.test(text) && /Deletion waits until[^|]*refund unconfirmed/.test(text) && /Past the 90-day limit/.test(text) && /Last error: paystack said no/.test(text));
    check('the written request (who asked, how checked, reference) is shown', /Asked by Held Person · checked: registered email · reference MAIL-1/.test(text));
    const undoCount = (html.match(/data-action="undo"/g) ?? []).length;
    const deferCount = (html.match(/data-action="defer"/g) ?? []).length;
    check('Undo is offered only to closures still inside their 30 days (3 of 5); Defer to closed and half-deleted ones (4 of 5)', undoCount === 3 && deferCount === 4, `${undoCount}/${deferCount}`);
    check('"Stop waiting" is offered only where a waiting date stands', (html.match(/data-action="clear-defer"/g) ?? []).length === 1);
    const missingFns: [string, { code?: string; message?: string }][] = [['PGRST202', { code: 'PGRST202', message: 'Could not find the function public.list_account_closures' }], ['42883', { code: '42883', message: 'function does not exist' }], ['message only', { message: 'could not find the function public.list_account_closures(p_include_finished) in the schema cache' }]];
    for (const [label, err] of missingFns) {
      const miss = await fetchAccountClosures(fakeClient({ list_account_closures: { error: err } }).client);
      check(`when the migration is absent (${label}) the page gets a plain note, not an error`, miss.state === 'not_active' && miss.note === CLOSURES_NOT_ACTIVE);
    }
    const notActiveHtml = words(renderAdmin(AdminReact.createElement(AccountClosuresBody, { list: { state: 'not_active', note: CLOSURES_NOT_ACTIVE }, client: list.client, onChanged: () => {} })));
    check('the "not active on this database" note is drawn instead of the list', /not active on this database/.test(notActiveHtml) && !/Day 30/.test(notActiveHtml));
    check('an empty list says so', /No account is waiting to be deleted/.test(words(renderAdmin(AdminReact.createElement(AccountClosuresBody, { list: { state: 'ok', rows: [] }, client: list.client, onChanged: () => {} })))));
    let notAdmin = '';
    await fetchAccountClosures(fakeClient({ list_account_closures: { error: { code: '42501', message: 'Admins only' } } }).client).catch((e) => { notAdmin = e.message; });
    check('a non-admin is refused in plain words', notAdmin === 'Only admins can see this list.');

    // The "Close on a written request" form: every field required.
    const good = { profileId: 'p-1', askedBy: 'Lerato Mokoena', howVerified: 'Email from her registered address', reference: 'MAIL-2026-114', requestedOn: '2026-10-20', reason: 'She asked to leave Tutorlage' };
    check('a filled-in form passes', closeFormProblem(good, NOW) === null);
    for (const k of Object.keys(good) as (keyof typeof good)[]) {
      const w = fakeClient({});
      const r = await closeOnRequest(w.client, { ...good, [k]: '' }, NOW);
      const spaces = await closeOnRequest(w.client, { ...good, [k]: '   ' }, NOW);
      check(`a blank "${k}" blocks the form and makes no call`, !r.ok && !spaces.ok && w.calls.length === 0 && closeFormProblem({ ...good, [k]: '' }, NOW) !== null);
    }
    check('a date in the future, and a two-letter answer, are refused', closeFormProblem({ ...good, requestedOn: '2026-12-31' }, NOW) !== null && closeFormProblem({ ...good, reference: 'ab' }, NOW) !== null);
    const closeCall = fakeClient({ admin_close_account: { data: { accounts_closed: 1, sessions_cancelled: 2 } } });
    const done = await closeOnRequest(closeCall.client, good, NOW);
    const sent = closeCall.args.admin_close_account;
    check('a good form calls admin_close_account once with the migration\'s own argument names and basis "person_request"', done.ok && closeCall.calls.join() === 'rpc:admin_close_account' && sameSet(Object.keys(sent), paramsOf('admin_close_account') ?? ['?']) && sent.p_basis === 'person_request' && sent.p_profile === 'p-1' && sent.p_note === good.reason);
    check('...and the day they asked is sent as a moment that is not in the future', typeof sent.p_requested_on === 'string' && new Date(sent.p_requested_on as string).getTime() <= NOW.getTime());
    const heldRefusal = fakeClient({ admin_close_account: { error: { code: '42501', message: 'This person is on a safety hold: only the safeguarding lead can close it on a request' } } });
    const refusedHeld = await closeOnRequest(heldRefusal.client, good, NOW);
    check('an admin who may not close a held person sees the database\'s sentence as it is (the person never does)', !refusedHeld.ok && /safety hold: only the safeguarding lead/.test(refusedHeld.message));
    const notAdminClose = await closeOnRequest(fakeClient({ admin_close_account: { error: { code: '42501', message: 'Admins only' } } }).client, good, NOW);
    check('closing, undoing and deferring are refused for a non-admin in plain words', !notAdminClose.ok && notAdminClose.message === 'Only admins can do this.');

    const goodUndo = { askedBy: 'Lerato Mokoena', howVerified: 'Phoned her registered number', note: 'Changed her mind' };
    for (const k of Object.keys(goodUndo) as (keyof typeof goodUndo)[]) {
      const w = fakeClient({});
      const r = await undoClosure(w.client, 'c-1', { ...goodUndo, [k]: '' });
      check(`undo: a blank "${k}" blocks it and makes no call`, !r.ok && w.calls.length === 0);
    }
    const undoCall = fakeClient({ undo_account_closure: { data: { reopened: 1 } } });
    const undone = await undoClosure(undoCall.client, 'c-1', goodUndo);
    check('undo calls undo_account_closure with the migration\'s argument names', undone.ok && undoCall.calls.join() === 'rpc:undo_account_closure' && sameSet(Object.keys(undoCall.args.undo_account_closure), paramsOf('undo_account_closure') ?? ['?']) && undoCall.args.undo_account_closure.p_closure === 'c-1');
    const refusedUndo = await undoClosure(fakeClient({ undo_account_closure: { error: { message: 'This closure can no longer be undone (deletion has started, or the time is up)' } } }).client, 'c-1', goodUndo);
    check('a closure that can no longer be undone says so', !refusedUndo.ok && /can no longer be undone/.test(refusedUndo.message));

    for (const bad of [{ until: '', reason: 'refund waiting' }, { until: '2026-12-01', reason: '' }, { until: '2026-10-01', reason: 'refund waiting' }]) {
      const w = fakeClient({});
      const r = await deferClosure(w.client, 'c-1', bad, NOW);
      check(`defer: ${JSON.stringify(bad)} is blocked and makes no call`, !r.ok && w.calls.length === 0);
    }
    const deferCall = fakeClient({ defer_account_closure: { data: null } });
    const deferred = await deferClosure(deferCall.client, 'c-1', { until: '2026-12-01', reason: 'refund unconfirmed' }, NOW);
    check('defer calls defer_account_closure with the migration\'s argument names', deferred.ok && sameSet(Object.keys(deferCall.args.defer_account_closure), paramsOf('defer_account_closure') ?? ['?']) && deferCall.args.defer_account_closure.p_until === '2026-12-01');
    const clearCall = fakeClient({});
    await clearDeferral(clearCall.client, 'c-1');
    check('"Stop waiting" sends a null date', clearCall.args.defer_account_closure.p_until === null && clearCall.args.defer_account_closure.p_reason === null);
    const absent = await closeOnRequest(fakeClient({ admin_close_account: { error: { code: 'PGRST202', message: 'Could not find the function' } } }).client, good, NOW);
    check('closing before the migration exists gives the plain "not active" note', !absent.ok && absent.message === CLOSURES_NOT_ACTIVE);

    const formHtml = renderAdmin(AdminReact.createElement(CloseOnRequestForm, { client: list.client, findPeople: async () => [], onClosed: () => {} }));
    check('the form has all five written fields plus the person search, each required, and the button starts off', ['closeAskedBy', 'closeHowVerified', 'closeReference', 'closeRequestedOn', 'closeReason'].every((id) => new RegExp(`<input id="${id}"[^>]*required`).test(formHtml))
      && /closePersonSearch/.test(formHtml) && isDisabled(formHtml, 'close-on-request'));

    // The names the code uses are the names the migration defines, and the admin functions refuse non-admins.
    const used: [string, string[]][] = [['preview_account_closure', ['p_learner']], ['request_account_closure', ['p_confirmation', 'p_learner']], ['list_account_closures', ['p_include_finished']]];
    for (const [fn, names] of used) check(`the migration defines ${fn}(${names.join(', ')}) as the screens call it`, sameSet(paramsOf(fn) ?? ['?'], names), String(paramsOf(fn)));
    check('admin_close_account, undo_account_closure, defer_account_closure and list_account_closures all refuse anyone who is not an active admin', ['admin_close_account', 'undo_account_closure', 'defer_account_closure', 'list_account_closures'].every((fn) => /not public\.is_active_admin\(\)/.test(bodyOf(fn)) && /Admins only/.test(bodyOf(fn))));
    check('only a super admin may read a tombstone, and the new screens do not call it', /closure_is_super_admin\(\)/.test(bodyOf('read_account_tombstone')) && !/read_account_tombstone/.test([read('admin/src/lib/accountClosures.ts'), read('admin/src/components/AccountClosuresBody.tsx'), read('admin/src/components/CloseOnRequestForm.tsx'), read('admin/src/pages/AccountClosures.tsx')].join()));
    check('the admin menu and routes carry the new page', /to: '\/account-closures'/.test(read('admin/src/components/AdminLayout.tsx')) && /path="account-closures"/.test(read('admin/src/App.tsx')));
  }

  // ================================================================ 6. What the new files do not do
  {
    const files = [
      'src/lib/closeAccount.ts', 'src/components/CloseAccountView.tsx', 'src/components/CloseAccountFlow.tsx', 'src/components/CloseAccountSection.tsx', 'src/components/AccountClosedView.tsx',
      'src/pages/AccountClosed.tsx', 'admin/src/lib/accountClosures.ts', 'admin/src/components/AccountClosuresBody.tsx', 'admin/src/components/CloseOnRequestForm.tsx', 'admin/src/pages/AccountClosures.tsx',
      'scripts/dev/close-account-screens-test.ts',
    ];
    const code = (f: string) => read(f).replace(/\/\/.*$/gm, '');
    const offenders = files.filter((f) => f !== 'scripts/dev/close-account-screens-test.ts' && /\bfetch\(|apiUrl|from '\.\.\/lib\/api'|\.storage\b|createSignedUrl|\/api\/|close-account\/run|job-secret|CLOSE_ACCOUNT_JOB/.test(code(f)));
    check('the screens never call the Worker or Storage directly (no fetch, no api address, no storage, no job route or secret)', offenders.length === 0, offenders.join());
    const direct = files.filter((f) => f !== 'scripts/dev/close-account-screens-test.ts' && /\.from\(['"`]/.test(code(f)));
    check('the screens read no table directly: only the database functions named above', direct.length === 0, direct.join());
    const keyShaped = new RegExp(['sk_' + 'live', 'pk_' + 'live', 'sk_' + 'test', 'whsec' + '_', 'service' + '_role', 'eyJ' + 'hbGci'].join('|'));
    check('no key-shaped text in the new files', !files.some((f) => keyShaped.test(read(f))), files.filter((f) => keyShaped.test(read(f))).join());
    const rpcNames = new Set<string>();
    for (const f of files.filter((x) => x !== 'scripts/dev/close-account-screens-test.ts')) for (const m of code(f).matchAll(/rpc\(\s*'([a-z_]+)'/g)) rpcNames.add(m[1]);
    check('every database function the new screens call is defined by the migration', [...rpcNames].length === 6 && [...rpcNames].every((n) => paramsOf(n) !== null), [...rpcNames].join());
    check('the word the person types is the word the database waits for', CLOSE_WORD === 'CLOSE' && /<> 'CLOSE'/.test(MIGRATION));
  }

  console.log(failed === 0 ? '\nall checks passed' : `\n${failed} check(s) FAILED`);
  process.exit(failed === 0 ? 0 : 1);
}

function parseResult() {
  return { accountsClosed: 1, sessionsCancelled: 1, deleteAfter: '2026-11-21T01:10:00Z', deleteBy: '2027-01-19T01:10:00Z', undoUntil: '2026-11-21T01:10:00Z' };
}

main();
