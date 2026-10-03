// Student-facing copy for the Model 3 price menu (backlog 12a), from
// Drake/marketing-gtm/pricing-menu-copy.md (v2 + the 2026-09-30 v3 corrections).
// Every line has to be true of every tutor who could accept at that level —
// the earned route and, where it exists, the credential route.

export const MENU_HEADLINE =
  "You'll never be matched below the level you choose — and you may be matched above it.";

// Sourced from the 750-advert market study (Jan 2025 – Jul 2026) cited in
// Drake/project-manager/previous-meetings.md.
export const MARKET_REFERENCE = 'Private tutoring in South Africa typically costs around R330 an hour.';

// The CEO chose trust line "Option A" on 2026-09-30. It may only be shown once
// every tester has actually been checked (their school-screening documents on
// file) — until then it stays off. Flip to true when that's done.
export const SHOW_TRUST_LINE = false;
export const TRUST_LINE =
  "Our first tutors are student teachers we know personally. Every one is checked by our team before they take a booking, and we're building a training course and competency check that every future tutor will pass.";

// Plain-language meaning of each level. 1A deliberately doesn't claim the 70%
// check yet — it isn't enforced until the Tier 1 onboarding pipeline (item 7)
// ships. 3D has no credential route (subject leadership enters at 3C).
// 4C and 4D are held and never offered.
export const LEVEL_DESCRIPTIONS: Record<string, string> = {
  '1A': 'New to Tutorlage, building their record.',
  '1B': 'Rated 4.8+ across their first 10+ hours here.',
  '1C': '6 in 10 of their students book them again. Rated 4.85+.',
  '1D': '6 in 10 students return, rated 4.9+, with written reviews you can read.',
  '2A': 'Rated 4.85+, with 65% of students returning.',
  '2B': 'Nearly 7 in 10 of their students come back. Rated 4.88+.',
  '2C': 'A qualified teacher, or a student teacher who has completed their classroom practicum — or a tutor with 7 in 10 students returning across 110+ hours here.',
  '2D': '3 in 4 of their students return. Rated 4.9+, with 12+ written reviews.',
  '3A': 'A qualified teacher who teaches this subject to matric classes — or a tutor with 160+ hours here, rated 4.9+.',
  '3B': 'Rated 4.92+, with 78% of students returning.',
  '3C': 'A teacher who heads this subject at their school — or 270+ hours here, rated 4.93+.',
  '3D': 'Our most established tutors: 350+ hours here, rated 4.95+, 85% of students returning.',
  '4A': 'Marks NSC, IEB or Cambridge exam papers — or 360+ hours here, rated 4.95+.',
  '4B': 'Moderates or examines for an exam board — or 420+ hours here, rated 4.96+.',
};
