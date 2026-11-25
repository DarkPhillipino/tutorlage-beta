// Checks on the path from a tutor's page to booking that tutor (PM line 79, 25 Nov 2026). Run: npx tsx scripts/dev/tutor-booking-test.ts
// The pure halves (src/lib/tutorBooking.ts, src/lib/bookingPath.ts) with fake storage, and the sources of the screens: only the tutor's own subjects, grades and times; no refusal or note ever
// offers another tutor; the sign-up code survives Google and the confirmation e-mail and is used once; no tutor choice on the path; Google waits for the choice. The database half is
// supabase/tests/tutor_page_booking.sql; the screens in a browser are tests/browser/tutor-link.spec.ts.
import { readFileSync } from 'node:fs';
import { BOOKING_COPY, bookingRefusalWords, fetchBookingPage, gradesFor, parseBookingPage, parseTimes, subjectNames } from '../../src/lib/tutorBooking';
import { BOOKS_ON_CONFIRM_SENTENCE, CONFIRM_COPY, CONFIRM_TERMS_VERSION, OFFER_COPY, lessonTimes, longDate, offersNewTerms, parseBooked, wasRefused } from '../../src/lib/pageConfirm';
import { BOOKING_META_KEY, forgetGoogleBooking, isNewAccount, noteBookingLanded, pendingBookingCode, rememberGoogleBooking, takeGoogleBooking } from '../../src/lib/bookingPath';

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : ` ${detail}`}`);
  if (!ok) failed += 1;
};
const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const code = (p: string) => read(p).replace(/(^|\s)\/\/.*$/gm, '$1').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
const store = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
};

async function main() {
  const answer = { code: 'TESSA', first_name: 'Tessa', tutor_id: 't-1', level_id: '1A', level_name: 'Rising Tutors', price: 50, currency: 'ZAR', subjects: [
    { subject: 'English', min_grade: 'Grade 4', max_grade: 'Grade 6' }, { subject: 'Mathematics', min_grade: 'Grade 8', max_grade: 'Grade 9' }, { subject: 'English', min_grade: 'Grade 9', max_grade: 'Grade 9' }] };
  const page = parseBookingPage(answer);
  check('the booking page needs the tutor to address', !!page && page.tutorId === 't-1' && parseBookingPage({ ...answer, tutor_id: undefined }) === null && parseBookingPage(null) === null);
  let threw = false;
  await fetchBookingPage({ rpc: async () => ({ data: null, error: { message: 'down' } }) }, 'TESSA').catch(() => { threw = true; });
  check('no page is null; a failed question is an error to retry', threw && (await fetchBookingPage({ rpc: async () => ({ data: null, error: null }) }, 'X')) === null);
  const grades = ['Grade R', 'Grade 1', 'Grade 2', 'Grade 3', 'Grade 4', 'Grade 5', 'Grade 6', 'Grade 7', 'Grade 8', 'Grade 9', 'Grade 10'];
  check("only the tutor's subjects, once each", subjectNames(page!.subjects).join(',') === 'English,Mathematics');
  check('only the grades approved for the chosen subject (two ranges joined)', gradesFor(page!.subjects, 'English', grades).join(',') === 'Grade 4,Grade 5,Grade 6,Grade 9' && gradesFor(page!.subjects, 'History', grades).length === 0 && gradesFor(page!.subjects, '', grades).length === 0);
  const times = parseTimes({ now_ok: true, days: [{ date: '2026-11-28', times: ['08:00', 'x', 3] }, { date: '2026-11-29', times: [] }, 7] });
  check('the times are read tolerantly; a day with no time is left out', times.nowOk && times.days.length === 1 && times.days[0].times.join() === '08:00' && parseTimes(null).days.length === 0 && parseTimes(null).nowOk === false);

  const database = [
    "This tutor isn't available at that time. Choose another time, or send the request to any available tutor.",
    "This tutor isn't approved for that subject, grade and curriculum. You can send the request to any available tutor.",
    "This tutor doesn't teach that subject.",
    'This tutor teaches at a lower price level than the one you chose. Choose a lower level, or send the request to any available tutor.',
    'You already have 3 requests waiting for this tutor.',
    "That tutor can't take this request right now. You can send it to any available tutor.",
    'You can only ask for a tutor you have had a session with.',
    'You chose to try someone else instead of this tutor. Undo that under My tutors to ask for them again.',
    'Something new happened. You can send it to any available tutor.',
  ];
  const said = database.map((m) => bookingRefusalWords(m, 'Tessa'));
  check('every refusal is said about the tutor and none offers another', said.every((s) => s.length > 0 && !/any available|another tutor|\bfree\b/i.test(s)) && said[0] === "Tessa isn't available at that time. Choose another time.", JSON.stringify(said));
  check('a money or phone message is shown as it is', bookingRefusalWords('Your credit has R0. This session is R50. Add R50 or more.', 'Tessa') === 'Your credit has R0. This session is R50. Add R50 or more.');
  // booked on confirm (PM line 81 C)
  const terms = readFileSync('src/content/legal/terms.md', 'utf8');
  check('the lesson times and the date read in words', lessonTimes('14:00', 1.5) === '14:00 to 15:30' && lessonTimes('09:30', 1) === '09:30 to 10:30' && longDate('2026-11-28') === 'Saturday 28 November 2026');
  check('only a real booking answer counts as booked', parseBooked({ booked: true, session_id: 's', paid_rand: 280, available_rand: 20 })?.paidRand === 280 && parseBooked({ booked: true }) === null && parseBooked(null) === null);
  check('a database refusal is told apart from no answer', wasRefused({ code: 'P0001' }) && !wasRefused(new Error('Failed to fetch')) && !wasRefused({ code: '' }));
  check("the cancellation rule on the confirm step is the Terms' own words", terms.includes(CONFIRM_COPY.cancelSelf) && /We always refund in full when:/.test(terms) && /the tutor cancels, or does not turn up/.test(terms) && CONFIRM_COPY.cancelTutor === 'We always refund in full when the tutor cancels, or does not turn up.');
  check('only a new enough Terms version is offered to a tutor', offersNewTerms([{ document: 'terms', version: CONFIRM_TERMS_VERSION }]) && offersNewTerms([{ document: 'terms', version: '2026-12-01' }]) && !offersNewTerms([{ document: 'terms', version: '2026-11-25' }]) && !offersNewTerms([{ document: 'privacy', version: CONFIRM_TERMS_VERSION }]) && !offersNewTerms(null));
  check('the migration and the app name the same version', readFileSync('supabase/migrations/20261125180000_page_booking_confirm.sql', 'utf8').includes(`'"${CONFIRM_TERMS_VERSION}"'::jsonb`));
  check('no accept or request wording on a booking confirmed this way, and no banned word', !/request|accept it\b(?! first)/i.test([CONFIRM_COPY.heading, CONFIRM_COPY.youBook('T'), CONFIRM_COPY.creditNote, CONFIRM_COPY.bookedMore('T'), CONFIRM_COPY.confirm].join(' ')) && !/\bfree\b|instant|wallet|vetted|certified|background-checked/i.test(JSON.stringify([BOOKS_ON_CONFIRM_SENTENCE, OFFER_COPY, CONFIRM_COPY, CONFIRM_COPY.note('T'), CONFIRM_COPY.bookedMore('T')])));
  const words = [BOOKING_COPY.title('Tessa'), BOOKING_COPY.waitAsap('Tessa'), BOOKING_COPY.waitScheduled('Tessa'), BOOKING_COPY.toHer('Tessa'), BOOKING_COPY.tutorAccount, BOOKING_COPY.noTimes('Tessa')].join(' ');
  check('the notes keep the time limit (30 minutes, 48 hours), name the tutor and offer no other', /about 30 minutes/.test(words) && /up to 48 hours/.test(words) && !/any available|another tutor|Not Tessa|\bfree\b|instant|wallet/i.test(words));

  const s = store();
  const done = store();
  const user = { user_metadata: { [BOOKING_META_KEY]: 'tessa' } };
  check('the account remembers which tutor it was made to book', pendingBookingCode(user, done) === 'TESSA' && pendingBookingCode({ user_metadata: {} }, done) === null && pendingBookingCode({ user_metadata: { [BOOKING_META_KEY]: '../x' } }, done) === null && pendingBookingCode(null, done) === null);
  noteBookingLanded('TESSA', done);
  check('once the booking page has been shown it is not forced again', pendingBookingCode(user, done) === null);
  rememberGoogleBooking('tessa', 1_000, s);
  check('Google: the code waits on this device and is used once', takeGoogleBooking(2_000, s) === 'TESSA' && takeGoogleBooking(2_000, s) === null);
  rememberGoogleBooking('TESSA', 0, s);
  check('Google: an old one is dropped', takeGoogleBooking(31 * 60_000, s) === null);
  rememberGoogleBooking('TESSA', 0, s);
  forgetGoogleBooking(s);
  check('Google from anywhere else forgets it', takeGoogleBooking(1, s) === null);
  const now = Date.parse('2026-11-25T12:00:00Z');
  check('only a new account takes the choice made before Google', isNewAccount('2026-11-25T11:50:00Z', now) && !isNewAccount('2026-11-20T11:50:00Z', now) && !isNewAccount(undefined, now));

  const path = ['src/components/LinkSignIn.tsx', 'src/pages/TutorSignUp.tsx', 'src/components/LinkRolePicker.tsx', 'src/pages/TutorBook.tsx', 'src/components/TutorBookingPage.tsx'].map(code).join('\n');
  check('no tutor choice and no start page on the path', !/Become a tutor|\/signup\/tutor|\/signin\/tutor|to="\/login"|to="\/teach"/.test(path) && !/role: 'tutor'/.test(code('src/components/LinkRolePicker.tsx')));
  check('both screens keep the Privacy Policy link, and Google waits for the choice', [code('src/components/LinkSignIn.tsx'), code('src/pages/TutorSignUp.tsx')].every((f) => /to="\/privacy"/.test(f) && /disabled=\{role === null\}/.test(f)));
  const up = code('src/pages/TutorSignUp.tsx');
  check('sign-up keeps the safeguards: date of birth, under-18 learner, adult parent, Terms never pre-ticked, versions recorded, code and tutor carried', /isPlausibleDateOfBirth/.test(up) && /if \(isUnder18Learner\) return/.test(up) && /COPY\.parentUnder18/.test(up) && /\[accepted, setAccepted\] = useState\(false\)/.test(up) && /accepted_terms_version/.test(up) && /promoSignupMetadata\(page\.code\)/.test(up) && /\[BOOKING_META_KEY\]: page\.code/.test(up));
  const book = code('src/components/TutorBookingPage.tsx');
  check('the booking page: only this tutor and the level of the tutor, no school or curriculum, no price ladder, no tutor counts, no send to anyone', /requestedTutorId: page\.tutorId/.test(book) && /minSubTierId: page\.levelId/.test(book) && /institutionId: null/.test(book) && /viaTutorPage: true/.test(book) && !/PriceLadder|available_price_levels|fetchAvailablePriceLevels|InstitutionModal|resendRequest|bannerClear|refusedSendToAnyone/.test(book));
  check('signed in, the date of birth and Terms gate stands before the booking page', /<AccountGate[\s\S]*<TutorBookingPage/.test(read('src/pages/TutorBook.tsx')));
  const app = read('src/App.tsx');
  check("the home page button goes to the tutor's booking page and the general request page is no longer addressed by a link", /navigate\(bookPath\(linkTutor\.code\)\)/.test(app) && !/linkTutorDismissed/.test(app));

  console.log(failed === 0 ? '\nAll tutor-booking checks passed.' : `\n${failed} tutor-booking check(s) FAILED.`);
  process.exit(failed === 0 ? 0 : 1);
}
main();
