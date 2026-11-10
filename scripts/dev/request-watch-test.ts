// Checks on THE WAITING SCREEN after a lesson request is sent (the CEO, 9 Nov 2026). Run: npx tsx scripts/dev/request-watch-test.ts
// Proves, with a pretend database client (nothing real is called): what each state of the payer's own request row means (waiting, a tutor said yes, booked, a
// booked session cancelled or finished, expired / declined / cancelled), that the tutor's name is read ONLY after a tutor has accepted and never while a
// request is waiting, that the page only ever READS (no write or function call in the files it uses; the two cancel doors are the existing ones), how often it
// looks (quick, then slower, once a minute when the tab is hidden, and a hard stop at 30 minutes), that an id that is not a real id is never even asked for,
// that a missing or someone else's request (the database returns nothing) gives today's page, the plain sentences (including the CEO's "No tutor accepted in
// time. Your R__ is back in your wallet."), and that the addresses carry only the request id.
// It does NOT prove the screens in a browser (tests/browser/request-watch.spec.ts does, with the database pretended), the database's policies, or a real tutor
// accepting a real request (that needs two real accounts).
import { readFileSync } from 'node:fs';
import {
  WATCH_COPY, WATCH_FAST_MS, WATCH_FAST_UNTIL_MS, WATCH_HIDDEN_MS, WATCH_SLOW_MS, WATCH_STOP_AFTER_MS,
  decideView, detailsLine, endedSentence, endedTitle, fetchRequestIdByReference, fetchWatchRequest, fetchWatchSession, isRequestId, lookAtRequest,
  moneyBackSentence, nextLookDelayMs, payModeOf, sessionOverSentence, shouldKeepLooking, waitingLine,
  type WatchClient, type WatchRequest, type WatchSession, type WatchView,
} from '../../src/lib/requestWatch';

