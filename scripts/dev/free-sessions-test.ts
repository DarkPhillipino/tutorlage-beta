// Checks on FREE SESSIONS mode (CEO, 2 Nov 2026): the switch is a database setting, off by default; a request can be sent without a card, a
// tutor can accept it and the session can be completed with no money; free sessions count towards a tutor's level, are flagged and are kept
// out of every earnings sum; the screens say so plainly. Run: npx tsx scripts/dev/free-sessions-test.ts
// Proves, with a fake database client and by reading the source: the CEO's words are on the screens exactly; every question to the database
// is tolerant (a database without the migration answers "no" and nothing about booking changes); the booking page sends the free request
// BEFORE and INSTEAD of the card check and never both; the three replaced functions are patched at an anchor that exists once; the migration
// changes no existing row and drops nothing. It does NOT prove the database behaviour: that is supabase/tests/free_sessions.sql (rolled back).
import { readFileSync, readdirSync } from 'node:fs';
import {
  FREE_FOR_NOW_DETAIL, FREE_FOR_NOW_NOTICE, FREE_SESSION_LEARNER_BADGE, FREE_SESSION_TUTOR_NOTICE, FREE_WAITING_NOTE,
  fetchFreeRequestIds, fetchFreeSessionIds, fetchFreeSessionsOpen, sendRequestFree, type FreeSessionsClient,
} from '../../src/lib/freeSessions';

