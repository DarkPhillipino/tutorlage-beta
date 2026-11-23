// Checks on PAY BY BANK, INSTANT: the site half (Ozow phase 3 of 3, 9 Nov 2026). Run: npx tsx scripts/dev/wallet-online-test.ts
// Proves, with a fake database client and a fake Worker (nothing real is called): the choice is shown only when the database function says yes (and every doubt, a
// missing function or Worker, an error, an odd answer, is "no", so the screen is the old manual one with no error); the top-up row is made through
// create_online_topup and the Worker is asked with NO amount and NO body; the redirect address must be plain https; the Worker's error codes become OUR plain
// words (never its text); the return page reads the payer's own row every 3 seconds for up to 60 seconds and can never credit (no write and no credit call
// anywhere in the files it uses); "Check now" only asks the Worker; the wallet lines for an online top-up are plain words and never show a stored comment;
// no processor is named and nothing says "free"; and the names this file relies on exist in phase 1's migration and phase 2's Worker.
// It does NOT prove the Worker or the database (their own tests do), the real bank page, or a real webhook: those need the real Worker and the real provider.
import { readFileSync } from 'node:fs';
import { WALLET_COPY, fetchTopups, topupStatusLine, type Topup, type WalletClient } from '../../src/lib/wallet';
import {
  CARD_IS_MAIN, ONLINE_COPY, POLL_INTERVAL_MS, POLL_MAX_MS, checkOnlineTopup, createOnlineTopup, decideMainWay, decideReturn, checkOnceWhenWaiting, hintWords, parseReturnHint, fetchMainWay, fetchOnlineAvailable,
  fetchOnlineEnvironment, fetchTopupById, isTopupId, onlineTestNote, paidBody, paidTitle, pollReturn, safeRedirectUrl, startOnlinePayment, type OnlineGet, type OnlineRequest, type ReturnView,
} from '../../src/lib/walletOnline';