let failed = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) failed += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && detail ? ` [${detail}]` : ''}`);
}
const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

const ME = '00000000-0000-4000-8000-000000000001';
const REQ = '33333333-3333-4333-8333-333333333333';
const SES = '44444444-4444-4444-8444-444444444444';
const TUTOR = '55555555-5555-4555-8555-555555555555';

const request = (over: Partial<WatchRequest> = {}): WatchRequest => ({
  id: REQ, status: 'pending', paymentStatus: 'card_verified', tutorId: null, sessionId: null, requestedStart: '2026-11-12T12:00:00Z', durationHours: 1,
  chargedAmount: 252, holdRand: 252, paidFromWallet: true, subjectName: 'Mathematics', ...over,
});
const session = (over: Partial<WatchSession> = {}): WatchSession => ({
  id: SES, status: 'scheduled', scheduledStart: '2026-11-12T12:00:00Z', durationHours: 1, tutorName: 'Thandi Mokoena', subjectName: 'Mathematics', walletPaid: true, ...over,
});

// ---- the pretend database ----
interface Seen { tables: string[]; selects: string[]; filters: string[]; methods: string[] }
function fakeDb(opts: { request?: Record<string, unknown> | null; session?: Record<string, unknown> | null; failRequest?: boolean; failSession?: boolean }): { db: WatchClient; seen: Seen } {
  const seen: Seen = { tables: [], selects: [], filters: [], methods: [] };
  const db: WatchClient = {
    from: (table: string) => {
      seen.tables.push(table);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const b: any = {};
      b.select = (cols: string) => { seen.selects.push(`${table}: ${cols}`); return b; };
      b.eq = (col: string, value: unknown) => { seen.filters.push(`${table}.${col}=${String(value)}`); return b; };
      for (const m of ['insert', 'update', 'delete', 'upsert']) b[m] = () => { seen.methods.push(m); return b; };
      b.maybeSingle = async () => {
        if (table === 'session_requests') return opts.failRequest ? { data: null, error: { message: 'network' } } : { data: opts.request ?? null, error: null };
        return opts.failSession ? { data: null, error: { message: 'network' } } : { data: opts.session ?? null, error: null };
      };
      return b;
    },
  };
  return { db, seen };
}
const requestRow = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: REQ, status: 'pending', payment_status: 'card_verified', tutor_id: null, resulting_session_id: null, requested_start: '2026-11-12T12:00:00Z', duration_hours: 1,
  charged_amount: 252, wallet_hold_rand: 252, paid_from_wallet: true, student_subject_enrollments: { subject_name: 'Mathematics' }, ...over,
});
const sessionRow = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: SES, status: 'scheduled', scheduled_start: '2026-11-12T12:00:00Z', duration_hours: 1, wallet_paid: true,
  tutor_profiles: { profiles: { full_name: 'Thandi Mokoena' } }, student_subject_enrollments: { subject_name: 'Mathematics' }, ...over,
});

async function main(): Promise<void> {
  // ---------------------------------------------------------------- what a row means ----------------------------------------------------------------
  const kind = (v: WatchView) => v.kind;
  check('no row (no such id, or not the payer\'s) is "show today\'s page", and does not keep looking', kind(decideView(null, undefined)) === 'fallback' && !shouldKeepLooking(decideView(null, undefined)));
  check('a sent request nobody has taken is "waiting", and the page keeps looking', kind(decideView(request(), undefined)) === 'waiting' && shouldKeepLooking(decideView(request(), undefined)));
  check('a free request and a card-verified request wait the same way', kind(decideView(request({ paidFromWallet: false, holdRand: null }), undefined)) === 'waiting');
  const waiting = decideView(request(), undefined);
  check('waiting is not "confirming"', waiting.kind === 'waiting' && waiting.confirming === false);
  const confirming = decideView(request({ tutorId: TUTOR }), undefined);
  check('a tutor is on the row but it is still pending: "a tutor said yes", still looking', confirming.kind === 'waiting' && confirming.confirming === true && shouldKeepLooking(confirming));
  check('a card being charged is "confirming" too', (() => { const v = decideView(request({ paymentStatus: 'charging' }), undefined); return v.kind === 'waiting' && v.confirming; })());
  check('accepted with no session id yet: still confirming, keep looking', (() => { const v = decideView(request({ status: 'accepted', tutorId: TUTOR }), undefined); return v.kind === 'waiting' && v.confirming && shouldKeepLooking(v); })());
  check('a pending request that is not "sent" (card check not finished) is today\'s page', kind(decideView(request({ paymentStatus: 'initiated' }), undefined)) === 'fallback' && kind(decideView(request({ paymentStatus: 'charge_failed' }), undefined)) === 'fallback');
  check('an unknown status is today\'s page, never an error', kind(decideView(request({ status: 'something_new' }), undefined)) === 'fallback');
  const booked = decideView(request({ status: 'accepted', tutorId: TUTOR, sessionId: SES, paymentStatus: 'wallet_paid' }), session());
  check('accepted + a scheduled session: "booked", with the session, and the page stops looking', booked.kind === 'booked' && booked.session.tutorName === 'Thandi Mokoena' && !shouldKeepLooking(booked));
  check('accepted but the session cannot be read: "booked_unseen" (we still say a tutor accepted, without a name)', kind(decideView(request({ status: 'accepted', tutorId: TUTOR, sessionId: SES }), null)) === 'booked_unseen');
  check('a completed session is "session over: completed"', (() => { const v = decideView(request({ status: 'accepted', sessionId: SES }), session({ status: 'completed' })); return v.kind === 'session_over' && v.why === 'completed'; })());
  check('a session the tutor cancelled says the tutor cancelled', (() => { const v = decideView(request({ status: 'cancelled', tutorId: TUTOR, sessionId: SES }), session({ status: 'cancelled_by_tutor' })); return v.kind === 'session_over' && v.why === 'cancelled_by_tutor'; })());
  check('a session the learner cancelled says so', (() => { const v = decideView(request({ status: 'cancelled', tutorId: TUTOR, sessionId: SES }), session({ status: 'cancelled_by_student' })); return v.kind === 'session_over' && v.why === 'cancelled_by_you'; })());
  check('a cancelled request that had a tutor is a cancelled SESSION even if the session cannot be read', (() => { const v = decideView(request({ status: 'cancelled', tutorId: TUTOR, sessionId: SES }), null); return v.kind === 'session_over' && v.why === 'cancelled'; })());
  for (const why of ['expired', 'declined', 'cancelled'] as const) {
    const v = decideView(request({ status: why }), undefined);
    check(`${why} (nobody took it) is "ended: ${why}" and the page stops looking`, v.kind === 'ended' && v.why === why && !shouldKeepLooking(v));
  }
  check('"reading" and a retrying fallback keep looking; a settled fallback does not', shouldKeepLooking({ kind: 'reading' }) && shouldKeepLooking({ kind: 'fallback', retry: true }) && !shouldKeepLooking({ kind: 'fallback', retry: false }));

  // ---------------------------------------------------------------- the reads ----------------------------------------------------------------------
  {
    const { db, seen } = fakeDb({ request: requestRow() });
    const r = await fetchWatchRequest(db, ME, REQ);
    check('the request is read from session_requests for THIS request id AND this payer', r?.id === REQ && seen.tables.join() === 'session_requests' && seen.filters.includes(`session_requests.id=${REQ}`) && seen.filters.includes(`session_requests.requested_by_profile_id=${ME}`), seen.filters.join());
    check('the row is read into plain values (price on hold, wallet flag, subject)', r?.holdRand === 252 && r.paidFromWallet && r.subjectName === 'Mathematics' && r.sessionId === null && r.tutorId === null);
    check('the request read asks for no tutor or profile column at all (a waiting request can never show a name)', !/tutor_profiles|profiles|full_name/.test(seen.selects.join(' ')), seen.selects.join());
  }
  {
    const { db } = fakeDb({ request: requestRow({ paid_from_wallet: false, wallet_hold_rand: 0 }) });
    const r = await fetchWatchRequest(db, ME, REQ);
    check('a request not paid from a wallet has no hold amount', r?.holdRand === null && r.paidFromWallet === false);
  }
  {
    const { db, seen } = fakeDb({ request: requestRow() });
    const bad = await Promise.all(['', 'not-an-id', "' or 1=1 --", '../../etc', REQ + 'x'].map((id) => fetchWatchRequest(db, ME, id)));
    check('an id that is not a real id is never asked for', bad.every((x) => x === null) && seen.tables.length === 0);
    check('isRequestId accepts a real id and nothing else', isRequestId(REQ) && !isRequestId('') && !isRequestId(null) && !isRequestId(42) && !isRequestId('33333333-3333-4333-8333-33333333333'));
  }
  {
    const { db } = fakeDb({ request: null });
    check('the database returns nothing (no such request, or not the payer\'s): null, then today\'s page', (await fetchWatchRequest(db, ME, REQ)) === null && kind(await lookAtRequest(db, ME, REQ)) === 'fallback');
  }
  {
    const { db } = fakeDb({ failRequest: true });
    let threw = false;
    try { await fetchWatchRequest(db, ME, REQ); } catch { threw = true; }
    check('a failed read throws (so the page can tell "could not look" from "nothing there")', threw);
  }
  {
    // ANONYMOUS MATCHING: the tutor's name is read only when the request is accepted, and only through the session.
    const { db, seen } = fakeDb({ request: requestRow(), session: sessionRow() });
    const v = await lookAtRequest(db, ME, REQ);
    check('a waiting request: only session_requests is read, the sessions table is never touched, and the view holds no name', v.kind === 'waiting' && seen.tables.join() === 'session_requests' && !JSON.stringify(v).includes('Thandi'));
    const { db: db2, seen: seen2 } = fakeDb({ request: requestRow({ tutor_id: TUTOR }), session: sessionRow() });
    const v2 = await lookAtRequest(db2, ME, REQ);
    check('a tutor on a still-pending row ("said yes"): still no session read and no name', v2.kind === 'waiting' && seen2.tables.join() === 'session_requests' && !JSON.stringify(v2).includes('Thandi'));
    const { db: db3, seen: seen3 } = fakeDb({ request: requestRow({ status: 'accepted', tutor_id: TUTOR, resulting_session_id: SES, payment_status: 'wallet_paid' }), session: sessionRow() });
    const v3 = await lookAtRequest(db3, ME, REQ);
    check('accepted: the session is read by its id and the tutor\'s name appears', v3.kind === 'booked' && v3.session.tutorName === 'Thandi Mokoena' && seen3.filters.includes(`sessions.id=${SES}`) && seen3.tables.join() === 'session_requests,sessions');
    check('the session is read the way the Sessions page reads it (tutor_profiles -> profiles.full_name, subject, wallet flag)', /tutor_profiles!sessions_tutor_id_fkey \( profiles!tutor_profiles_id_fkey \( full_name \) \)/.test(seen3.selects.join(' ')) && /wallet_paid/.test(seen3.selects.join(' ')));
    const { db: db4 } = fakeDb({ request: requestRow({ status: 'accepted', tutor_id: TUTOR, resulting_session_id: SES }), failSession: true });
    const v4 = await lookAtRequest(db4, ME, REQ);
    check('a failed session read does not hide that a tutor accepted ("booked_unseen")', v4.kind === 'booked_unseen');
    const { db: db5 } = fakeDb({ request: requestRow({ status: 'accepted', tutor_id: TUTOR, resulting_session_id: SES }), session: null });
    check('a session the payer cannot read is "booked_unseen", not an error', kind(await lookAtRequest(db5, ME, REQ)) === 'booked_unseen');
    const { db: db6 } = fakeDb({ session: sessionRow({ tutor_profiles: null }) });
    check('a session with no readable tutor profile says "Your tutor", never "undefined"', (await fetchWatchSession(db6, SES))?.tutorName === 'Your tutor');
  }
  {
    const { db, seen } = fakeDb({ request: { id: REQ } });
    const id = await fetchRequestIdByReference(db, ME, '66666666-6666-4666-8666-666666666666');
    check('card path: the request is found by its card reference AND this payer', id === REQ && seen.filters.includes('session_requests.paystack_reference=66666666-6666-4666-8666-666666666666') && seen.filters.includes(`session_requests.requested_by_profile_id=${ME}`));
    const { db: db2, seen: seen2 } = fakeDb({ request: { id: REQ } });
    check('card path: a reference that is not one of ours is never asked for', (await fetchRequestIdByReference(db2, ME, 'abc')) === null && seen2.tables.length === 0);
    const { db: db3 } = fakeDb({ failRequest: true });
    check('card path: a failed lookup is "none", never an error', (await fetchRequestIdByReference(db3, ME, '66666666-6666-4666-8666-666666666666')) === null);
  }

  // ---------------------------------------------------------------- how often to look -------------------------------------------------------------
  check('quick at first: every 4 seconds for the first 2 minutes', nextLookDelayMs(0, false) === WATCH_FAST_MS && nextLookDelayMs(WATCH_FAST_UNTIL_MS - 1, false) === WATCH_FAST_MS && WATCH_FAST_MS === 4000);
  check('then every 15 seconds', nextLookDelayMs(WATCH_FAST_UNTIL_MS, false) === WATCH_SLOW_MS && nextLookDelayMs(WATCH_STOP_AFTER_MS - 1, false) === WATCH_SLOW_MS && WATCH_SLOW_MS === 15000);
  check('slower when the tab is hidden: once a minute', nextLookDelayMs(0, true) === WATCH_HIDDEN_MS && nextLookDelayMs(10 * 60_000, true) === WATCH_HIDDEN_MS && WATCH_HIDDEN_MS === 60_000);
  check('it always stops, after 30 minutes, visible or hidden', nextLookDelayMs(WATCH_STOP_AFTER_MS, false) === null && nextLookDelayMs(WATCH_STOP_AFTER_MS, true) === null && WATCH_STOP_AFTER_MS === 30 * 60_000);
  {
    // Walk the whole 30 minutes the way the page does: how many looks, and that the walk ends.
    const count = (hidden: boolean) => { let t = 0; let looks = 1; for (let guard = 0; guard < 10_000; guard += 1) { const d = nextLookDelayMs(t, hidden); if (d === null) return looks; t += d; looks += 1; } return -1; };
    check('a visible tab looks about 140 times in 30 minutes (never more than 200) and the loop ends', count(false) > 100 && count(false) <= 200, String(count(false)));
    check('a hidden tab looks about 30 times in 30 minutes and the loop ends', count(true) >= 25 && count(true) <= 35, String(count(true)));
  }

  // ---------------------------------------------------------------- the words ----------------------------------------------------------------------
  const wallet = request();
  check('the CEO\'s sentence for a request nobody took, paid from the wallet', endedSentence('expired', wallet) === 'No tutor accepted in time. Your R252 is back in your wallet.', endedSentence('expired', wallet));
  check('declined and cancelled say it plainly, with the money', endedSentence('declined', wallet) === 'The tutor could not take this request. Your R252 is back in your wallet.' && endedSentence('cancelled', wallet) === 'Your request was cancelled. Your R252 is back in your wallet.');
  const free = request({ paidFromWallet: false, holdRand: null });
  check('a free or card request that ended says nothing was charged, and names no amount', endedSentence('expired', free) === 'No tutor accepted in time. You were not charged.' && moneyBackSentence(free) === 'You were not charged.');
  check('the money comes back as the amount that was on hold (a code-discounted price is not the list price)', moneyBackSentence(request({ chargedAmount: 280, holdRand: 252 })) === 'Your R252 is back in your wallet.');
  check('the titles: a cancelled request says "Request cancelled", the others "Your request has ended"', endedTitle('cancelled') === 'Request cancelled' && endedTitle('expired') === 'Your request has ended' && endedTitle('declined') === 'Your request has ended');
  const over = (why: 'cancelled_by_you' | 'cancelled_by_tutor' | 'cancelled' | 'completed') => ({ kind: 'session_over' as const, request: wallet, session: session(), why });
  check('a cancelled session says who cancelled and where the money went (wallet credit)', sessionOverSentence(over('cancelled_by_tutor'), 'wallet') === 'Your tutor cancelled this session. Your R252 went back into your wallet as credit.' && sessionOverSentence(over('cancelled_by_you'), 'wallet') === 'This session was cancelled. Your R252 went back into your wallet as credit.');
  check('a cancelled free session says it was free; a cancelled card session says the payment is refunded', sessionOverSentence({ ...over('cancelled'), request: free }, 'free') === 'This session was cancelled. It was free, so nothing was charged.' && sessionOverSentence({ ...over('cancelled'), request: free }, 'card') === 'This session was cancelled. Your payment is refunded in full.');
  check('the row\'s own wallet flag beats the address for how it was paid', payModeOf(wallet, 'card') === 'wallet' && payModeOf(free, 'free') === 'free');
  check('the waiting line per way of paying: wallet hold / free / card (plain, 10 Nov)', waitingLine('wallet') === 'The price is on hold in your wallet. If nobody accepts in time, it goes straight back.' && /Free for now/.test(waitingLine('free')) && waitingLine('card') === 'Your request is waiting for a tutor to accept it.');
  check('the lesson line is subject, day and time in South African time, and hours', detailsLine('Mathematics', '2026-11-12T12:00:00Z', 1) === 'Mathematics · Thu 12 Nov, 14:00 SAST · 1h', detailsLine('Mathematics', '2026-11-12T12:00:00Z', 1));
  check('the confirm lines are the Sessions page\'s own sentences', WATCH_COPY.cancelRequestNote.wallet === 'Cancel this request? The price on hold goes straight back into your wallet.' && WATCH_COPY.cancelSessionNote.wallet === 'Cancel this session? The payment goes back into your wallet as credit.' && WATCH_COPY.cancelRequestNote.card === 'Cancel this request? You have not been charged.');
  const allWords = JSON.stringify(WATCH_COPY) + endedSentence('expired', wallet) + sessionOverSentence(over('cancelled'), 'wallet');
  check('no word the CEO ruled out: "Back to Tutorlage" is gone from the new screens; "free sessions" is never used; the wallet and free screens name no payment company', !/Back to Tutorlage/i.test(allWords) && !/free sessions/i.test(allWords) && !/ozow|payfast|peach/i.test(allWords) && !/paystack/i.test(JSON.stringify([WATCH_COPY.waitingWallet, WATCH_COPY.waitingFree, WATCH_COPY.cancelRequestNote, WATCH_COPY.cancelSessionNote.wallet, WATCH_COPY.cancelSessionNote.free])));

  // ---------------------------------------------------------------- the files ----------------------------------------------------------------------
  const lib = code('src/lib/requestWatch.ts');
  const hooks = code('src/lib/requestWatchHooks.ts');
  const card = code('src/components/RequestWatchCard.tsx');
  const callback = code('src/pages/PaymentCallback.tsx');
  const prices = code('src/components/PricesPage.tsx');
  const app = code('src/App.tsx');
  const writes = /\.(insert|update|upsert|delete)\(|\.rpc\(|\.storage\b|fetch\(/;
  check('the logic and the hook only READ: no insert, update, delete, function call, storage or raw fetch', !writes.test(lib) && !writes.test(hooks), [lib, hooks].map((s) => s.match(writes)?.[0]).join());
  check('the card calls only the two existing cancel doors (cancelWaitingRequest for a waiting request, cancelSession for a booked one) and nothing else from the database', /cancelWaitingRequest\(request\.id\)/.test(card) && /cancelSession\(view\.session\.id\)/.test(card) && !writes.test(card) && !/supabase/.test(card));
  check('cancelling asks first (a second press does it), and the screen looks again afterwards', /setAsking\(true\)/.test(card) && /Yes, cancel/.test(card) && /Keep it/.test(card) && /await onCancelled\(\)/.test(card) && /onCancelled=\{watch\.refresh\}/.test(callback));
  check('the changing words sit in a polite live region', /role="status" aria-live="polite"/.test(card));
  check('the hook stops its timer and its tab listener when the page goes, looks when the tab comes back, and stops after the cap', /clearTimeout/.test(hooks) && /removeEventListener\('visibilitychange'/.test(hooks) && /addEventListener\('visibilitychange'/.test(hooks) && /nextLookDelayMs\(/.test(hooks) && /shouldKeepLooking\(/.test(hooks) && /setStopped\(true\)/.test(hooks));
  check('the hook looks at nothing without a request id AND a signed-in person', /if \(!requestId \|\| !userId\)/.test(hooks));
  check('today\'s page is still there word for word: the three sentences and "Back to Tutorlage"', /Your request is sent\. The price is on hold in your wallet\. If nobody accepts in time, it goes straight back\. We'll let you know when a tutor accepts\./.test(callback) && /Your request is now visible to qualifying tutors, and we'll let you know when one accepts\./.test(callback) && /Back to Tutorlage/.test(callback) && /FREE_FOR_NOW_NOTICE/.test(callback) && /searchParams\.get\('wallet'\) === '1'/.test(callback) && /searchParams\.get\('free'\) === '1'/.test(callback));
  check('the sent page loses its button only while the first look is on its way', /\{!firstLookPending && \(/.test(callback));
  check('the waiting screen is shown only when the request id is a real id and the person is signed in', /isRequestId\(urlRequest\)/.test(callback) && /showWatch = !!watchId && !!userId/.test(callback));
  check('the booking page puts ONLY the request id in the address, for wallet and for free', /payment\/callback\?free=1&request=\$\{created\.id\}`\)/.test(prices) && /payment\/callback\?wallet=1&request=\$\{created\.id\}`\)/.test(prices) && !/callback\?(free|wallet)=1&(?!request=)/.test(prices));
  check('"View my sessions" lands on the Sessions page (a separate one-time effect; the wallet one is untouched)', /params\.get\('view'\) !== 'sessions'/.test(app) && /openSessionsPage\(\);/.test(app) && /params\.get\('view'\) !== 'wallet'/.test(app) && /openWalletPage\(\);/.test(app) && /navigate\('\/\?view=sessions'\)/.test(callback));
  check('"Send a new request" goes to the booking page', /onNewRequest=\{\(\) => navigate\('\/'\)\}/.test(callback));
  check('the screen adds no new colour or font: only colours the old page and the Sessions page already use', !/#[0-9a-fA-F]{3,6}/.test(card.replace(/#(0F172A|15803D|166534|FAF7F2)/g, '')) );

  console.log(failed === 0 ? '\nALL PASS' : `\n${failed} FAILED`);
  process.exit(failed === 0 ? 0 : 1);
}

void main();
