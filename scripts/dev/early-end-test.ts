// A session that ends early (CEO, 15 Nov 2026): the state logic the screens follow, and a read of the migration for the rules the database must keep.
// Run: npx tsx scripts/dev/early-end-test.ts   (the database half is supabase/tests/session_early_end.sql, rolled back)
import { readFileSync } from 'node:fs';
import { EARLY_END_GRACE_MS, showEarlyEndCheckIn, showTutorEarlyEnd, tutorEarlyEndMessage } from '../../src/lib/earlyEnd';

let failed = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) failed += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && detail ? ` [${detail}]` : ''}`);
}

// A one-hour session 12 Nov 2026 12:00 UTC (14:00 SAST), ending 13:00 UTC (15:00 SAST).
const base = { status: 'scheduled', scheduledStart: '2026-11-12T12:00:00Z', durationHours: 1 };
const at = (iso: string) => new Date(iso).getTime();
const left = '2026-11-12T12:20:00Z';
const live = { ...base, endedEarlyAt: left };

check('learner: asked once the grace has passed', showEarlyEndCheckIn(live, at('2026-11-12T12:25:00Z')));
check('learner: not asked while the tutor may only be reloading', !showEarlyEndCheckIn(live, at(left) + EARLY_END_GRACE_MS - 1));
check('learner: asked exactly at the end of the grace', showEarlyEndCheckIn(live, at(left) + EARLY_END_GRACE_MS));
check('learner: not asked after the answer', !showEarlyEndCheckIn({ ...live, earlyEndAckAt: '2026-11-12T12:26:00Z' }, at('2026-11-12T12:30:00Z')));
check('learner: not asked at or after the scheduled end', !showEarlyEndCheckIn(live, at('2026-11-12T13:00:00Z')));
check('learner: not asked when the session did not end early', !showEarlyEndCheckIn(base, at('2026-11-12T12:25:00Z')));
check('learner: not asked once completed or cancelled', !showEarlyEndCheckIn({ ...live, status: 'completed' }, at('2026-11-12T12:25:00Z')) && !showEarlyEndCheckIn({ ...live, status: 'cancelled_by_tutor' }, at('2026-11-12T12:25:00Z')));
check('tutor: told straight away', showTutorEarlyEnd(live, at(left) + 1_000));
check('tutor: told until the scheduled end only', showTutorEarlyEnd(live, at('2026-11-12T12:59:59Z')) && !showTutorEarlyEnd(live, at('2026-11-12T13:00:00Z')));
check('tutor: the answer from the learner does not hide it', showTutorEarlyEnd({ ...live, earlyEndAckAt: '2026-11-12T12:26:00Z' }, at('2026-11-12T12:30:00Z')));
check('tutor: not told when the session did not end early', !showTutorEarlyEnd(base, at('2026-11-12T12:25:00Z')));
const msg = tutorEarlyEndMessage(base, at('2026-11-12T12:25:00Z'));
check('tutor message, same day, in SAST', msg === 'You ended the session early. You can mark it complete from 15:00 SAST.', msg);
const msg2 = tutorEarlyEndMessage(base, at('2026-11-12T12:25:00Z') - 86_400_000);
check('tutor message, another day, names the day', msg2 === 'You ended the session early. You can mark it complete from Thu 12 Nov, 15:00 SAST.', msg2);

// The database rules, read from the migration (code lines only).
const mig = readFileSync('supabase/migrations/20261115140000_session_early_end.sql', 'utf8').split(/\r?\n/).filter((l) => !/^\s*--/.test(l)).join('\n');
const start = mig.indexOf('function public.complete_session');
const completeBody = mig.slice(start, mig.indexOf('$$;', start + 60));
check('complete_session still refuses before the scheduled end and says the early-end sentence', /if now\(\) < v_end then/.test(mig) && /You ended the session early\. You can mark it complete from/.test(mig));
check('complete_session still demands the session\'s own tutor and a scheduled session', /Only this session''s tutor can mark it complete/.test(mig) && /v_session\.status <> 'scheduled'/.test(mig));
check('the early-end mark needs the tutor and another admitted person, before the end, on a scheduled session', /new\.profile_id is distinct from v_tutor/.test(mig) && /om\.admitted_at is not null/.test(mig) && /now\(\) < v_end/.test(mig) && /se\.status = 'scheduled'/.test(mig));
check('the tutor coming back clears the mark', /new\.status = 'admitted'/.test(mig) && /set ended_early_at = null/.test(mig));
check('only the learner or whoever booked can answer; signed-out refused', /auth\.uid\(\) not in \(v\.student_id/.test(mig) && /revoke all on function public\.acknowledge_early_end\(uuid\) from public, anon/.test(mig));
check('the trigger and the job are not callable by clients', /revoke all on function public\.fn_mark_early_end\(\) from public, anon, authenticated/.test(mig) && /revoke all on function public\.notify_early_end_checkins\(\) from public, anon, authenticated/.test(mig));
check('no money or auto-complete function is replaced', !/function public\.(auto_complete_sessions|wallet_credit_tutor)/.test(mig) && !/wallet|payout|ledger/i.test(completeBody));
check('the bell job runs every two minutes and sends once', /\*\/2 \* \* \* \*/.test(mig) && /early_end_notified_at is null/.test(mig));

if (failed) {
  console.log(`\n${failed} FAILED`);
  process.exit(1);
}
console.log('\nall early-end checks passed');
