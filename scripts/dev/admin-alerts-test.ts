// Checks on the ADMIN BACKGROUND NOTIFICATIONS (wallet phase 5; CEO, 2 Nov 2026: "it should run in the background"). Run: npx tsx scripts/dev/admin-alerts-test.ts
// Proves, with a fake database client, a fake clock and a fake memory: each role gets exactly the alerts of the pages its menu shows (compared with the menu in the
// source); every alert asks the same question as its page, with only an id column (so no name, amount, document or bank detail can reach a notification); a new
// item gives ONE notification and the same item is never announced twice, not even after a restart; many at once, a long gap (PC off or asleep), a mute and the hourly
// limit each fold into ONE summary; a muted or signed-out round reads nothing and remembers nothing; a switched-off alert is not even asked; a failing read says
// nothing and loses nothing; a lapsed sign-in is announced once. By reading the sources: the desktop program hides to the tray instead of quitting, starts with Windows,
// keeps the sign-in encrypted (safeStorage, never plain text), checks every call's sender, and only opens plain in-app addresses; the page side uses the encrypted
// storage only inside the desktop app. It does NOT show a real Windows notification (the packaged-app smoke check does that on this PC) and does NOT run against the
// database (the questions are the pages' own; the real data is empty until phase 7). Listed under P3 in the report.
import { readFileSync } from 'node:fs';
import http from 'node:http';
import { createClient } from '@supabase/supabase-js';
import { fakeAccessToken, startFakeAuth } from './fake-auth';
import { createRequire } from 'node:module';
import {
  CATCH_UP_AFTER_MS, CHECK_EVERY_MS, MAX_SEPARATE_TOASTS, MAX_TOASTS_PER_HOUR, WATCHERS, WATCHER_IDS, emptyState, isAuthError, lapseToast, loadLink, nextLink, runAlertRound,
  saveLink, sinceText, storageAlertStore, watchersForRole, type AlertClient, type AlertState, type RoundResult, type Toast, type WatcherId,
} from '../../admin/src/lib/adminAlerts';
import { getDesktopBridge, noteManualSignOut, secureAuthStorage, wasManualSignOut } from '../../admin/src/lib/desktopBridge';
import { NotificationsBody } from '../../admin/src/components/NotificationsBody';
import { walletTabFromSearch } from '../../admin/src/components/WalletTabs';
import type { AdminRole } from '../../admin/src/types';

const adminRequire = createRequire(new URL('../../admin/package.json', import.meta.url));
const React = adminRequire('react') as typeof import('react');
const { renderToStaticMarkup } = adminRequire('react-dom/server') as typeof import('react-dom/server');
const html = (el: React.ReactElement) => renderToStaticMarkup(el);

