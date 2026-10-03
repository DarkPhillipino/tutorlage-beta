// Account rules and the wording legal drafted for them
// (Drake/legal/specs/7k-minors-consent-and-acceptance.md). Kept in one file on purpose: the attorney
// may still refine the wording, and it should change here without touching the screens.
//
// The database enforces every rule below as well (migration 20260930190000) — these copies exist so
// people get a clear message before submitting, not as the actual control.

export type SignupRole = 'student' | 'tutor' | 'parent';

export const ROLE_LABELS: Record<SignupRole, string> = {
  student: 'student',
  tutor: 'tutor',
  parent: 'parent or guardian',
};

export function parseSignupRole(raw: string | undefined): SignupRole {
  return raw === 'tutor' || raw === 'parent' ? raw : 'student';
}

export const ADULT_AGE = 18;

// A learner a guardian adds without an email gets a sign-in name (e.g.
// "thando-7k2m9q") stored as an address under this reserved .invalid domain,
// which can never receive mail or belong to anyone. Must match
// LEARNER_LOGIN_DOMAIN in server/index.ts.
export const LEARNER_LOGIN_DOMAIN = 'learners.tutorlage.invalid';

// What the sign-in form sends to Supabase: an email as typed, or a learner
// sign-in name turned into its stored address.
export function toSignInEmail(typed: string): string {
  const value = typed.trim().toLowerCase();
  return value.includes('@') ? value : `${value}@${LEARNER_LOGIN_DOMAIN}`;
}

// Whole years between an ISO date (yyyy-mm-dd) and today, in the browser's local calendar.
export function ageFromIsoDate(isoDate: string, today = new Date()): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  let age = today.getFullYear() - year;
  const beforeBirthday = today.getMonth() + 1 < month || (today.getMonth() + 1 === month && today.getDate() < day);
  if (beforeBirthday) age -= 1;
  return age;
}

export function isPlausibleDateOfBirth(isoDate: string, today = new Date()): boolean {
  const age = ageFromIsoDate(isoDate, today);
  return age !== null && age >= 0 && age < 120;
}

export const COPY = {
  // Legal spec §1 — never pre-ticked. Rendered with links to /terms and /privacy.
  acceptTermsLead: 'I accept the',
  // Legal spec §2 (7l).
  tutorUnder18: "Tutors on Tutorlage need to be 18 or older — we'd love to hear from you once you are.",
  parentUnder18: 'Parent and guardian accounts need to be 18 or older.',
  // Legal spec §3 (7k): an under-18 learner can't finish signing up alone.
  learnerUnder18Title: 'Ask a parent or guardian to set up your account',
  learnerUnder18Body:
    'Learners under 18 use Tutorlage through a parent or guardian. They create their own account, add you as a learner, and book sessions for you — you can then sign in to see your sessions and tutor.',
  dateOfBirthWhy: 'We ask because tutors must be 18 or older, and learners under 18 are booked for by a parent or guardian.',
  // Legal spec §3: what a learner under 18 sees instead of booking.
  viewOnlyLearner: 'Your parent or guardian books and pays for your sessions from their account. You can see your sessions and your tutor here.',
  // Legal spec §5: the guardian's phone must be on the account and shown to the tutor. Wording drafted
  // by the PM on 2026-09-30 from the spec — legal to confirm (it tells the guardian who sees the number).
  guardianPhoneNeeded:
    "Add your phone number before you book. For each session you book, your learner's tutor sees your name and this number, so you can be reached during the session.",
  guardianPhoneOnFile: "Your learners' tutors see your name and this number for the sessions you book:",
} as const;

// Legal spec §4 — POPIA s34/s35 guardian consent. Shown unticked when a
// guardian adds a learner; the version it's recorded against comes from
// system_settings (guardian_consent_version), so change both together.
export function guardianConsentText(learnerName: string): string {
  const name = learnerName.trim() || 'this learner';
  return (
    `I confirm I am ${name}'s parent or legal guardian. I consent to Tutorlage processing ${name}'s name, ` +
    `date of birth, school, grade, and session and review records, so that Tutorlage can match them with ` +
    `tutors, run their sessions and handle payments. I can review this information or withdraw my consent ` +
    `at any time from my account, which ends ${name}'s use of Tutorlage.`
  );
}
