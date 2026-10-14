// Checks for master item 7cy: the "successful session" numbers (admin/src/lib/sessionOutcomes.ts).
// Run: npx tsx scripts/dev/session-outcomes-test.ts
// A successful session = completed + rated 4 or more + the same learner and tutor booked again within 14 days.
import fs from 'node:fs';
import { computeSessionOutcomes, REBOOK_WINDOW_DAYS, type OutcomeSession, type OutcomeReview } from '../../admin/src/lib/sessionOutcomes';

let failures = 0;
function check(name: string, ok: boolean, detail = '') {
  if (ok) console.log(`ok   ${name}`);
  else {
    failures++;
    console.log(`FAIL ${name}${detail ? `  (${detail})` : ''}`);
  }
}

const NOW = new Date('2026-10-14T12:00:00Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();

let n = 0;
function session(p: Partial<OutcomeSession> & { student_id: string; tutor_id: string }): OutcomeSession {
  n++;
  const created = p.created_at ?? daysAgo(40);
  return {
    id: p.id ?? `s${n}`,
    student_id: p.student_id,
    tutor_id: p.tutor_id,
    status: p.status ?? 'completed',
    created_at: created,
    scheduled_start: p.scheduled_start ?? created,
    completed_at: p.completed_at === undefined ? (p.status && p.status !== 'completed' ? null : created) : p.completed_at,
    duration_hours: p.duration_hours ?? 1,
  };
}
const review = (session_id: string, rating: number | string): OutcomeReview => ({ session_id, rating });

check('the window is 14 days', REBOOK_WINDOW_DAYS === 14);

// ---- nothing at all --------------------------------------------------------------------------------------------------
{
  const o = computeSessionOutcomes([], [], NOW);
  check('empty: no completed sessions, no rate', o.completedSessions === 0 && o.successRatePct === null && o.decidedSessions === 0);
  check('empty: no leakage, no hours', o.leakageSignals === 0 && o.hoursBookedLast28Days === 0 && o.tutorsWorkedLast28Days === 0);
}

// ---- the definition ----------------------------------------------------------------------------------------------------
{
  // A: completed 30 days ago, rated 5, booked again 20 days ago (10 days after completion) -> SUCCESS, decided
  const a1 = session({ id: 'a1', student_id: 'LA', tutor_id: 'TA', created_at: daysAgo(31), completed_at: daysAgo(30) });
  const a2 = session({ id: 'a2', student_id: 'LA', tutor_id: 'TA', status: 'scheduled', created_at: daysAgo(20), scheduled_start: daysAgo(-5) });
  const o = computeSessionOutcomes([a1, a2], [review('a1', 5)], NOW);
  check('A: completed, rated 5, rebooked in 10 days -> successful', o.successfulSessions === 1 && o.successfulDecided === 1);
  check('A: it is decided (window closed) and the rate is 100%', o.decidedSessions === 1 && o.successRatePct === 100);
  check('A: the pair counts as booked again', o.pairsBookedAgain === 1 && o.pairsWithACompletedSession === 1);
}
{
  // B: rated 3 and rebooked -> NOT successful (a rating under 4 is not a success)
  const b1 = session({ id: 'b1', student_id: 'LB', tutor_id: 'TB', created_at: daysAgo(31), completed_at: daysAgo(30) });
  const b2 = session({ id: 'b2', student_id: 'LB', tutor_id: 'TB', status: 'scheduled', created_at: daysAgo(25) });
  const o = computeSessionOutcomes([b1, b2], [review('b1', 3)], NOW);
  check('B: rated 3 even though rebooked -> not successful', o.successfulSessions === 0 && o.ratedSessions === 1 && o.ratedFourPlus === 0);
  check('B: still decided (and counts against the rate)', o.decidedSessions === 1 && o.successRatePct === 0);
}
{
  // C: rated 5, never booked again, window closed -> NOT successful, decided
  const c1 = session({ id: 'c1', student_id: 'LC', tutor_id: 'TC', created_at: daysAgo(31), completed_at: daysAgo(30) });
  const o = computeSessionOutcomes([c1], [review('c1', 5)], NOW);
  check('C: rated 5 but not rebooked, window closed -> not successful', o.successfulSessions === 0 && o.decidedSessions === 1);
  check('C: a good session that was not rebooked is counted as such', o.ratedFourPlus === 1);
}
{
  // D: rated 5, completed 3 days ago, not rebooked yet -> too early to tell
  const d1 = session({ id: 'd1', student_id: 'LD', tutor_id: 'TD', created_at: daysAgo(4), completed_at: daysAgo(3) });
  const o = computeSessionOutcomes([d1], [review('d1', 5)], NOW);
  check('D: completed 3 days ago, not yet rebooked -> still open, not decided', o.stillOpenSessions === 1 && o.decidedSessions === 0 && o.successRatePct === null);
}
{
  // E: completed 3 days ago and already rebooked, rated 5 -> successful already, but NOT in the decided denominator
  const e1 = session({ id: 'e1', student_id: 'LE', tutor_id: 'TE', created_at: daysAgo(4), completed_at: daysAgo(3) });
  const e2 = session({ id: 'e2', student_id: 'LE', tutor_id: 'TE', status: 'scheduled', created_at: daysAgo(2) });
  const o = computeSessionOutcomes([e1, e2], [review('e1', 5)], NOW);
  check('E: rebooked early -> successful', o.successfulSessions === 1);
  check('E: but not yet decided, so the rate stays empty and it is not "still open"', o.decidedSessions === 0 && o.successfulDecided === 0 && o.stillOpenSessions === 0);
}
{
  // F: the second booking came 20 days after completion -> too late
  const f1 = session({ id: 'f1', student_id: 'LF', tutor_id: 'TF', created_at: daysAgo(41), completed_at: daysAgo(40) });
  const f2 = session({ id: 'f2', student_id: 'LF', tutor_id: 'TF', status: 'scheduled', created_at: daysAgo(20) });
  const o = computeSessionOutcomes([f1, f2], [review('f1', 5)], NOW);
  check('F: rebooked 20 days after completion -> not successful', o.successfulSessions === 0 && o.decidedSessions === 1);
  check('F: it is still a pair booked again (counts all bookings)', o.pairsBookedAgain === 1);
}
{
  // G: the second session was cancelled -> does not count as rebooked
  const g1 = session({ id: 'g1', student_id: 'LG', tutor_id: 'TG', created_at: daysAgo(31), completed_at: daysAgo(30) });
  const g2 = session({ id: 'g2', student_id: 'LG', tutor_id: 'TG', status: 'cancelled_by_student', created_at: daysAgo(25) });
  const o = computeSessionOutcomes([g1, g2], [review('g1', 5)], NOW);
  check('G: a cancelled second booking does not count', o.successfulSessions === 0 && o.pairsBookedAgain === 0);
}
{
  // H: a different tutor is not the same pair
  const h1 = session({ id: 'h1', student_id: 'LH', tutor_id: 'TH1', created_at: daysAgo(31), completed_at: daysAgo(30) });
  const h2 = session({ id: 'h2', student_id: 'LH', tutor_id: 'TH2', status: 'scheduled', created_at: daysAgo(25) });
  const o = computeSessionOutcomes([h1, h2], [review('h1', 5)], NOW);
  check('H: booking a different tutor is not a rebooking', o.successfulSessions === 0 && o.pairsBookedAgain === 0);
}
{
  // I: no rating at all -> not successful even if rebooked
  const i1 = session({ id: 'i1', student_id: 'LI', tutor_id: 'TI', created_at: daysAgo(31), completed_at: daysAgo(30) });
  const i2 = session({ id: 'i2', student_id: 'LI', tutor_id: 'TI', status: 'scheduled', created_at: daysAgo(25) });
  const o = computeSessionOutcomes([i1, i2], [], NOW);
  check('I: unrated -> not successful, not counted as rated', o.successfulSessions === 0 && o.ratedSessions === 0);
}
{
  // J: ratings arrive as strings from the database; an exact 4 counts
  const j1 = session({ id: 'j1', student_id: 'LJ', tutor_id: 'TJ', created_at: daysAgo(31), completed_at: daysAgo(30) });
  const j2 = session({ id: 'j2', student_id: 'LJ', tutor_id: 'TJ', status: 'scheduled', created_at: daysAgo(25) });
  const o = computeSessionOutcomes([j1, j2], [review('j1', '4')], NOW);
  check('J: a rating of exactly 4 (as text) counts', o.successfulSessions === 1 && o.ratedFourPlus === 1);
}
{
  // K: a scheduled session that never completed is not "completed"
  const k1 = session({ id: 'k1', student_id: 'LK', tutor_id: 'TK', status: 'scheduled', created_at: daysAgo(5) });
  const o = computeSessionOutcomes([k1], [review('k1', 5)], NOW);
  check('K: a booked, uncompleted session is not counted as completed or successful', o.completedSessions === 0 && o.successfulSessions === 0);
}

{
  // L: only a LATER booking is a rebooking. s0 is booked first and completed; s1 is booked 5 days after s0 completed.
  // s0 is successful (s1 followed it). s1 is NOT successful just because s0 exists: s0 came before it.
  const s0 = session({ id: 'l0', student_id: 'LL', tutor_id: 'TL', created_at: daysAgo(60), completed_at: daysAgo(50) });
  const s1 = session({ id: 'l1', student_id: 'LL', tutor_id: 'TL', created_at: daysAgo(45), completed_at: daysAgo(44) });
  const o = computeSessionOutcomes([s0, s1], [review('l0', 5), review('l1', 5)], NOW);
  check('L: an earlier booking does not make a later session look rebooked', o.successfulSessions === 1 && o.decidedSessions === 2 && o.successRatePct === 50, `got ${o.successfulSessions}/${o.decidedSessions}`);
}

// ---- the rate, with several sessions ----------------------------------------------------------------------------------------
{
  const s: OutcomeSession[] = [];
  const r: OutcomeReview[] = [];
  // 3 decided sessions, 1 successful -> 33%
  for (const k of ['m1', 'm2', 'm3']) s.push(session({ id: k, student_id: `L${k}`, tutor_id: `T${k}`, created_at: daysAgo(31), completed_at: daysAgo(30) }));
  r.push(review('m1', 5), review('m2', 5), review('m3', 2));
  s.push(session({ id: 'm1b', student_id: 'Lm1', tutor_id: 'Tm1', status: 'scheduled', created_at: daysAgo(28) }));
  const o = computeSessionOutcomes(s, r, NOW);
  check('rate: 1 successful of 3 decided = 33%', o.decidedSessions === 3 && o.successfulDecided === 1 && o.successRatePct === 33);
}

// ---- leakage signal ----------------------------------------------------------------------------------------------------------
{
  // L1 finished with T1 thirty days ago and never booked again; T1 then taught someone else -> a signal
  const l1 = session({ id: 'x1', student_id: 'LX1', tutor_id: 'TX1', created_at: daysAgo(31), completed_at: daysAgo(30) });
  const t1Other = session({ id: 'x2', student_id: 'LX9', tutor_id: 'TX1', status: 'scheduled', created_at: daysAgo(10) });
  // L2 finished with T2 and stopped; T2 has nobody else after -> no signal (the tutor stopped too)
  const l2 = session({ id: 'y1', student_id: 'LY1', tutor_id: 'TY1', created_at: daysAgo(31), completed_at: daysAgo(30) });
  // L3 finished with T3 two days ago and the tutor kept working -> window not closed: no signal
  const l3 = session({ id: 'z1', student_id: 'LZ1', tutor_id: 'TZ1', created_at: daysAgo(3), completed_at: daysAgo(2) });
  const t3Other = session({ id: 'z2', student_id: 'LZ9', tutor_id: 'TZ1', status: 'scheduled', created_at: daysAgo(1) });
  // L4 stopped with T4, T4 kept working, but L4 booked someone else lately -> still a customer: no signal
  const l4 = session({ id: 'w1', student_id: 'LW1', tutor_id: 'TW1', created_at: daysAgo(31), completed_at: daysAgo(30) });
  const t4Other = session({ id: 'w2', student_id: 'LW9', tutor_id: 'TW1', status: 'scheduled', created_at: daysAgo(10) });
  const l4New = session({ id: 'w3', student_id: 'LW1', tutor_id: 'TW2', status: 'scheduled', created_at: daysAgo(2) });
  const o = computeSessionOutcomes([l1, t1Other, l2, l3, t3Other, l4, t4Other, l4New], [], NOW);
  check('leakage: exactly one learner (stopped, tutor kept working)', o.leakageSignals === 1, `got ${o.leakageSignals}`);
}

// ---- hours and tutors in the last 28 days ------------------------------------------------------------------------------------
{
  const a = session({ id: 'h-a', student_id: 'L1', tutor_id: 'T1', status: 'completed', created_at: daysAgo(20), scheduled_start: daysAgo(10), completed_at: daysAgo(10), duration_hours: 1.5 });
  const b = session({ id: 'h-b', student_id: 'L2', tutor_id: 'T2', status: 'completed', created_at: daysAgo(20), scheduled_start: daysAgo(27), completed_at: daysAgo(27), duration_hours: '1' });
  const old = session({ id: 'h-c', student_id: 'L3', tutor_id: 'T3', status: 'completed', created_at: daysAgo(50), scheduled_start: daysAgo(40), completed_at: daysAgo(40), duration_hours: 2 });
  const cancelled = session({ id: 'h-d', student_id: 'L4', tutor_id: 'T4', status: 'cancelled_by_tutor', created_at: daysAgo(10), scheduled_start: daysAgo(5), duration_hours: 3 });
  const future = session({ id: 'h-e', student_id: 'L5', tutor_id: 'T5', status: 'scheduled', created_at: daysAgo(2), scheduled_start: daysAgo(-3), duration_hours: 1 });
  const o = computeSessionOutcomes([a, b, old, cancelled, future], [], NOW);
  check('hours: counts 1.5 + 1 (text) in the window, not the old, cancelled or future ones', o.hoursBookedLast28Days === 2.5, `got ${o.hoursBookedLast28Days}`);
  check('tutors: the two who worked in the window', o.tutorsWorkedLast28Days === 2);
}

// ---- wiring: the page and the query read this module, and nothing here can write ---------------------------------------------
{
  const root = new URL('../../', import.meta.url);
  const read = (p: string) => fs.readFileSync(new URL(p, root), 'utf8');
  const lib = read('admin/src/lib/sessionOutcomes.ts');
  const queries = read('admin/src/lib/queries.ts');
  const page = read('admin/src/pages/Phase1Numbers.tsx');
  check('the library imports nothing (pure)', !/^import /m.test(lib));
  check('the library never writes (no insert, update, delete, upsert, rpc)', !/\.(insert|update|delete|upsert|rpc)\(/.test(lib));
  check('queries.ts has fetchSessionOutcomes, which only selects', /export async function fetchSessionOutcomes/.test(queries) && !/fetchSessionOutcomes[\s\S]{0,1800}\.(insert|update|delete|upsert)\(/.test(queries));
  check('the page shows the successful-session numbers', /Successful sessions/.test(page) && /successRatePct/.test(page));
  check('a failed outcomes query cannot blank the rest of the page (it is loaded separately)', /fetchSessionOutcomes\(\)\s*\n?\s*\.then/.test(page) || /fetchSessionOutcomes\(\)\.then/.test(page));
}

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
