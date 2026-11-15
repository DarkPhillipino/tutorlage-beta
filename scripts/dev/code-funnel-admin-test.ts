// Checks on the CODES FUNNEL (R12) and the TUTOR ACTIVATION list (R13) on the admin Codes page, 11 Nov 2026. Run: npx tsx scripts/dev/code-funnel-admin-test.ts
// Proves, with a fake database client and by reading the source: the numbers are read with ONE call each to the audited, read-only functions; a database without the
// migration is "not available" (one plain line, never a crash); the answers become whole numbers and dates only; the range is checked in South African days before
// anything is asked (a start after the end, more than a year, a bad date); the opens columns show a dash while the counter is not live and "link not opened yet" is
// only said when it is live; the day-by-day rows add up across codes and filter to one code; the tutor list says what is missing next and never guesses an approval date;
// no email, phone number or family name can be in either answer's shape; the screens render, and the source has no direct table read or write.
// It does NOT prove the database behaviour (supabase/tests/code_funnel.sql, rolled back) or the screens in a real browser.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import {
  ACTIVATION_NOT_AVAILABLE, FUNNEL_LIMITS, FUNNEL_NOT_AVAILABLE, KIND_WORDS, NEXT_STEP_WORDS, addDays, approvalWords, count, dayByDay, daysBetween, fetchCodeFunnel, fetchTutorActivation,
  hasActivity, linkState, parseActivation, parseFunnel, percentOf, presetRange, rangeLabel, rangeProblem, sastToday, stageWords, type ActivationTutor,
} from '../../admin/src/lib/codeFunnel';
import type { PromoAdminClient } from '../../admin/src/lib/promoCodes';
import { CodeNumbersBody } from '../../admin/src/components/CodeNumbersBody';
import { TutorActivationBody } from '../../admin/src/components/TutorActivationBody';
import { PromoCodesBody } from '../../admin/src/components/PromoCodesBody';

const adminRequire = createRequire(new URL('../../admin/package.json', import.meta.url));
const React = adminRequire('react') as typeof import('react');
const render = (adminRequire('react-dom/server') as typeof import('react-dom/server')).renderToStaticMarkup;

