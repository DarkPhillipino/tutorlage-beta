// P5-b (CEO, 21 Nov 2026): the learner is told WHY no tutor is shown. Checks on the call, the reading of the database's answer, the three messages'
// words and the page wiring. Run: npx tsx scripts/dev/no-tutor-reason-test.ts   (the database function is proved in supabase/tests/no_tutor_reason.sql)
import fs from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NoTutorMessage } from '../../src/components/NoTutorMessage';
import {
  ALL_FULLY_BOOKED,
  CHANGE_YOUR_TIME,
  NOT_A_PROMISE,
  NO_TUTOR_FOR_SUBJECT,
  askNoTutorReason,
  formatWindow,
  parseNoTutorReason,
  type NoTutorRpc,
} from '../../src/lib/noTutorReason';

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
};
const root = new URL('../../', import.meta.url);
const read = (p: string) => fs.readFileSync(new URL(p, root), 'utf8');

async function main() {
  // ---- the words (the CEO's, exactly) --------------------------------------------------------------------------------------------------
  check('case 1 words', NO_TUTOR_FOR_SUBJECT === 'No tutor available for this subject.');
  check('case 2 words', ALL_FULLY_BOOKED === "They're all fully booked at the moment.");
  check('case 3 words', CHANGE_YOUR_TIME === 'No tutor is available at the time or date you chose. Please change your time to one of the following time frames:');
  check('it says plainly that it is information, not a promise', /not a promise/.test(NOT_A_PROMISE));

  // ---- reading the database's answer ---------------------------------------------------------------------------------------------------
  const six = Array.from({ length: 6 }, (_, i) => ({ date: '2026-11-2' + i, from: '09:00', end_date: '2026-11-2' + i, to: '11:00', place: 'online' }));
  const parsed = parseNoTutorReason({ case: 'other_time', windows: six });
  check('at most 5 time frames are kept', parsed?.windows.length === 5);
  check('a window is read in full', parsed?.windows[0].date === '2026-11-20' && parsed.windows[0].from === '09:00' && parsed.windows[0].to === '11:00' && parsed.windows[0].place === 'online');
  check('no answer, a wrong shape and an unknown case are all "no answer" (the page keeps its old words)', parseNoTutorReason(null) === null && parseNoTutorReason('x') === null && parseNoTutorReason({ case: 'banana' }) === null && parseNoTutorReason({}) === null);
  check('a window without its times is dropped', parseNoTutorReason({ case: 'other_time', windows: [{ date: '2026-11-23' }] })?.windows.length === 0);
  check('no_subject and fully_booked carry no windows', parseNoTutorReason({ case: 'no_subject', windows: [] })?.kind === 'no_subject' && parseNoTutorReason({ case: 'fully_booked', windows: [] })?.windows.length === 0);

  // ---- how a time frame reads ----------------------------------------------------------------------------------------------------------
  const w = { date: '2026-11-24', from: '10:00', endDate: '2026-11-24', to: '16:00', place: 'online' };
  check('a time frame reads with the weekday, date, from and to in SAST, and the place', formatWindow(w) === 'Tue 24 Nov, 10:00 to 16:00 SAST, online', formatWindow(w));
  check('a frame that runs past midnight says so', formatWindow({ ...w, from: '22:00', to: '02:00', endDate: '2026-11-25' }) === 'Tue 24 Nov, 22:00 to 02:00 the next day SAST, online');

  // ---- the call --------------------------------------------------------------------------------------------------------------------------
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const answering = (data: unknown, error: unknown = null): NoTutorRpc => (fn, args) => {
    calls.push({ fn, args });
    return Promise.resolve({ data, error });
  };
  const got = await askNoTutorReason(answering({ case: 'fully_booked', windows: [] }), { subject: 'Maths', gradeLevel: 'Grade 10', start: '2026-11-24T08:00:00Z', hours: 1.5 });
  check('it calls the one read-only function with the subject, grade, start and length', calls[0].fn === 'no_tutor_reason' && calls[0].args.p_subject === 'Maths' && calls[0].args.p_grade === 'Grade 10' && calls[0].args.p_start === '2026-11-24T08:00:00Z' && calls[0].args.p_hours === 1.5 && !('p_min_sub_tier' in calls[0].args));
  check('and returns the reason', got?.kind === 'fully_booked');
  await askNoTutorReason(answering({ case: 'ok', windows: [] }), { subject: 'Maths', gradeLevel: '', start: null, hours: null, minSubTierId: '2C' });
  check('a chosen level is sent as the floor', calls[1].args.p_min_sub_tier === '2C');
  const missing = await askNoTutorReason(answering(null, { code: 'PGRST202', message: 'Could not find the function public.no_tutor_reason' }), { subject: 'Maths', gradeLevel: '', start: null, hours: null });
  check('a missing function (migration not applied yet) is "no answer", not an error', missing === null);
  let threw = false;
  try {
    await askNoTutorReason(answering(null, { code: '57014', message: 'timeout' }), { subject: 'Maths', gradeLevel: '', start: null, hours: null });
  } catch {
    threw = true;
  }
  check('any other error is raised, so the page can fall back to its old words', threw);

  // ---- what is shown ---------------------------------------------------------------------------------------------------------------------
  const one = renderToStaticMarkup(React.createElement(NoTutorMessage, { reason: { kind: 'no_subject', windows: [] } }));
  check('case 1 is in red WITH an icon and the words (colour is not the only signal)', /text-red-700/.test(one) && /<svg/.test(one) && one.includes(NO_TUTOR_FOR_SUBJECT));
  const two = renderToStaticMarkup(React.createElement(NoTutorMessage, { reason: { kind: 'fully_booked', windows: [] } }));
  check('case 2 shows its sentence and no time frames', two.includes("They&#x27;re all fully booked at the moment.") && !/<li/.test(two));
  const three = renderToStaticMarkup(React.createElement(NoTutorMessage, { reason: { kind: 'other_time', windows: [w, { ...w, date: '2026-11-25', endDate: '2026-11-25', from: '12:00', to: '15:00' }] } }));
  check('case 3 shows the sentence, each frame in SAST with the place, and says it is not a promise', three.includes(CHANGE_YOUR_TIME) && three.includes('Tue 24 Nov, 10:00 to 16:00 SAST, online') && three.includes('Wed 25 Nov, 12:00 to 15:00 SAST, online') && three.includes(NOT_A_PROMISE));
  check('the frames are a list, soonest first (the database orders them)', (three.match(/<li/g) ?? []).length === 2 && three.indexOf('Tue 24 Nov') < three.indexOf('Wed 25 Nov'));
  check('no tutor name, number of tutors or profile can appear: the component only receives dates and times', !/tutor[s]? (available|can)/i.test(two) && !/\d+ tutors?/i.test(three));

  // ---- the page ---------------------------------------------------------------------------------------------------------------------------
  const page = read('src/components/PricesPage.tsx');
  check('the prices page asks the database why when the count is empty', /fetchNoTutorReason/.test(page) && /<NoTutorMessage reason=\{counts\.reason\}/.test(page));
  check('and keeps its old words when the database cannot answer (function missing or call failing)', /noTutorsMessage/.test(page) && /NO_TUTOR_FREE_TITLE/.test(page) && /fetchAvailablePriceLevels\(search\)/.test(page));
  check('the waiting-list offer is still made when nobody teaches the subject, and not when tutors are only busy', /!noTutorFreeAtThatTime && FEATURES\.tutorWaitlist/.test(page));
  const sql = read('supabase/migrations/20261121200000_no_tutor_reason.sql');
  check('the function is read-only and closed to signed-out callers', /\bstable\b/.test(sql) && /revoke all on function public\.no_tutor_reason\(text, text, timestamptz, numeric, text\) from public, anon;/.test(sql) && !/\b(insert into|update public|delete from)\b/i.test(sql.replace(/--.*$/gm, '')));

  console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
