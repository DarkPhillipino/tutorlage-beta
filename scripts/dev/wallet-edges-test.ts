// Checks on WALLET PHASE 6 (edge cases; CEO's design, 2 Nov 2026): the app and admin sides of the migration 20261103100000_wallet_edges.sql.
// Run: npx tsx scripts/dev/wallet-edges-test.ts
// Proves, with fake clients and screens drawn to markup: the closing screen tells a person what is in their wallet (a learner or parent: the balance and any
// bank transfer not yet confirmed; a tutor: the open payout request) and nothing when there is nothing; a database without the wallet sends no "wallet" key and
// nothing breaks; the Worker now accepts the payment-proofs bucket and still refuses an unknown one; the admin functions (refund after the tutor was credited,
// money returned by hand, a transfer credited by hand, a tutor's bank details, the sessions a wallet paid for, closed accounts with money) are called with exactly
// the names and arguments the migration defines, check their input before asking, say in words what happened (including a tutor who could not cover a refund),
// are tolerant of a missing or failing function, never use select *, and the forms keep one one-time key per attempt. The SQL itself is proved by
// supabase/tests/wallet_edges.sql (rolled back, on production, 3 Nov). It does NOT click through the screens and does NOT touch a database.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { STORAGE_BUCKETS, runClosureTasks } from '../../server/closeAccount';
import type { CloseAccountDeps, ClosureTask } from '../../server/closeAccount';
import { CLOSE_COPY, GENERIC_KEPT_LINE, parseClosurePreview, parseClosureWallet, walletNotes } from '../../src/lib/closeAccount';
import { CloseAccountView, CloseAccountViewProps } from '../../src/components/CloseAccountView';
import {
  LEDGER_KIND_LABELS, addTopupByHand, canRefundSession, checkHandTopup, checkRefund, checkReturn, closedToListRow, closedWalletSentence, fetchClosedAccountWallets, fetchTopupQueue,
  fetchWalletDetail, fetchWalletSessions, handTopupConfirmText, ledgerKindLabel, openTutorBankDetails, refreshWalletRow, refundConfirmText, refundResultSentence, refundSessionLine,
  refundToWallet, refundableRand, returnConfirmText, returnWalletMoney, type ClosedWalletRow, type WalletAdminClient, type WalletListRow, type WalletSession,
} from '../../admin/src/lib/walletAdmin';
import { WalletBalancesBody } from '../../admin/src/components/WalletBalancesBody';
import { ClosedAccountsSection, WalletSessionsSection } from '../../admin/src/components/WalletEdgeForms';

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
const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const words = (h: string) => h.replace(/<[^>]+>/g, ' ').replace(/&#x27;|&apos;/g, "'").replace(/\s+/g, ' ');

const MIGRATION = 'supabase/migrations/20261103100000_wallet_edges.sql';
const mig = read(MIGRATION);

type Err = { code?: string; message?: string } | null;
interface Call { fn: string; args: Record<string, unknown> }
function fake(opts: { rpc?: (fn: string, args: Record<string, unknown>) => { data: unknown; error: Err }; tables?: Record<string, { data: unknown; error: Err }>; throwAll?: boolean } = {}) {
  const calls: Call[] = [];
  const queries: { table: string; cols: string }[] = [];
  const client: WalletAdminClient = {
    rpc: async (fn, args = {}) => {
      if (opts.throwAll) throw new TypeError('Failed to fetch');
      calls.push({ fn, args });
      return (opts.rpc ?? (() => ({ data: null, error: null })))(fn, args);
    },
    from: (table: string) => {
      const q = { table, cols: '' };
      queries.push(q);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const b: any = {};
      b.select = (c: string) => { q.cols = c; return b; };
      for (const m of ['in', 'eq', 'order', 'limit']) b[m] = () => b;
      b.then = (resolve: (v: { data: unknown; error: Err }) => void) => {
        if (opts.throwAll) throw new TypeError('Failed to fetch');
        return resolve(opts.tables?.[table] ?? { data: [], error: null });
      };
      return b;
    },
  };
  return { client, calls, queries };
}

async function main() {
  // ================================================================ 1. the Worker removes proof files
  {
    const calls: string[] = [];
    const deps = (tasks: ClosureTask[]): CloseAccountDeps => {
      const batches = [tasks];
      return {
        claimTasks: async () => batches.shift() ?? [],
        reportResult: async (id, outcome) => { calls.push(`report:${id}:${outcome.ok ? 'ok' : outcome.detail}`); },
        removeFiles: async (bucket, paths) => { calls.push(`remove:${bucket}:${paths.length}`); return { error: null }; },
        deleteAuthUser: async () => ({ error: null }),
        paystack: async () => ({ ok: true, httpStatus: 200, body: {} }),
        sendMail: async () => ({ ok: true }),
      };
    };
    const UID = '11111111-2222-3333-4444-555555555555';
    const task = (id: number, bucket: string): ClosureTask => ({ id, closure_id: 'c1', kind: 'storage_remove', payload: { bucket, paths: [`${UID}/a.pdf`] }, attempts: 1 });
    await runClosureTasks(deps([task(1, 'payment-proofs'), task(2, 'some-other-bucket')]));
    check('the Worker allows the payment-proofs bucket and removes the files named', STORAGE_BUCKETS.includes('payment-proofs' as never) && calls.includes('remove:payment-proofs:1') && calls.includes('report:1:ok'), calls.join(' | '));
    check('an unknown bucket is still refused (nothing removed, reported as a failure)', !calls.includes('remove:some-other-bucket:1') && calls.includes('report:2:unknown storage bucket'), calls.join(' | '));
    const queued = [...mig.matchAll(/closure_enqueue_files\([^,]+,[^,]+,\s*'([\w-]+)'/g)].map((m) => m[1]);
    check('every bucket the new migration queues for removal is one the Worker allows (and there are two such calls)', queued.length === 2 && queued.every((b) => (STORAGE_BUCKETS as readonly string[]).includes(b)), queued.join(','));
  }

  // ================================================================ 2. the closing screen (the person's)
  {
    const WALLET = { available_rand: 430, held_rand: 70, open_payout_rand: 0, open_topups: 2, unconfirmed_rand: 150 };
    const acct = (role: string, wallet: unknown, owed: number | null = null) => ({ profile_id: 'p-1', name: 'Lerato M', role, sessions_to_cancel: [], payout_owed: owed, ...(wallet === undefined ? {} : { wallet }) });
    const preview = (a: unknown) => ({ accounts: [a], blocked: false, blocked_message: null, delete_after_days: 30, delete_by_days: 90, undo_days: 30, deleted: ['your name'], kept: [], note: GENERIC_KEPT_LINE });
    const view = (a: unknown) => {
      const props: CloseAccountViewProps = {
        stage: 'preview', subject: 'self', preview: parseClosurePreview(preview(a)), needsPassword: true, word: '', password: '', error: null,
        onWord: () => {}, onPassword: () => {}, onContinue: () => {}, onBack: () => {}, onConfirm: () => {}, onCancel: () => {},
      };
      return words(renderRoot(RootReact.createElement(CloseAccountView, props)));
    };
    const w = parseClosureWallet(WALLET);
    check('the wallet is read from the preview: available, on hold, open top-ups, unconfirmed', !!w && w.availableRand === 430 && w.heldRand === 70 && w.openTopups === 2 && w.unconfirmedRand === 150);
    check('no wallet key (a database without the wallet), null, and an empty wallet all mean "nothing to say"', parseClosureWallet(undefined) === null && parseClosureWallet(null) === null
      && parseClosureWallet({ available_rand: 0, held_rand: 0, open_payout_rand: 0, open_topups: 1, unconfirmed_rand: 0 }) === null && parseClosurePreview(preview(acct('student', undefined))).accounts[0].wallet === null);
    const learner = walletNotes(w, 'student');
    check('a learner or parent is told their wallet total (R500), that closing does not delete it, how it comes back, and the unconfirmed transfer',
      learner.length === 2 && learner[0] === CLOSE_COPY.walletBalance('R500') && /does not delete it/.test(learner[0]) && /write to support/.test(learner[0]) && learner[1] === CLOSE_COPY.walletUnconfirmed('R150'), learner.join(' | '));
    check('a tutor is not told the balance twice (it is already in "you are owed"); only an open payout request is mentioned', walletNotes(w, 'tutor').length === 0
      && walletNotes(parseClosureWallet({ ...WALLET, open_payout_rand: 120 }), 'tutor').join('') === CLOSE_COPY.walletPayoutOpen('R120') && walletNotes(null, 'student').length === 0);
    const hLearner = view(acct('student', WALLET));
    check('the screen shows the wallet sentences for a learner, in amber notes', /Your wallet holds R500\./.test(hLearner) && /bank transfer of R150 that we have not confirmed/.test(hLearner) && (renderRoot(RootReact.createElement(CloseAccountView, {
      stage: 'preview', subject: 'self', preview: parseClosurePreview(preview(acct('student', WALLET))), needsPassword: true, word: '', password: '', error: null,
      onWord: () => {}, onPassword: () => {}, onContinue: () => {}, onBack: () => {}, onConfirm: () => {}, onCancel: () => {},
    })).match(/data-wallet-note/g) ?? []).length === 2);
    const hNone = view(acct('student', undefined));
    check('nothing is drawn about a wallet for someone who has none', !/wallet/i.test(hNone));
    const hTutor = view(acct('tutor', { ...WALLET, available_rand: 20, held_rand: 120, open_payout_rand: 120 }, 140));
    check('a tutor sees "you are owed R140" (the wallet is counted) and that the payout request stays open', /You are owed R140/.test(hTutor) && /Your payout request of R120 stays open/.test(hTutor) && !/Your wallet holds/.test(hTutor), hTutor.slice(0, 300));
    check('the new closing sentences are plain: no "ledger", "held" or "idempotency"', ![CLOSE_COPY.walletBalance('R1'), CLOSE_COPY.walletPayoutOpen('R1'), CLOSE_COPY.walletUnconfirmed('R1')].some((s) => /ledger|held|idempoten|database/i.test(s)));
    const src = code('src/lib/closeAccount.ts') + code('src/components/CloseAccountView.tsx');
    check('the closing screen reads the wallet only from preview_account_closure (no table read, no new rpc)', !/from\('wallet/.test(src) && (src.match(/rpc\('/g) ?? []).length === 2);
  }

  // ================================================================ 3. the admin functions
  {
    const PEOPLE = { data: [{ id: 't-1', full_name: 'Thandi Tutor', role: 'tutor' }], error: null };
    const aw = fake({ rpc: () => ({ data: { already: false, refunded_rand: 80, refunded_total_rand: 80, price_rand: 200, tutor_credited: true, tutor_reduced_rand: 56, tutor_shortfall_rand: 0 }, error: null }) });
    const rr = await refundToWallet(aw.client, 's-1', 80, 'Session did not happen', true, 'k-1');
    check('refundToWallet calls admin_refund_to_wallet with session, amount, reason, take-back and key, and reads the answer',
      JSON.stringify(aw.calls[0]) === JSON.stringify({ fn: 'admin_refund_to_wallet', args: { p_session: 's-1', p_amount: 80, p_comment: 'Session did not happen', p_take_back: true, p_key: 'k-1' } }) && rr.refundedRand === 80 && rr.tutorReducedRand === 56 && rr.priceRand === 200, JSON.stringify(rr));
    check('the refund result is said in words: taken back; could not cover (and what they still owe); not credited yet; already done',
      /R80 is back in the learner's wallet \(R80 of R200 refunded in all\)\. R56 was taken from Thandi's wallet\./.test(refundResultSentence(rr, 'Thandi'))
      && /could not cover their share, so nothing was taken from it: Thandi still owes R70\. Settle that with them by hand\./.test(refundResultSentence({ ...rr, tutorReducedRand: 0, tutorShortfallRand: 70 }, 'Thandi'))
      && /had not been credited yet, so nothing was taken/.test(refundResultSentence({ ...rr, tutorReducedRand: 0, tutorCredited: false }, 'Thandi'))
      && /already done/.test(refundResultSentence({ ...rr, already: true }, 'Thandi')));
    check('a failing refund throws the database\'s own sentence', await refundToWallet(fake({ rpc: () => ({ data: null, error: { code: '22023', message: 'At most R0 can still be refunded for this session' } }) }).client, 's', 1, 'x', true, 'k').then(() => 'no', (e) => (e as Error).message) === 'At most R0 can still be refunded for this session');
    const ra = fake();
    await returnWalletMoney(ra.client, 'p-1', 100, 'Asked support', 'EFT-1', 'k-2');
    await addTopupByHand(ra.client, 'p-1', 300, null, 'No proof', 'k-3');
    await openTutorBankDetails(ra.client, 't-1');
    check('returnWalletMoney, addTopupByHand and openTutorBankDetails use the migration\'s function and argument names',
      JSON.stringify(ra.calls[0]) === JSON.stringify({ fn: 'admin_return_wallet_money', args: { p_profile: 'p-1', p_amount: 100, p_reason: 'Asked support', p_bank_reference: 'EFT-1', p_key: 'k-2' } })
      && JSON.stringify(ra.calls[1]) === JSON.stringify({ fn: 'admin_add_topup_by_hand', args: { p_profile: 'p-1', p_amount: 300, p_bank_reference: null, p_comment: 'No proof', p_key: 'k-3' } })
      && JSON.stringify(ra.calls[2]) === JSON.stringify({ fn: 'admin_open_tutor_bank_details', args: { p_tutor: 't-1' } }));
    const sigOf = (fn: string) => new RegExp(`create or replace function public\\.${fn}\\(([^)]*)\\)`).exec(mig)?.[1] ?? '';
    const argNames = (fn: string) => [...sigOf(fn).matchAll(/\bp_\w+/g)].map((m) => m[0]).sort().join(',');
    const used = (i: number) => Object.keys(ra.calls[i].args).sort().join(',');
    check('the argument names the screens send are exactly the parameters the migration declares',
      used(0) === argNames('admin_return_wallet_money') && used(1) === argNames('admin_add_topup_by_hand') && used(2) === argNames('admin_open_tutor_bank_details')
      && Object.keys(aw.calls[0].args).sort().join(',') === argNames('admin_refund_to_wallet'), `${argNames('admin_refund_to_wallet')} / ${argNames('admin_return_wallet_money')}`);
    check('the migration makes every one of the six admin functions finance-admin only and never grants them to a signed-out visitor',
      ['admin_refund_to_wallet', 'admin_return_wallet_money', 'admin_add_topup_by_hand', 'admin_open_tutor_bank_details', 'admin_wallet_sessions', 'admin_closed_account_wallets'].every((fn) =>
        new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\) to authenticated;`).test(mig) && new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from public, anon;`).test(mig)) && (mig.match(/wallet_is_finance_admin\(\)/g) ?? []).length >= 6);

    // input rules
    check('refund: whole rands, at most what is left, a reason of at least 5 characters',
      checkRefund(120, '80', 'Session did not happen').ok === true && (checkRefund(120, '80', 'Session did not happen') as { amount: number }).amount === 80 && checkRefund(120, '0', 'Session did not happen').ok === false
      && checkRefund(120, '121', 'Session did not happen').ok === false && checkRefund(120, '80.5', 'Session did not happen').ok === false && checkRefund(120, '80', 'bad').ok === false && checkRefund(120, '80', 'x'.repeat(501)).ok === false);
    check('return by hand: not more than is available (money on hold is explained), a reason, a short bank reference',
      checkReturn(100, '100', 'Asked support, checked by phone', 'EFT-1').ok === true && checkReturn(100, '101', 'Asked support, checked by phone', '').ok === false && /on hold belongs to a payout request/.test((checkReturn(0, '5', 'Asked support, checked', '') as { error: string }).error)
      && checkReturn(100, '5', 'bad', '').ok === false && checkReturn(100, '5', 'Asked support, checked', 'x'.repeat(61)).ok === false && (checkReturn(100, '5', 'Asked support, checked', ' ') as { reference: string | null }).reference === null);
    check('hand top-up: whole rands (no cap), a reason of at least 5 characters, a short reference',
      checkHandTopup('20000', 'Paid with no proof', 'FNB 44').ok === true && checkHandTopup('0', 'Paid with no proof', '').ok === false && checkHandTopup('50', 'no', '').ok === false && checkHandTopup('50', 'x'.repeat(381), '').ok === false && checkHandTopup('50', 'Paid with no proof', 'x'.repeat(61)).ok === false);
    check('the confirmation sentences say who and how much, and what happens to the tutor',
      /Put R80 back in Lee's wallet as credit\?.*Thandi's share is taken back only if their wallet still covers it/.test(refundConfirmText('Lee', 80, 'Thandi', true)) && /Thandi keeps their credit/.test(refundConfirmText('Lee', 80, 'Thandi', false))
      && /Record that you sent R100 back to Lee\?.*only after the money has left the bank account/.test(returnConfirmText('Lee', 100)) && /Add R300 to Lee's wallet.*They will be told/.test(handTopupConfirmText('Lee', 300)));

    // reading
    const sessionsWorld = fake({ rpc: () => ({ data: [
      { session_id: 's-1', scheduled_start: '2026-11-04T08:00:00Z', status: 'completed', price_rand: 200, refunded_rand: 80, tutor_id: 't-1', tutor_share_rand: 140, tutor_credited: true, tutor_reduced_rand: 56 },
      { session_id: 's-2', scheduled_start: '2026-11-20T08:00:00Z', status: 'scheduled', price_rand: 100, refunded_rand: 0, tutor_id: 't-1', tutor_share_rand: 0, tutor_credited: false, tutor_reduced_rand: 0 },
      { session_id: 's-3', scheduled_start: '2026-11-02T08:00:00Z', status: 'completed', price_rand: 100, refunded_rand: 100, tutor_id: 't-1', tutor_share_rand: 70, tutor_credited: true, tutor_reduced_rand: 70 },
    ], error: null }), tables: { profiles: PEOPLE } });
    const sess = await fetchWalletSessions(sessionsWorld.client, 'p-1');
    check('the sessions a wallet paid for are read through admin_wallet_sessions, with the tutor\'s name',
      sessionsWorld.calls[0].fn === 'admin_wallet_sessions' && sessionsWorld.calls[0].args.p_profile === 'p-1' && sess.length === 3 && sess[0].tutorName === 'Thandi Tutor' && sess[0].priceRand === 200 && sess[0].tutorReducedRand === 56, JSON.stringify(sess[0]));
    check('only a finished session with something left can be refunded; a booked one and a fully refunded one cannot', canRefundSession(sess[0]) && !canRefundSession(sess[1]) && !canRefundSession(sess[2]) && refundableRand(sess[0]) === 120 && refundableRand(sess[2]) === 0);
    check('the session line says price, what already went back and what the tutor lost', /paid R200/.test(refundSessionLine(sess[0])) && /R80 already refunded/.test(refundSessionLine(sess[0])) && /tutor was credited R140, R56 taken back/.test(refundSessionLine(sess[0])) && /scheduled/.test(refundSessionLine(sess[1])));
    check('a missing function or a failing call gives no sessions and never throws',
      (await fetchWalletSessions(fake({ rpc: () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } }) }).client, 'p')).length === 0 && (await fetchWalletSessions(fake({ throwAll: true }).client, 'p')).length === 0);
    const closedWorld = fake({ rpc: () => ({ data: [
      { profile_id: 'c-1', role: 'student', display_name: 'Former learner', available_rand: 500, held_rand: 0, open_payout_rand: 0, unconfirmed_rand: 150, closure_id: 'z-1', closure_status: 'db_deleted', closed_at: '2026-10-01T08:00:00Z', topup_references: ['TL-ABCDEF'], has_bank_details: false },
      { profile_id: 'c-2', role: 'tutor', display_name: 'Former tutor', available_rand: 20, held_rand: 120, open_payout_rand: 120, unconfirmed_rand: 0, closure_id: 'z-2', closure_status: 'closed', closed_at: '2026-10-02T08:00:00Z', topup_references: null, has_bank_details: true },
    ], error: null }) });
    const closed = await fetchClosedAccountWallets(closedWorld.client);
    check('closed accounts with money are read through admin_closed_account_wallets', closed.state === 'ok' && closedWorld.calls[0].fn === 'admin_closed_account_wallets' && closed.rows.length === 2 && closed.rows[0].topupReferences[0] === 'TL-ABCDEF' && closed.rows[1].topupReferences.length === 0 && closed.rows[1].hasBankDetails);
    const rows = closed.state === 'ok' ? closed.rows : [];
    check('each closed account is described in words (available, on hold with the open payout, unconfirmed transfer)', closedWalletSentence(rows[0]) === 'R500 available · R150 in a bank transfer with proof you have not decided on'
      && closedWalletSentence(rows[1]) === 'R20 available · R120 on hold (R120 is an open payout request: mark it paid first)', closedWalletSentence(rows[1]));
    check('a missing function says "not available"; a failure says what went wrong', (await fetchClosedAccountWallets(fake({ rpc: () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.admin_closed_account_wallets' } }) }).client)).state === 'not_available'
      && (await fetchClosedAccountWallets(fake({ throwAll: true }).client)).state === 'error');
    const opened = closedToListRow(rows[1]);
    check('a closed account opens as an ordinary wallet row (same card, same ledger)', opened.profileId === 'c-2' && opened.availableRand === 20 && opened.heldRand === 120 && opened.hasWallet && opened.role === 'tutor');
    const fresh = await refreshWalletRow(fake({ tables: { wallets: { data: [{ profile_id: 'c-2', available_rand: 0, held_rand: 0 }], error: null } } }).client, opened);
    check('after a money action the balance is read again (and the old row is kept if the read fails)', fresh.availableRand === 0 && fresh.heldRand === 0 && (await refreshWalletRow(fake({ throwAll: true }).client, opened)).availableRand === 20);
    check('the two new ledger kinds have plain labels', ledgerKindLabel('withdrawal') === 'Money returned to the person by hand' && /refunded/.test(ledgerKindLabel('refund_reversal')) && LEDGER_KIND_LABELS.refund_reversal !== undefined);
    const topupWorld = fake({ tables: { wallet_topups: { data: [], error: null }, profiles: { data: [], error: null } } });
    await fetchTopupQueue(topupWorld.client);
    await fetchWalletDetail(fake({ tables: { wallet_ledger: { data: [], error: null } } }).client, 'p-1');
    check('top-ups are read with the proof-deleted time, and never with select *', topupWorld.queries.filter((q) => q.table === 'wallet_topups').every((q) => /proof_deleted_at/.test(q.cols) && !q.cols.includes('*')));
    const libSrc = code('admin/src/lib/walletAdmin.ts');
    check('the new admin code reads no bank column from any table and uses no select *', !/select\('\*'\)/.test(libSrc) && !/from\('(payout_requests|tutor_bank_details)'\)\.select\([^)]*(account_number|bank_name|account_holder|branch_code)/.test(libSrc)
      && (libSrc.match(/\baccount_number\b/g) ?? []).length === 2);
  }

  // ================================================================ 4. the screens
  {
    const row: WalletListRow = { profileId: 'p-1', name: 'Lee', role: 'student', availableRand: 100, heldRand: 0, hasWallet: true };
    const sessions: WalletSession[] = [
      { sessionId: 's-1', scheduledStart: '2026-11-04T08:00:00Z', status: 'completed', priceRand: 200, refundedRand: 80, tutorId: 't-1', tutorName: 'Thandi', tutorShareRand: 140, tutorCredited: true, tutorReducedRand: 56 },
      { sessionId: 's-2', scheduledStart: '2026-11-20T08:00:00Z', status: 'scheduled', priceRand: 100, refundedRand: 0, tutorId: 't-1', tutorName: 'Thandi', tutorShareRand: 0, tutorCredited: false, tutorReducedRand: 0 },
    ];
    const closedRows: ClosedWalletRow[] = [{ profileId: 'c-1', role: 'student', name: 'Former learner', availableRand: 500, heldRand: 0, openPayoutRand: 0, unconfirmedRand: 0, closureId: 'z', closureStatus: 'db_deleted', closedAt: '2026-10-01T08:00:00Z', topupReferences: ['TL-ABCDEF'], hasBankDetails: false }];
    const sec = words(renderAdmin(AdminReact.createElement(WalletSessionsSection, { row, sessions, onRefund: async () => ({ ok: true as const, message: '' }) })));
    check('the sessions section lists each session with a Refund button only where a refund is possible', /Sessions this wallet paid for/.test(sec) && (sec.match(/Refund…/g) ?? []).length === 1 && /Not finished/.test(sec) && /Tutor Thandi/.test(sec));
    check('the sessions section is not drawn at all without a handler', renderAdmin(AdminReact.createElement(WalletSessionsSection, { row, sessions })) === '');
    const cs = words(renderAdmin(AdminReact.createElement(ClosedAccountsSection, { rows: closedRows, onOpen: () => undefined })));
    check('the closed-accounts list says closing never deletes money, shows the figures, the top-up reference, and an Open button', /Closing never deletes money/.test(cs) && /R500 available/.test(cs) && /TL-ABCDEF/.test(cs) && /Open/.test(cs) && /Closed accounts with money \(1\)/.test(cs));
    check('an empty list says so', /No closed account has money left/.test(words(renderAdmin(AdminReact.createElement(ClosedAccountsSection, { rows: [], onOpen: () => undefined })))));
    const okList = { state: 'ok' as const, wallets: [row] };
    const baseProps = {
      totals: { state: 'not_available' as const, note: 'x' }, list: okList, term: '', onTerm: () => undefined, onSearch: () => undefined,
      selected: { row, detail: { ledger: [], topups: [], payouts: [], sessions } }, onSelect: () => undefined, check: { state: 'idle' as const }, onRunCheck: () => undefined,
      canAdjust: false, onAdjust: async () => null, onRetry: () => undefined,
    };
    const act = async () => ({ ok: true as const, message: 'done' });
    const fullHtml = renderAdmin(AdminReact.createElement(WalletBalancesBody, { ...baseProps, closed: { state: 'ok', rows: closedRows }, edge: { onRefund: act, onReturn: act, onHandTopup: act, onOpenTutorBank: async () => ({ bankName: 'B', accountHolder: 'H', branchCode: '1', accountNumber: '2' }) } }));
    const full = words(fullHtml);
    check('with the handlers, a person\'s card has the refund list, "Add a top-up by hand" and "Return money by hand"; the closed list is above the wallets',
      /Sessions this wallet paid for/.test(full) && /Add a top-up by hand/.test(full) && /Return money by hand/.test(full) && /Closed accounts with money/.test(full) && fullHtml.indexOf('data-closed-wallets') < fullHtml.indexOf('id="wallet-search"'));
    const bare = words(renderAdmin(AdminReact.createElement(WalletBalancesBody, baseProps)));
    check('without the handlers none of the new forms is drawn (a page that does not use them is unchanged)', !/Return money by hand|Add a top-up by hand|Sessions this wallet paid for|Closed accounts with money/.test(bare));
    const tutorCard = words(renderAdmin(AdminReact.createElement(WalletBalancesBody, { ...baseProps, selected: { row: { ...row, role: 'tutor' }, detail: { ledger: [], topups: [], payouts: [], sessions: [] } }, edge: { onReturn: act, onOpenTutorBank: async () => ({ bankName: 'B', accountHolder: 'H', branchCode: '1', accountNumber: '2' }) } })));
    check('for a tutor the return form offers "Show their bank details" (each opening is recorded); for a learner it does not', /Show their bank details/.test(tutorCard) && /Each opening is recorded/.test(tutorCard) && !/Show their bank details/.test(full));
    const forms = code('admin/src/components/WalletEdgeForms.tsx');
    check('each form keeps ONE one-time key per attempt (a ref) and only makes a new one after success',
      (forms.match(/const key = useRef<string>\(newAdjustKey\(\)\)/g) ?? []).length === 3 && (forms.match(/key\.current = newAdjustKey\(\)/g) ?? []).length === 3
      && forms.indexOf('key.current = newAdjustKey()') > forms.indexOf('if (result.ok === false) return setError(result.error)'));
    check('every money click asks first (a confirm box) and the confirm checks the input again before it calls', (forms.match(/<ConfirmBox/g) ?? []).length === 3 && (forms.match(/const c = check(Refund|Return|HandTopup)\(/g) ?? []).length === 6);
    const tabs = code('admin/src/components/WalletTabs.tsx');
    check('the Wallets tab wires the six new calls, loads the closed list, and keeps the card on screen while it reloads (the sentence stays)',
      ['refundToWallet', 'returnWalletMoney', 'addTopupByHand', 'openTutorBankDetails', 'fetchClosedAccountWallets', 'refreshWalletRow'].every((f) => tabs.includes(`${f}(`)) && /detail: cur\.detail/.test(tabs));
    check('the two new audit actions have a plain label in the Audit Log', /wallet_refunded_to_learner: 'Session refunded into a wallet'/.test(read('admin/src/pages/AuditLog.tsx')) && /wallet_money_returned: 'Wallet money returned by hand'/.test(read('admin/src/pages/AuditLog.tsx')));
    check('an account closure waiting for money is flagged on the closures screen with where to go', /Money still owed: payout details kept \(Payments, Wallets, Closed accounts with money\)/.test(read('admin/src/components/AccountClosuresBody.tsx')));
  }

  // ================================================================ 5. no key-shaped text, nothing private in the new files
  {
    const bad = [['sk', 'live', ''].join('_'), ['pk', 'live', ''].join('_'), ['whsec', ''].join('_'), ['sk', 'test', ''].join('_')];
    const files = [MIGRATION, 'supabase/migrations/20261103090000_wallet_edges_audit_actions.sql', 'supabase/tests/wallet_edges.sql', 'scripts/dev/wallet-edges-test.ts', 'admin/src/components/WalletEdgeForms.tsx'];
    const hits = files.filter((f) => bad.some((b) => read(f).includes(b)));
    check('no key-shaped text in any new file', hits.length === 0, hits.join(','));
  }

  console.log(failed === 0 ? '\nwallet-edges test: all checks passed' : `\nwallet-edges test: ${failed} check(s) FAILED`);
  process.exit(failed === 0 ? 0 : 1);
}
void main();