let failed = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) failed += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && detail ? ` [${detail}]` : ''}`);
}
const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// ---- fakes -------------------------------------------------------------------------------------------------------------------------------------------
type Row = Record<string, unknown>;
interface Call { table: string; cols: string; filters: string[] }
interface World {
  tutors: string[]; disputes: string[]; payments: string[]; subjects: string[]; schoolResults: string[]; tier1: string[]; topups: string[]; payouts: string[];
  mismatch: string[]; bank: string[]; errors: string[]; closures: string[];
  // known errors that were reported again recently: what the spike question gets back (id and running count)
  spikes: { id: string; occurrences: number }[];
  fail: Partial<Record<string, { code?: string; message?: string; status?: number }>>;   // table -> error
}
const newWorld = (): World => ({ tutors: [], disputes: [], payments: [], subjects: [], schoolResults: [], tier1: [], topups: [], payouts: [], mismatch: [], bank: [], errors: [], closures: [], spikes: [], fail: {} });
const ids = (list: string[]): Row[] => list.map((id) => ({ id }));

function fakeClient(world: World, opts: { session?: boolean } = {}) {
  const calls: Call[] = [];
  const client: AlertClient = {
    auth: { getSession: async () => ({ data: { session: opts.session === false ? null : { user: { id: 'admin-1' } } } }) },
    from(table: string) {
      const call: Call = { table, cols: '', filters: [] };
      calls.push(call);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const b: any = {};
      for (const m of ['eq', 'in', 'is', 'gte', 'lt', 'order', 'limit', 'or']) b[m] = (...args: unknown[]) => { call.filters.push(`${m}(${args.map((a) => JSON.stringify(a)).join(',')})`); return b; };
      b.select = (cols: string) => { call.cols = cols; return b; };
      b.then = (resolve: (v: { data: unknown; error: unknown }) => void) => {
        const error = world.fail[table];
        if (error) return resolve({ data: null, error });
        const has = (frag: string) => call.filters.some((f) => f.includes(frag));
        const data: Row[] =
          table === 'tutor_verification_documents' ? world.tutors.flatMap((t) => [{ tutor_id: t }, { tutor_id: t }]) :   // two documents each: still one tutor
          table === 'platform_disputes' ? ids(world.disputes) :
          table === 'session_requests' ? ids(world.payments) :
          table === 'tutor_subject_competencies' ? ids(world.subjects) :
          table === 'school_results' ? ids(world.schoolResults) :
          table === 'tier1_academic_records' ? ids(world.tier1) :
          table === 'wallet_topups' ? ids(world.topups) :
          table === 'payout_requests' ? ids(world.payouts) :
          table === 'client_errors' ? (call.cols === 'id, occurrences' ? world.spikes : ids(world.errors)) :
          table === 'notifications' ? ids(has('"wallet_mismatch"') ? world.mismatch : has('"wallet_bank_changed"') ? world.bank : has('"closure_step_failed"') ? world.closures : []) : [];
        return resolve({ data, error: null });
      };
      return b;
    },
  };
  return { client, calls };
}
function memoryStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => (m.has(k) ? (m.get(k) as string) : null), setItem: (k: string, v: string) => { m.set(k, v); }, map: m };
}

const T0 = Date.UTC(2026, 10, 3, 8, 0, 0);   // 3 Nov 2026, 10:00 in South Africa
function harness(role: AdminRole, world: World, storage = memoryStorage(), opts: { session?: boolean; muted?: () => boolean } = {}) {
  const fc = fakeClient(world, { session: opts.session });
  const shown: Toast[] = [];
  const h = {
    clock: T0, storage, ...fc, shown, role,
    round(): Promise<RoundResult> {
      return runAlertRound({
        client: fc.client, adminId: 'admin-1', role, now: () => h.clock, store: storageAlertStore(storage),
        show: (t) => { shown.push(t); }, isMuted: () => (opts.muted ? opts.muted() : false),
      });
    },
  };
  return h;
}

async function main() {
  // ---- who gets what: the same roles as the menu ---------------------------------------------------------------------------------------------------
  const layout = read('admin/src/components/AdminLayout.tsx');
  const nav = [...layout.matchAll(/\{ to: '([^']+)', label: '[^']+', icon: \w+, roles: \[([^\]]*)\] \}/g)].map((m) => ({ to: m[1], roles: [...m[2].matchAll(/'(\w+)'/g)].map((x) => x[1]).sort() }));
  check('the menu was read from the source', nav.length >= 15, String(nav.length));
  for (const w of WATCHERS) {
    const page = nav.find((n) => n.to === w.route.split('?')[0]);
    check(`${w.id}: same roles as its page's menu entry (${w.route.split('?')[0]})`, !!page && JSON.stringify([...w.roles].sort()) === JSON.stringify(page.roles), JSON.stringify({ w: w.roles, page: page?.roles }));
  }
  const idsFor = (role: AdminRole) => watchersForRole(role).map((w) => w.id).sort().join(',');
  check('support agent: disputes and account closures', idsFor('support_agent') === 'closure_stuck,dispute', idsFor('support_agent'));
  check('verification officer: tutors, subjects, school results, Tier 1, account closures', idsFor('verification_officer') === 'closure_stuck,school_result,subject_approval,tier1_record,tutor_verification', idsFor('verification_officer'));
  check('finance manager: the five money alerts', idsFor('finance_manager') === 'payment_attention,wallet_bank_changed,wallet_mismatch,wallet_payout,wallet_topup', idsFor('finance_manager'));
  check('super admin: all 13 (the 11 of phase 5 + a closure alert + the error-spike alert)', watchersForRole('super_admin').length === 13 && WATCHER_IDS.length === 13);
  check('no role, no alerts', watchersForRole(null).length === 0 && watchersForRole(undefined).length === 0);
  check('the three wallet entries the CEO asked for are there (proof sent, payout requested, balance mismatch/wallet alert)', ['wallet_topup', 'wallet_payout', 'wallet_mismatch', 'wallet_bank_changed'].every((id) => WATCHER_IDS.includes(id as WatcherId)));
  check('every alert is on the Notifications menu entry for all four roles', /to: '\/notifications', label: 'Notifications', icon: Bell, roles: \['support_agent', 'verification_officer', 'finance_manager', 'super_admin'\]/.test(layout));

  // ---- the questions asked: the pages' own, one id column ------------------------------------------------------------------------------------------
  const all = newWorld();
  const full = harness('super_admin', all);
  await full.round();
  const asked = (table: string, frag = '') => full.calls.find((c) => c.table === table && c.filters.join(' ').includes(frag));
  check('verification: documents pending or under review, tutor_id only', asked('tutor_verification_documents')?.cols === 'tutor_id' && asked('tutor_verification_documents')?.filters.join(' ').includes('"pending","under_review"') === true);
  check('disputes: status open, id only', asked('platform_disputes')?.cols === 'id' && asked('platform_disputes')?.filters.join(' ').includes('"status","open"') === true);
  check('subjects: pending, under review or no status', asked('tutor_subject_competencies')?.filters.join(' ').includes('verification_status.is.null,verification_status.in.(pending,under_review)') === true);
  check('school results and Tier 1: status pending', asked('school_results')?.filters.join(' ').includes('"status","pending"') === true && asked('tier1_academic_records')?.filters.join(' ').includes('"status","pending"') === true);
  check('top-ups: proof_sent; payouts: requested', asked('wallet_topups')?.filters.join(' ').includes('"status","proof_sent"') === true && asked('payout_requests')?.filters.join(' ').includes('"status","requested"') === true);
  check('wallet alerts: THIS admin\'s own unread notices of the two types', asked('notifications', 'wallet_mismatch')?.filters.join(' ').includes('"profile_id","admin-1"') === true && asked('notifications', 'wallet_mismatch')?.filters.join(' ').includes('is("read_at",null)') === true && !!asked('notifications', 'wallet_bank_changed'));
  check('errors: kinds first seen in the last 7 days', asked('client_errors')?.filters.join(' ').includes('gte("first_seen"') === true);
  const pageFilter = /\.or\('([^']+)'\)/.exec(read('admin/src/lib/queries.ts').slice(read('admin/src/lib/queries.ts').indexOf('fetchPaymentsNeedingAttention')))?.[1];
  check('card payments: the very filter of the Payments page "Needs a person" list', !!pageFilter && asked('session_requests')?.filters.join(' ').includes(JSON.stringify(pageFilter).slice(1, -1).replace(/\\"/g, '\\"')) === true, String(pageFilter));
  check('every question selects ONLY an id column (no name, amount, reference, document or bank column can reach a notification); the spike question adds the running count and nothing else',
    full.calls.every((c) => c.cols === 'id' || c.cols === 'tutor_id' || (c.table === 'client_errors' && c.cols === 'id, occurrences')), full.calls.map((c) => c.cols).join('|'));
  check('closure alert: THIS admin\'s own unread closure_step_failed / closure_overdue notices of the last 7 days',
    asked('notifications', 'closure_step_failed')?.filters.join(' ').includes('"profile_id","admin-1"') === true && asked('notifications', 'closure_step_failed')?.filters.join(' ').includes('"closure_step_failed","closure_overdue"') === true
    && asked('notifications', 'closure_step_failed')?.filters.join(' ').includes('is("read_at",null)') === true && asked('notifications', 'closure_step_failed')?.filters.join(' ').includes('gte("created_at"') === true);
  check('spike alert: known errors (first seen before a day ago), reported again within 2 hours, with a count of at least 16',
    asked('client_errors', 'lt("first_seen"')?.filters.join(' ').includes('gte("last_seen"') === true && asked('client_errors', 'lt("first_seen"')?.filters.join(' ').includes('gte("occurrences",16)') === true);
  check('the database names the two closure notice types exactly as the close-account migration writes them', /notify_active_admins\('closure_overdue'/.test(read('supabase/migrations/20261021140000_close_account.sql')) && /notify_active_admins\('closure_step_failed'/.test(read('supabase/migrations/20261021140000_close_account.sql')));

  // ---- one notification per new item, never twice ---------------------------------------------------------------------------------------------------
  const w1 = newWorld();
  const a = harness('verification_officer', w1);
  let r = await a.round();
  check('nothing waiting, first look: nothing shown, but remembered', r.toasts.length === 0 && r.firstRun && a.shown.length === 0 && storageAlertStore(a.storage).loadState('admin-1').lastCheckedAt === T0);
  a.clock += CHECK_EVERY_MS;
  w1.tutors = ['t-1'];
  r = await a.round();
  check('a tutor appears: ONE notification, the page it opens, a count', r.toasts.length === 1 && r.toasts[0].title === 'Tutor verification' && r.toasts[0].body === '1 tutor is waiting to be verified.' && r.toasts[0].route === '/verification', JSON.stringify(r.toasts));
  check('two documents from one tutor are one tutor', r.toasts.length === 1);
  a.clock += CHECK_EVERY_MS;
  r = await a.round();
  check('next round, nothing changed: nothing shown', r.toasts.length === 0 && a.shown.length === 1);
  const restarted = harness('verification_officer', w1, a.storage);
  restarted.clock = a.clock + CHECK_EVERY_MS;
  r = await restarted.round();
  check('after a restart (a new run reading the same memory): still nothing repeated', r.toasts.length === 0 && !r.firstRun);
  w1.tutors = ['t-1', 't-2', 't-3'];
  restarted.clock += CHECK_EVERY_MS;
  r = await restarted.round();
  check('two more arrive: ONE notification with the new count and the total', r.toasts.length === 1 && r.toasts[0].body === '2 tutors are waiting to be verified (3 waiting in all).', r.toasts[0]?.body);
  w1.tutors = ['t-2'];
  restarted.clock += CHECK_EVERY_MS;
  r = await restarted.round();
  check('some are decided (the list shrinks): nothing shown', r.toasts.length === 0);
  w1.tutors = ['t-2', 't-1'];
  restarted.clock += CHECK_EVERY_MS;
  r = await restarted.round();
  check('a tutor who left the list and comes back counts as new again', r.toasts.length === 1 && r.toasts[0].body.startsWith('1 tutor is waiting'), r.toasts[0]?.body);

  // ---- the wallet entries ------------------------------------------------------------------------------------------------------------------------------
  const wm = newWorld();
  const f = harness('finance_manager', wm);
  await f.round();
  f.clock += CHECK_EVERY_MS;
  wm.topups = ['p-1'];
  r = await f.round();
  check('a proof is sent: "1 payment proof is waiting", opens Payments, Top-ups, no name or amount', r.toasts.length === 1 && r.toasts[0].body === '1 payment proof is waiting.' && r.toasts[0].route === '/payouts?wallet=topups' && !/R\s?\d/.test(r.toasts[0].body));
  f.clock += CHECK_EVERY_MS;
  wm.payouts = ['o-1'];
  r = await f.round();
  check('a payout is requested: "1 payout is waiting to be paid", opens Payout requests', r.toasts.length === 1 && r.toasts[0].body === '1 payout is waiting to be paid.' && r.toasts[0].route === '/payouts?wallet=payouts');
  f.clock += CHECK_EVERY_MS;
  wm.mismatch = ['n-1'];
  r = await f.round();
  check('a balance mismatch: says so, opens the Wallets tab', r.toasts.length === 1 && r.toasts[0].body === 'The balance check found a wallet that does not add up.' && r.toasts[0].route === '/payouts?wallet=wallets');
  f.clock += CHECK_EVERY_MS;
  wm.bank = ['n-2'];
  r = await f.round();
  check("a bank-details change: says so without who or what, opens Wallet settings", r.toasts.length === 1 && r.toasts[0].body === "Tutorlage's bank details were changed." && r.toasts[0].route === '/payouts?wallet=settings');
  check('the deep links name tabs the Payments page knows', ['topups', 'payouts', 'wallets', 'settings'].every((t) => walletTabFromSearch(t) === t) && walletTabFromSearch('x') === undefined && walletTabFromSearch(null) === undefined);
  check('the Payments page reads the link and the tabs take a first tab', /useSearchParams/.test(read('admin/src/pages/Payouts.tsx')) && /initialTab=\{walletTab\}/.test(read('admin/src/pages/Payouts.tsx')) && /initialTab \?\? 'topups'/.test(read('admin/src/components/WalletTabs.tsx')));
  check('a verification officer is never asked about money', (await (async () => { const v = harness('verification_officer', newWorld()); await v.round(); return v.calls.every((c) => !['wallet_topups', 'payout_requests', 'session_requests'].includes(c.table) && !(c.table === 'notifications' && c.filters.join(' ').includes('wallet_'))); })()));

  // ---- the two small adds of phase 6: account closures that need a person, and a known error suddenly repeating ------------------------------------------
  const wc = newWorld();
  const cl = harness('support_agent', wc);
  await cl.round();
  cl.clock += CHECK_EVERY_MS;
  wc.closures = ['n-c1'];
  r = await cl.round();
  check('a closure step fails five times (or a closure is overdue): "1 account closure needs a person", opens Account closures, no name or error text',
    r.toasts.length === 1 && r.toasts[0].title === 'Account closure' && r.toasts[0].body === '1 account closure needs a person.' && r.toasts[0].route === '/account-closures' && !/R\s?\d/.test(r.toasts[0].body), JSON.stringify(r.toasts));
  cl.clock += CHECK_EVERY_MS;
  r = await cl.round();
  check('the same closure is not announced again', r.toasts.length === 0);
  cl.clock += CHECK_EVERY_MS;
  wc.closures = ['n-c1', 'n-c2', 'n-c3'];
  r = await cl.round();
  check('two more: one notification with the new count and the total', r.toasts.length === 1 && r.toasts[0].body === '2 account closures need a person (3 waiting in all).', r.toasts[0]?.body);
  const wsp = newWorld();
  const sp = harness('super_admin', wsp);
  await sp.round();
  sp.clock += CHECK_EVERY_MS;
  wsp.spikes = [{ id: 'e-1', occurrences: 20 }];
  r = await sp.round();
  check('a known error reaches 20 reports: "1 known error is repeating a lot", opens Errors, no error text',
    r.toasts.length === 1 && r.toasts[0].title === 'Error repeating' && r.toasts[0].body === '1 known error is repeating a lot.' && r.toasts[0].route === '/errors', JSON.stringify(r.toasts));
  sp.clock += CHECK_EVERY_MS;
  wsp.spikes = [{ id: 'e-1', occurrences: 31 }];
  r = await sp.round();
  check('still the same doubling mark (16 to 31): not announced again', r.toasts.length === 0);
  sp.clock += CHECK_EVERY_MS;
  wsp.spikes = [{ id: 'e-1', occurrences: 33 }];
  r = await sp.round();
  check('it passes the next mark (32): announced once more', r.toasts.length === 1 && r.toasts[0].body.startsWith('1 known error is repeating a lot'), JSON.stringify(r.toasts));
  sp.clock += CHECK_EVERY_MS;
  wsp.spikes = [{ id: 'e-1', occurrences: 40000 }, { id: 'e-2', occurrences: 3 }];
  r = await sp.round();
  check('a chronic error with a huge count is one announcement, and a count under 16 is not a spike at all', r.toasts.length === 1 && r.toasts[0].body.startsWith('1 known error is repeating a lot'), JSON.stringify(r.toasts));
  sp.clock += CHECK_EVERY_MS;
  r = await sp.round();
  check('and then it stays quiet', r.toasts.length === 0);
  check('only a super admin gets the spike alert; a finance manager and a support agent do not', watchersForRole('finance_manager').every((w) => w.id !== 'error_spike') && watchersForRole('support_agent').every((w) => w.id !== 'error_spike'));

  // ---- quiet: summaries --------------------------------------------------------------------------------------------------------------------------------
  const wq = newWorld();
  const q = harness('super_admin', wq);
  await q.round();
  q.clock += CHECK_EVERY_MS;
  wq.tutors = ['t']; wq.disputes = ['d']; wq.topups = ['p']; wq.payouts = ['o'];
  r = await q.round();
  check(`more than ${MAX_SEPARATE_TOASTS} kinds at once: ONE "N new" notification`, r.toasts.length === 1 && r.toasts[0].title === '4 new items need you' && /payment proof/.test(r.toasts[0].body) && /tutor to verify/.test(r.toasts[0].body), JSON.stringify(r.toasts));
  q.clock += CHECK_EVERY_MS;
  wq.subjects = ['s']; wq.schoolResults = ['sr'];
  r = await q.round();
  check('two kinds at once: two separate notifications', r.toasts.length === 2 && new Set(r.toasts.map((t) => t.tag)).size === 2);

  const gap = newWorld();
  const g = harness('finance_manager', gap);
  await g.round();
  g.clock += CATCH_UP_AFTER_MS + 60_000;
  gap.topups = ['p1', 'p2']; gap.payouts = ['o1'];
  r = await g.round();
  check('the PC was off / asleep for a while: ONE catch-up notification with the time', r.catchUp && r.toasts.length === 1 && r.toasts[0].title === 'Tutorlage Admin: while you were away' && r.toasts[0].body === `Since ${sinceText(T0, g.clock)}: 2 payment proofs, 1 payout to pay.` && r.toasts[0].body.startsWith('Since 10:00'), r.toasts[0]?.body);
  check('a normal 2-minute round is not a catch-up', (await (async () => { const n = harness('finance_manager', newWorld()); await n.round(); n.clock += CHECK_EVERY_MS; return !(await n.round()).catchUp; })()));

  const first = newWorld();
  first.tutors = ['t1', 't2'];
  const fr = harness('verification_officer', first);
  r = await fr.round();
  check('the very first round on a PC: ONE notification "will now alert you", with what is waiting', r.firstRun && r.toasts.length === 1 && r.toasts[0].title === 'Tutorlage Admin will now alert you' && r.toasts[0].body === 'Waiting now: 2 tutors to verify.', JSON.stringify(r.toasts));

  const cap = newWorld();
  const c = harness('super_admin', cap);
  await c.round();
  for (let i = 1; i <= 7; i += 1) {
    c.clock += CHECK_EVERY_MS;
    cap.disputes = [...cap.disputes, `d${i}`];
    await c.round();
  }
  check(`hourly quiet limit: after ${MAX_TOASTS_PER_HOUR} separate notifications the next ones are folded into a summary`, c.shown.length === 7 && c.shown.slice(0, MAX_TOASTS_PER_HOUR).every((t) => t.tag === 'w:dispute') && c.shown[MAX_TOASTS_PER_HOUR].tag === 'summary', c.shown.map((t) => t.tag).join(','));

  // ---- mute, signed out, switches, failures ----------------------------------------------------------------------------------------------------------
  const wmute = newWorld();
  let muted = false;
  const m = harness('finance_manager', wmute, memoryStorage(), { muted: () => muted });
  await m.round();
  const before = JSON.stringify([...m.storage.map.entries()]);
  const callsBefore = m.calls.length;
  muted = true;
  m.clock += CHECK_EVERY_MS;
  wmute.topups = ['p1'];
  r = await m.round();
  check('muted: nothing is read, nothing is remembered, nothing is shown', r.skipped === 'muted' && m.calls.length === callsBefore && JSON.stringify([...m.storage.map.entries()]) === before && m.shown.length === 0);
  muted = false;
  m.clock += 2 * CHECK_EVERY_MS;
  r = await m.round();
  check('unmuted: what arrived meanwhile is announced (once)', r.toasts.length === 1 && r.toasts[0].body === '1 payment proof is waiting.');

  const so = harness('finance_manager', newWorld(), memoryStorage(), { session: false });
  r = await so.round();
  check('signed out: nothing is read and nothing is shown', r.skipped === 'no_session' && so.calls.length === 0 && so.shown.length === 0);

  const wsw = newWorld();
  const s = harness('finance_manager', wsw);
  storageAlertStore(s.storage).savePrefs('admin-1', { disabled: ['wallet_topup'] });
  await s.round();
  s.clock += CHECK_EVERY_MS;
  wsw.topups = ['p1']; wsw.payouts = ['o1'];
  r = await s.round();
  check('a switched-off alert is not asked and not shown; the others work', !s.calls.some((x) => x.table === 'wallet_topups') && r.toasts.length === 1 && r.toasts[0].body.startsWith('1 payout'));
  storageAlertStore(s.storage).savePrefs('admin-1', { disabled: [] });
  s.clock += CHECK_EVERY_MS;
  r = await s.round();
  check('switched back on: what it missed is announced', r.toasts.length === 1 && r.toasts[0].body.startsWith('1 payment proof'));

  const wf = newWorld();
  wf.fail = { client_errors: { code: 'PGRST205', message: "Could not find the table 'public.client_errors' in the schema cache" } };
  const fl = harness('super_admin', wf);
  await fl.round();
  fl.clock += CHECK_EVERY_MS;
  wf.disputes = ['d1'];
  r = await fl.round();
  check('one question failing (a table not switched on yet) says nothing and does not stop the others', r.failed.includes('new_error') && r.toasts.length === 1 && r.toasts[0].tag === 'w:dispute');
  const offline = newWorld();
  offline.fail = Object.fromEntries(['tutor_verification_documents', 'platform_disputes', 'session_requests', 'tutor_subject_competencies', 'school_results', 'tier1_academic_records', 'wallet_topups', 'payout_requests', 'notifications', 'client_errors'].map((t) => [t, { message: 'Failed to fetch' }]));
  const off = harness('super_admin', offline);
  r = await off.round();
  check('everything failing (offline): nothing shown, NOTHING remembered (the next round is still a first look)', r.toasts.length === 0 && r.checked.length === 0 && storageAlertStore(off.storage).loadState('admin-1').lastCheckedAt === null);
  const jwt = newWorld();
  jwt.fail = { platform_disputes: { status: 401, message: 'JWT expired' } };
  const jw = harness('support_agent', jwt);
  r = await jw.round();
  check('an expired token is flagged as an auth failure', r.authFailed && isAuthError({ code: 'PGRST301' }) && isAuthError({ message: 'JWT expired' }) && !isAuthError({ message: 'Failed to fetch' }));

  // ---- privacy -----------------------------------------------------------------------------------------------------------------------------------------
  const priv = newWorld();
  priv.tutors = ['11111111-aaaa-bbbb-cccc-000000000001']; priv.topups = ['22222222-aaaa-bbbb-cccc-000000000002']; priv.payouts = ['33333333-aaaa-bbbb-cccc-000000000003'];
  priv.mismatch = ['44444444-aaaa-bbbb-cccc-000000000004']; priv.errors = ['9991'];
  const pv = harness('super_admin', priv);
  await pv.round();
  pv.clock += CHECK_EVERY_MS;
  priv.disputes = ['55555555-aaaa-bbbb-cccc-000000000005'];
  priv.tutors = [...priv.tutors, '66666666-aaaa-bbbb-cccc-000000000006'];
  await pv.round();
  const text = pv.shown.map((t) => `${t.title} ${t.body} ${t.route}`).join(' | ');
  check('no id, email, amount or reference appears in any notification', pv.shown.length > 0 && !/[0-9a-f]{8}-[0-9a-f]{4}/i.test(text) && !/@/.test(text) && !/\bR\s?\d/.test(text) && !/9991/.test(text), text);
  check('every notification is short enough for a toast', pv.shown.every((t) => t.title.length <= 60 && t.body.length <= 220));
  check('every route is a plain in-app address', WATCHERS.every((w) => /^\/[a-z0-9-]+(\?wallet=[a-z]+)?$/.test(w.route)) && /^\/[a-z-]+$/.test(lapseToast().route));

  // ---- memory: damaged, blocked --------------------------------------------------------------------------------------------------------------------
  const bad = memoryStorage();
  bad.setItem('tutorlage-admin-alerts-v1:admin-1', '{not json');
  bad.setItem('tutorlage-admin-alert-prefs-v1:admin-1', JSON.stringify({ disabled: ['nonsense', 'dispute', 5] }));
  const st = storageAlertStore(bad);
  check('damaged memory reads as empty (never a crash); unknown switch names are dropped', JSON.stringify(st.loadState('admin-1')) === JSON.stringify(emptyState()) && JSON.stringify(st.loadPrefs('admin-1').disabled) === '["dispute"]');
  const blocked = storageAlertStore({ getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } });
  let threw = false;
  try { blocked.saveState('a', { ...emptyState(), lastCheckedAt: 1 } as AlertState); blocked.loadState('a'); blocked.savePrefs('a', { disabled: [] }); blocked.loadPrefs('a'); } catch { threw = true; }
  check('blocked storage never throws', !threw);
  const noStore = storageAlertStore(undefined);
  check('no storage at all never throws', noStore.loadState('a').lastCheckedAt === null);

  // ---- the lapsed sign-in --------------------------------------------------------------------------------------------------------------------------
  let link = { signedIn: false, lapseAnnounced: false };
  let step = nextLink(link, 'none');
  check('never signed in on this PC: no lapse notification', !step.announce);
  link = nextLink(link, 'session').link;
  step = nextLink(link, 'none');
  check('a working sign-in that stops: announced ONCE', step.announce && step.link.lapseAnnounced);
  step = nextLink(step.link, 'none');
  check('and not again on the next look (nor after a restart)', !step.announce);
  check('the admin signing out themselves is never announced; signing in again re-arms it', !nextLink(nextLink({ signedIn: true, lapseAnnounced: false }, 'manual_signout').link, 'none').announce && nextLink(nextLink(step.link, 'session').link, 'none').announce);
  const ls = memoryStorage();
  saveLink(ls, { signedIn: true, lapseAnnounced: true });
  check('the sign-in state is remembered on the PC', JSON.stringify(loadLink(ls)) === '{"signedIn":true,"lapseAnnounced":true}' && loadLink(undefined).signedIn === false);
  check('the lapse notification asks to sign in again and says nothing personal', lapseToast().body === 'Sign in to Tutorlage Admin to keep getting alerts.');
  noteManualSignOut(1000);
  check('the manual sign-out mark lasts a minute', wasManualSignOut(30_000) && !wasManualSignOut(1_000_000));
  check('the menu\'s Sign out leaves that mark', /noteManualSignOut\(\)/.test(read('admin/src/lib/AuthContext.tsx')));

  // ---- the encrypted sign-in storage (page side) ----------------------------------------------------------------------------------------------------
  const store = new Map<string, string>();
  const bridge = { secureStorage: { getItem: async (k: string) => store.get(k) ?? null, setItem: async (k: string, v: string) => { store.set(k, v); return true; }, removeItem: async (k: string) => { store.delete(k); return true; } } };
  const legacy = new Map<string, string>([['sb-x-auth-token', '{"session":"old"}']]);
  const adapter = secureAuthStorage(bridge, { getItem: (k) => legacy.get(k) ?? null, removeItem: (k) => { legacy.delete(k); } });
  check('first read moves the old plain-text session into the encrypted store and deletes the old copy', (await adapter.getItem('sb-x-auth-token')) === '{"session":"old"}' && store.get('sb-x-auth-token') === '{"session":"old"}' && legacy.size === 0);
  await adapter.setItem('sb-x-auth-token', 'new');
  check('writes go to the encrypted store', store.get('sb-x-auth-token') === 'new' && (await adapter.getItem('sb-x-auth-token')) === 'new');
  await adapter.removeItem('sb-x-auth-token');
  check('sign-out removes it', !store.has('sb-x-auth-token') && (await adapter.getItem('sb-x-auth-token')) === null);
  const refusing = secureAuthStorage({ secureStorage: { getItem: async () => null, setItem: async () => false, removeItem: async () => true } }, undefined);
  await refusing.setItem('k', 'v');
  check('if Windows cannot encrypt, the session lasts in memory only (never plain text on disk)', (await refusing.getItem('k')) === 'v');
  const broken = secureAuthStorage({ secureStorage: { getItem: async () => { throw new Error('ipc'); }, setItem: async () => { throw new Error('ipc'); }, removeItem: async () => { throw new Error('ipc'); } } }, undefined);
  let brokenThrew = false;
  try { await broken.setItem('k', 'v'); await broken.getItem('z'); await broken.removeItem('k'); } catch { brokenThrew = true; }
  check('a failing bridge never throws', !brokenThrew);
  check('in a plain browser there is no bridge', getDesktopBridge() === null);
  const client = code('admin/src/lib/supabaseClient.ts');
  check('the encrypted storage is used only inside the desktop app', /const desktop = getDesktopBridge\(\)/.test(client) && /desktop\s*\?\s*createClient\(supabaseUrl, supabaseKey, \{ auth: \{ storage: secureAuthStorage\(desktop/.test(client) && /:\s*createClient\(supabaseUrl, supabaseKey\)/.test(client));

  // The same adapter with the REAL supabase-js against a pretend sign-in server (scripts/dev/fake-auth.ts, a local fake; its test password): the session is written
  // through the adapter (not to the page's plain storage), a new client ("after a restart") reads it back, an old plain copy is moved over, sign-out removes it.
  const fake = await startFakeAuth();
  try {
    const secure = new Map<string, string>();
    const bridge2 = { secureStorage: { getItem: async (k: string) => secure.get(k) ?? null, setItem: async (k: string, v: string) => { secure.set(k, v); return true; }, removeItem: async (k: string) => { secure.delete(k); return true; } } };
    const plain = new Map<string, string>();
    const plainStorage = { getItem: (k: string) => plain.get(k) ?? null, removeItem: (k: string) => { plain.delete(k); } };
    const make = (b: typeof bridge2, legacyStore: typeof plainStorage | undefined) =>
      createClient(fake.url, 'fake-publishable-key', { auth: { storage: secureAuthStorage(b, legacyStore), autoRefreshToken: false, detectSessionInUrl: false } });
    const first = make(bridge2, plainStorage);
    const signedIn = await first.auth.signInWithPassword({ email: 'admin@example.com', password: 'goodpassword1' });
    const key = [...secure.keys()].find((k) => k.endsWith('-auth-token'));
    check('real supabase-js signs in through the adapter: the session is in the encrypted store, not in the plain storage of the page', !signedIn.error && !!key && (secure.get(key as string) ?? '').includes('fake-refresh') && plain.size === 0);
    const second = make(bridge2, plainStorage);
    const restored = await second.auth.getSession();
    check('a new client (after a restart) reads the same session back from the encrypted store', restored.data.session?.refresh_token === 'fake-refresh' && restored.data.session?.user.email === 'admin@example.com');
    const migratedPlain = new Map<string, string>([[key as string, secure.get(key as string) as string]]);
    const emptySecure = new Map<string, string>();
    const bridge3 = { secureStorage: { getItem: async (k: string) => emptySecure.get(k) ?? null, setItem: async (k: string, v: string) => { emptySecure.set(k, v); return true; }, removeItem: async (k: string) => { emptySecure.delete(k); return true; } } };
    const third = make(bridge3, { getItem: (k) => migratedPlain.get(k) ?? null, removeItem: (k) => { migratedPlain.delete(k); } });
    const moved = await third.auth.getSession();
    check('an admin already signed in (old plain storage) stays signed in: the session is moved to the encrypted store and the plain copy deleted', moved.data.session?.refresh_token === 'fake-refresh' && emptySecure.has(key as string) && migratedPlain.size === 0);
    const alertsClient = await runAlertRound({ client: second as unknown as AlertClient, adminId: 'admin-1', role: 'support_agent', now: () => T0, store: storageAlertStore(memoryStorage()), show: () => undefined, isMuted: () => false });
    check('the alert round sees that real client as signed in (it then asks the database; here the fake sign-in server has no tables, so it reads nothing and says nothing)', alertsClient.skipped !== 'no_session' && alertsClient.toasts.length === 0);
    await second.auth.signOut({ scope: 'local' });
    check('signing out removes the stored session', !secure.has(key as string));
  } finally {
    await fake.close();
  }

  // A window hidden in the tray: the sign-in library stops its own refresh timer while the page says it is hidden, so the checks themselves must keep the sign-in alive.
  // An EXPIRED stored session + one getSession() (what every alert round does first) must refresh it and write the new one through the adapter.
  let refreshCalls = 0;
  const refreshServer = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://fake');
    req.resume();
    req.on('end', () => {
      res.writeHead(url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'refresh_token' ? 200 : 404, { 'content-type': 'application/json' });
      if (url.searchParams.get('grant_type') === 'refresh_token') {
        refreshCalls += 1;
        res.end(JSON.stringify({ access_token: fakeAccessToken('admin@example.com', 3600), token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'refresh-2',
          user: { id: 'user-1', aud: 'authenticated', role: 'authenticated', email: 'admin@example.com', app_metadata: {}, user_metadata: {}, created_at: '2026-10-10T08:00:00Z' } }));
      } else res.end('{}');
    });
  });
  await new Promise<void>((resolve) => refreshServer.listen(0, '127.0.0.1', () => resolve()));
  try {
    const port = (refreshServer.address() as import('node:net').AddressInfo).port;
    const secure = new Map<string, string>();
    const expired = { access_token: fakeAccessToken('admin@example.com', -3600), token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) - 60, refresh_token: 'refresh-1',
      user: { id: 'user-1', aud: 'authenticated', role: 'authenticated', email: 'admin@example.com', app_metadata: {}, user_metadata: {}, created_at: '2026-10-10T08:00:00Z' } };
    secure.set('sb-127-auth-token', JSON.stringify(expired));
    const hiddenBridge = { secureStorage: { getItem: async (k: string) => secure.get(k) ?? null, setItem: async (k: string, v: string) => { secure.set(k, v); return true; }, removeItem: async (k: string) => { secure.delete(k); return true; } } };
    const hidden = createClient(`http://127.0.0.1:${port}`, 'fake-publishable-key', { auth: { storage: secureAuthStorage(hiddenBridge, undefined), autoRefreshToken: false, detectSessionInUrl: false } });
    const round = await runAlertRound({ client: hidden as unknown as AlertClient, adminId: 'admin-1', role: 'support_agent', now: () => T0, store: storageAlertStore(memoryStorage()), show: () => undefined, isMuted: () => false });
    check('with the refresh timer stopped (window hidden), a round refreshes an EXPIRED sign-in by itself and the new one is stored encrypted', refreshCalls === 1 && round.skipped !== 'no_session' && (secure.get('sb-127-auth-token') ?? '').includes('refresh-2') && !(secure.get('sb-127-auth-token') ?? '').includes('refresh-1'), `refreshCalls=${refreshCalls}`);
  } finally {
    await new Promise<void>((resolve) => refreshServer.close(() => resolve()));
  }

  // ---- the screen ----------------------------------------------------------------------------------------------------------------------------------
  const props = { inDesktopApp: true, status: { muted: false, mutedUntil: null, autostart: true, notificationsSupported: true }, watchers: watchersForRole('finance_manager'), disabled: ['wallet_payout'] as WatcherId[], busy: false, testSent: null, onToggleWatcher: () => undefined, onMute: () => undefined, onTest: () => undefined };
  const page = html(React.createElement(NotificationsBody, props));
  check('the Notifications screen lists this role\'s alerts, with the switched-off one unchecked', page.includes('A payment proof is waiting') && page.includes('A payout was requested') && !page.includes('A tutor needs verification') && /id="alert-wallet_payout"(?![^>]*checked)/.test(page) && /id="alert-wallet_topup"[^>]*checked/.test(page));
  check('it says whether notifications are on and offers mute and a test', page.includes('Notifications on this computer: On') && page.includes('Mute for 1 hour') && page.includes('Send a test notification') && page.includes('Starts with Windows.'));
  const mutedPage = html(React.createElement(NotificationsBody, { ...props, status: { ...props.status, muted: true, mutedUntil: Date.UTC(2026, 10, 3, 9, 0, 0) } }));
  check('muted: says until when and offers to turn back on', mutedPage.includes('Muted until') && mutedPage.includes('Turn notifications back on') && !mutedPage.includes('Mute for 1 hour'));
  const browserPage = html(React.createElement(NotificationsBody, { ...props, inDesktopApp: false, status: null }));
  check('in a plain browser it says nothing runs there', browserPage.includes('only run in the installed Tutorlage Admin app') && !browserPage.includes('Send a test notification'));
  check('a failed test says so', html(React.createElement(NotificationsBody, { ...props, testSent: false })).includes('Windows did not accept the notification'));
  const app = read('admin/src/App.tsx');
  check('the runner is always mounted (also on the sign-in page) and the page has a route', /<AlertRunner \/>/.test(app) && /path="notifications" element=\{<Notifications \/>\}/.test(app));

  // ---- the desktop program (source reading) ---------------------------------------------------------------------------------------------------------
  const main = code('admin/desktop/main.cjs');
  const pre = code('admin/desktop/preload.cjs');
  check('closing the window hides it to the tray instead of quitting', /win\.on\('close', \(event\) => \{[\s\S]*?event\.preventDefault\(\);[\s\S]*?win\.hide\(\)/.test(main) && !/window-all-closed['"], \(\) => app\.quit\(\)/.test(main) && /window-all-closed', \(\) => \{\s*if \(SMOKE\) app\.quit/.test(main));
  check('Windows shutting down is never blocked by the hide-on-close', /win\.on\('session-end'[\s\S]*?quitting = true/.test(main) && /before-quit[\s\S]*?quitting = true/.test(main));
  check('there is a tray icon whose menu can open, mute, test, set start-with-Windows and Quit', /new Tray\(/.test(main) && ['Open Tutorlage Admin', 'Mute notifications', 'Mute for 1 hour', 'Send a test notification', 'Start with Windows', 'Quit Tutorlage Admin'].every((l) => main.includes(l)));
  check('it starts with Windows, hidden, only when installed (not a folder run, not a smoke check)', /openAtLogin: settings\.autostart/.test(main) && /args: \['--hidden'\]/.test(main) && /if \(!app\.isPackaged \|\| SMOKE\) return;/.test(main) && /START_HIDDEN = !SMOKE && process\.argv\.includes\('--hidden'\)/.test(main) && /show: !SMOKE && !START_HIDDEN/.test(main));
  check('the window keeps running when hidden (no background throttling)', /backgroundThrottling: false/.test(main));
  check('the sign-in is encrypted with Windows before it is written, and nothing is written when Windows cannot encrypt', /safeStorage\.encryptString\(value\)/.test(main) && /safeStorage\.decryptString/.test(main) && /!safeStorage\.isEncryptionAvailable\(\)\) return false/.test(main));
  // (the smoke check looks for the sign-in screen's password FIELD by name; that is the only mention)
  check('no password, token or key is handled in the desktop program (it stores opaque text it is given, encrypted)', !/password|apikey|service_role|sb_secret/i.test((main + pre).replace(/hasPasswordField|input\[type="password"\]/g, '')));
  check('every call from the page is checked: the sender must be our own address', /function guarded\(handler\)[\s\S]*?!fromOurPage\(event\)\) throw/.test(main) && (main.match(/ipcMain\.handle\(/g) ?? []).length === (main.match(/guarded\(/g) ?? []).length - 1, `${(main.match(/ipcMain\.handle\(/g) ?? []).length} handlers`);
  check('the page can reach only the listed calls and no Node', ['secureStorage', 'notify', 'isMuted', 'getStatus', 'setMuted', 'sendTest', 'onNavigate', 'onCheckNow', 'onStatusChange'].every((n) => pre.includes(n)) && !/require\('(fs|child_process|node:fs)'\)/.test(pre) && /contextIsolation: true, nodeIntegration: false, sandbox: true/.test(main));
  const routeLine = main.split('\n').find((l) => l.startsWith('const validRoute')) ?? '';
  const validRoute = (0, eval)(`(${routeLine.slice(routeLine.indexOf('=') + 1).trim().replace(/;$/, '')})`) as (r: unknown) => boolean;
  check('only plain in-app addresses are opened from a notification', ['/', '/verification', '/payouts?wallet=topups', '/notifications'].every((r) => validRoute(r)) && ['https://evil.example', '//evil.example', 'javascript:alert(1)', 'file:///c:/x', '/a b', '/../x:y', 5, null].every((r) => !validRoute(r)));
  check('muting is kept here and a timed mute ends by itself and then checks at once', /muted: muted === true|muted: raw\.muted === true/.test(main) && /scheduleUnmute/.test(main) && /statusChanged\(true\)/.test(main) && /statusChanged\(!muted\)/.test(main));
  check('waking from sleep or unlocking triggers a check', /powerMonitor\.on\('resume'/.test(main) && /powerMonitor\.on\('unlock-screen'/.test(main));
  check('a second start brings the hidden copy forward', /app\.on\('second-instance', \(\) => openWindow\(\)\)/.test(main));
  check('a smoke check uses a throw-away profile and proves the encrypted store holds no plain text', /mkdtempSync/.test(main) && /plainTextOnDisk: fileText\.includes\(probe\)/.test(main));
  const pkg = JSON.parse(read('admin/desktop/package.json')) as { build: { files: string[] } };
  check('the installer ships the preload file', pkg.build.files.includes('preload.cjs') && pkg.build.files.includes('main.cjs'));
  const engine = code('admin/src/lib/adminAlerts.ts');
  check('the alert rules are pure: no database import, no storage of their own, no network', !/from '\.\/supabaseClient'|@supabase\/supabase-js|\blocalStorage\b|\bfetch\(/.test(engine));

  console.log(failed === 0 ? '\nall ok' : `\n${failed} FAILED`);
  process.exitCode = failed === 0 ? 0 : 1;
}
main().catch((e) => {
  console.error('FAIL test crashed', e);
  process.exitCode = 1;
});