let failed = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) failed += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && detail ? ` [${detail}]` : ''}`);
}
const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

type Answer = { data: unknown; error: { code?: string; message?: string } | null };
function fake(answer: (fn: string, args?: Record<string, unknown>) => Answer): { db: PromoAdminClient; calls: { fn: string; args?: Record<string, unknown> }[] } {
  const calls: { fn: string; args?: Record<string, unknown> }[] = [];
  return { calls, db: { rpc: async (fn, args) => { calls.push({ fn, args }); return answer(fn, args); } } };
}

const funnelJson = {
  from: '2026-11-01', to: '2026-11-11', opens_counter: 'live', bonus_on: false,
  codes: [
    { code_id: 'a', code: 'ZZFUNA', label: 'A', active: true, owner_tutor_id: null, referring_tutor_id: null, created_at: '2026-11-01T00:00:00Z', opens_ever: 4, k: { open: 3, visitor: 2, signup: 2, book_1: 1, rand_booked: 28, rand_given: 28 } },
    { code_id: 'b', code: 'ZZFUNB', label: '', active: true, owner_tutor_id: 't1', referring_tutor_id: null, created_at: '2026-11-02T00:00:00Z', opens_ever: 0, k: {} },
    { code_id: 'c', code: 'ZZPAUSED', label: '', active: false, owner_tutor_id: null, referring_tutor_id: null, created_at: '2026-11-03T00:00:00Z', opens_ever: 0, k: {} },
  ],
  totals: { open: 3, visitor: 2, signup: 2, book_1: 1, rand_booked: 28, rand_given: 28 },
  days: [
    { day: '2026-11-10', code_id: 'a', code: 'ZZFUNA', k: { open: 1, signup: 1 } },
    { day: '2026-11-11', code_id: 'a', code: 'ZZFUNA', k: { open: 2, signup: 1, book_1: 1 } },
    { day: '2026-11-11', code_id: 'b', code: 'ZZFUNB', k: { open: 1 } },
  ],
  baseline: { with_code: 2, without_code: 6 },
  baseline_days: [{ day: '2026-11-10', with_code: 1, without_code: 3 }, { day: '2026-11-11', with_code: 1, without_code: 3 }],
};
const tutorJson = (over: Record<string, unknown> = {}) => ({
  tutor_id: 't1', name: 'Zzquo Tutor', level: '2C', approved_at: '2026-10-20T10:00:00Z', approval_known: true, code: 'ZZQUO', code_active: true, opens: 1, visitors: 1, signups: 1, family_lessons: 1,
  has_subjects: false, has_hours: false, hours_saved_at: null, first_request_seen_at: null, onboarding_completed_at: null, accepted: 0, first_accepted_at: null, completed: 0, bonus_rand: 0,
  next_step: 'subjects', quiet: true, ...over,
});
const activationJson = {
  quiet_days: 7, opens_counter: 'live',
  totals: { verified: 3, quiet: 2, with_subjects: 1, with_hours: 1, saw_a_request: 1, accepted_one: 1, completed_one: 1, approval_unknown: 1 },
  tutors: [
    tutorJson(),
    tutorJson({ tutor_id: 't2', name: 'Zznone', approved_at: null, approval_known: false, code: null, code_active: false, opens: 0, visitors: 0, signups: 0, family_lessons: 0, next_step: 'subjects', quiet: true }),
    tutorJson({ tutor_id: 't3', name: 'Zzteach', approved_at: '2026-11-09T10:00:00Z', has_subjects: true, has_hours: true, first_request_seen_at: '2026-11-10T08:00:00Z', accepted: 6, completed: 3, bonus_rand: 14, next_step: null, quiet: false }),
  ],
};

async function main() {
  // ---- reading the funnel ----
  const ok = fake(() => ({ data: funnelJson, error: null }));
  const got = await fetchCodeFunnel(ok.db, '2026-11-01', '2026-11-11');
  check('the numbers are read in ONE call to the audited funnel function, with the two days', ok.calls.length === 1 && ok.calls[0].fn === 'admin_code_funnel' && ok.calls[0].args?.p_from === '2026-11-01' && ok.calls[0].args?.p_to === '2026-11-11' && got.status === 'ready');
  const data = got.status === 'ready' ? got.data : null;
  check('every figure arrives as a whole number and a missing kind means none', data?.codes[0].k.open === 3 && count(data!.codes[0].k, 'signup') === 2 && count(data!.codes[0].k, 'book_4') === 0 && data?.totals.rand_given === 28 && data?.baseline.withoutCode === 6);
  check('the counter state and the bonus switch come through', data?.opensCounter === 'live' && data?.bonusOn === false && parseFunnel({ ...funnelJson, opens_counter: 'weird' })?.opensCounter === 'not_live');
  check('a database without the migration is "not available", never an error: PostgREST code, Postgres code or the words',
    (await Promise.all([
      fetchCodeFunnel(fake(() => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.admin_code_funnel' } })).db, null, null),
      fetchCodeFunnel(fake(() => ({ data: null, error: { code: '42883', message: 'function admin_code_funnel(date, date) does not exist' } })).db, null, null),
    ])).every((r) => r.status === 'not_available') && /not been applied/.test(FUNNEL_NOT_AVAILABLE) && /as soon as it is/.test(FUNNEL_NOT_AVAILABLE) && /not been applied/.test(ACTIVATION_NOT_AVAILABLE));
  check('someone the database refuses is told so; any other failure is an error with its words; a thrown error does not crash',
    (await fetchCodeFunnel(fake(() => ({ data: null, error: { code: '42501', message: 'Finance admins only' } })).db, null, null)).status === 'forbidden'
    && (await fetchCodeFunnel(fake(() => ({ data: null, error: { code: 'XX000', message: 'boom' } })).db, null, null)).status === 'error'
    && (await fetchCodeFunnel({ rpc: async () => { throw new Error('offline'); } }, null, null)).status === 'error'
    && (await fetchCodeFunnel(fake(() => ({ data: { nothing: true }, error: null })).db, null, null)).status === 'error');
  check('an odd answer is refused or skipped row by row', parseFunnel(null) === null && parseFunnel('x') === null && parseFunnel({ ...funnelJson, codes: [null, 5, { code: 'x' }, funnelJson.codes[0]], days: [null, { day: 'x' }] })?.codes.length === 1);

  // ---- the range, in South African days ----
  check('presets are South African days ending today: today, 7, 30 and 90 days', (() => { const r = presetRange('7', '2026-11-11'); const t = presetRange('today', '2026-11-11'); const n = presetRange('90', '2026-11-11'); return r.from === '2026-11-05' && r.to === '2026-11-11' && t.from === '2026-11-11' && daysBetween(n.from, n.to) === 89; })());
  check('"today" is the South African day, even when it is still yesterday in UTC', sastToday(new Date('2026-11-10T22:30:00Z')) === '2026-11-11' && sastToday(new Date('2026-11-11T21:59:00Z')) === '2026-11-11' && sastToday(new Date('2026-11-11T22:00:00Z')) === '2026-11-12');
  check('adding days crosses month ends', addDays('2026-11-30', 1) === '2026-12-01' && addDays('2026-03-01', -1) === '2026-02-28');
  check('a bad range is refused before anything is asked: a start after the end, over a year, a bad date', rangeProblem('2026-11-11', '2026-11-10') !== null && rangeProblem('2025-01-01', '2026-11-10') !== null && rangeProblem('11 Nov', '2026-11-12') !== null && rangeProblem('2026-11-01', '2026-11-11') === null && rangeProblem('2026-11-11', '2026-11-11') === null);
  check('a range is told in words', rangeLabel('2026-11-11', '2026-11-11') === '2026-11-11' && rangeLabel('2026-11-01', '2026-11-11') === '2026-11-01 to 2026-11-11');

  // ---- what the page decides from the numbers ----
  check('"link not opened yet" is only said when the counter is live, the code is active and nobody ever opened it; before that it says "not counted"',
    linkState({ opensEver: 0, active: true }, 'live') === 'not_opened' && linkState({ opensEver: 4, active: true }, 'live') === 'ok' && linkState({ opensEver: 0, active: false }, 'live') === 'ok' && linkState({ opensEver: 0, active: true }, 'not_live') === 'not_counted');
  check('a code with nothing in the range has no activity; one with a count has', !hasActivity({}) && !hasActivity({ open: 0 }) && hasActivity({ signup: 1 }));
  const days = dayByDay(data!, null);
  check('day by day adds the codes together, newest first, with the sign-ups that had no code', days.length === 2 && days[0].day === '2026-11-11' && days[0].k.open === 3 && days[0].k.signup === 1 && days[0].withoutCode === 3 && days[1].day === '2026-11-10');
  const dayA = dayByDay(data!, 'a');
  check('day by day for one code leaves the others out', dayA.length === 2 && dayA[0].k.open === 2 && dayByDay(data!, 'b').length === 1 && dayByDay(data!, 'b')[0].day === '2026-11-11');
  check('a share is a whole percent, and a dash when there is nothing to divide by', percentOf(2, 8) === '25%' && percentOf(0, 0) === '—');
  check('every kind the page shows has its words, and the limits are printed (daily events not a cohort, returned lessons, visitors, the baseline)',
    ['open', 'visitor', 'signup', 'funded', 'book_1', 'book_4', 'first_done', 'rand_given', 'rand_booked', 'bonus_paid', 'expired', 'returned'].every((k) => typeof KIND_WORDS[k] === 'string')
    && FUNNEL_LIMITS.some((l) => /not a follow-the-family cohort/.test(l)) && FUNNEL_LIMITS.some((l) => /returned lesson/.test(l)) && FUNNEL_LIMITS.some((l) => /baseline/.test(l)) && FUNNEL_LIMITS.some((l) => /counts as a visitor of A only/.test(l)));

  // ---- the tutor list ----
  const act = fake(() => ({ data: activationJson, error: null }));
  const list = await fetchTutorActivation(act.db, 7);
  check('the tutors are read in ONE call to the audited list function with the quiet days', act.calls.length === 1 && act.calls[0].fn === 'admin_tutor_activation' && act.calls[0].args?.p_quiet_days === 7 && list.status === 'ready');
  const ad = list.status === 'ready' ? list.data : null;
  check('the totals and each tutor arrive as numbers, booleans and text; an unknown next step is none', ad?.totals.verified === 3 && ad?.totals.quiet === 2 && ad?.tutors.length === 3 && ad?.tutors[2].completed === 3 && ad?.tutors[2].nextStep === null && ad?.tutors[0].nextStep === 'subjects'
    && parseActivation({ ...activationJson, tutors: [tutorJson({ next_step: 'whatever' })] })?.tutors[0].nextStep === null);
  check('a database without the migration says so in one line for the tutor list too', (await fetchTutorActivation(fake(() => ({ data: null, error: { code: '42883', message: 'function admin_tutor_activation(integer) does not exist' } })).db)).status === 'not_available'
    && (await fetchTutorActivation(fake(() => ({ data: null, error: { code: '42501', message: 'Finance admins only' } })).db)).status === 'forbidden');
  const T = (over: Partial<ActivationTutor>): ActivationTutor => parseActivation({ ...activationJson, tutors: [tutorJson()] })!.tutors[0] && { ...parseActivation({ ...activationJson, tutors: [tutorJson()] })!.tutors[0], ...over };
  check('where a tutor is: the next thing missing in words, or that they have taught', stageWords(T({ nextStep: 'hours' })) === NEXT_STEP_WORDS.hours && stageWords(T({ nextStep: 'accept' })) === NEXT_STEP_WORDS.accept && /taught a lesson/.test(stageWords(T({ nextStep: null }))));
  const now = new Date('2026-11-11T12:00:00Z');
  check('the approval is told in days, and an unknown approval is never guessed', approvalWords(T({ approvedAt: '2026-10-22T12:00:00Z', approvalKnown: true }), now) === 'Approved 20 days ago' && approvalWords(T({ approvedAt: '2026-11-10T11:00:00Z' }), now) === 'Approved yesterday'
    && approvalWords(T({ approvedAt: '2026-11-11T09:00:00Z' }), now) === 'Approved today' && approvalWords(T({ approvedAt: null, approvalKnown: false }), now) === 'Approval date not recorded');

  // ---- the screens ----
  const html = render(React.createElement(CodeNumbersBody, { client: ok.db }));
  check('the Numbers block renders its heading, the day buttons and starts by loading', /Numbers/.test(html) && /Last 30 days/.test(html) && /Today/.test(html) && /Loading the numbers/.test(html));
  const html2 = render(React.createElement(TutorActivationBody, { client: act.db }));
  check('the Tutors block renders its heading and the quiet choices, and starts by loading', /Tutors: who has got going/.test(html2) && /7 days/.test(html2) && /Loading the tutors/.test(html2));
  const page = render(React.createElement(PromoCodesBody, { client: ok.db, role: 'finance_manager' }));
  check('the Codes page still renders and still starts by loading (the new blocks appear once the code list is ready)', /Codes<\/h1>/.test(page) && /Loading codes/.test(page));
  const denied = render(React.createElement(PromoCodesBody, { client: ok.db, role: 'support_agent' }));
  check('a support agent who reaches the page still gets neither block', !/data-codes-numbers/.test(denied) && !/data-codes-activation/.test(denied));

  // ---- the source ----
  const lib = code('admin/src/lib/codeFunnel.ts');
  const numbers = code('admin/src/components/CodeNumbersBody.tsx');
  const tutors = code('admin/src/components/TutorActivationBody.tsx');
  check('no direct table read or write: only the two audited, read-only database functions', !/\.from\(/.test(lib + numbers + tutors) && !/\.insert\(|\.update\(|\.delete\(|\.upsert\(/.test(lib + numbers + tutors) && /admin_code_funnel/.test(lib) && /admin_tutor_activation/.test(lib));
  check('nothing in either shape can carry a family name, e-mail address or phone number', !/email|phone|full_name|parent_name|family_name/i.test(lib + numbers + tutors.replace(/the tutor's own page/g, '')));
  check('the wording never says "free sessions" and never names the school or campus', !/free (session|lesson)/i.test(lib + numbers + tutors) && !/waterfall|campus|faculty/i.test(lib + numbers + tutors));
  const body = code('admin/src/components/PromoCodesBody.tsx');
  check('the Codes page shows the Numbers block only once the code list is ready, and the Tutors block after the tutor-code box', /result\?\.status === 'ready' && <CodeNumbersBody/.test(body) && /<TutorCodeBox[^>]*\/>\}\s*\n\s*\n\s*\{result\?\.status === 'ready' && <TutorActivationBody/.test(body));

  console.log(failed === 0 ? '\nAll checks passed.' : `\n${failed} check(s) FAILED.`);
  if (failed > 0) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
