// Checks on the ADMIN WALLET SCREENS (phase 4 of the wallet + manual bank transfer system; CEO's design, 2 Nov 2026), the four tabs of the Payments page.
// Run: npx tsx scripts/dev/wallet-admin-test.ts
// Proves, with a fake database client, the screens drawn to markup, and by reading the source: only finance_manager and super_admin see or use anything
// (a support or verification admin gets nothing, and only a super admin gets "Adjust wallet"); every call uses the database function names of the
// phase 1 migration; every question is tolerant (a missing function or table says "not available", a failure gives a message with Try again, nothing
// throws); payout_requests and tutor_bank_details are read with explicit column lists and the bank columns are not even asked for; the proof is opened
// only through the logged viewer (log first, signed link second, file third, bucket payment-proofs) and never as a link; the amount received is
// prefilled with the claim and a comment is required when it differs; Unsuccessful needs a comment; the wallet switch is never changed by code except
// from its own confirmed button; the limits are saved in an order the database guard accepts; wallet_paid and wallet_refunded are labelled and counted.
// It does NOT click through the screens (static markup only) and does NOT run against the database: the functions themselves are proved by
// supabase/tests/wallet_core.sql (rolled back, on production 2 Nov), and the screens with real top-ups wait for phase 7 (see the P3 list in the report).
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import {
  BANK_KEYS, LIMIT_KEYS, LEDGER_KIND_LABELS, OVERDUE_HOURS, SWITCH_KEY, WALLET_NOT_AVAILABLE, adjustConfirmText, adjustWallet, balanceCheckSentence, bankChangedRecently,
  canAdjustWallet, canUseWallet, checkAdjustment, checkBank, checkCannotPay, checkLimits, checkPaid, checkSuccessful, checkUnsuccessful, fetchPayoutQueue, fetchTopupQueue,
  fetchTotals, fetchWalletDetail, fetchWalletList, fetchWalletSettings, formatSast, isOverdue, ledgerAmountText, ledgerKindLabel, markPayoutCannotPay, markPayoutPaid,
  markTopupSuccessful, markTopupUnsuccessful, newAdjustKey, openBankDetails, parseTotals, planSettingSaves, rand0, readWalletSettings, runBalanceCheck, saveSettingWrites,
  successConfirmText, switchSummary, viewProof, waitingFor, walletErrorMessage, type PayoutQueue, type TopupQueue, type WalletAdminClient, type WalletList,
} from '../../admin/src/lib/walletAdmin';
import { PAYMENT_STATUS_LABELS, countHowPaid, paymentStatusLabel, requestWasMatched, requestWasSent } from '../../admin/src/lib/paymentStatus';
import { WalletTopupsBody } from '../../admin/src/components/WalletTopupsBody';
import { WalletPayoutsBody } from '../../admin/src/components/WalletPayoutsBody';
import { WalletBalancesBody } from '../../admin/src/components/WalletBalancesBody';
import { WalletSettingsBody } from '../../admin/src/components/WalletSettingsBody';
import { WalletTabs } from '../../admin/src/components/WalletTabs';

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

type Err = { code?: string; message?: string } | null;
type Answer = { data: unknown; error: Err };
interface Q { table: string; cols: string; ins: Record<string, unknown[]>; eqs: Record<string, unknown>; orders: string[]; limit: number | null }
function fake(opts: { tables?: Record<string, Answer | ((q: Q) => Answer)>; rpc?: (fn: string, args?: Record<string, unknown>) => Answer; throwAll?: boolean } = {}) {
  const queries: Q[] = [];
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const client: WalletAdminClient = {
    rpc: async (fn, args = {}) => {
      if (opts.throwAll) throw new TypeError('Failed to fetch');
      calls.push({ fn, args });
      return (opts.rpc ?? (() => ({ data: null, error: null })))(fn, args);
    },
    from: (table: string) => {
      const q: Q = { table, cols: '', ins: {}, eqs: {}, orders: [], limit: null };
      queries.push(q);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const b: any = {};
      b.select = (c: string) => { q.cols = c; return b; };
      b.in = (col: string, values: unknown[]) => { q.ins[col] = values; return b; };
      b.eq = (col: string, v: unknown) => { q.eqs[col] = v; return b; };
      b.order = (col: string, o?: { ascending?: boolean }) => { q.orders.push(`${col}:${o?.ascending === false ? 'desc' : 'asc'}`); return b; };
      b.limit = (n: number) => { q.limit = n; return b; };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      b.then = (res: any, rej: any) => {
        if (opts.throwAll) return Promise.reject(new TypeError('Failed to fetch')).then(res, rej);
        const t = opts.tables?.[table];
        const answer: Answer = typeof t === 'function' ? t(q) : t ?? { data: [], error: null };
        return Promise.resolve(answer).then(res, rej);
      };
      return b;
    },
  };
  return { client, queries, calls };
}

