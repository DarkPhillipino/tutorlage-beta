// Checks on the WALLET SCREENS (phase 3 of the wallet + manual bank transfer system; CEO's design, 2 Nov 2026). Run: npx tsx scripts/dev/wallet-test.ts
// Proves, with a fake database client and by reading the source: the CEO's words are on the screens; every question to the database is tolerant (a
// database without the wallet, an error or an odd answer all mean "closed / none", and nothing about booking changes); the shortfall maths and the
// whole-rand text; the amount and the proof file are checked (type by the first bytes, 5 MB); the proof is uploaded FIRST and attached after; the
// tables are read with explicit column lists (never select *, never the account number); the booking page sends a wallet request through
// send_request_wallet before and instead of the card check; hooks keep their order; the Paystack code and the Worker are untouched.
// It does NOT prove the database behaviour (supabase/tests/wallet_core.sql and wallet_booking.sql, rolled back, on production 2 Nov), a real upload
// into the private bucket, or the screens with the switch on (see the P3 list in Drake/programmer/reports/2026-11-03.md).
import { readFileSync, readdirSync } from 'node:fs';
import {
  OTHER_BANK, SA_BANKS, WALLET_COPY, WalletRefusal, checkBankForm, checkProofFile, comingLine, createTopup, fetchBalance, fetchBankDetails, fetchComing,
  fetchInFlight, fetchLedger, fetchPaymentDetails, fetchPayouts, fetchTopups, fetchWalletOpen, fetchWalletRequestIds, fetchWalletSessionIds, ledgerAmount,
  ledgerLineText, parseTopupAmount, payoutStatusLine, rand0, requestPayout, sendProof, sendRequestWallet, shortfall, shortfallSentence, sniffProof,
  suggestedTopup, topupStatusLine, walletPrice, walletTutorShare, type WalletClient,
} from '../../src/lib/wallet';
import { notificationTarget } from '../../src/lib/notificationTarget';
import { FREE_CANCEL_NOTE, FREE_TUTOR_CANCEL_NOTE } from '../../src/lib/freeSessions';

