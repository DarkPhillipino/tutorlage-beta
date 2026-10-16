// 16 Oct 2026, the CEO's test day: four faults found in how a parent books and follows a session, each fixed locally:
//   1. the green "Booking for <child>" button undid the choice when pressed again (nothing seemed to happen);
//   2. a notification in the header could not be tapped, and the "Sessions & history" page did not exist;
//   3. the request used the subject last SEARCHED, not the one in the box (typed "Life Sciences", sent "English");
//   4. the history query asked for a session status the database does not have ("cancelled"), which made the page fail;
//   5. a parent's "Change" next to the grade did nothing (it sent them to the home page they were already on), and a parent
//      had no way at all to change a learner's grade (the learner's row is read-only to a parent);
//   6. with only one price level on offer, a parent still had to "choose" it on a page of its own.
//
// Part A: the small rule for where a notification goes (pure).
// Part B: source guards, because every one of these faults was in the wiring. Each guard is then run against a deliberately
//         broken copy of the source to prove it can fail (so a guard that always passes is found out).
// Run: npx tsx scripts/dev/sessions-page-test.ts   (exits 1 if any check fails)
import { readFileSync } from 'node:fs';
import { notificationTarget } from '../../src/lib/notificationTarget';

let failed = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) failed += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ' - ' + detail : ''}`);
};

// ---- Part A -------------------------------------------------------------------------------------------------------
check('a booked-session notice goes to the sessions page', notificationTarget('request_accepted') === 'sessions');
check('"your session link is ready" goes to the sessions page', notificationTarget('session_link') === 'sessions');
check('an expired request notice goes to the sessions page', notificationTarget('request_expired') === 'sessions');
check('an unknown type goes to the sessions page', notificationTarget('something_new') === 'sessions');
check('a request sent to a tutor goes to Teach', notificationTarget('request_for_you') === 'teach');
check('its reminder goes to Teach', notificationTarget('request_for_you_reminder') === 'teach');

// ---- Part B -------------------------------------------------------------------------------------------------------
const FILES = {
  learners: 'src/components/LearnersPanel.tsx',
  bell: 'src/components/NotificationsBell.tsx',
  header: 'src/components/Header.tsx',
  banner: 'src/components/SubHeaderBanner.tsx',
  app: 'src/App.tsx',
  prices: 'src/components/PricesPage.tsx',
  queries: 'src/lib/queries.ts',
  panel: 'src/components/UpcomingSessionsPanel.tsx',
  page: 'src/components/SessionsHistoryPage.tsx',
  gradeModal: 'src/components/LearnerGradeModal.tsx',
  gradeMigration: 'supabase/migrations/20261016150000_parent_sets_learner_grade.sql',
  booking: 'src/components/BookingForm.tsx',
  levels: 'src/components/LevelSelectionPage.tsx',
} as const;
type Sources = Record<keyof typeof FILES, string>;

const load = (): Sources =>
  Object.fromEntries(Object.entries(FILES).map(([k, p]) => [k, readFileSync(p, 'utf8')])) as Sources;

// Each guard: a name and a test of the sources. Returns true when the source is right.
const guards: { name: string; ok: (s: Sources) => boolean }[] = [
  {
    name: 'the child button no longer deselects when pressed again',
    ok: (s) => !/onSelectLearner\(isSelected \? null : learner\)/.test(s.learners) && /if \(!isSelected\) onSelectLearner\(learner\)/.test(s.learners),
  },
  {
    name: 'the child button takes the parent to the booking box',
    ok: (s) => /getElementById\('book-a-tutor'\)/.test(s.learners),
  },
  {
    name: 'a notification in the bell is a button that calls onOpenNotification',
    ok: (s) => /<button[\s\S]{0,200}onOpenNotification\?\.\(n\)/.test(s.bell),
  },
  {
    name: 'the header passes the handler to the bell',
    ok: (s) => /<NotificationsBell onOpenNotification=\{onOpenNotification\} \/>/.test(s.header),
  },
  {
    name: 'the "upcoming sessions" line in the banner opens the page',
    ok: (s) => /onClick=\{onOpenSessions\}/.test(s.banner),
  },
  {
    name: 'App opens the sessions page for a notification (Teach only for a tutor request)',
    ok: (s) => /notificationTarget\(notification\.type\) === 'teach'/.test(s.app) && /onOpenNotification=\{handleOpenNotification\}/.test(s.app),
  },
  {
    name: 'App renders the sessions page and the banner opens it',
    ok: (s) => /view === 'sessions'/.test(s.app) && /<SessionsHistoryPage/.test(s.app) && /onOpenSessions=\{openSessionsPage\}/.test(s.app),
  },
  {
    name: 'the sessions page shows the full history (the panel is told it is the page)',
    ok: (s) => /<UpcomingSessionsPanel[^>]*\bpage\b/.test(s.page),
  },
  {
    name: 'a request is never sent while the box and the searched subject differ',
    ok: (s) => /if \(searchIsStale\) \{[\s\S]{0,400}return;/.test(s.prices) && /subjectName: appliedSubject/.test(s.prices),
  },
  {
    name: 'updating the search clears the chosen price level',
    ok: (s) => /setAppliedSubject\(formState\.subject\);\s*[\s\S]{0,200}onClearLevel\(\)/.test(s.prices),
  },
  {
    name: 'the history query asks only for statuses the database has',
    ok: (s) =>
      /'cancelled_by_tutor', 'cancelled_by_student'/.test(s.queries) &&
      !/\['scheduled', 'completed', 'cancelled'\]/.test(s.queries),
  },
  {
    name: 'waiting requests are only the ones whose card check passed and nobody accepted',
    ok: (s) => /\.eq\('payment_status', 'card_verified'\)/.test(s.queries) && /\.is\('tutor_id', null\)/.test(s.queries) && /\.eq\('status', 'pending'\)/.test(s.queries),
  },
  {
    name: 'the waiting requests are an extra: if they fail the sessions still show',
    ok: (s) => /fetchMyWaitingRequests failed/.test(s.panel),
  },
  {
    name: 'a Google Meet link carries the sign-in-and-be-let-in hint',
    ok: (s) => /meet\\\.google\\\.com/.test(s.panel) && /Google only lets in people who are signed in to Google/.test(s.panel),
  },
  {
    name: "a parent's grade button opens the learner's grade window, or says to choose a learner first",
    ok: (s) =>
      /if \(isGuardian\) \{\s*if \(bookingFor\) \{\s*setIsLearnerGradeOpen\(true\);/.test(s.app) &&
      /getElementById\('your-learners'\)/.test(s.app) &&
      /<LearnerGradeModal/.test(s.app),
  },
  {
    name: 'the grade button no longer just goes to the home page for a parent',
    ok: (s) => !/if \(isGuardian\) \{\s*setView\('home'\);\s*\} else/.test(s.app),
  },
  {
    name: '"Your learners" can be scrolled to, and reloads after a grade is saved',
    ok: (s) => /id="your-learners"/.test(s.learners) && /key=\{learnersVersion\}/.test(s.app) && /setLearnersVersion\(\(v\) => v \+ 1\)/.test(s.app),
  },
  {
    name: 'the grade is saved through the database function, and a missing function is said in words',
    ok: (s) => /rpc\('set_learner_grade'/.test(s.queries) && /isMissingDatabaseFunction\(e\)/.test(s.gradeModal) && /isn't switched on yet/.test(s.gradeModal),
  },
  {
    name: 'the grade function checks the guardian and the list of grades, and is not callable signed out',
    ok: (s) =>
      /can_act_for_learner\(p_learner\)/.test(s.gradeMigration) &&
      /from public\.grade_levels where lower\(name\)/.test(s.gradeMigration) &&
      /revoke all on function public\.set_learner_grade\(uuid, text\) from public, anon;/.test(s.gradeMigration),
  },
  {
    name: 'a parent with no learner chosen sees "Choose a learner" on the grade row, not "Set in account"',
    ok: (s) => /'Choose a learner'/.test(s.app) && /gradeLevel \? 'Change' : gradeSetLabel/.test(s.booking),
  },
  {
    name: 'when only one price level has a tutor it is chosen automatically (nothing to choose)',
    ok: (s) =>
      /const onlyLevel = !isLoading && !loadError && levels\.length === 1 \? levels\[0\] : null;/.test(s.levels) &&
      /if \(onlyLevel\) onSelectLevel\(onlyLevel\);/.test(s.levels),
  },
];

const real = load();
for (const g of guards) check(g.name, g.ok(real));

// Deliberate breakages: each must make its guard fail. (Done on in-memory copies; no file is touched.)
const breakages: { guard: string; file: keyof typeof FILES; from: string | RegExp; to: string }[] = [
  { guard: 'the child button no longer deselects when pressed again', file: 'learners', from: 'if (!isSelected) onSelectLearner(learner);', to: 'onSelectLearner(isSelected ? null : learner);' },
  { guard: 'the child button takes the parent to the booking box', file: 'learners', from: "getElementById('book-a-tutor')", to: "getElementById('nowhere')" },
  { guard: 'a notification in the bell is a button that calls onOpenNotification', file: 'bell', from: 'onOpenNotification?.(n);', to: '/* nothing */' },
  { guard: 'the header passes the handler to the bell', file: 'header', from: '<NotificationsBell onOpenNotification={onOpenNotification} />', to: '<NotificationsBell />' },
  { guard: 'the "upcoming sessions" line in the banner opens the page', file: 'banner', from: 'onClick={onOpenSessions}', to: 'onClick={undefined}' },
  { guard: 'App opens the sessions page for a notification (Teach only for a tutor request)', file: 'app', from: 'onOpenNotification={handleOpenNotification}', to: '' },
  { guard: 'App renders the sessions page and the banner opens it', file: 'app', from: 'onOpenSessions={openSessionsPage}', to: '' },
  { guard: 'the sessions page shows the full history (the panel is told it is the page)', file: 'page', from: 'onBookAgain={onBookAgain} page />', to: 'onBookAgain={onBookAgain} />' },
  { guard: 'a request is never sent while the box and the searched subject differ', file: 'prices', from: 'if (searchIsStale) {', to: 'if (false) {' },
  { guard: 'updating the search clears the chosen price level', file: 'prices', from: 'if (selectedLevel) onClearLevel();', to: '' },
  { guard: 'the history query asks only for statuses the database has', file: 'queries', from: "'cancelled_by_tutor', 'cancelled_by_student'", to: "'cancelled'" },
  { guard: 'waiting requests are only the ones whose card check passed and nobody accepted', file: 'queries', from: ".eq('payment_status', 'card_verified')", to: '' },
  { guard: 'the waiting requests are an extra: if they fail the sessions still show', file: 'panel', from: 'fetchMyWaitingRequests failed', to: 'x' },
  { guard: 'a Google Meet link carries the sign-in-and-be-let-in hint', file: 'panel', from: 'Google only lets in people who are signed in to Google', to: 'x' },
  { guard: "a parent's grade button opens the learner's grade window, or says to choose a learner first", file: 'app', from: 'setIsLearnerGradeOpen(true);', to: 'setView(\'home\');' },
  { guard: 'the grade button no longer just goes to the home page for a parent', file: 'app', from: /if \(isGuardian\) \{\s*if \(bookingFor\) \{/, to: "if (isGuardian) {\n      setView('home');\n    } else if (false) {\n      if (bookingFor) {" },
  { guard: '"Your learners" can be scrolled to, and reloads after a grade is saved', file: 'learners', from: 'id="your-learners"', to: 'id="x"' },
  { guard: 'the grade is saved through the database function, and a missing function is said in words', file: 'queries', from: "rpc('set_learner_grade'", to: "rpc('something_else'" },
  { guard: 'the grade function checks the guardian and the list of grades, and is not callable signed out', file: 'gradeMigration', from: 'can_act_for_learner(p_learner)', to: 'true' },
  { guard: 'a parent with no learner chosen sees "Choose a learner" on the grade row, not "Set in account"', file: 'booking', from: "gradeLevel ? 'Change' : gradeSetLabel", to: "gradeLevel ? 'Change' : 'Set in account'" },
  { guard: 'when only one price level has a tutor it is chosen automatically (nothing to choose)', file: 'levels', from: 'if (onlyLevel) onSelectLevel(onlyLevel);', to: '' },
];

let caught = 0;
for (const b of breakages) {
  const copy: Sources = { ...real };
  const had = typeof b.from === 'string' ? copy[b.file].includes(b.from) : b.from.test(copy[b.file]);
  copy[b.file] = copy[b.file].replace(b.from, b.to);
  const guard = guards.find((g) => g.name === b.guard);
  const ok = had && !!guard && !guard.ok(copy);
  if (ok) caught += 1;
  check(`breakage caught: ${b.guard}`, ok, had ? '' : 'the text to break was not found, so this check proves nothing');
}
check(`every deliberate breakage was caught (${caught} of ${breakages.length})`, caught === breakages.length);

console.log(failed === 0 ? '\nALL CHECKS PASSED' : `\n${failed} CHECK(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);