let failed = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) failed += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && detail ? ` [${detail}]` : ''}`);
}
const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

type DbAnswer = { data: unknown; error: { code?: string; message?: string } | null };
function fakeDb(opts: { rpc?: (fn: string, args?: Record<string, unknown>) => DbAnswer | Promise<DbAnswer>; row?: DbAnswer } = {}) {
  const calls: string[] = [];
  const filters: string[] = [];
  const selects: string[] = [];
  const db: WalletClient = {
    rpc: async (fn, args) => { calls.push(`rpc:${fn}`); return (opts.rpc ?? (() => ({ data: null, error: null })))(fn, args); },
    from: (table: string) => {
      calls.push(`from:${table}`);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const b: any = {};
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      b.select = (cols: string) => { selects.push(cols); return b; };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      b.eq = (col: string, value: unknown) => { filters.push(`${col}=${String(value)}`); return b; };
      for (const m of ['in', 'order', 'limit']) b[m] = () => b;
      b.maybeSingle = async () => opts.row ?? { data: null, error: null };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      b.then = (res: any, rej: any) => Promise.resolve(opts.row ?? { data: [], error: null }).then(res, rej);
      return b;
    },
    storage: { from: () => ({ upload: async () => ({ data: {}, error: null }) }) },
  };
  return { db, calls, filters, selects };
}

const ID = '11111111-1111-4111-8111-111111111111';
const ME = '00000000-0000-4000-8000-000000000001';
const BANK_PAGE = 'https://pay.example.test/checkout/abc123';

function fakeWorker(answer: { status: number; body: unknown } | (() => Promise<{ status: number; body: unknown }>)) {
  const paths: string[] = [];
  const request: OnlineRequest = async (path) => {
    paths.push(path);
    return typeof answer === 'function' ? answer() : answer;
  };
  return { request, paths };
}

const topupRow = (over: Partial<Topup> = {}): Topup => ({
  id: ID, reference: 'TL-ABC234', amountRand: 200, status: 'awaiting_payment', method: 'online', receivedRand: null, comment: null, createdAt: '2026-11-09T10:00:00Z', decidedAt: null, proofSentAt: null, ...over,
});

async function main() {
  // ---- the two names, the words ----
  check('the two ways to pay are named "Pay by bank" and "Bank transfer, checked by a person"', ONLINE_COPY.onlineTitle === 'Pay by bank' && ONLINE_COPY.manualTitle === 'Bank transfer, checked by a person');
  check('the return page words: "Checking your payment", and after a minute "Still waiting. We will tell you here and in your bell the moment it arrives."',
    ONLINE_COPY.checkingTitle === 'Checking your payment' && ONLINE_COPY.waitingBody === 'Still waiting. We will tell you here and in your bell the moment it arrives.' && ONLINE_COPY.checkNow === 'Check now');
  check('a paid payment says so in rand with the usual format (no spaces, no cents)', paidTitle === 'Payment received' && paidBody(200) === 'R200 has been added to your credit.' && paidBody(1250) === 'R1250 has been added to your credit.');
  const allWords = [...Object.values(ONLINE_COPY), WALLET_COPY.onlineWaiting, WALLET_COPY.onlinePaid, WALLET_COPY.onlineNotCompleted, WALLET_COPY.onlineCancelled, paidTitle, paidBody(200)].join(' | ');
  check('no word offers "free" lessons or sessions', !/\bfree\b/i.test(allWords));
  check('no processor, bank or technical name in any word the person sees', !/ozow|paystack|payfast|yoco|peach|stitch|svix|webhook|token|\bAPI\b|http|json|\bnull\b|undefined|awaiting_payment/i.test(allWords), allWords.match(/ozow|paystack|webhook|token|http/i)?.[0]);

  // ---- is the choice open? every doubt is "no" ----
  check('the choice is open only for an exact true from wallet_online_available', await fetchOnlineAvailable(fakeDb({ rpc: () => ({ data: true, error: null }) }).db) === true);
  const noCases: [string, DbAnswer | 'throws'][] = [
    ['false', { data: false, error: null }], ['null', { data: null, error: null }], ['the text "true"', { data: 'true', error: null }], ['1', { data: 1, error: null }],
    ['a list', { data: [true], error: null }], ['an error with data true', { data: true, error: { code: '42501', message: 'x' } }],
    ['the function missing from the database (PGRST202)', { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } }], ['a call that throws', 'throws'],
  ];
  for (const [name, answer] of noCases) {
    const db = fakeDb({ rpc: () => { if (answer === 'throws') throw new Error('network'); return answer; } }).db;
    check(`the choice stays closed when the answer is ${name}`, await fetchOnlineAvailable(db) === false);
  }
  const asked = fakeDb({ rpc: () => ({ data: true, error: null }) });
  await fetchOnlineAvailable(asked.db);
  check('the one question asked is wallet_online_available (the platform setting wallet_online_mode is read by the database, never by the browser)', asked.calls.join() === 'rpc:wallet_online_available');

  // ---- making the row ----
  const made = fakeDb({ rpc: (fn, args) => (fn === 'create_online_topup' && args?.p_amount === 250 ? { data: { topup_id: ID, reference: 'TL-ABC234', amount_rand: 250, status: 'awaiting_payment', method: 'online' }, error: null } : { data: null, error: { message: 'wrong call' } }) });
  const created = await createOnlineTopup(made.db, 250);
  check('create_online_topup(p_amount) returns the id, the reference and the amount', created.topupId === ID && created.reference === 'TL-ABC234' && created.amountRand === 250 && made.calls.join() === 'rpc:create_online_topup');
  check('the database\'s plain refusal is passed on as the message', await createOnlineTopup(fakeDb({ rpc: () => ({ data: null, error: { message: 'Add between R50 and R5000 at a time, in whole rands.' } }) }).db, 10).then(() => '', (e: Error) => e.message) === 'Add between R50 and R5000 at a time, in whole rands.');
  check('an answer without an id or a reference is an error, not a payment', await createOnlineTopup(fakeDb({ rpc: () => ({ data: { status: 'awaiting_payment' }, error: null }) }).db, 100).then(() => false, () => true));

  // ---- the address of the bank's page ----
  check('only a plain https address is followed', safeRedirectUrl(BANK_PAGE) === BANK_PAGE);
  for (const bad of ['http://pay.example.test/x', 'javascript:alert(1)', 'data:text/html,hi', '//pay.example.test/x', '/relative/path', 'https://localhost/x', 'https://pay.example.test/a b', '', 'https://', null, 42, undefined]) {
    check(`the address ${JSON.stringify(bad)} is never followed`, safeRedirectUrl(bad) === null);
  }

  // ---- starting the payment: the Worker call ----
  const okWorker = fakeWorker({ status: 200, body: { redirect_url: BANK_PAGE, expires_at: '2026-11-09T11:00:00Z', resumed: false } });
  const started = await startOnlinePayment(okWorker.request, ID);
  check('the Worker is asked at /api/wallet/topups/:id/start-online with nothing but the path (no amount, no payer), and its redirect_url is the answer',
    started.ok === true && 'redirectUrl' in started && started.redirectUrl === BANK_PAGE && okWorker.paths.join() === `/api/wallet/topups/${ID}/start-online`);
  const resumed = await startOnlinePayment(fakeWorker({ status: 200, body: { redirect_url: BANK_PAGE, resumed: true } }).request, ID);
  check('a resumed payment (the Worker gives back the same page) is followed the same way', resumed.ok === true);
  const noUrl = await startOnlinePayment(fakeWorker({ status: 200, body: { redirect_url: 'javascript:alert(1)' } }).request, ID);
  check('a 200 with a bad or missing address is "could not open", never followed', noUrl.ok === false && 'message' in noUrl && noUrl.message === ONLINE_COPY.couldNotOpen);
  const neverCalled = fakeWorker({ status: 200, body: { redirect_url: BANK_PAGE } });
  const badId = await startOnlinePayment(neverCalled.request, '../../x');
  check('an id that is not a UUID never reaches the Worker', neverCalled.paths.length === 0 && badId.ok === false);
  const codes: [string, { status: number; body: unknown } | 'throws', string, string, boolean | null][] = [
    ['busy (409, code busy)', { status: 409, body: { error: 'We are still starting this payment.', code: 'busy', retry_after_seconds: 3 } }, 'busy', ONLINE_COPY.busy, false],
    ['closed (409, code closed)', { status: 409, body: { error: 'x', code: 'closed', status: 'unsuccessful' } }, 'closed', ONLINE_COPY.closed, true],
    ['not found (404)', { status: 404, body: { error: 'x', code: 'not_found' } }, 'closed', ONLINE_COPY.closed, true],
    ['not set up (503)', { status: 503, body: { error: 'x', code: 'not_configured' } }, 'unavailable', ONLINE_COPY.notAvailable, false],
    ['the provider refused (502, start_failed)', { status: 502, body: { error: 'x', code: 'start_failed' } }, 'unavailable', ONLINE_COPY.couldNotOpen, true],
    ['a fault on our side (500)', { status: 500, body: { error: 'x', code: 'server_error' } }, 'unavailable', ONLINE_COPY.couldNotOpen, false],
    ['signed out (401)', { status: 401, body: { error: 'Sign in first.', code: 'sign_in' } }, 'signin', ONLINE_COPY.signInAgain, false],
    ['too many calls (429)', { status: 429, body: null }, 'busy', ONLINE_COPY.busy, false],
    ['a lost connection', 'throws', 'unavailable', ONLINE_COPY.couldNotOpen, false],
  ];
  for (const [name, answer, reason, message, rowClosed] of codes) {
    const w = fakeWorker(answer === 'throws' ? () => { throw new Error('network'); } : answer);
    const r = await startOnlinePayment(w.request, ID);
    check(`${name}: ${reason}, in our own words${rowClosed ? ', and the top-up is not tried again' : ''}`, r.ok === false && 'reason' in r && r.reason === reason && r.message === message && r.rowClosed === rowClosed, JSON.stringify(r));
  }
  const echoed = await startOnlinePayment(fakeWorker({ status: 502, body: { error: 'SECRET PROCESSOR TEXT', code: 'start_failed' } }).request, ID);
  check('the Worker\'s own error text is never shown', echoed.ok === false && 'message' in echoed && !/SECRET|PROCESSOR/.test(echoed.message));

  // ---- "Check now" ----
  const checkWorker = fakeWorker({ status: 200, body: { result: 'checked', status: 'awaiting_payment', transactions: 1 } });
  check('"Check now" posts to /api/wallet/topups/:id/check with nothing else and is ok on 200', (await checkOnlineTopup(checkWorker.request, ID)).ok === true && checkWorker.paths.join() === `/api/wallet/topups/${ID}/check`);
  for (const result of ['closed', 'nothing_to_check']) check(`a 200 "${result}" is ok (the page then reads the row)`, (await checkOnlineTopup(fakeWorker({ status: 200, body: { result } }).request, ID)).ok === true);
  const wait = await checkOnlineTopup(fakeWorker({ status: 429, body: { error: 'x', code: 'wait', retry_after_seconds: 9 } }).request, ID);
  check('too soon (429) says how long to wait, in seconds', wait.ok === false && 'message' in wait && wait.message === 'Please wait 9 seconds, then try again.');
  const wait1 = await checkOnlineTopup(fakeWorker({ status: 429, body: { code: 'wait', retry_after_seconds: 1 } }).request, ID);
  check('one second is "1 second"', wait1.ok === false && 'message' in wait1 && wait1.message === 'Please wait 1 second, then try again.');
  const failedCheck = await checkOnlineTopup(fakeWorker({ status: 502, body: { error: 'SECRET', code: 'check_failed' } }).request, ID);
  check('a failed look (502) says we will keep checking and tell them here and in the bell; no Worker text', failedCheck.ok === false && 'message' in failedCheck && failedCheck.message === ONLINE_COPY.checkFailed && /bell/.test(failedCheck.message));
  const lost = await checkOnlineTopup(async () => { throw new Error('network'); }, ID);
  check('a lost connection on "Check now" is a plain message, not a crash', lost.ok === false);
  const neverChecked = fakeWorker({ status: 200, body: {} });
  await checkOnlineTopup(neverChecked.request, 'nope');
  check('an id that is not a UUID never reaches the Worker on "Check now" either', neverChecked.paths.length === 0);

  // ---- reading the payer's own row ----
  const rowDb = fakeDb({ row: { data: { id: ID, reference: 'TL-ABC234', amount_rand: 200, status: 'successful', method: 'online', received_rand: 200, decision_comment: 'internal note', created_at: '2026-11-09T10:00:00Z', decided_at: '2026-11-09T10:05:00Z', proof_attached_at: null }, error: null } });
  const row = await fetchTopupById(rowDb.db, ME, ID);
  check('the payer\'s own row is read by id AND payer id, with named columns (never select *)', rowDb.filters.join() === `id=${ID},profile_id=${ME}` && !/\*/.test(rowDb.selects[0]) && /\bmethod\b/.test(rowDb.selects[0]) && row?.status === 'successful' && row.method === 'online' && row.receivedRand === 200);
  const noRowDb = fakeDb({ row: { data: null, error: null } });
  check('no such row (or not the person\'s own) is null', await fetchTopupById(noRowDb.db, ME, ID) === null);
  const guarded = fakeDb();
  check('an id that is not a UUID is null and the database is not asked', await fetchTopupById(guarded.db, ME, "x'; drop table wallet_topups;--") === null && guarded.calls.length === 0 && !isTopupId('') && isTopupId(ID));
  check('a failing read throws (the page then keeps trying)', await fetchTopupById(fakeDb({ row: { data: null, error: { message: 'boom' } } }).db, ME, ID).then(() => false, () => true));
  const listDb = fakeDb({ row: { data: [{ id: 'a', reference: 'TL-AAAAAA', amount_rand: 100, status: 'awaiting_payment', method: 'online', received_rand: null, decision_comment: null, created_at: 'x', decided_at: null, proof_attached_at: null }, { id: 'b', reference: 'TL-BBBBBB', amount_rand: 100, status: 'proof_sent', received_rand: null, decision_comment: null, created_at: 'x', decided_at: null, proof_attached_at: null }], error: null } });
  const list = await fetchTopups(listDb.db, ME);
  check('the wallet list reads the method (a row without one is a bank transfer) and the new status', list[0].method === 'online' && list[0].status === 'awaiting_payment' && list[1].method === 'eft' && /\bmethod\b/.test(listDb.selects[0]));

  // ---- the lines on the wallet page ----
  const line = (status: Topup['status'], method: Topup['method'] = 'online', comment: string | null = null) => topupStatusLine({ status, method, comment, receivedRand: status === 'successful' ? 200 : null, amountRand: 200 });
  check('an online top-up reads "Waiting for your bank", "Paid by bank and added to your credit", "The payment did not go through...", "Cancelled..."',
    line('awaiting_payment') === 'Waiting for your bank' && line('successful') === 'Paid by bank and added to your credit' && line('unsuccessful') === 'The payment did not go through. Nothing was added to your credit.' && line('cancelled') === 'Cancelled. Nothing was added to your credit.');
  check('the stored comment (for our records) is never shown for an online top-up', !/INTERNAL/i.test(line('unsuccessful', 'online', 'INTERNAL: provider said X')) && !/INTERNAL/i.test(line('cancelled', 'online', 'INTERNAL')));
  check('no raw status or code reaches the lines', !/awaiting_payment|unsuccessful|_|online/.test(['awaiting_payment', 'successful', 'unsuccessful', 'cancelled'].map((s) => line(s as Topup['status'])).join(' ')));
  check('the bank-transfer lines are exactly as before', topupStatusLine({ status: 'awaiting_proof', comment: null, receivedRand: null, amountRand: 200 }) === 'Waiting for your proof of payment'
    && line('unsuccessful', 'eft', 'No payment with that reference') === 'Not received: No payment with that reference' && line('successful', 'eft') === 'Added to your credit');

  // ---- what the return page says ----
  const v = (row: Topup | null | undefined, elapsed: number): ReturnView => decideReturn(row, elapsed);
  check('settled rows: successful is paid (with the amount), unsuccessful and cancelled say so', JSON.stringify(v(topupRow({ status: 'successful', receivedRand: 200 }), 0)) === '{"kind":"paid","amountRand":200}'
    && v(topupRow({ status: 'unsuccessful' }), 0).kind === 'not_completed' && v(topupRow({ status: 'cancelled' }), 0).kind === 'cancelled');
  check('still waiting: "checking" for the first minute, then "waiting"', v(topupRow(), 0).kind === 'checking' && v(topupRow(), POLL_MAX_MS - 1).kind === 'checking' && JSON.stringify(v(topupRow(), POLL_MAX_MS)) === '{"kind":"waiting","readFailed":false}');
  check('a row that cannot be read is tried again for a minute, then says so too', v(undefined, 0).kind === 'checking' && JSON.stringify(v(undefined, POLL_MAX_MS)) === '{"kind":"waiting","readFailed":true}');
  check('no such row is "not found"; a bank-transfer row is "not an online payment"', v(null, 0).kind === 'not_found' && v(topupRow({ method: 'eft', status: 'proof_sent' }), 0).kind === 'other');
  check('time alone never says "paid": no elapsed time turns a waiting row into paid', [0, 1000, 59_000, 60_000, 10 ** 12].every((t) => v(topupRow(), t).kind !== 'paid'));

  // ---- the polling: every 3 seconds, for up to 60 seconds ----
  const clock = (reads: Array<Topup | null | 'throws'>) => {
    let t = 0;
    let i = 0;
    const views: ReturnView[] = [];
    const sleeps: number[] = [];
    return {
      views, sleeps, reads: () => i,
      deps: {
        read: async () => { const r = reads[Math.min(i, reads.length - 1)]; i += 1; if (r === 'throws') throw new Error('network'); return r; },
        sleep: async (ms: number) => { sleeps.push(ms); t += ms; },
        now: () => t,
        isCancelled: () => false,
        onView: (view: ReturnView) => { views.push(view); },
      },
    };
  };
  check('the interval is 3 seconds and the limit 60', POLL_INTERVAL_MS === 3000 && POLL_MAX_MS === 60_000);
  const quick = clock([topupRow(), topupRow(), topupRow({ status: 'successful', receivedRand: 200 })]);
  const quickLast = await pollReturn(quick.deps);
  check('paid after two more looks: reads at 0, 3 and 6 seconds, then stops', quick.reads() === 3 && JSON.stringify(quick.sleeps) === '[3000,3000]' && quickLast?.kind === 'paid' && quick.views.map((x) => x.kind).join() === 'checking,checking,paid');
  const never = clock([topupRow()]);
  const neverLast = await pollReturn(never.deps);
  check('never paid: it looks every 3 seconds for 60 seconds (21 looks, 20 waits of 3 s), then says "waiting" and stops', never.reads() === 21 && never.sleeps.length === 20 && never.sleeps.reduce((a, b) => a + b, 0) === 60_000 && neverLast?.kind === 'waiting' && never.views.filter((x) => x.kind === 'waiting').length === 1);
  const flaky = clock(['throws', 'throws', topupRow({ status: 'successful', receivedRand: 200 })]);
  check('a failed read does not stop the page: the next one is tried and the money shows', (await pollReturn(flaky.deps))?.kind === 'paid' && flaky.reads() === 3);
  const alwaysDown = clock(['throws']);
  const downLast = await pollReturn(alwaysDown.deps);
  check('reads that never work end as "waiting" with the note that the payment could not be read (money is safe)', JSON.stringify(downLast) === '{"kind":"waiting","readFailed":true}');
  let gone = false;
  const away = clock([topupRow()]);
  const awayRun = await pollReturn({ ...away.deps, isCancelled: () => gone, sleep: async (ms) => { away.deps.sleep(ms); gone = true; } });
  check('leaving the page stops the polling (no more reads, no more updates)', awayRun === null && away.reads() === 1);
  const closed = clock([topupRow({ status: 'unsuccessful' })]);
  check('a closed top-up stops the polling at once', (await pollReturn(closed.deps))?.kind === 'not_completed' && closed.reads() === 1);

  // ---- the page can NEVER credit: nothing it uses writes or credits ----
  const pageFiles = ['src/pages/TopupReturn.tsx', 'src/lib/walletOnline.ts', 'src/lib/walletOnlineHooks.ts', 'src/components/OnlineTopupActions.tsx'];
  const pageCode = pageFiles.map((f) => code(f)).join('\n');
  check('the return page and its helpers have no write: no insert, update, upsert, delete, no storage', !/\.(insert|update|upsert|delete)\(|\.storage\b/.test(pageCode));
  check('and no credit or ledger call: no wallet_credit_topup, wallet_online_apply, wallet_post, admin_mark', !/wallet_credit_topup|wallet_online_apply|wallet_online_claim|wallet_online_attach|wallet_post|admin_mark|wallet_adjust/.test(pageCode));
  const rpcNames = [...code('src/lib/walletOnline.ts').matchAll(/rpc\('([a-z_]+)'/g)].map((m) => m[1]).sort().join();
  check('the only database functions called are wallet_online_available and create_online_topup', rpcNames === 'create_online_topup,wallet_online_available', rpcNames);
  const hooks = code('src/lib/walletOnlineHooks.ts');
  const fetchOptions = /fetch\(apiUrl\(path\), \{([^}]*)\}\)/.exec(hooks)?.[1] ?? '';
  check('the Worker is only ever POSTed, with the person\'s token and NO body (no amount, no payer)', /method: 'POST'/.test(fetchOptions) && /headers/.test(fetchOptions) && !/body/.test(fetchOptions) && !/JSON\.stringify/.test(hooks), fetchOptions);
  check('the browser sends no amount to the Worker: start-online and check carry the path only', /start-online`\)/.test(code('src/lib/walletOnline.ts')) && /\/check`\)/.test(code('src/lib/walletOnline.ts')));
  const returnPage = code('src/pages/TopupReturn.tsx');
  check('the return page reads the row through pollReturn and offers "Check now" only after the minute (the waiting view)', /pollReturn\(/.test(returnPage) && /view\.kind === 'waiting' && \(\s*<button/.test(returnPage) && /ONLINE_COPY\.checkNow/.test(returnPage));
  check('the return page decides from the database row alone (never from the address)', /fetchTopupById\(walletDb, userId, topupId\)/.test(returnPage) && !/searchParams\.get\('(status|paid|success|result)'\)/.test(returnPage));
  check('nobody signed in sees a sign-in button, not a crash or a blank page', /ONLINE_COPY\.signInTitle/.test(returnPage) && /navigate\('\/login'\)/.test(returnPage));

  // ---- the screens ----
  const modal = code('src/components/AddMoneyModal.tsx');
  check('Add credit asks for the details and the choice TOGETHER when it opens, and never offers the choice to someone finishing a waiting transfer', /Promise\.all\(\[fetchPaymentDetails\(walletDb\), resume \? Promise\.resolve\(false\) : fetchOnlineAvailable\(walletDb\)\]\)/.test(modal) && /setOnlineAvailable\(!!d && online\)/.test(modal));
  check('without the choice the amount goes straight to the bank transfer, exactly as before (createTopup, same words)', /if \(onlineAvailable\) \{[\s\S]{0,200}setStep\('method'\);[\s\S]{0,40}return;[\s\S]{0,20}\}\s*void run\(async \(\) => \{\s*const created = await createTopup\(walletDb, parsed\.rand\);/.test(modal)
    && modal.includes('You add lesson credit by bank transfer. Choose how much, from {rand0(details.minRand)} to {rand0(details.maxRand)}. We then show you where to pay and the reference to use.'));
  check('"Bank transfer, checked by a person" makes the usual top-up (createTopup) and goes to the bank details and the proof; "Pay by bank" makes the online top-up, asks the Worker and goes to the bank',
    /createTopup\(walletDb, chosenRand\)/.test(modal) && /createOnlineTopup\(walletDb, rand\)/.test(modal) && /payByBankFor\(chosenRand\)/.test(modal) && /startOnlinePayment\(onlineRequest, created\.topupId\)/.test(modal) && /goToBankPage\(started\.redirectUrl\)/.test(modal)
    && /ONLINE_COPY\.onlineTitle/.test(modal) && /ONLINE_COPY\.manualTitle/.test(modal));
  check('a payment that failed to start is tried again on the same top-up, unless the Worker closed it; "Pay by bank transfer instead" is always there', /onlineTopup \?\? \(await createOnlineTopup/.test(modal) && /if \(started\.rowClosed\) setOnlineTopup\(null\)/.test(modal) && /handleChooseTransfer/.test(modal));
  check('the buttons stay off on the way to the bank, and come back if the person returns with the browser\'s Back button', /disabled=\{busy \|\| redirecting\}/.test(modal) && /'pageshow'/.test(modal) && /e\.persisted/.test(modal));
  const page = code('src/components/WalletPage.tsx');
  check('the wallet page shows "Continue to your bank" and "Check now" only under an online top-up that is waiting', /t\.status === 'awaiting_payment' && t\.method === 'online' && <OnlineTopupActions/.test(page));
  const actions = code('src/components/OnlineTopupActions.tsx');
  check('those buttons start (resume) the payment and check it, and never write', /startOnlinePayment\(onlineRequest, topupId\)/.test(actions) && /checkOnlineTopup\(onlineRequest, topupId\)/.test(actions) && /ONLINE_COPY\.continueToBank/.test(actions) && /ONLINE_COPY\.checkNow/.test(actions));
  const screens = ['src/pages/TopupReturn.tsx', 'src/components/OnlineTopupActions.tsx', 'src/components/AddMoneyModal.tsx', 'src/components/WalletPage.tsx', 'src/lib/walletOnline.ts'].map((f) => code(f).replace(/console\.[a-z]+\([^)]*\)/g, '')).join('\n');
  check('no screen text names a processor or offers anything "free"', !/ozow|payfast|yoco|peach payments|stitch/i.test(screens) && !/'[^']*\bfree\b[^']*'|"[^"]*\bfree\b[^"]*"|`[^`]*\bfree\b[^`]*`/i.test(code('src/pages/TopupReturn.tsx') + code('src/components/OnlineTopupActions.tsx') + code('src/lib/walletOnline.ts')));
  check('the wallet-open check stays: the online lines add no new way in (the wallet page still needs useWalletVisible / useWalletOpen)', /useWalletOpen\(\)/.test(page) && /walletOpen && \(\s*<button/.test(page));
  const app = code('src/App.tsx');
  check('"Go to your credit" arrives as /?view=wallet: the app opens the wallet once and drops the word from the address', /params\.get\('view'\) !== 'wallet'/.test(app) && /params\.delete\('view'\)/.test(app) && /replaceState/.test(app) && /openWalletPage\(\);/.test(app));
  const main = code('src/main.tsx');
  const meta = code('src/lib/pageMeta.ts');
  check('the return page has its route and its row in the page table (not indexed)', /path="\/wallet\/topup-return" element=\{<TopupReturn \/>\}/.test(main) && /path: '\/wallet\/topup-return'[^}]*index: false/.test(meta));
  check('the wallet does not reach into the Paystack code (payments.ts is untouched)', !/wallet/i.test(code('src/lib/payments.ts')));

  // ---- THE BANK AS THE MAIN WAY TO PAY on the booking page (Option A, CEO 12 Nov 2026) ----
  const env = (status: number, body: unknown) => async (path: string) => { envPaths.push(path); return { status, body }; };
  const envPaths: string[] = [];
  const okBody = (over: Record<string, unknown> = {}) => ({ configured: true, provider: 'ozow', test: true, ...over });
  const stagingEnv = await fetchOnlineEnvironment(env(200, okBody()));
  check('the Worker is asked the one public question, a GET path with nothing in it', envPaths.join() === '/api/wallet/online-environment' && stagingEnv?.test === true && stagingEnv.provider === 'ozow');
  check('the Worker says production: test is false', (await fetchOnlineEnvironment(env(200, okBody({ test: false }))))?.test === false);
  const envNo: [string, OnlineGet][] = [
    ['a 503 not_configured', env(503, { error: 'x', code: 'not_configured' })], ['a 404 (an old Worker without the route)', env(404, { error: 'x' })], ['a 500', env(500, null)],
    ['an answer that is not JSON', env(200, null)], ['configured false', env(200, okBody({ configured: false }))], ['configured missing', env(200, { test: true })],
    ['test as the text "true"', env(200, okBody({ test: 'true' }))], ['test missing', env(200, { configured: true, provider: 'ozow' })], ['a list', env(200, [okBody()])],
    ['a call that throws', async () => { throw new Error('network'); }],
  ];
  for (const [name, ask] of envNo) check(`the bank is not asked about further when the Worker answers ${name}: no environment`, (await fetchOnlineEnvironment(ask)) === null);
  const bankOpen = fakeDb({ rpc: () => ({ data: true, error: null }) }).db;
  const bankClosed = fakeDb({ rpc: () => ({ data: false, error: null }) }).db;
  const mainTest = await fetchMainWay(bankOpen, env(200, okBody()));
  check('the bank leads only when the database says yes AND the Worker says it is set up', mainTest.bankIsMain === true && mainTest.test === true && mainTest.provider === 'ozow');
  check('live: the bank leads and test is false (so no test note)', JSON.stringify(await fetchMainWay(bankOpen, env(200, okBody({ test: false })))) === '{"bankIsMain":true,"test":false,"provider":"ozow"}');
  const workerAsked: string[] = [];
  const closedAnswer = await fetchMainWay(bankClosed, async (p) => { workerAsked.push(p); return { status: 200, body: okBody() }; });
  check('the database says no: the card leads and the Worker is not even asked (an ordinary payer costs no extra call)', closedAnswer.bankIsMain === false && closedAnswer.test === false && workerAsked.length === 0);
  check('the Worker cannot be asked or says no: the card leads, and test is false', JSON.stringify(await fetchMainWay(bankOpen, env(503, { code: 'not_configured' }))) === JSON.stringify(CARD_IS_MAIN) && JSON.stringify(await fetchMainWay(bankOpen, async () => { throw new Error('x'); })) === JSON.stringify(CARD_IS_MAIN));
  check('the database failing or throwing: the card leads', (await fetchMainWay(fakeDb({ rpc: () => { throw new Error('db'); } }).db, env(200, okBody()))).bankIsMain === false && (await fetchMainWay(fakeDb({ rpc: () => ({ data: true, error: { code: 'x', message: 'y' } }) }).db, env(200, okBody()))).bankIsMain === false);
  check('decideMainWay: only an exact true and a real environment lead with the bank', decideMainWay(true, { provider: 'ozow', test: false }).bankIsMain === true && decideMainWay(false, { provider: 'ozow', test: true }).bankIsMain === false && decideMainWay(true, null).bankIsMain === false && decideMainWay('yes' as unknown as boolean, { provider: 'ozow', test: true }).bankIsMain === false);
  // the Test mode note
  const note = onlineTestNote('ozow');
  check('the test note says it is test mode, the demo login, that no real money is taken and that the lesson credit is pretend; the provider name comes from the Worker', /^Test mode: you will pay on Ozow's practice bank page with the demo login\. No real money is taken, and the money added to your credit is pretend money\.$/.test(note));
  check('a provider word that is not a plain lower-case name never reaches the screen (the note says "the bank\'s")', onlineTestNote('<b>x</b>').includes("the bank's practice bank page") && !onlineTestNote('<b>x</b>').includes('<') && onlineTestNote('').includes("the bank's"));
  check('the new words name no processor and offer nothing "free"', !/ozow|paystack|webhook|token|http/i.test(`${ONLINE_COPY.addByBank} ${ONLINE_COPY.cardInstead}`) && !/\bfree\b/i.test(`${note} ${ONLINE_COPY.addByBank} ${ONLINE_COPY.cardInstead}`));
  // the files
  const hooksSrc = code('src/lib/walletOnlineHooks.ts');
  check('the one GET is the public environment question: no token, no body, no header; every other Worker call is still a POST with the token and no body', /fetch\(apiUrl\(path\), \{ method: 'GET' \}\)/.test(hooksSrc) && (hooksSrc.match(/method: '/g) ?? []).length === 2 && !/JSON\.stringify/.test(hooksSrc));
  const libCode = code('src/lib/walletOnline.ts');
  check('the environment question reads nothing about a person and writes nothing (no rpc other than the two, no insert or update)', !/online-environment[\s\S]{0,400}\.(insert|update|upsert|delete)\(/.test(libCode) && /'\/api\/wallet\/online-environment'/.test(libCode));
  const pricesSrc = code('src/components/PricesPage.tsx');
  check('the booking page leads with the bank only through useBankMainWay (walletAvailable, then the database, then the Worker); the wallet opens by itself then, and Add credit goes straight to the bank',
    /const bank = useBankMainWay\(walletAvailable\);/.test(pricesSrc) && /const bankMain = walletAvailable && bank\.bankIsMain;/.test(pricesSrc) && /const walletMode = walletAvailable && \(showWallet \|\| bankMain \|\| cardClosed\);/.test(pricesSrc) && /preferOnline=\{bankMain\}/.test(pricesSrc));
  check('the card is kept: with the bank leading it sits under "Pay with a card instead" with its own Paystack test note, the not-open notice and its button; with the bank not leading the page is as before',
    /cardSection=\{<>\{cardNote\}\{notOpenNotice\}\{cardButton\}<\/>\}/.test(pricesSrc) && /\) : \(<>\{cardNote\}<\/>\)\}\s*\{staleNote\}\s*\{notOpenNotice\}\s*\{cardButton\}/.test(pricesSrc));
  check('the bank test note comes from the Worker alone: it is rendered only under {test && ...} with onlineTestNote(provider), and no screen file types the sentence', /\{test && \(\s*<p data-test-mode-bank[\s\S]{0,200}\{onlineTestNote\(provider\)\}/.test(code('src/components/BankMainCheckout.tsx')) && !/practice bank page/.test(code('src/components/BankMainCheckout.tsx') + pricesSrc + code('src/components/AddMoneyModal.tsx')) && /test=\{bank\.test\}/.test(pricesSrc));
  check('the Paystack test note is still only the card\'s, and is not shown beside the bank\'s note', /const cardNote = \(\s*<p data-test-mode[\s\S]{0,200}Test mode: use a Paystack test card\. No real money is taken\./.test(pricesSrc) && !/data-test-mode[\s\S]{0,40}onlineTestNote/.test(pricesSrc));
  const bankMainSrc = code('src/components/BankMainCheckout.tsx');
  check('with the bank leading: enough in the wallet gives "Pay R... from your credit", too little gives the shortfall and "Add credit by bank", and the card is folded (aria-expanded, closed to start with)', /Pay \$\{rand0\(price\)\} from your credit/.test(bankMainSrc) && /addLabel=\{ONLINE_COPY\.addByBank\}/.test(bankMainSrc) && /useState\(false\)/.test(bankMainSrc) && /aria-expanded=\{showCard\}/.test(bankMainSrc) && /ONLINE_COPY\.cardInstead/.test(bankMainSrc));
  const modalSrc = code('src/components/AddMoneyModal.tsx');
  check('Add credit with preferOnline opens the bank at once for the chosen amount, with the "How would you like to pay?" step on screen so a failure shows the message and the transfer; it does nothing different unless the choice is open for this person',
    /preferOnline = false/.test(modalSrc) && /if \(onlineAvailable\) \{[\s\S]{0,260}if \(preferOnline\) payByBankFor\(parsed\.rand\);[\s\S]{0,60}setStep\('method'\);/.test(modalSrc));
  check('the new files use no processor name and nothing "free" in anything a person sees', !/ozow|paystack(?! test card)|payfast|yoco/i.test(bankMainSrc.replace(/console\.[a-z]+\([^)]*\)/g, '')) && !/\bfree\b/i.test(bankMainSrc));

  // ---- the names this file relies on exist in phase 1 (database) and phase 2 (Worker) ----
  const migration = read('supabase/migrations/20261109110000_wallet_online_topups.sql');
  check('phase 1: wallet_online_available() is granted to signed-in people only and reads the mode setting wallet_online_mode',
    /function public\.wallet_online_available\(\)/.test(migration) && /grant execute on function public\.wallet_online_available\(\) to authenticated;/.test(migration) && /'wallet_online_mode'/.test(migration));
  check('phase 1: create_online_topup(p_amount integer) returns topup_id, reference and amount_rand; method online, status awaiting_payment',
    /function public\.create_online_topup\(p_amount integer\)/.test(migration) && /'topup_id', v_id, 'reference', v_ref, 'amount_rand', p_amount/.test(migration) && /method in \('eft', 'card', 'online'\)/.test(migration) && /'awaiting_payment'/.test(migration));
  check('phase 1: the provider columns are NOT on wallet_topups (the table is closed to browsers), so the page only ever sees method, status and the usual columns', /create table if not exists public\.wallet_online_attempts/.test(migration) && /revoke all on public\.wallet_online_attempts from public, anon, authenticated, service_role;/.test(migration));
  const worker = read('server/walletOnline.ts');
  check('phase 2: the Worker has the two routes and answers start-online with redirect_url', /\/api\/wallet\/topups\/:id\/start-online/.test(worker) && /\/api\/wallet\/topups\/:id\/check/.test(worker) && /redirect_url: made\.redirectUrl/.test(worker));
  check('phase 2: the Worker\'s error codes the page maps (busy, closed, not_found, not_configured, start_failed, wait, check_failed) all exist', ['busy', 'closed', 'not_found', 'not_configured', 'start_failed', 'wait', 'check_failed'].every((c) => worker.includes(`'${c}'`)));
  check('phase 2: the return address the Worker gives the processor is /wallet/topup-return?topup=<id>', /returnPath: `\/wallet\/topup-return\?topup=\$\{topupId\}`/.test(worker));

  // ---- the hint in the return address and the one immediate check (18 Nov 2026) --------------------------------------------------------------------
  {
    const row = (status: Topup['status'], method: Topup['method'] = 'online'): Topup => ({ id: ID, reference: 'TL-ABC234', amountRand: 200, status, method, receivedRand: null, comment: null, createdAt: '2026-11-18T10:00:00Z', decidedAt: null, proofSentAt: null });
    check('hint: only success, cancelled and error are read; anything else (any case, empty, a list, a number, null) is no hint', parseReturnHint('success') === 'success' && parseReturnHint('cancelled') === 'cancelled' && parseReturnHint('error') === 'error'
      && ['paid', 'Complete', 'CANCELLED', '', 'cancelled ', null, undefined, 5, ['error'], { r: 'error' }].every((w) => parseReturnHint(w) === null));
    const waitingViews: ReturnView[] = [{ kind: 'checking' }, { kind: 'waiting', readFailed: false }, { kind: 'waiting', readFailed: true }];
    const settledViews: ReturnView[] = [{ kind: 'paid', amountRand: 200 }, { kind: 'not_completed' }, { kind: 'cancelled' }, { kind: 'not_found' }, { kind: 'other' }];
    check('hint: while the top-up still waits, "cancelled" and "error" change the WORDS only: nothing was taken, and if you did pay it will be added', waitingViews.every((vw) => {
      const c = hintWords(vw, 'cancelled'); const e = hintWords(vw, 'error');
      return !!c && !!e && c.tone === 'bad' && e.tone === 'bad' && c.title === ONLINE_COPY.hintCancelledTitle && e.title === ONLINE_COPY.hintErrorTitle && c.body.includes('Nothing was taken') && c.body.includes('If you did pay') && !/received|added to your wallet|Payment received/.test(c.title + e.title);
    }));
    check('hint: "success" never says money arrived: it says we are confirming it', waitingViews.every((vw) => { const s = hintWords(vw, 'success'); return !!s && s.tone === 'wait' && s.body.includes('confirming') && s.title === ONLINE_COPY.checkingTitle && (s.title as string) !== paidTitle; }));
    check('hint: a settled view (paid, not completed, cancelled, not found, other) is NEVER touched by a hint: the row alone decides', settledViews.every((vw) => (['success', 'cancelled', 'error'] as const).every((h) => hintWords(vw, h) === null)));
    check('hint: no hint, no words', waitingViews.every((vw) => hintWords(vw, null) === null));
    check('hint: the hint never changes the row: a paid row is "paid" and a waiting row is "checking" whatever hint came with the address (decideReturn does not take one)', decideReturn(row('successful'), 0).kind === 'paid' && decideReturn(row('awaiting_payment'), 0).kind === 'checking' && decideReturn.length <= 3);
    const asked: string[] = [];
    const once = async (r: Topup | null | undefined | 'throw', fail = false) => {
      asked.length = 0;
      const out = await checkOnceWhenWaiting({ read: async () => { if (r === 'throw') throw new Error('x'); return r; }, check: async () => { asked.push('check'); if (fail) throw new Error('boom'); return { ok: true }; } });
      return `${out}/${asked.length}`;
    };
    check('immediate check: a row that still waits for the bank is checked ONCE', (await once(row('awaiting_payment'))) === 'checked/1');
    check('immediate check: a failing check is ignored (the page keeps reading the row)', (await once(row('awaiting_payment'), true)) === 'checked/1');
    check('immediate check: a settled row, a row that is not online, a missing row, a failed read are never checked', (await Promise.all([once(row('successful')), once(row('unsuccessful')), once(row('cancelled')), once(row('awaiting_payment', 'eft')), once(row('proof_sent')), once(null), once(undefined), once('throw')])).every((x) => x.endsWith('/0') && x.startsWith('skipped')));
    const page = code('src/pages/TopupReturn.tsx');
    check('the return page asks the signed-in check call, once, on open, and still never writes: no insert, update, delete, upsert or credit call, and the hint is read from the address only for wording', /checkOnceWhenWaiting\(/.test(page) && (page.match(/checkOnlineTopup\(/g) ?? []).length === 2 && /parseReturnHint\(searchParams\.get\('r'\)\)/.test(page) && !/\.(insert|update|delete|upsert)\(|rpc\(|wallet_credit/.test(page));
  }

  console.log(failed === 0 ? '\nALL OK' : `\n${failed} FAILED`);
  process.exit(failed === 0 ? 0 : 1);
}
void main();