let failed = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) failed += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && detail ? ` [${detail}]` : ''}`);
}
const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

type Answer = { data: unknown; error: { code?: string; message?: string; details?: string; hint?: string; statusCode?: string } | null };
// A fake database client: records every call; tables answer a scripted result; rpc answers by function name.
function fake(opts: { rpc?: (fn: string, args?: Record<string, unknown>) => Answer; tables?: Record<string, Answer>; upload?: () => Answer } = {}) {
  const calls: string[] = [];
  const selects: { table: string; cols: string }[] = [];
  const db: WalletClient = {
    rpc: async (fn, args) => { calls.push(`rpc:${fn}`); return (opts.rpc ?? (() => ({ data: null, error: null })))(fn, args); },
    from: (table: string) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const b: any = {};
      for (const m of ['select', 'eq', 'in', 'order', 'limit', 'is', 'gt']) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        b[m] = (...a: any[]) => { if (m === 'select') selects.push({ table, cols: String(a[0]) }); return b; };
      }
      const answer = (): Answer => opts.tables?.[table] ?? { data: [], error: null };
      b.maybeSingle = async () => { const r = answer(); return { data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data, error: r.error }; };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      b.then = (res: any, rej: any) => Promise.resolve(answer()).then(res, rej);
      return b;
    },
    storage: { from: (bucket: string) => ({ upload: async (path: string, _body: Blob, o: { contentType: string; upsert: boolean }) => { calls.push(`upload:${bucket}:${path}:${o.contentType}:${o.upsert}`); return opts.upload ? opts.upload() : { data: {}, error: null }; } }) },
  };
  return { db, calls, selects };
}
const blobOf = (bytes: number[], pad = 0) => new Blob([new Uint8Array([...bytes, ...new Array(pad).fill(0)])]);
const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34];
const JPG = [0xff, 0xd8, 0xff, 0xe0, 0, 0x10];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

async function main() {
  // ---- the words (the CEO's, adapted to the top-up) ----
  check('a learner who sent proof is told: could receive the money in the next 24 hours, if not contact support with the Help button at the top', /could receive your money in the next 24 hours/.test(WALLET_COPY.proofSentLine) && /contact support by clicking the Help button at the top of the page/.test(WALLET_COPY.proofSentLine));
  check('the tutor is told: could receive R640 within the next 24 hours, otherwise contact support with the Help button at the top', WALLET_COPY.payoutSent(640) === 'Your request was sent. You could receive R640 within the next 24 hours. If you do not, contact support with the Help button at the top of the page.');
  check('the wallet page says money is for lessons and a withdrawal goes through support', /for lessons/.test(WALLET_COPY.moneyIsForLessons) && /contact support/.test(WALLET_COPY.moneyIsForLessons));
  check('every top-up state has plain words, and "not received" carries the CEO\'s comment',
    topupStatusLine({ status: 'awaiting_proof', comment: null, receivedRand: null, amountRand: 200 }) === 'Waiting for your proof of payment'
    && /usually within 24 hours/.test(topupStatusLine({ status: 'proof_sent', comment: null, receivedRand: null, amountRand: 200 }))
    && topupStatusLine({ status: 'successful', comment: null, receivedRand: 200, amountRand: 200 }) === 'Added to your wallet'
    && topupStatusLine({ status: 'successful', comment: 'Short by R20', receivedRand: 180, amountRand: 200 }) === 'Added to your wallet: R180 received'
    && topupStatusLine({ status: 'unsuccessful', comment: 'No payment with that reference', receivedRand: null, amountRand: 200 }) === 'Not received: No payment with that reference'
    && topupStatusLine({ status: 'cancelled', comment: null, receivedRand: null, amountRand: 200 }) === 'Cancelled');
  check('the ledger reads in words: hold, release (three reasons), charge, refund, top-up, tutor credit, payout lines, adjustment',
    ledgerLineText({ kind: 'hold', note: null }, 'Maths', false) === 'On hold for your Maths request'
    && ledgerLineText({ kind: 'release', note: 'Request expired' }, null, false) === 'Returned: nobody accepted in time'
    && ledgerLineText({ kind: 'release', note: 'Request declined' }, null, false) === 'Returned: the tutor could not take it'
    && ledgerLineText({ kind: 'release', note: 'Request cancelled' }, null, false) === 'Returned: the request ended'
    && ledgerLineText({ kind: 'charge', note: null }, 'Maths', false) === 'Paid for your Maths session'
    && ledgerLineText({ kind: 'refund', note: null }, null, false) === 'Refund: session cancelled'
    && ledgerLineText({ kind: 'topup', note: null }, null, false) === 'Top-up added'
    && ledgerLineText({ kind: 'session_credit', note: null }, 'Maths', true) === 'Earned from a Maths session'
    && ledgerLineText({ kind: 'payout_paid', note: null }, null, true) === 'Payout paid'
    && /Adjustment by Tutorlage: wrong reference/.test(ledgerLineText({ kind: 'adjustment', note: 'wrong reference' }, null, false)));
  check('the figure beside a ledger line is what moved: available, else the held money (a charge or a payout paid)', ledgerAmount({ availableDelta: -180, heldDelta: 180 }) === -180 && ledgerAmount({ availableDelta: 0, heldDelta: -180 }) === -180 && ledgerAmount({ availableDelta: 200, heldDelta: 0 }) === 200);
  const day = (iso: string) => `D(${iso})`;
  check('payout states in words', /within 24 hours/.test(payoutStatusLine({ status: 'requested', paidOn: null, comment: null }, day)) && payoutStatusLine({ status: 'paid', paidOn: '2026-11-05', comment: null }, day) === 'Paid on D(2026-11-05)' && /Could not pay: no such account\. The money is back in your wallet/.test(payoutStatusLine({ status: 'could_not_pay', paidOn: null, comment: 'no such account' }, day)));
  check('"Coming: R360 from 2 sessions waiting to be completed" (and one session in the singular)', comingLine({ rand: 360, sessions: 2 }) === 'Coming: R360 from 2 sessions waiting to be completed' && comingLine({ rand: 180, sessions: 1 }) === 'Coming: R180 from 1 session waiting to be completed');

  // ---- money: whole rands, the shortfall, the split ----
  check('amounts read as whole rands', rand0(180) === 'R180' && rand0(0) === 'R0' && rand0(187.5) === 'R188' && rand0(-60) === '-R60');
  check('the price rounds like the database (nearest rand): 187.5 -> 188, 180 -> 180', walletPrice(187.5) === 188 && walletPrice(180) === 180 && walletPrice(149.4) === 149);
  check('shortfall: R180 with R120 -> R60; enough or more -> 0; an empty wallet -> the whole price', shortfall(180, 120) === 60 && shortfall(180, 180) === 0 && shortfall(180, 500) === 0 && shortfall(180, 0) === 180);
  check('the shortfall sentence is the database\'s own wording', shortfallSentence(180, 120) === 'Your wallet has R120. This session is R180. Add R60 or more.' && shortfallSentence(180, 0) === 'Your wallet has R0. This session is R180. Add R180 or more.');
  let splitOk = true;
  for (const price of [90, 120, 150, 180, 187.5, 225, 270, 300, 420]) for (const pct of [12, 17.5, 20, 22.5, 30]) {
    const priceRand = Math.round(price);
    const commissionExact = Math.round(price * pct) / 100;           // what the card formula shows (to the cent)
    const cardPayout = price - commissionExact;
    const share = walletTutorShare(price, cardPayout);
    const dbCommission = Math.round(priceRand * pct / 100);          // what create_wallet_session books
    // The screen's share equals the database's, except the rare case where the cent-rounding sits exactly on a half rand (see the report).
    if (!Number.isInteger(share) || share + Math.round(price - cardPayout) !== priceRand) splitOk = false;
    if (Math.abs(share - (priceRand - dbCommission)) > 1) splitOk = false;
  }
  check('the tutor\'s share shown in the list is a whole rand and share + commission = price over a grid of prices and rates', splitOk);
  check('a normal case matches the database exactly: R180 at 17.5% -> commission R32, tutor R148', walletTutorShare(180, 180 - 31.5) === 148);

  // ---- is the wallet open? every doubt answers "no" ----
  check('open: true', await fetchWalletOpen(fake({ rpc: () => ({ data: true, error: null }) }).db) === true);
  check('closed: false', await fetchWalletOpen(fake({ rpc: () => ({ data: false, error: null }) }).db) === false);
  check('a database without the wallet (function not found) answers false', await fetchWalletOpen(fake({ rpc: () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.wallet_open' } }) }).db) === false);
  check('an odd answer (a string, an empty object, null, 1) is never read as "open"', (await Promise.all(['true', {}, null, 1].map((d) => fetchWalletOpen(fake({ rpc: () => ({ data: d, error: null }) }).db)))).every((x) => x === false));
  check('a failing call is false, not a crash', await fetchWalletOpen({ ...fake().db, rpc: async () => { throw new Error('offline'); } }) === false);
  check('payment details: closed or an error means none; open gives the bank and limits', await fetchPaymentDetails(fake({ rpc: () => ({ data: { open: false }, error: null }) }).db) === null
    && await fetchPaymentDetails(fake({ rpc: () => ({ data: null, error: { message: 'x' } }) }).db) === null
    && (await fetchPaymentDetails(fake({ rpc: () => ({ data: { open: true, bank_name: 'FNB', account_holder: 'Tutorlage', account_number: '62000000000', branch_code: '250655', account_type: 'Cheque', min_rand: 50, max_rand: 5000, cap_rand: 10000 }, error: null }) }).db))?.maxRand === 5000);
  const ids = ['a', 'b', 'c'];
  const w1 = fake({ tables: { session_requests: { data: [{ id: 'b' }, { id: 7 }, { id: 'zzz' }], error: null }, sessions: { data: [{ id: 'c' }], error: null } } });
  const found = await fetchWalletRequestIds(ids, w1.db);
  check('the wallet requests come back as a set, ignoring anything that is not an id string', found.has('b') && found.has('zzz') && found.size === 2);
  check('the wallet sessions use their own table and flag', (await fetchWalletSessionIds(ids, w1.db)).has('c') && w1.selects.some((s) => s.table === 'sessions'));
  check('no ids asks nothing', (await fetchWalletRequestIds([], w1.db)).size === 0);
  check('an error means "none were paid from a wallet"', (await fetchWalletRequestIds(ids, fake({ tables: { session_requests: { data: null, error: { message: 'column does not exist' } } } }).db)).size === 0 && (await fetchWalletSessionIds(ids, { ...fake().db, from: () => { throw new Error('boom'); } })).size === 0);
  check('"in flight" is false on any error and true for money, a waiting top-up or a waiting payout',
    await fetchInFlight(fake({ tables: { wallets: { data: null, error: { message: 'x' } }, wallet_topups: { data: [], error: { message: 'x' } }, payout_requests: { data: [], error: { message: 'x' } } } }).db, 'me') === false
    && await fetchInFlight(fake({ tables: { wallets: { data: { available_rand: 0, held_rand: 0 }, error: null } } }).db, 'me') === false
    && await fetchInFlight(fake({ tables: { wallets: { data: { available_rand: 50, held_rand: 0 }, error: null } } }).db, 'me') === true
    && await fetchInFlight(fake({ tables: { wallet_topups: { data: [{ id: 't' }], error: null } } }).db, 'me') === true
    && await fetchInFlight(fake({ tables: { payout_requests: { data: [{ id: 'p' }], error: null } } }).db, 'me') === true);

  // ---- reads: explicit columns, never select *, never the account number ----
  const reads = fake({ tables: {
    wallets: { data: { available_rand: 320, held_rand: 180 }, error: null },
    wallet_topups: { data: [{ id: 't1', reference: 'TL-7K4M9Q', amount_rand: 200, status: 'unsuccessful', received_rand: null, decision_comment: 'Not found', created_at: '2026-11-03T08:00:00Z', decided_at: null }], error: null },
    wallet_ledger: { data: [{ id: 'l1', kind: 'hold', available_delta: -180, held_delta: 180, request_id: 'r1', session_id: null, note: null, created_at: '2026-11-03T08:00:00Z' }], error: null },
    tutor_bank_details: { data: { bank_name: 'FNB (First National Bank)', branch_code: '250655', account_holder: 'J Smith', account_last4: '4821', updated_at: '2026-11-01T00:00:00Z' }, error: null },
    payout_requests: { data: [{ id: 'p1', amount_rand: 640, status: 'paid', bank_name: 'FNB', account_last4: '4821', requested_at: '2026-11-03T08:00:00Z', decided_at: '2026-11-03T09:00:00Z', paid_on: '2026-11-03', decision_comment: null }], error: null },
    sessions: { data: [{ id: 's1', tutor_payout_amount: 150 }, { id: 's2', tutor_payout_amount: '210' }], error: null },
  } });
  const balance = await fetchBalance(reads.db, 'me');
  const topups = await fetchTopups(reads.db, 'me');
  const ledger = await fetchLedger(reads.db, 'me');
  const bank = await fetchBankDetails(reads.db, 'me');
  const payouts = await fetchPayouts(reads.db, 'me');
  const coming = await fetchComing(reads.db, 'me');
  check('the balance, top-ups, ledger, bank summary and payouts are read into plain values', balance.available === 320 && balance.held === 180 && topups[0].reference === 'TL-7K4M9Q' && topups[0].comment === 'Not found' && ledger[0].availableDelta === -180 && bank?.last4 === '4821' && payouts[0].paidOn === '2026-11-03');
  check('"Coming" adds the tutor share of booked wallet sessions (numbers or numeric text)', coming.rand === 360 && coming.sessions === 2);
  check('no wallet row yet is an empty wallet; a failing read throws so the screen can say "try again"', (await fetchBalance(fake().db, 'me')).available === 0
    && await fetchBalance(fake({ tables: { wallets: { data: null, error: { message: 'x' } } } }).db, 'me').then(() => false, () => true));
  check('every table read names its columns; none is select *; the full account number and the proof path are never selected',
    reads.selects.length >= 6 && reads.selects.every((s) => !s.cols.includes('*') || s.cols.includes('(')) && reads.selects.every((s) => !/account_number|proof_path|authorization/.test(s.cols)), JSON.stringify(reads.selects.map((s) => s.cols)));
  const walletSrc = code('src/lib/wallet.ts');
  check('the source has no select(\'*\') and no account_number or proof_path in any read', !/\.select\(\s*['"`]\*/.test(walletSrc) && !/\.select\([^)]*(account_number|proof_path)/.test(walletSrc));

  // ---- the amount typed ----
  check('amounts: 200, "R 200", "1,000" are fine', JSON.stringify(parseTopupAmount('200', 50, 5000)) === '{"ok":true,"rand":200}' && (parseTopupAmount('R 200', 50, 5000) as { rand: number }).rand === 200 && (parseTopupAmount('1,000', 50, 5000) as { rand: number }).rand === 1000);
  const bad = ['', 'abc', '12.5', '49', '5001', '-20', '0'].map((t) => parseTopupAmount(t, 50, 5000));
  check('empty, letters, cents, below the minimum, above the maximum, negative and zero are all refused with a sentence', bad.every((r) => 'message' in r && r.message.length > 5));
  check('the limits are named in the sentence (R50 and R5000)', /R50/.test((parseTopupAmount('10', 50, 5000) as { message: string }).message) && /R5000/.test((parseTopupAmount('9999', 50, 5000) as { message: string }).message));
  check('the box is prefilled with the missing amount, never below the minimum or above the maximum', suggestedTopup(60, 50, 5000) === 60 && suggestedTopup(20, 50, 5000) === 50 && suggestedTopup(9000, 50, 5000) === 5000 && suggestedTopup(0, 50, 5000) === null && suggestedTopup(null, 50, 5000) === null);

  // ---- the proof file: by its first bytes, up to 5 MB ----
  check('PDF, JPG and PNG are recognised by their first bytes; anything else is not', sniffProof(new Uint8Array(PDF))?.ext === 'pdf' && sniffProof(new Uint8Array(JPG))?.ext === 'jpg' && sniffProof(new Uint8Array(PNG))?.ext === 'png'
    && sniffProof(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0])) === null && sniffProof(new TextEncoder().encode('<html><scr')) === null && sniffProof(new Uint8Array([])) === null);
  check('an empty file, a file over 5 MB and a file that only claims to be a PDF are refused', !(await checkProofFile(new Blob([]))).ok
    && !(await checkProofFile(blobOf(PDF, 5 * 1024 * 1024))).ok
    && !(await checkProofFile(new File([new TextEncoder().encode('just text, named .pdf')], 'proof.pdf', { type: 'application/pdf' }))).ok);
  check('a file of exactly 5 MB is accepted', (await checkProofFile(blobOf(PDF, 5 * 1024 * 1024 - PDF.length))).ok === true);

  // ---- upload first, then attach ----
  const up = fake();
  await sendProof(up.db, 'payer-1', 'topup-1', blobOf(PNG, 20));
  check('the proof goes to the private bucket at <payer>/<top-up>.<ext> first, then attach_topup_proof is called', up.calls[0] === 'upload:payment-proofs:payer-1/topup-1.png:image/png:false' && up.calls[1] === 'rpc:attach_topup_proof' && up.calls.length === 2, up.calls.join(' | '));
  const upErr = fake({ upload: () => ({ data: null, error: { message: 'Bucket not found' } }) });
  const upErrMsg = await sendProof(upErr.db, 'p', 't', blobOf(PDF, 10)).then(() => '', (e) => (e as Error).message);
  check('a failed upload says why and never reaches attach', upErrMsg === 'Bucket not found' && !upErr.calls.includes('rpc:attach_topup_proof'));
  const upDup = fake({ upload: () => ({ data: null, error: { message: 'The resource already exists', statusCode: '409' } }) });
  await sendProof(upDup.db, 'p', 't', blobOf(PDF, 10));
  check('a file already there from an earlier try is attached as it is', upDup.calls.includes('rpc:attach_topup_proof'));
  const attErr = fake({ rpc: () => ({ data: null, error: { message: 'This top-up already has its proof, or was decided.' } }) });
  check('the database\'s refusal of the attach reaches the person', await sendProof(attErr.db, 'p', 't', blobOf(JPG, 10)).then(() => '', (e) => (e as Error).message) === 'This top-up already has its proof, or was decided.');
  const noUp = fake();
  await sendProof(noUp.db, 'p', 't', new File([new TextEncoder().encode('nope nope nope')], 'x.pdf')).catch(() => undefined);
  check('a bad file is refused BEFORE any upload', noUp.calls.length === 0);

  // ---- sending a request from the wallet ----
  const refused = await sendRequestWallet('req-1', fake({ rpc: () => ({ data: null, error: { message: 'Your wallet has R120. This session is R180. Add R60 or more.', details: 'wallet_too_low', hint: '60' } }) }).db).then(() => null, (e) => e as WalletRefusal);
  check('a wallet too small: the database\'s sentence and the missing rand reach the page', refused instanceof WalletRefusal && refused.message === 'Your wallet has R120. This session is R180. Add R60 or more.' && refused.shortRand === 60);
  const other = await sendRequestWallet('req-1', fake({ rpc: () => ({ data: null, error: { message: 'Wallet payments are not open.' } }) }).db).then(() => null, (e) => e as WalletRefusal);
  check('any other refusal passes its sentence on, with no missing amount', other instanceof WalletRefusal && other.message === 'Wallet payments are not open.' && other.shortRand === null);
  const sentCalls = fake({ rpc: () => ({ data: { mode: 'wallet' }, error: null }) });
  await sendRequestWallet('req-9', sentCalls.db);
  check('sending calls send_request_wallet with the request id and nothing else', sentCalls.calls.length === 1 && sentCalls.calls[0] === 'rpc:send_request_wallet');

  // ---- topups and payouts ----
  const made = await createTopup(fake({ rpc: () => ({ data: { topup_id: 'tt', reference: 'TL-ABC234', amount_rand: 200, status: 'awaiting_proof' }, error: null }) }).db, 200);
  check('a top-up comes back with its reference', made.topupId === 'tt' && made.reference === 'TL-ABC234' && made.amountRand === 200);
  check('the database\'s refusal of a top-up reaches the person; an odd answer is an error, not a crash', await createTopup(fake({ rpc: () => ({ data: null, error: { message: 'You already have 3 top-ups waiting for proof of payment.' } }) }).db, 200).then(() => '', (e) => (e as Error).message) === 'You already have 3 top-ups waiting for proof of payment.'
    && await createTopup(fake({ rpc: () => ({ data: {}, error: null }) }).db, 200).then(() => false, () => true));
  check('a payout request returns the amount asked for', (await requestPayout(fake({ rpc: () => ({ data: { payout_id: 'p', amount_rand: 640, status: 'requested' }, error: null }) }).db)).amountRand === 640);

  // ---- the tutor's bank form ----
  const goodForm = { bank: SA_BANKS[0], otherBank: '', accountNumber: '1234 5678-90', branchCode: '250 655', holder: ' J Smith ' };
  const ok1 = checkBankForm(goodForm);
  check('a good form is cleaned (spaces and dashes out) and accepted', 'bankName' in ok1 && ok1.accountNumber === '1234567890' && ok1.branchCode === '250655' && ok1.holder === 'J Smith');
  check('"Other bank" uses the typed name; no bank, a short or lettered account number, a 5-digit branch code and no holder are all refused with a sentence',
    ('bankName' in checkBankForm({ ...goodForm, bank: OTHER_BANK, otherBank: 'Bank of Athens' }) && (checkBankForm({ ...goodForm, bank: OTHER_BANK, otherBank: 'Bank of Athens' }) as { bankName: string }).bankName === 'Bank of Athens')
    && ['message' in checkBankForm({ ...goodForm, bank: '' }), 'message' in checkBankForm({ ...goodForm, bank: OTHER_BANK, otherBank: ' ' }), 'message' in checkBankForm({ ...goodForm, accountNumber: '12345' }), 'message' in checkBankForm({ ...goodForm, accountNumber: '12ab567890' }),
        'message' in checkBankForm({ ...goodForm, branchCode: '25065' }), 'message' in checkBankForm({ ...goodForm, holder: '' })].every(Boolean));
  check('the bank list is built in (no Paystack call) and has the big banks', SA_BANKS.length >= 8 && SA_BANKS.some((b) => /FNB/.test(b)) && SA_BANKS.includes('Capitec Bank') && SA_BANKS.includes('Standard Bank'));

  // ---- the screens, read as source ----
  const prices = code('src/components/PricesPage.tsx');
  check('the booking page asks whether the wallet is open and works only in rand', /useWalletOpen\(\)/.test(prices) && /walletOpen && !freeOpen && selectedLevel\?\.currencyCode\.trim\(\) === 'ZAR'/.test(prices));
  check('enough in the wallet: the button reads "Pay R180 from your wallet"', /`Pay \$\{rand0\(price\)\} from your wallet`/.test(prices) && /\(!walletMode \|\| walletEnough\) && \(/.test(prices));
  check('a wallet request is sent through send_request_wallet and returns BEFORE the card check; the free branch is still first', (() => {
    const free = prices.indexOf('await sendMyRequestFree(created.id)');
    const wal = prices.indexOf('await sendMyRequestWallet(created.id)');
    const card = prices.indexOf('await initializePayment(reference)');
    return free > 0 && wal > free && card > wal && /sendMyRequestWallet\(created\.id\);[\s\S]{0,160}return;/.test(prices);
  })());
  check('while the wallet is short the request is never created (the handler stops before createSessionRequest)', prices.indexOf('if (walletMode && !walletEnough) return;') > 0 && prices.indexOf('if (walletMode && !walletEnough) return;') < prices.indexOf('await createSessionRequest('));
  check('short or empty: the box shows the shortfall sentence and "Add money" prefilled with what is missing', /WalletPayBox/.test(prices) && /suggestedRand=\{wallet\.state\.status === 'ready' \? shortfall\(price, wallet\.state\.available\) : null\}/.test(prices) && /shortfallSentence\(price, state\.available\)/.test(code('src/components/WalletPayBox.tsx')) && />\s*Add money\s*</.test(code('src/components/WalletPayBox.tsx')));
  check('the card wording, the free wording and the "payments are not open" notice are still there, and the notice stays while the wallet is closed', /You'll pay/.test(prices) && /FREE_FOR_NOW_NOTICE/.test(prices) && /PAYMENTS_NOT_OPEN && !freeOpen && !walletMode && \(/.test(prices) && /initializePayment/.test(prices));
  check('the wallet does not touch the Paystack code or the Worker', !/wallet/i.test(read('server/index.ts')) && !/wallet/i.test(read('src/lib/payments.ts')) && !/wallet/i.test(read('src/components/PayoutAccountPanel.tsx')));
  const callback = code('src/pages/PaymentCallback.tsx');
  check('the confirmation page for a wallet request needs no card check, says the price is on hold and puts no amount in the address', /searchParams\.get\('wallet'\) === '1'/.test(callback) && /on hold in your wallet/.test(callback) && !/wallet=1&/.test(prices) && /payment\/callback\?wallet=1'\)/.test(prices));
  const add = code('src/components/AddMoneyModal.tsx');
  check('Add money: amount -> createTopup -> reference and bank details -> the proof; the proof is sent through sendProof; "send later" and "cancel this top-up" exist', /createTopup\(walletDb, parsed\.rand\)/.test(add) && /sendProof\(walletDb, payerId, topup\.topupId, file\)/.test(add) && /I will send the proof later/.test(add) && /cancelTopup\(walletDb/.test(add) && /WALLET_COPY\.proofSentLine/.test(add));
  check('the file box takes PDF, JPG and PNG only', /accept="application\/pdf,image\/jpeg,image\/png,\.pdf,\.jpg,\.jpeg,\.png"/.test(add));
  const tutorPanel = code('src/components/TutorWalletPanel.tsx');
  check('the tutor sees Available, Coming, the four fields (account number write-only), "Transact" and the CEO\'s 24-hour message; one open request at a time', /comingLine\(coming\)/.test(tutorPanel) && /Transact/.test(tutorPanel) && /WALLET_COPY\.payoutSent\(sent\)/.test(tutorPanel) && /Account number/.test(tutorPanel) && /Branch code/.test(tutorPanel) && /Account holder/.test(tutorPanel) && /setForm\(EMPTY_FORM\)/.test(tutorPanel) && /canTransact = balance\.available > 0 && !!bank && !openPayout/.test(tutorPanel) && /\{!openPayout && \(\s*<button onClick=\{\(\) => setEditing\(true\)\}/.test(tutorPanel));
  check('the saved account number is never displayed: only the last four', /••\{bank\.last4\}/.test(tutorPanel) && !/accountNumber\}<\/|bank\.accountNumber/.test(tutorPanel));

  // ---- the lists: the wording for a wallet request, and hooks before any early return ----
  const learnerSessions = code('src/components/UpcomingSessionsPanel.tsx');
  const tutorSessions = code('src/components/TutorSessionsPanel.tsx');
  const queue = code('src/components/AvailableRequestsQueue.tsx');
  check('a learner\'s waiting wallet request says the price is on hold, and their session cancel says "back into your wallet"; the card text stays for card requests', /walletRequestIds\.has\(r\.id\)\s*\?\s*WALLET_COPY\.waitingNote/.test(learnerSessions) && /walletNote=\{walletSessionIds\.has\(s\.id\) \? WALLET_COPY\.cancelNote : undefined\}/.test(learnerSessions) && /walletNote \?\? freeNote \?\? 'Cancel this session\? The payment is refunded in full to the card/.test(learnerSessions));
  check('a tutor is told the share goes into their wallet on completion, and the "payments are not open" line is hidden when EVERY request is a wallet request or free, and always in free mode', /walletSessionIds\.has\(s\.id\) && \(/.test(tutorSessions) && /WALLET_COPY\.tutorQueueNote/.test(queue) && /!freeOpen && visibleRequests\.length > 0 && !visibleRequests\.every\(\(r\) => walletIds\.has\(r\.id\) \|\| freeIds\.has\(r\.id\)\)/.test(queue));
  // FREE sessions (found 2 Nov 2026, fixed 3 Nov): a free session's cancel confirmation must not say the payment is "refunded to the card".
  check('a FREE session\'s cancel confirmation (learner and tutor) says nothing was charged, not "refunded to the card"', /freeNote=\{freeSessionIds\.has\(s\.id\) \? FREE_CANCEL_NOTE : undefined\}/.test(learnerSessions) && /freeNote=\{freeSessionIds\.has\(s\.id\) \? FREE_TUTOR_CANCEL_NOTE : undefined\}/.test(tutorSessions) && !/card|Paystack|refunded/i.test(FREE_CANCEL_NOTE.replace('nothing to refund', '').replace('refunded or paid', '')) && /nothing was charged/.test(FREE_CANCEL_NOTE) && /free/i.test(FREE_TUTOR_CANCEL_NOTE));
  check('the tutor\'s "You earn" for a wallet request is the whole-rand share the database books', /walletIds\.has\(r\.id\) \? walletTutorShare\(r\.chargedAmount, r\.tutorPayout\) : r\.tutorPayout/.test(queue));
  for (const [file, src] of [['AvailableRequestsQueue', queue], ['TutorSessionsPanel', tutorSessions], ['UpcomingSessionsPanel', learnerSessions]] as const) {
    const hook = src.indexOf('useWalletIds(');
    const firstReturn = src.indexOf('if (isLoading');
    check(`${file}: the wallet-ids hook runs before any early return (hooks keep their order)`, hook > 0 && (firstReturn === -1 || hook < firstReturn), `hook ${hook}, return ${firstReturn}`);
  }
  const queries = code('src/lib/queries.ts');
  check('every read of payment_status in the app is one of the two known ones, and both still list a pending wallet request (card_verified)', (queries.match(/payment_status/g) ?? []).length === 2 && /\.in\('payment_status', \['card_verified', 'paid'\]\)/.test(queries) && /\.eq\('payment_status', 'card_verified'\)/.test(queries)
    && readdirSync('src', { recursive: true }).filter((f) => /\.(ts|tsx)$/.test(String(f)) && !/queries\.ts$/.test(String(f))).every((f) => !/\.(eq|in|neq)\('payment_status'/.test(code(`src/${f}`))));

  // ---- quiet while closed ----
  const chip = code('src/components/WalletChip.tsx');
  const hooks = code('src/lib/walletHooks.ts');
  check('the header chip draws nothing unless the wallet is open or something is in flight, and never for a learner under 18', /if \(!visible \|\| !onOpen\) return null;/.test(chip) && /useWalletVisible\(user\?\.id, isViewOnlyLearner\)/.test(chip) && /visible: !hidden && \(open \|\| inFlight\)/.test(hooks));
  check('the "in flight" probe runs only while the wallet is closed', /if \(open \|\| !userId \|\| hidden\) \{\s*setInFlight\(false\);\s*return;\s*\}/.test(hooks));
  check('the wallet balance is read only when the wallet is open and the request is in rand', /useWalletBalance\(user\?\.id, walletMode\)/.test(prices) && /if \(!enabled \|\| !userId\) \{\s*setState\(\{ status: 'closed' \}\);/.test(hooks));
  check('wallet notices (types starting wallet_) open the Wallet page; the other targets are unchanged', notificationTarget('wallet_topup_added') === 'wallet' && notificationTarget('wallet_payout_paid') === 'wallet' && notificationTarget('terms_updated') === 'terms' && notificationTarget('request_for_you') === 'teach' && notificationTarget('request_accepted') === 'sessions');
  const app = code('src/App.tsx');
  check('the app has a Wallet view, opened from the chip and from a wallet notice; a learner under 18 is told the parent pays', /view === 'wallet'/.test(app) && /<WalletPage/.test(app) && /onOpenWallet=\{openWalletPage\}/.test(app) && /target === 'wallet'\) openWalletPage\(\)/.test(app) && /COPY\.viewOnlyLearner/.test(code('src/components/WalletPage.tsx')));
  check('the wallet words are plain English constants like the free-sessions ones (the app\'s i18n holds only header words); no card, Paystack or "charged" wording in the wallet copy', !/paystack|charged|card/i.test(Object.values(WALLET_COPY).map((v) => (typeof v === 'function' ? v(100) : v)).join(' ')));

  console.log(failed === 0 ? '\nall checks passed' : `\n${failed} FAILED`);
  process.exit(failed === 0 ? 0 : 1);
}
main();