const PAYER = '11111111-1111-4111-8111-111111111111';
const PARENT = '22222222-2222-4222-8222-222222222222';
const TUTOR = '33333333-3333-4333-8333-333333333333';
const NOW = new Date('2026-11-03T12:00:00Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

const topupRow = (id: string, profile: string, status: string, extra: Record<string, unknown> = {}) => ({
  id, profile_id: profile, reference: `TL-${id.toUpperCase().padEnd(6, 'A').slice(0, 6)}`, amount_rand: 200, status, proof_path: status === 'awaiting_proof' ? null : `${profile}/${id}.pdf`,
  proof_attached_at: status === 'awaiting_proof' ? null : hoursAgo(3), received_rand: null, decided_at: null, decision_comment: null, created_at: hoursAgo(5), ...extra,
});
const people = { data: [{ id: PAYER, full_name: 'Thandi M', role: 'student' }, { id: PARENT, full_name: 'Nomsa P', role: 'parent' }, { id: TUTOR, full_name: 'Sipho T', role: 'tutor' }], error: null };

async function main() {
  // ---- who sees what ----
  check('only a finance manager and a super admin may use the wallet tabs', canUseWallet('finance_manager') && canUseWallet('super_admin') && !canUseWallet('support_agent') && !canUseWallet('verification_officer') && !canUseWallet(null) && !canUseWallet(undefined));
  check('only a super admin may adjust a wallet', canAdjustWallet('super_admin') && !canAdjustWallet('finance_manager') && !canAdjustWallet('support_agent'));
  const dummy = fake().client;
  const tabsFor = (role: 'support_agent' | 'verification_officer' | 'finance_manager' | 'super_admin') => html(React.createElement(WalletTabs, { client: dummy, role, saveSetting: async () => undefined }));
  check('a support agent and a verification officer get NOTHING from the wallet tabs (empty markup)', tabsFor('support_agent') === '' && tabsFor('verification_officer') === '');
  const financeTabs = tabsFor('finance_manager');
  check('a finance manager and a super admin get the four tabs', ['Top-ups to check', 'Payout requests', 'Wallets', 'Wallet settings'].every((t) => financeTabs.includes(t) && tabsFor('super_admin').includes(t)));
  const payoutsPage = read('admin/src/pages/Payouts.tsx');
  const layout = read('admin/src/components/AdminLayout.tsx');
  check('the Payments page shows the wallet tabs only when canUseWallet says so, and the nav item is still finance_manager + super_admin only', /const showWallet = canUseWallet\(adminProfile\?\.adminRole\)/.test(payoutsPage) && /\{showWallet && \(\s*<WalletTabs/.test(payoutsPage) && /to: '\/payouts', label: 'Payments', icon: Banknote, roles: \['finance_manager', 'super_admin'\]/.test(layout));
  check('the old card sections stay on the page and are labelled dormant for a finance admin', /Card payments \(dormant\)/.test(payoutsPage) && /fetchPayoutBatches\(\)/.test(payoutsPage) && /Where tutors are paid/.test(payoutsPage));

  // ---- 1. top-ups to check ----
  const openRows = [
    topupRow('bbbbbb', PARENT, 'proof_sent', { proof_attached_at: hoursAgo(30), amount_rand: 500 }),
    topupRow('aaaaaa', PAYER, 'proof_sent', { proof_attached_at: hoursAgo(2) }),
    topupRow('cccccc', PAYER, 'awaiting_proof'),
  ];
  const decidedRows = [
    topupRow('dddddd', PAYER, 'successful', { received_rand: 150, decided_at: hoursAgo(10), decision_comment: 'Only R150 arrived' }),
    topupRow('eeeeee', PAYER, 'unsuccessful', { decided_at: hoursAgo(20), decision_comment: 'Nothing in the account' }),
  ];
  const topupWorld = fake({ tables: { wallet_topups: (q) => ({ data: (q.ins.status ?? []).includes('proof_sent') ? openRows : decidedRows, error: null }), profiles: people } });
  const queue = await fetchTopupQueue(topupWorld.client);
  check('the queue lists proofs oldest first, waiting-for-proof apart, and the recent decisions', queue.state === 'ok' && queue.proofSent.map((r) => r.id).join() === 'bbbbbb,aaaaaa' && queue.awaiting.map((r) => r.id).join() === 'cccccc' && queue.recent.length === 2);
  check('the payer is named and a parent is marked as one', queue.state === 'ok' && queue.proofSent[0].payerName === 'Nomsa P' && queue.proofSent[0].payerIsParent === true && queue.proofSent[1].payerIsParent === false);
  const topupSelects = topupWorld.queries.filter((q) => q.table === 'wallet_topups').map((q) => q.cols);
  check('top-ups are read with an explicit column list, never select *', topupSelects.length === 2 && topupSelects.every((c) => c !== '*' && !c.includes('*') && c.includes('proof_path')));
  const missing = await fetchTopupQueue(fake({ tables: { wallet_topups: { data: null, error: { code: '42P01', message: 'relation "wallet_topups" does not exist' } } } }).client);
  check('a database without the wallet says "not available" (no crash)', missing.state === 'not_available' && missing.note === WALLET_NOT_AVAILABLE);
  const refused = await fetchTopupQueue(fake({ tables: { wallet_topups: { data: null, error: { code: '42501', message: 'permission denied' } } } }).client);
  check('a refusal is an error message with a way to try again, not a crash', refused.state === 'error' && /finance manager/.test(refused.message));
  const thrown = await fetchTopupQueue(fake({ throwAll: true }).client);
  check('a client that throws gives an error state', thrown.state === 'error');

  check('"Amount received": a whole number of rands, nothing else', checkSuccessful(200, '200', '').ok === true && checkSuccessful(200, '2e2', '').ok === false && checkSuccessful(200, '', '').ok === false && checkSuccessful(200, '0', 'x'.repeat(5)).ok === false && checkSuccessful(200, '-5', '').ok === false && checkSuccessful(200, '199.50', 'cents').ok === false);
  check('the amount equal to the claim needs no comment', JSON.stringify(checkSuccessful(200, ' 200 ', '')) === JSON.stringify({ ok: true, received: 200, comment: null }));
  const differs = checkSuccessful(200, '150', '');
  check('an amount that differs from the claim REQUIRES a comment, and says why', differs.ok === false && /R150/.test(differs.error) && /R200/.test(differs.error) && checkSuccessful(200, '150', 'Only R150 arrived').ok === true);
  check('Unsuccessful REQUIRES a comment (the learner reads it)', checkUnsuccessful('').ok === false && checkUnsuccessful('  ').ok === false && checkUnsuccessful('Nothing arrived').ok === true && checkUnsuccessful('x'.repeat(1001)).ok === false);
  check('the confirm box names the person and the amount ("Add R200 to Thandi\'s wallet?")', /^Add R200 to Thandi's wallet\?/.test(successConfirmText("Thandi", 200, 200)) && /They said R200/.test(successConfirmText('Thandi', 150, 200)));
  const sw = fake({ rpc: () => ({ data: { already: false }, error: null }) });
  await markTopupSuccessful(sw.client, 'aaaaaa', 200, null);
  await markTopupUnsuccessful(sw.client, 'aaaaaa', 'Nothing arrived');
  check('Successful and Unsuccessful call the phase 1 functions with their exact argument names', JSON.stringify(sw.calls) === JSON.stringify([
    { fn: 'admin_mark_topup_successful', args: { p_topup: 'aaaaaa', p_received: 200, p_comment: null } },
    { fn: 'admin_mark_topup_unsuccessful', args: { p_topup: 'aaaaaa', p_comment: 'Nothing arrived' } },
  ]));
  const again = await markTopupSuccessful(fake({ rpc: () => ({ data: { already: true }, error: null }) }).client, 'aaaaaa', 200, null);
  check('a repeat click is reported as already decided (the database posts once)', again.already === true);
  let refusedMessage = '';
  try { await markTopupSuccessful(fake({ rpc: () => ({ data: null, error: { code: '42501', message: 'Finance admins only' } }) }).client, 'aaaaaa', 200, null); } catch (e) { refusedMessage = (e as Error).message; }
  check('the database\'s refusal reaches the screen in words', /finance manager/i.test(refusedMessage));
  let missingMessage = '';
  try { await markTopupUnsuccessful(fake({ rpc: () => ({ data: null, error: { code: '42883', message: 'function does not exist' } }) }).client, 'a', 'no'); } catch (e) { missingMessage = (e as Error).message; }
  check('a missing function says "not available"', missingMessage === WALLET_NOT_AVAILABLE);
  check('walletErrorMessage never returns an empty string', walletErrorMessage({}).length > 0 && walletErrorMessage(null).length > 0 && walletErrorMessage(new Error('boom')) === 'boom');

  const topupNoop = async () => null;
  const topupMarkup = html(React.createElement(WalletTopupsBody, { queue, now: NOW, onView: () => undefined, onSuccessful: topupNoop, onUnsuccessful: topupNoop, onRetry: () => undefined }));
  check('each proof shows payer, claim, reference with a copy button, View proof, Successful and Unsuccessful', (topupMarkup.match(/data-topup-card/g) ?? []).length === 2 && (topupMarkup.match(/View proof/g) ?? []).length === 2 && (topupMarkup.match(/Successful transfer/g) ?? []).length === 2 && (topupMarkup.match(/Unsuccessful transfer/g) ?? []).length === 2 && /TL-AAAAAA/.test(topupMarkup) && /Copy reference/.test(topupMarkup) && /Nomsa P/.test(topupMarkup) && /parent/.test(topupMarkup));
  check('"Amount received" is prefilled with the claimed amount', /id="topup-bbbbbb-received"[^>]*value="500"/.test(topupMarkup) && /id="topup-aaaaaa-received"[^>]*value="200"/.test(topupMarkup));
  check('a proof older than 24 hours goes red and says so; a fresh one does not', (topupMarkup.match(/over 24 hours/g) ?? []).length === 1 && isOverdue(hoursAgo(OVERDUE_HOURS + 1), NOW) && !isOverdue(hoursAgo(OVERDUE_HOURS - 1), NOW) && !isOverdue(null, NOW));
  check('waiting-for-proof rows have no decision buttons, and decided rows show the comment', /data-awaiting-row/.test(topupMarkup) && /Only R150 arrived/.test(topupMarkup) && /Nothing in the account/.test(topupMarkup));
  check('no link to a proof file is ever drawn in the list (no href, no storage address)', !/href=/.test(topupMarkup) && !/supabase|signed|token=/i.test(topupMarkup));
  check('the list screens draw "not available" and a failure with Try again, never a crash', html(React.createElement(WalletTopupsBody, { queue: missing as TopupQueue, onView: () => undefined, onSuccessful: topupNoop, onUnsuccessful: topupNoop, onRetry: () => undefined })).includes('not on this database') && /Try again/.test(html(React.createElement(WalletTopupsBody, { queue: refused as TopupQueue, onView: () => undefined, onSuccessful: topupNoop, onUnsuccessful: topupNoop, onRetry: () => undefined }))));

  // the proof is opened through the logged viewer only
  const order: string[] = [];
  const proofClient: WalletAdminClient = {
    rpc: async (fn, args) => { order.push(`rpc:${fn}:${String(args?.p_bucket)}`); return { data: 'row', error: null }; },
    from: () => { throw new Error('not used'); },
    storage: { from: (bucket) => ({ createSignedUrl: async (path, seconds) => { order.push(`sign:${bucket}:${seconds}`); return { data: { signedUrl: `https://files.example.invalid/${path}?token=abc` }, error: null }; } }) },
  };
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string) => { order.push(`fetch:${String(url).startsWith('https://files.example.invalid/') ? 'signed-url' : 'other'}`); return new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a]), { status: 200 }); }) as typeof fetch;
  const viewed = await viewProof(proofClient, `${PAYER}/aaaaaa.pdf`, PAYER);
  globalThis.fetch = realFetch;
  check('View proof records the opening FIRST (bucket payment-proofs), then makes a 5-minute link, then reads the file once', order.join(' | ') === 'rpc:log_document_access:payment-proofs | sign:payment-proofs:300 | fetch:signed-url' && viewed.kind === 'pdf');
  let noStorage = '';
  try { await viewProof(dummy, 'x/y.pdf', PAYER); } catch (e) { noStorage = (e as Error).message; }
  check('without storage access nothing is opened', noStorage !== '');
  const tabsSrc = code('admin/src/components/WalletTabs.tsx');
  const libSrc = code('admin/src/lib/walletAdmin.ts');
  check('the proof opens in the app\'s own viewer: DocumentViewer + viewProof; the screens never call createSignedUrl, window.open or draw a file link', /<DocumentViewer documents=\{\[viewing\]\}/.test(tabsSrc) && /viewProof\(client, path, row\.payerId\)/.test(tabsSrc) && !/createSignedUrl|window\.open|href=/.test(tabsSrc + code('admin/src/components/WalletTopupsBody.tsx') + libSrc) && /viewStoredDocument\(client as unknown as DocumentClient, 'payment-proofs'/.test(libSrc));
  check('the DocumentBucket type knows payment-proofs', /export type DocumentBucket = 'tutor-documents' \| 'school-results' \| 'payment-proofs'/.test(read('admin/src/lib/documentAccess.ts')));

  // ---- 2. payout requests ----
  const payoutRows = [
    { id: 'p1', tutor_id: TUTOR, amount_rand: 640, status: 'requested', bank_details_changed_at: hoursAgo(40), session_ids: ['s1', 's2'], requested_at: hoursAgo(30), decided_at: null, paid_on: null, bank_reference: null, decision_comment: null },
    { id: 'p2', tutor_id: TUTOR, amount_rand: 100, status: 'requested', bank_details_changed_at: hoursAgo(400), session_ids: ['s3'], requested_at: hoursAgo(1), decided_at: null, paid_on: null, bank_reference: null, decision_comment: null },
  ];
  const paidRows = [{ id: 'p0', tutor_id: TUTOR, amount_rand: 300, status: 'paid', bank_details_changed_at: null, session_ids: [], requested_at: hoursAgo(50), decided_at: hoursAgo(40), paid_on: '2026-11-01', bank_reference: 'FNB-77', decision_comment: null }];
  const payoutWorld = fake({ tables: { payout_requests: (q) => ({ data: q.eqs.status === 'requested' ? payoutRows : paidRows, error: null }), profiles: people } });
  const pq = await fetchPayoutQueue(payoutWorld.client);
  check('payout requests: oldest first, with names, session counts and the "changed recently" flag', pq.state === 'ok' && pq.requested.length === 2 && pq.requested[0].tutorName === 'Sipho T' && pq.requested[0].sessionCount === 2 && pq.requested[0].bankChangedRecently === true && pq.requested[1].bankChangedRecently === false && pq.recent[0].bankReference === 'FNB-77');
  const payoutCols = payoutWorld.queries.filter((q) => q.table === 'payout_requests').map((q) => q.cols);
  check('payout_requests is read with an explicit column list that holds NO bank column (not even the last four digits)', payoutCols.length === 2 && payoutCols.every((c) => !c.includes('*') && !/account|bank_name|holder|branch|last4/.test(c.replace('bank_details_changed_at', '').replace('bank_reference', ''))), payoutCols[0]);
  check('"changed recently" means the 48 hours before the request', bankChangedRecently(hoursAgo(60), hoursAgo(1)) === false && bankChangedRecently(hoursAgo(26), hoursAgo(1)) === true && bankChangedRecently(hoursAgo(2), hoursAgo(1)) === true && bankChangedRecently(null, hoursAgo(1)) === false);
  const payoutNoop = async () => null;
  const payoutMarkup = html(React.createElement(WalletPayoutsBody, { queue: pq, now: NOW, today: '2026-11-03', onOpenBank: async () => { throw new Error('x'); }, onPaid: payoutNoop, onCannotPay: payoutNoop, onRetry: () => undefined }));
  check('the bank details are HIDDEN until opened: the list holds an "Open bank details" button and no bank, holder, branch or number', (payoutMarkup.match(/Open bank details/g) ?? []).length === 2 && /Bank details are hidden/.test(payoutMarkup) && !/data-bank-open/.test(payoutMarkup) && !/FNB|Branch code|Account number/i.test(payoutMarkup.replace(/FNB-77/, '')));
  check('each request offers Mark paid and Cannot pay; the old one is red and the changed-details warning shows once', (payoutMarkup.match(/data-payout-card/g) ?? []).length === 2 && (payoutMarkup.match(/>Mark paid</g) ?? []).length === 2 && (payoutMarkup.match(/>Cannot pay</g) ?? []).length === 2 && (payoutMarkup.match(/over 24 hours/g) ?? []).length === 1 && (payoutMarkup.match(/data-bank-changed/g) ?? []).length === 1);
  const bankWorld = fake({ rpc: () => ({ data: { payout_id: 'p1', bank_name: 'FNB', account_holder: 'S Tutor', branch_code: '250655', account_number: '62000000001', amount_rand: 640, status: 'requested' }, error: null }) });
  const details = await openBankDetails(bankWorld.client, 'p1');
  check('Open bank details calls admin_open_bank_details once per opening (the database writes the audit line) and returns the details to the screen only', bankWorld.calls.length === 1 && bankWorld.calls[0].fn === 'admin_open_bank_details' && details.accountNumber === '62000000001' && details.bankName === 'FNB');
  const pw = fake({ rpc: () => ({ data: { already: false }, error: null }) });
  await markPayoutPaid(pw.client, 'p1', 'FNB-77', '2026-11-03');
  await markPayoutCannotPay(pw.client, 'p1', 'Account closed');
  check('Mark paid and Cannot pay call the phase 1 functions with their exact argument names', JSON.stringify(pw.calls) === JSON.stringify([
    { fn: 'admin_mark_payout_paid', args: { p_payout: 'p1', p_bank_reference: 'FNB-77', p_paid_on: '2026-11-03' } },
    { fn: 'admin_mark_payout_cannot_pay', args: { p_payout: 'p1', p_comment: 'Account closed' } },
  ]));
  check('Mark paid: the date cannot be in the future, the reference is short, both are optional', checkPaid('', '', '2026-11-03').ok === true && checkPaid('', '2026-11-04', '2026-11-03').ok === false && checkPaid('x'.repeat(101), '', '2026-11-03').ok === false && checkPaid('ref', '3 Nov', '2026-11-03').ok === false && JSON.stringify(checkPaid(' FNB-77 ', '2026-11-03', '2026-11-03')) === JSON.stringify({ ok: true, reference: 'FNB-77', paidOn: '2026-11-03' }));
  check('Cannot pay REQUIRES a comment (the tutor reads it)', checkCannotPay('').ok === false && checkCannotPay('Account closed').ok === true);
  check('a missing table or a failure on the payouts tab is "not available" / Try again, never a crash', (await fetchPayoutQueue(fake({ tables: { payout_requests: { data: null, error: { code: 'PGRST205', message: 'Could not find the table' } } } }).client)).state === 'not_available' && (await fetchPayoutQueue(fake({ throwAll: true }).client)).state === 'error');
  check('the bank-details panel draws only from admin_open_bank_details in the screen\'s own state (the lists never carry the number)', /bank \? \(\s*<div data-bank-open>/.test(read('admin/src/components/WalletPayoutsBody.tsx')) && !/account_number/.test(code('admin/src/components/WalletPayoutsBody.tsx')) && (libSrc.match(/\baccount_number\b/g) ?? []).length === 1);
  void (null as unknown as PayoutQueue);

  // ---- 3. wallets ----
  const totalsFull = parseTotals({ wallets: 4, available_rand: 700, held_rand: 180, total_rand: 880, tutor_wallets_rand: 300, topups_waiting: 3, topups_proof_sent: 2, payouts_requested: 1, payouts_requested_rand: 640, oldest_proof_sent_at: hoursAgo(3), oldest_payout_requested_at: null, booked_sessions: 2, booked_tutor_share_rand: 270, held_for_others_rand: 1150 });
  check('the totals read every figure, including "held for others"', totalsFull.heldForOthersRand === 1150 && totalsFull.inWalletsRand === 880 && totalsFull.bookedTutorShareRand === 270 && totalsFull.proofSent === 2 && totalsFull.payoutsRequested === 1 && totalsFull.tutorWalletsRand === 300);
  check('before the booking migration (no held_for_others figure) the total falls back to what is in wallets', parseTotals({ total_rand: 880 }).heldForOthersRand === 880 && parseTotals(null).heldForOthersRand === 0);
  const tw = fake({ rpc: () => ({ data: { total_rand: 10 }, error: null }) });
  const t1 = await fetchTotals(tw.client);
  const t2 = await fetchTotals(fake({ rpc: () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.wallet_totals' } }) }).client);
  check('wallet_totals() is called with no arguments; a missing function says "not available"', t1.state === 'ok' && tw.calls[0].fn === 'wallet_totals' && t2.state === 'not_available' && (await fetchTotals(fake({ throwAll: true }).client)).state === 'error');
  const bc = await runBalanceCheck(fake({ rpc: () => ({ data: { checked: 4, mismatch_count: 1, mismatches: [{ profile_id: PAYER, stored_available: 107, ledger_available: 100, stored_held: 0, ledger_held: 0, broken_links: 0 }], checked_at: hoursAgo(0) }, error: null }) }).client);
  check('the balance check is admin_wallet_balance_check(); a clean result and a mismatch are said plainly', bc.mismatchCount === 1 && bc.mismatches[0].storedAvailable === 107 && /do not add up/.test(balanceCheckSentence(bc)) && /All 4 wallets add up/.test(balanceCheckSentence({ ...bc, mismatchCount: 0, checked: 4, mismatches: [] })));
  const listWorld = fake({ tables: { wallets: { data: [{ profile_id: PAYER, available_rand: 320, held_rand: 180 }], error: null }, profiles: people } });
  const biggest = await fetchWalletList(listWorld.client);
  const wq = listWorld.queries.find((q) => q.table === 'wallets');
  check('with no search the biggest wallets are listed, with names', biggest.state === 'ok' && biggest.wallets[0].name === 'Thandi M' && biggest.wallets[0].availableRand === 320 && wq!.orders[0] === 'available_rand:desc' && wq!.limit === 50 && !wq!.cols.includes('*'));
  const searchWorld = fake({ rpc: () => ({ data: [{ id: PAYER, full_name: 'Thandi M', role: 'student' }, { id: PARENT, full_name: 'Nomsa P', role: 'parent' }], error: null }), tables: { wallets: { data: [{ profile_id: PAYER, available_rand: 320, held_rand: 0 }], error: null } } });
  const found = await fetchWalletList(searchWorld.client, ' thandi ');
  check('a search finds people with admin_search_profiles; someone with no wallet shows "No wallet yet"', searchWorld.calls[0].fn === 'admin_search_profiles' && searchWorld.calls[0].args.p_term === 'thandi' && found.state === 'ok' && found.wallets.length === 2 && found.wallets[1].hasWallet === false);
  const detailWorld = fake({ tables: { wallet_ledger: { data: [{ id: 'l1', kind: 'topup', available_delta: 200, held_delta: 0, available_after: 200, held_after: 0, note: null, created_at: hoursAgo(2) }], error: null }, wallet_topups: { data: [], error: { code: '42P01', message: 'x' } }, payout_requests: { data: [], error: null } } });
  const detail = await fetchWalletDetail(detailWorld.client, PAYER);
  check('one failing part of a wallet\'s detail is left out and the others still show', detail.ledger.length === 1 && detail.topups.length === 0 && detailWorld.queries.every((q) => !q.cols.includes('*')) && !detailWorld.queries.some((q) => q.table === 'payout_requests' && /account|bank_name|holder|branch|last4/.test(q.cols)));
  check('every ledger kind has a plain label, and amounts read +R200 available', ['topup', 'hold', 'release', 'charge', 'refund', 'session_credit', 'payout_hold', 'payout_paid', 'payout_release', 'adjustment'].every((k) => LEDGER_KIND_LABELS[k] && ledgerKindLabel(k) !== k) && ledgerAmountText({ availableDelta: 200, heldDelta: 0 }) === '+R200 available' && ledgerAmountText({ availableDelta: -180, heldDelta: 180 }) === '-R180 available, +R180 on hold');
  check('Adjust wallet: whole rands, a reason of at least 5 characters, add or take out', checkAdjustment('add', '50', 'Refund for session').ok === true && (checkAdjustment('remove', '50', 'Mistaken credit') as { amount: number }).amount === -50 && checkAdjustment('add', '0', 'Refund for session').ok === false && checkAdjustment('add', '50.5', 'Refund for session').ok === false && checkAdjustment('add', '50', 'oops').ok === false && checkAdjustment('add', '50', '').ok === false && checkAdjustment('add', '100001', 'Refund for session').ok === false);
  check('the adjustment key is a new one every time (one-time key) and the call sends it with the reason', newAdjustKey() !== newAdjustKey() && /^[0-9a-f-]{36}$/.test(newAdjustKey()));
  const aw = fake({ rpc: () => ({ data: { already: false }, error: null }) });
  await adjustWallet(aw.client, PAYER, -50, 'Mistaken credit', 'key-1');
  check('adjustWallet calls admin_adjust_wallet with profile, signed amount, reason and key', JSON.stringify(aw.calls[0]) === JSON.stringify({ fn: 'admin_adjust_wallet', args: { p_profile: PAYER, p_amount: -50, p_reason: 'Mistaken credit', p_key: 'key-1' } }) && /Take R50 out of Thandi's wallet/.test(adjustConfirmText('Thandi', -50)));
  const okList = biggest as Extract<WalletList, { state: 'ok' }>;
  const walletProps = (canAdjust: boolean) => ({ totals: t1, list: okList, term: '', onTerm: () => undefined, onSearch: () => undefined, selected: { row: okList.wallets[0], detail }, onSelect: () => undefined, check: { state: 'idle' as const }, onRunCheck: () => undefined, canAdjust, onAdjust: async () => null, onRetry: () => undefined });
  const walletsAsFinance = html(React.createElement(WalletBalancesBody, walletProps(false)));
  const walletsAsSuper = html(React.createElement(WalletBalancesBody, walletProps(true)));
  check('"Adjust wallet" is drawn for a super admin and NOT for a finance manager', /data-adjust-form/.test(walletsAsSuper) && !/data-adjust-form/.test(walletsAsFinance) && !/Adjust wallet/.test(walletsAsFinance));
  const fullTotals = html(React.createElement(WalletBalancesBody, { ...walletProps(false), totals: { state: 'ok', totals: totalsFull } }));
  check('the Wallets tab shows "Held for others", the balance check button and the person\'s ledger lines', /Held for others/.test(fullTotals) && /R1150/.test(fullTotals) && /Run the balance check/.test(fullTotals) && /Top-up added/.test(fullTotals));
  check('a failing wallets tab says "not available" or Try again', /not on this database/.test(html(React.createElement(WalletBalancesBody, { ...walletProps(false), totals: { state: 'not_available', note: WALLET_NOT_AVAILABLE }, list: { state: 'not_available', note: WALLET_NOT_AVAILABLE } }))) && /Try again/.test(html(React.createElement(WalletBalancesBody, { ...walletProps(false), list: { state: 'error', message: 'boom' } }))));
  const walletsSrc = code('admin/src/components/WalletBalancesBody.tsx');
  check('Adjust wallet keeps ONE key per attempt (a ref), and only refreshes it after success', /const key = useRef<string>\(newAdjustKey\(\)\)/.test(walletsSrc) && /onAdjust\(row, c\.amount, c\.reason, key\.current\)/.test(walletsSrc) && /key\.current = newAdjustKey\(\)/.test(walletsSrc) && walletsSrc.indexOf('key.current = newAdjustKey()') > walletsSrc.indexOf('if (problem) return setError(problem)'));

  // ---- 4. wallet settings ----
  const rowsOf = (over: Record<string, unknown> = {}) => [
    { settingKey: SWITCH_KEY, settingValue: false, description: 'Master switch' },
    { settingKey: 'free_sessions_enabled', settingValue: true, description: null },
    ...BANK_KEYS.map((b) => ({ settingKey: b.key, settingValue: '', description: `d ${b.key}` })),
    { settingKey: 'wallet_topup_min_rand', settingValue: 50, description: null }, { settingKey: 'wallet_topup_max_rand', settingValue: 5000, description: null },
    { settingKey: 'wallet_balance_cap_rand', settingValue: 10000, description: null }, { settingKey: 'wallet_topup_max_waiting', settingValue: 3, description: null },
    { settingKey: 'wallet_topup_max_per_day', settingValue: 10, description: null }, { settingKey: 'wallet_topup_stale_days', settingValue: 7, description: null },
    { settingKey: 'wallet_proof_keep_days_successful', settingValue: 90, description: null }, { settingKey: 'wallet_proof_keep_days_unsuccessful', settingValue: 30, description: null },
  ].map((r) => (r.settingKey in over ? { ...r, settingValue: over[r.settingKey] } : r));
  const current = readWalletSettings(rowsOf());
  check('the settings are read: switch off, free sessions on, bank boxes empty, the limits as text', current.present && current.enabled === false && current.freeOn === true && current.bank.wallet_bank_name === '' && current.limits.wallet_topup_max_rand === '5000' && current.descriptions[SWITCH_KEY] === 'Master switch');
  check('a database without the wallet keys is "not available"', (await fetchWalletSettings(fake({ tables: { system_settings: { data: [], error: null } } }).client)).state === 'not_available' && (await fetchWalletSettings(fake({ throwAll: true }).client)).state === 'error');
  check('the switch is described in words: off; on but free sessions on (still hidden); on and free off (open)', /OFF/.test(switchSummary(current).line) && /still hidden/.test(switchSummary({ ...current, enabled: true }).line) && switchSummary({ ...current, enabled: true, freeOn: false }).opens === true && switchSummary({ ...current, enabled: true, freeOn: true }).opens === false);
  check('the bank boxes still empty are listed as missing before the switch may go on', switchSummary(current).missing.length === 4 && !switchSummary({ ...current, bank: { ...current.bank, wallet_bank_name: 'X', wallet_bank_account_holder: 'Y', wallet_bank_account_number: '123456', wallet_bank_branch_code: '250655' } }).missing.length);
  const settingsOk = { state: 'ok' as const, values: current };
  const settingsMarkup = html(React.createElement(WalletSettingsBody, { load: settingsOk, onSave: async () => null, onSwitch: async () => null, onRetry: () => undefined }));
  check('the switch card shows its state, the plain warning, free sessions, and blocks turning on while bank details are missing', /The wallet switch/.test(settingsMarkup) && /OFF/.test(settingsMarkup) && /Free sessions: ON/.test(settingsMarkup) && /opens for learners and tutors only when this switch is ON and free sessions are OFF/.test(settingsMarkup) && /data-switch-blocked/.test(settingsMarkup) && /Turn the wallet ON/.test(settingsMarkup) && /disabled/.test(settingsMarkup.slice(settingsMarkup.indexOf('Turn the wallet ON') - 400, settingsMarkup.indexOf('Turn the wallet ON'))));
  check('the five bank boxes, the three limits and the proof-keeping days are real fields with labels', BANK_KEYS.every((b) => settingsMarkup.includes(`id="set-${b.key}"`)) && LIMIT_KEYS.every((l) => settingsMarkup.includes(`id="set-${l.key}"`)) && /Smallest transfer/.test(settingsMarkup) && /Most a wallet may hold/.test(settingsMarkup) && /Days a proof is kept after a successful transfer/.test(settingsMarkup));
  check('not-available and failure states are drawn with words (and Try again)', /not on this database/.test(html(React.createElement(WalletSettingsBody, { load: { state: 'not_available', note: WALLET_NOT_AVAILABLE }, onSave: async () => null, onSwitch: async () => null, onRetry: () => undefined }))) && /Try again/.test(html(React.createElement(WalletSettingsBody, { load: { state: 'error', message: 'x' }, onSave: async () => null, onSwitch: async () => null, onRetry: () => undefined }))));
  check('limits: whole numbers of 1 or more; smallest <= largest <= wallet cap', Object.keys(checkLimits(current.limits)).length === 0 && 'wallet_topup_min_rand' in checkLimits({ ...current.limits, wallet_topup_min_rand: '6000' }) && 'wallet_topup_max_rand' in checkLimits({ ...current.limits, wallet_topup_max_rand: '20000' }) && 'wallet_topup_stale_days' in checkLimits({ ...current.limits, wallet_topup_stale_days: '0' }) && 'wallet_topup_stale_days' in checkLimits({ ...current.limits, wallet_topup_stale_days: '1.5' }) && 'wallet_topup_stale_days' in checkLimits({ ...current.limits, wallet_topup_stale_days: '' }));
  check('bank details: 120 characters at most, account number 6 to 16 digits, branch code 6 digits', Object.keys(checkBank({ wallet_bank_name: 'FNB', wallet_bank_account_number: '6200 0000 001', wallet_bank_branch_code: '250-655' })).length === 0 && 'wallet_bank_account_number' in checkBank({ wallet_bank_account_number: '12ab' }) && 'wallet_bank_branch_code' in checkBank({ wallet_bank_branch_code: '25' }) && 'wallet_bank_name' in checkBank({ wallet_bank_name: 'x'.repeat(121) }));
  const typedBank = { ...current.bank, wallet_bank_name: 'Test Bank', wallet_bank_account_number: '1234 5678' };
  const plan = planSettingSaves(current, { bank: typedBank, limits: current.limits });
  check('only what changed is saved, and spaces in a number are not stored', JSON.stringify(plan) === JSON.stringify([{ key: 'wallet_bank_name', value: 'Test Bank' }, { key: 'wallet_bank_account_number', value: '12345678' }]) && planSettingSaves(current, { bank: current.bank, limits: current.limits }).length === 0);
  const applyPlan = (from: Record<string, string>, to: Record<string, string>) => {
    const state = { ...from };
    for (const w of planSettingSaves({ ...current, limits: from }, { bank: current.bank, limits: to })) {
      state[w.key] = String(w.value);
      const n = (k: string) => Number(state[k]);
      if (n('wallet_topup_min_rand') > n('wallet_topup_max_rand') || n('wallet_topup_max_rand') > n('wallet_balance_cap_rand')) return null;
    }
    return state;
  };
  const base = current.limits;
  check('the limits are saved in an order the database guard accepts after EVERY single write (raise all, lower all, swap, mixed)', [
    { ...base, wallet_topup_max_rand: '8000', wallet_balance_cap_rand: '12000' },
    { ...base, wallet_topup_min_rand: '20', wallet_topup_max_rand: '2000', wallet_balance_cap_rand: '3000' },
    { ...base, wallet_topup_min_rand: '6000', wallet_topup_max_rand: '7000', wallet_balance_cap_rand: '8000' },
    { ...base, wallet_topup_min_rand: '100', wallet_topup_max_rand: '300', wallet_balance_cap_rand: '400' },
    { ...base, wallet_balance_cap_rand: '5000' },
  ].every((to) => applyPlan(base, to) !== null));
  const writes: string[] = [];
  const fail = await saveSettingWrites(async (key, value, description) => {
    writes.push(`${key}=${String(value)}|${description}`);
    if (key === 'wallet_bank_account_number') throw { code: '22023', message: 'A bank detail must be text of at most 120 characters' };
  }, plan, current.descriptions);
  check('saving goes through the System Settings writer with the existing description kept, and stops at the first refusal with the database\'s words', writes.length === 2 && writes[0] === 'wallet_bank_name=Test Bank|d wallet_bank_name' && fail.saved.join() === 'wallet_bank_name' && fail.failed?.key === 'wallet_bank_account_number' && /at most 120/.test(fail.failed.message));
  const settingsSrc = code('admin/src/components/WalletSettingsBody.tsx');
  check('the switch is changed ONLY by its own confirmed button: onSwitch is called from flip, which only the confirm box runs', (settingsSrc.match(/onSwitch\(/g) ?? []).length === 1 && /onYes=\{flip\}/.test(settingsSrc) && !/onSwitch\(true\)/.test(settingsSrc + tabsSrc) && !/SWITCH_KEY[^;]*true/.test(libSrc));
  check('the settings screen writes through the existing System Settings path (upsertSystemSetting, which also writes the audit line)', /upsertSystemSetting\(key, value, adminProfile!\.id, description \?\? undefined\)/.test(payoutsPage));
  check('no bank detail, account number or real-looking value is written into the code', !/\b[0-9]{9,16}\b/.test(libSrc + settingsSrc + tabsSrc));

  // ---- payment statuses on the admin queries and counts ----
  check('wallet_paid reads "Paid from wallet" and wallet_refunded reads "Refunded to wallet"', paymentStatusLabel('wallet_paid') === 'Paid from wallet' && paymentStatusLabel('wallet_refunded') === 'Refunded to wallet' && paymentStatusLabel('free') === 'Free session' && paymentStatusLabel(null) === '—');
  const constraint = /check \(payment_status in \(([^)]*)\)\)/.exec(read('supabase/migrations/20261102210000_wallet_booking.sql'))?.[1] ?? '';
  const dbValues = [...constraint.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  check('EVERY payment status the database allows has a label', dbValues.length === 15 && dbValues.every((v) => PAYMENT_STATUS_LABELS[v]), dbValues.filter((v) => !PAYMENT_STATUS_LABELS[v]).join());
  check('wallet requests are counted as sent, and a cancelled wallet session is still a match (not "cancelled before a match")', requestWasSent('accepted', 'wallet_paid') && requestWasSent('cancelled', 'wallet_refunded') && requestWasSent('pending', 'card_verified') && !requestWasSent('pending', 'initiated') && requestWasMatched('accepted', 'wallet_paid') && requestWasMatched('cancelled', 'wallet_refunded') && !requestWasMatched('cancelled', 'card_verified') && !requestWasMatched('expired', 'card_verified'));
  const counts = countHowPaid([{ payment_status: 'free' }, { payment_status: 'free' }, { payment_status: 'wallet_paid' }, { payment_status: 'wallet_refunded' }, { payment_status: 'paid' }]);
  check('the dashboard counts free, paid-from-wallet and refunded-to-wallet requests', counts.free === 2 && counts.paidFromWallet === 1 && counts.refundedToWallet === 1);
  const queriesSrc = code('admin/src/lib/queries.ts');
  const dashboardSrc = code('admin/src/pages/Phase1Numbers.tsx');
  check('fetchPhase1Metrics uses those rules (no private list of "not sent" statuses left), and the dashboard shows the three counts with their labels', /requestWasSent\(r\.status, r\.payment_status\)/.test(queriesSrc) && /requestWasMatched\(r\.status, r\.payment_status\)/.test(queriesSrc) && !/notSent/.test(queriesSrc) && /requestsPaidFromWallet/.test(dashboardSrc) && /paymentStatusLabel\('wallet_refunded'\)/.test(dashboardSrc));
  check('the Payments page "Needs a person" lines carry the payment state in words', /paymentStatusLabel\(item\.paymentStatus\)/.test(payoutsPage));
  check('the six wallet audit actions have a label in the Audit Log and a type, and exist in the audit-actions migration', ['wallet_topup_successful', 'wallet_topup_unsuccessful', 'wallet_payout_paid', 'wallet_payout_cannot_pay', 'wallet_bank_details_opened', 'wallet_adjusted'].every((a) => read('admin/src/pages/AuditLog.tsx').includes(`${a}:`) && read('admin/src/types.ts').includes(`'${a}'`) && read('supabase/migrations/20261102200000_wallet_audit_actions.sql').includes(`'${a}'`)));

  // ---- small helpers ----
  check('money is whole rands: R200, never R200.00', rand0(200) === 'R200' && rand0(187.5) === 'R188' && rand0(-50) === '-R50');
  check('times are South African (UTC+2) and waits are in plain units', /14:00/.test(formatSast('2026-11-03T12:00:00Z')) && formatSast(null) === '—' && waitingFor(hoursAgo(3), NOW) === '3 h' && waitingFor(hoursAgo(0.5), NOW) === '30 min' && waitingFor(hoursAgo(72), NOW) === '3 days');
  const allSource = [libSrc, tabsSrc, ...['WalletTopupsBody', 'WalletPayoutsBody', 'WalletBalancesBody', 'WalletSettingsBody', 'WalletParts'].map((f) => code(`admin/src/components/${f}.tsx`))].join('\n');
  check('nothing in the wallet admin code selects *', !/select\(\s*['"`]\s*\*/.test(allSource) && !/select\(\s*\)/.test(allSource));

  console.log(failed === 0 ? '\nall checks passed' : `\n${failed} FAILED`);
  process.exitCode = failed === 0 ? 0 : 1;
}
main().catch((e) => { console.error(e); process.exit(1); });
