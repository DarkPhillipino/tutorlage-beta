// Guards the two 4 Nov 2026 changes the CEO asked for: "someone should be able to cancel any time before a lesson has actually begun" and a parent
// saving a learner's institution. Run: npx tsx scripts/dev/cancel-any-time-test.ts
// The database half is proved by supabase/tests/cancel_any_time.sql (rolled back); this reads the migrations, the screens and the policy text.
import { readFileSync } from 'node:fs';

let failed = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) failed += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && detail ? ` [${detail}]` : ''}`);
}
const read = (p: string) => readFileSync(p, 'utf8');

const cancelMig = read('supabase/migrations/20261104100100_cancel_any_time_before_start.sql');
const instMig = read('supabase/migrations/20261104100000_parent_sets_learner_institution.sql');
const queries = read('src/lib/queries.ts');
const panel = read('src/components/UpcomingSessionsPanel.tsx');
const app = read('src/App.tsx');
const refunds = read('src/content/legal/refunds.md');
const terms = read('src/content/legal/terms.md');

// The wallet branch of cancel_session in the new migration: from its start to the free-session branch.
const walletBranch = cancelMig.slice(cancelMig.indexOf("payment_status = 'wallet_paid'"), cancelMig.indexOf("payment_status = 'free'"))
  .split(/\r?\n/).filter((l) => !/^\s*--/.test(l)).join('\n'); // code only: the comment line above the branch may talk about the window
check('cancel_session has a wallet branch', walletBranch.length > 200);
check('the wallet branch no longer checks a cancellation window', !/cancellation_window_days|cancellation window|make_interval/i.test(walletBranch), 'window code still in the wallet branch');
check('the session must still be upcoming and not started (checked before the branches)', /status <> 'scheduled'/.test(cancelMig) && /now\(\) >= v_session\.scheduled_start/.test(cancelMig));
check('the tutor, the learner, whoever booked and the learner\'s guardian may cancel', /can_act_for_learner\(v_session\.student_id\)/.test(cancelMig) && /v_session\.booked_by_profile_id/.test(cancelMig) && /v_by_tutor/.test(cancelMig));
check('the card branch keeps its window (Paystack is unchanged)', /The % day cancellation window for this booking has closed/.test(cancelMig));
check('the waiting-request cancel exists, is signed-in only, and refuses a request a tutor has taken', /function public\.cancel_waiting_request\(p_request_id uuid\)/.test(cancelMig)
  && /v_uid is null/.test(cancelMig) && /v\.tutor_id is not null/.test(cancelMig) && /grant execute on function public\.cancel_waiting_request\(uuid\) to authenticated/.test(cancelMig)
  && /revoke all on function public\.cancel_waiting_request\(uuid\) from public, anon/.test(cancelMig));
check('it sets the request to cancelled (the wallet_release_hold trigger then returns the held price)', /set status = 'cancelled'/.test(cancelMig));

check('the institution function exists, is guardian-only, and is signed-in only', /function public\.set_learner_institution\(p_learner uuid, p_institution uuid\)/.test(instMig)
  && /can_act_for_learner\(p_learner\)/.test(instMig) && /grant execute on function public\.set_learner_institution\(uuid, uuid\) to authenticated/.test(instMig)
  && /revoke all on function public\.set_learner_institution\(uuid, uuid\) from public, anon/.test(instMig));

check('the app calls both functions by their database names and argument names', /rpc\('cancel_waiting_request', \{ p_request_id: requestId \}\)/.test(queries)
  && /rpc\('set_learner_institution', \{ p_learner: learnerId, p_institution: institutionId \}\)/.test(queries));
check('the "Waiting for a tutor" card has a cancel control for the request', /kind="request"/.test(panel) && /cancelWaitingRequest\(sessionId\)/.test(panel));
check('a guardian\'s institution choice is sent to the database, with a device fallback', /setLearnerInstitution\(learnerId, institution\.id\)/.test(app) && /rememberInstitution\(user\.id, learnerId, institution\)/.test(app));

check('the Refund Policy no longer says the cancel button stops after 7 days', !/7 days/.test(refunds) && /any time before a session starts/i.test(refunds) && /Waiting for a tutor/.test(refunds));
check('the Terms no longer say 7 days to cancel yourself', !/For 7 days after you send a request/.test(terms) && /Until a session starts, you can cancel it yourself/.test(terms));

if (failed > 0) {
  console.log(`${failed} FAILED`);
  process.exitCode = 1;
} else {
  console.log('all ok');
}