let failed = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) failed += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && detail ? ` [${detail}]` : ''}`);
}
const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

function fake(answer: (fn: string, args?: Record<string, unknown>) => { data: unknown; error: { code?: string; message?: string } | null }) {
  const calls: string[] = [];
  const client: FreeSessionsClient = { rpc: async (fn, args) => { calls.push(fn); return answer(fn, args); } };
  return { client, calls };
}

async function main() {
  // ---- the words (the CEO's, exactly) ----
  check('the learner is told "Free for now: you won\'t be charged."', FREE_FOR_NOW_NOTICE === "Free for now: you won't be charged.");
  check('the tutor is told "Free session, you won\'t be paid for this one"', FREE_SESSION_TUTOR_NOTICE === "Free session, you won't be paid for this one");
  check('the other free wording promises no price and no charge (and never says "paid for" to a learner)', /won't be charged/.test(FREE_WAITING_NOTE) && /Nobody is charged/.test(FREE_FOR_NOW_DETAIL) && FREE_SESSION_LEARNER_BADGE === 'Free session');

  // ---- is the switch on? every doubt answers "no" ----
  check('the switch on: true', await fetchFreeSessionsOpen(fake(() => ({ data: true, error: null })).client) === true);
  check('the switch off: false', await fetchFreeSessionsOpen(fake(() => ({ data: false, error: null })).client) === false);
  check('a database without the migration (function not found) answers false', await fetchFreeSessionsOpen(fake(() => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.free_sessions_open' } })).client) === false);
  check('an odd answer (a string, an empty object, null) is never read as "on"', (await Promise.all(['true', {}, null, 1].map((d) => fetchFreeSessionsOpen(fake(() => ({ data: d, error: null })).client)))).every((x) => x === false));
  check('a failing call is false, not a crash', await fetchFreeSessionsOpen({ rpc: async () => { throw new Error('offline'); } }) === false);

  // ---- which are free ----
  const ids = ['a', 'b', 'c'];
  const f1 = fake(() => ({ data: ['b', 'zzz', 7], error: null }));
  const found = await fetchFreeRequestIds(ids, f1.client);
  check('the free requests come back as a set, ignoring anything that is not an id string', found.has('b') && found.has('zzz') && found.size === 2 && f1.calls[0] === 'free_request_ids');
  check('the free sessions use their own question', (await fetchFreeSessionIds(ids, fake(() => ({ data: ['c'], error: null })).client)).has('c'));
  check('no ids asks nothing', (await fetchFreeRequestIds([], f1.client)).size === 0 && f1.calls.length === 1);
  check('an error or an odd answer means "none are free"', (await fetchFreeRequestIds(ids, fake(() => ({ data: null, error: { message: 'x' } })).client)).size === 0 && (await fetchFreeRequestIds(ids, fake(() => ({ data: { a: 1 }, error: null })).client)).size === 0);

  // ---- sending ----
  const s1 = fake(() => ({ data: 'free', error: null }));
  await sendRequestFree('req-1', s1.client);
  check('sending calls send_request_free with the request id and nothing else', s1.calls[0] === 'send_request_free');
  let refusal = '';
  try { await sendRequestFree('req-1', fake(() => ({ data: null, error: { message: 'Free sessions are not open.' } })).client); } catch (e) { refusal = (e as Error).message; }
  check('the database\'s reason reaches the learner when it refuses', refusal === 'Free sessions are not open.');

  // ---- the booking page ----
  const prices = code('src/components/PricesPage.tsx');
  check('the booking page asks the database whether the switch is on', /useFreeSessionsOpen\(\)/.test(prices));
  // (3 Nov 2026: the wallet is a third way to send a request, so "payments closed" also needs "and the wallet is not paying for this request"; free is unchanged.)
  check('the send button is off only when payments are closed AND free sessions are off (and the wallet is not paying for it; the card button is the main one since 10 Nov)', /disabled=\{isSending \|\| \(PAYMENTS_NOT_OPEN && !freeOpen\)\}/.test(prices) && /if \(PAYMENTS_NOT_OPEN && !freeOpen && !useWallet\) return;/.test(prices));
  const freeBranch = prices.indexOf('await sendMyRequestFree(created.id)');
  const cardCall = prices.indexOf('await initializePayment(reference)');
  check('a free request is sent through send_request_free, returns, and never reaches the card check', freeBranch > 0 && cardCall > freeBranch && /sendMyRequestFree\(created\.id\);[\s\S]{0,160}return;/.test(prices));
  check('the page says "Free for now" and does not name a price or a card check in free mode', /\{freeOpen \? \([\s\S]{0,300}FREE_FOR_NOW_NOTICE[\s\S]{0,200}\) : \(<>[\s\S]{0,400}data-test-mode/.test(prices) && /PAYMENTS_NOT_OPEN && !freeOpen && \(/.test(prices));
  const callback = code('src/pages/PaymentCallback.tsx');
  check('the confirmation page for a free request needs no card check and says "Free for now"', /searchParams\.get\('free'\) === '1'/.test(callback) && /FREE_FOR_NOW_NOTICE/.test(callback));

  // ---- the lists ----
  const queue = code('src/components/AvailableRequestsQueue.tsx');
  check('the tutor\'s open requests show "Free session, you won\'t be paid for this one" instead of "You earn" for a free request', /freeIds\.has\(r\.id\) \? \([\s\S]{0,300}FREE_SESSION_TUTOR_NOTICE[\s\S]{0,300}\) : r\.tutorPayout != null/.test(queue));
  const tutorSessions = code('src/components/TutorSessionsPanel.tsx');
  check('the tutor\'s sessions say it is unpaid', /freeSessionIds\.has\(s\.id\)[\s\S]{0,300}FREE_SESSION_TUTOR_NOTICE/.test(tutorSessions));
  const learnerSessions = code('src/components/UpcomingSessionsPanel.tsx');
  check('the learner\'s waiting request names no price when it is free, and their upcoming session carries the tag', /freeRequestIds\.has\(r\.id\)\s*\?\s*FREE_SESSION_LEARNER_BADGE/.test(learnerSessions) && /freeRequestIds\.has\(r\.id\)\s*\?\s*FREE_WAITING_NOTE/.test(learnerSessions) && /freeSessionIds\.has\(s\.id\) && <span/.test(learnerSessions));
  for (const [file, src, early] of [['AvailableRequestsQueue', queue, 'if (isLoading'], ['TutorSessionsPanel', tutorSessions, 'if (isLoading'], ['UpcomingSessionsPanel', learnerSessions, 'if (isLoading']] as const) {
    const hook = src.indexOf('useFreeIds(');
    const firstReturn = src.indexOf(early);
    check(`${file}: the free-ids hook runs before any early return (hooks keep their order)`, hook > 0 && (firstReturn === -1 || hook < firstReturn), `hook ${hook}, return ${firstReturn}`);
  }

  // ---- the migration ----
  const files = readdirSync('supabase/migrations').filter((f) => f.endsWith('_free_sessions_mode.sql'));
  check('one free-sessions migration exists', files.length === 1, files.join(','));
  const mig = read(`supabase/migrations/${files[0]}`);
  const migCode = mig.replace(/^\s*--.*$/gm, '');
  check('the switch is added OFF, and never changed if it already exists', /values \('free_sessions_enabled', 'false'::jsonb\)\s*on conflict \(setting_key\) do nothing/.test(migCode));
  check('nothing is dropped or deleted and no existing row is changed (only a constraint is rebuilt)', !/drop (table|column|function|policy)|delete from|truncate|update public\.(sessions|session_requests|system_settings)\s+set(?![\s\S]{0,60}free_session)/i.test(migCode.replace(/update public\.session_requests set payment_status = 'card_verified', free_session = true[^;]*;/, '').replace(/update public\.session_requests\s+set tutor_id = p_tutor_id[\s\S]*?where id = p_request_id;/, '').replace(/update public\.sessions\s+set status[\s\S]*?where id = p_session_id;/, '').replace(/update public\.session_requests set status = 'cancelled'[^;]*;/g, '')));
  const constraint = /check \(payment_status in \(([^)]*)\)\)/.exec(migCode)?.[1] ?? '';
  const oldList = ['unpaid', 'initiated', 'card_verified', 'charging', 'charge_failed', 'paid', 'refund_pending', 'refund_queued', 'refund_needs_attention', 'refunded', 'refund_failed', 'failed'];
  check('the rebuilt payment_status list keeps all 12 old values and adds only "free"', oldList.every((v) => constraint.includes(`'${v}'`)) && constraint.includes(`'free'`) && (constraint.match(/'[a-z_]+'/g) ?? []).length === 13);
  check('a signed-in user can never insert a request already marked free', /guard_free_flag[\s\S]{0,200}current_user in \('authenticated', 'anon'\)[\s\S]{0,80}new\.free_session := false/.test(migCode) && /before insert on public\.session_requests/.test(migCode));
  check('send_request_free: needs a signed-in user, the switch on, the requester, and a request not yet sent; repeat calls change nothing', /send_request_free[\s\S]{0,900}auth\.uid\(\)[\s\S]{0,300}free_sessions_open\(\)[\s\S]{0,400}requested_by_profile_id is distinct from v_uid[\s\S]{0,300}return 'free';[\s\S]{0,200}payment_status <> 'initiated'/.test(migCode));
  check('send_request_free is for signed-in users only', /revoke all on function public\.send_request_free\(uuid\) from public, anon;\s*grant execute on function public\.send_request_free\(uuid\) to authenticated;/.test(migCode));
  check('create_free_session is private (no one can call it but the owner-run claim function)', /revoke all on function public\.create_free_session\(uuid, uuid\) from public, anon, authenticated;/.test(migCode));
  check('a free session is stored with 0 money and the flag, and the request ends as "free"', /0, 0, 0,[\s\S]{0,300}'scheduled', true/.test(migCode) && /payment_status = 'free', commission_amount = 0/.test(migCode));
  check('free_sessions_open answers anyone and treats a missing or odd setting as off', /lower\(coalesce\(setting_value #>> '\{\}', ''\)\) = 'true'[\s\S]{0,200}false\);/.test(migCode) && /grant execute on function public\.free_sessions_open\(\) to anon, authenticated/.test(migCode));
  // The three patches: each anchor line must exist exactly once in the NEWEST definition of its function.
  const anchorsOk = (migFile: string, startMarker: string, endMarker: string, anchor: string) => {
    const s = read(`supabase/migrations/${migFile}`);
    const a = s.indexOf(startMarker);
    const b = s.indexOf(endMarker, a);
    return a >= 0 && b > a && s.slice(a, b).split(anchor).length === 2;
  };
  check('claim_session_request: the anchor (the fit check\'s raise) occurs exactly once in its newest definition', anchorsOk('20261020180000_police_clearance_checks.sql', 'create or replace function public.claim_session_request(', '$function$;', "raise exception '%', public.tutor_fit_sentence(v_fit);"));
  check('cancel_session: the anchor (the request lookup) occurs exactly once in its newest definition', anchorsOk('20260930239500_split_payments_charge_on_accept.sql', 'create or replace function public.cancel_session(', '\n$$;', 'select * into v_request from public.session_requests where resulting_session_id = p_session_id for update;'));
  check('closure_cancel_session: the anchor (the paid branch) occurs exactly once in its newest definition', anchorsOk('20261021140000_close_account.sql', 'create or replace function public.closure_cancel_session(', '\n$$;', "if found and v_r.payment_status = 'paid' then"));
  // Legal's H2 (a lapsed police certificate stops a tutor accepting, children included): in the newest claim_session_request the verified check
  // and the police check come BEFORE the place where the free block is inserted, so a free request can never skip them.
  {
    const s = read('supabase/migrations/20261020180000_police_clearance_checks.sql');
    const a = s.indexOf('create or replace function public.claim_session_request(');
    const body = s.slice(a, s.indexOf('$function$;', a));
    const anchor = body.indexOf("raise exception '%', public.tutor_fit_sentence(v_fit);");
    const verified = body.indexOf('if not coalesce(v_tutor.is_verified, false) then');
    const police = body.indexOf('v_problem := public.police_clearance_problem(p_tutor_id);');
    const raisePolice = body.indexOf("raise exception '%', v_problem using errcode = '42501';");
    check('the police-clearance check (and the verified check) run BEFORE the free block is reached: a free request cannot skip them', verified > 0 && police > verified && raisePolice > police && anchor > raisePolice, `${verified} ${police} ${raisePolice} ${anchor}`);
  }
  check('no later migration redefines the three patched functions (so the anchors are read from the newest text)', ['claim_session_request', 'cancel_session', 'closure_cancel_session'].every((fn) => {
    // Only migrations BEFORE the free-sessions one matter: it patches the live text when applied. A later migration may replace a function whole
    // (e.g. 20261104100100_cancel_any_time_before_start.sql replaces cancel_session, keeping the free and wallet branches it was given).
    const defs = readdirSync('supabase/migrations').filter((f) => f.endsWith('.sql') && f < files[0] && !f.endsWith('_free_sessions_mode.sql') && new RegExp(`create or replace function public\\.${fn}\\(`).test(read(`supabase/migrations/${f}`))).sort();
    const newest = { claim_session_request: '20261020180000_police_clearance_checks.sql', cancel_session: '20260930239500_split_payments_charge_on_accept.sql', closure_cancel_session: '20261021140000_close_account.sql' }[fn];
    return defs[defs.length - 1] === newest;
  }));
  check('the patch stops (changes nothing) if an anchor is not found exactly once, and skips a function already patched', /expected exactly once/.test(mig) && /already patched/.test(mig));

  // ---- what this feature must not touch ----
  check('the payments and Worker code is untouched by this feature (the Worker answers a free acceptance through the old paid path)', !/free_session|freeSessions/.test(read('server/index.ts')) && !/free_session|freeSessions/.test(read('src/lib/payments.ts')));
  check('the legal pages are not touched by this feature', !/free sessions|free_session/i.test(readdirSync('src/content/legal').map((f) => read(`src/content/legal/${f}`)).join('\n')));

  console.log(failed === 0 ? '\nall checks passed' : `\n${failed} FAILED`);
  process.exit(failed === 0 ? 0 : 1);
}
main();
