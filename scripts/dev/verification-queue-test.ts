// Checks on the Tutor Verification queue order (admin/src/lib/verificationQueueOrder.ts, burst-readiness 4 Nov 2026). Run:  npx tsx scripts/dev/verification-queue-test.ts
// Proves: the three groups; the longest-waiting tutor first; tutors with nothing to review below; rejected below that; verified only on request;
// the search finds by name, email or headline; "next tutor" skips the one just decided and the unfinished; the waiting words; and (source
// reading) that the detail page still blocks approval the same way and keys on the tutor so typed text is never carried over.
import fs from 'node:fs';
import { GROUP_ORDER, buildSections, groupOf, matchesSearch, nextToReview, sortQueue, waitingText } from '../../admin/src/lib/verificationQueueOrder';
import type { TutorForVerification } from '../../admin/src/types';

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
};

const t = (id: string, o: Partial<TutorForVerification> = {}): TutorForVerification => ({
  id, name: `Tutor ${id}`, email: `${id}@example.test`, headline: null, onboardingStatus: 'pending_academic', isVerified: false,
  createdAt: '2026-11-01T08:00:00Z', documentCount: 3, pendingDocumentCount: 3, tutorType: 'beginner', ...o,
});
const since = new Map<string, string>([
  ['a', '2026-11-03T10:00:00Z'],   // uploaded late, signed up first
  ['b', '2026-11-02T09:00:00Z'],   // waited longest
  ['c', '2026-11-02T15:00:00Z'],
]);
const list = [
  t('a', { createdAt: '2026-10-30T08:00:00Z' }),
  t('b', { createdAt: '2026-11-02T08:00:00Z' }),
  t('c', { createdAt: '2026-11-01T08:00:00Z' }),
  t('d', { createdAt: '2026-10-29T08:00:00Z', documentCount: 0, pendingDocumentCount: 0 }),                                   // signed up, nothing uploaded
  t('e', { createdAt: '2026-10-31T08:00:00Z', documentCount: 2, pendingDocumentCount: 0 }),                                   // all decided
  t('f', { createdAt: '2026-10-28T08:00:00Z', onboardingStatus: 'rejected', pendingDocumentCount: 0 }),
  t('g', { createdAt: '2026-10-27T08:00:00Z', onboardingStatus: 'verified', isVerified: true, pendingDocumentCount: 0 }),
  t('h', { createdAt: '2026-11-03T12:00:00Z' }),                                                                               // waiting, no upload time known: falls back to sign-up (the newest here)
];

// ---- groups ----
check('a tutor with a document waiting is in "to review"', groupOf(list[0]) === 'to_review');
check('a tutor with nothing waiting (none uploaded, or all decided) is in "nothing yet"', groupOf(list[3]) === 'nothing_yet' && groupOf(list[4]) === 'nothing_yet');
check('rejected and verified are their own groups, whatever their documents', groupOf(list[5]) === 'rejected' && groupOf(list[6]) === 'verified');
check('the group order is to review, nothing yet, rejected, verified', GROUP_ORDER.join() === 'to_review,nothing_yet,rejected,verified');

// ---- order ----
const sorted = sortQueue(list, since).map((x) => x.id);
check('the tutor who has waited longest for a decision is first (by the oldest waiting document, not by sign-up)', sorted.slice(0, 4).join() === 'b,c,a,h', sorted.join());
check('then "nothing yet" in sign-up order, then rejected, then verified', sorted.slice(4).join() === 'd,e,f,g', sorted.join());
check('a tutor with no known upload time falls back to the sign-up time', sorted.indexOf('h') === 3);
check('sorting never changes the list it is given', list[0].id === 'a' && list.length === 8);

// ---- sections and filters ----
const sections = buildSections(list, since);
check('verified tutors are hidden unless asked for', !sections.some((s) => s.group === 'verified') && sections.map((s) => s.group).join() === 'to_review,nothing_yet,rejected');
check('"show verified too" adds them as the last group', buildSections(list, since, { showVerified: true }).map((s) => s.group).at(-1) === 'verified');
check('an empty group is left out', buildSections([list[0]], since).length === 1);
check('search finds by name, email and headline, any case, every word', matchesSearch(t('x', { name: 'Thandiwe Nkosi', email: 'tn@uni.ac.za', headline: 'Maths tutor' }), 'nkosi MATHS')
  && matchesSearch(t('x', { email: 'tn@uni.ac.za' }), 'UNI.AC') && !matchesSearch(t('x', { name: 'Thandiwe' }), 'sipho'));
check('an empty search matches everyone', matchesSearch(list[0], '   '));
check('search narrows the sections', buildSections(list, since, { search: 'tutor d' }).flatMap((s) => s.tutors.map((x) => x.id)).join() === 'd');

// ---- next tutor ----
check('next after a decision is the next-longest-waiting tutor, never the one just decided', nextToReview(list, since, 'b')?.id === 'c' && nextToReview(list, since, 'c')?.id === 'b');
check('next skips tutors with nothing to review, rejected and verified ones', nextToReview(list.filter((x) => ['d', 'e', 'f', 'g', 'a'].includes(x.id)), since, 'a') === null);
check('next is null when nobody else is waiting', nextToReview([list[0]], since, 'a') === null && nextToReview([], since, 'a') === null);

// ---- words ----
const now = Date.parse('2026-11-04T12:00:00Z');
check('waiting words: under an hour, hours, days', waitingText('2026-11-04T11:30:00Z', now) === 'waiting under an hour' && waitingText('2026-11-04T07:00:00Z', now) === 'waiting 5 hours'
  && waitingText('2026-11-04T11:00:00Z', now) === 'waiting 1 hour' && waitingText('2026-11-01T12:00:00Z', now) === 'waiting 3 days');
check('a bad or future date never shows NaN', waitingText('not a date', now) === 'waiting under an hour' && waitingText('2026-12-01T00:00:00Z', now) === 'waiting under an hour');

// ---- source reading: the safety rules of the detail page are unchanged ----
const detail = fs.readFileSync(new URL('../../admin/src/pages/TutorVerificationDetail.tsx', import.meta.url), 'utf8');
check('Approve is still disabled without an 18+ date of birth or while documents are missing', /disabled=\{isFinalizing \|\| !canApprove \|\| blockApprove\}/.test(detail));
check('Reject still needs a reason', /Add a reason before rejecting/.test(detail));
check('the page is keyed on the tutor, so typed reasons and dates never carry to the next tutor', /<TutorVerificationDetailPage key=\{tutorId\} \/>/.test(detail));
check('after a decision it goes to the next tutor through findNextTutor, and falls back to the queue', /await goToNext\(/.test(detail) && /navigate\('\/verification', \{ state/.test(detail));
check('the subject checklist is on the page, below the documents', detail.indexOf('<TutorDocumentList') > 0 && detail.indexOf('<TutorSubjectsReviewCard') > detail.indexOf('<TutorDocumentList'));
check('the subject decision still goes through the same database function', /admin_review_tutor_subject/.test(fs.readFileSync(new URL('../../admin/src/lib/curriculumQueries.ts', import.meta.url), 'utf8')));
const card = fs.readFileSync(new URL('../../admin/src/components/TutorSubjectsReviewCard.tsx', import.meta.url), 'utf8');
check('the embedded card uses the Subject approvals review form and its reviewSubject action, nothing new', /import \{ ReviewForm \} from '\.\/SubjectApprovalsBody'/.test(card) && /review: reviewSubject/.test(card));

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} FAIL`);
process.exit(failures === 0 ? 0 : 1);
