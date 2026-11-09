// The grades CAPS teaches the Grade R to 9 subjects in (9 Nov 2026; the list and the reasons are in
// Drake/educator/primary-phase-subjects-2026-11-09.md). When a tutor picks one of these subjects in "Subjects Taught", the grade
// boxes start at that range instead of Grade R to "Adult / Professional Development", so a student teacher only narrows them.
// This is a starting point only: Tutorlage still approves the grades (an approved subject is approved for exactly the grades saved).
// No browser or Supabase code, so scripts/dev/subject-grade-defaults-test.ts runs it directly. It works the same before and after the
// migration that adds the six subjects to the suggestion list, because it goes by the typed name.
export interface GradeBand {
  min: string;
  max: string;
}

// Keys are lower case. Exact DBE names only: "Natural Sciences" is the Grade 7 to 9 subject, "Natural Sciences and Technology" the Grade 4 to 6 one.
const CAPS_BANDS: Record<string, GradeBand> = {
  'life skills': { min: 'Grade R', max: 'Grade 6' },
  'natural sciences and technology': { min: 'Grade 4', max: 'Grade 6' },
  'social sciences': { min: 'Grade 4', max: 'Grade 9' },
  'natural sciences': { min: 'Grade 7', max: 'Grade 9' },
  'technology': { min: 'Grade 7', max: 'Grade 9' },
  'economic and management sciences': { min: 'Grade 7', max: 'Grade 9' },
};

// The six names, lower case (the migration 20261109100000 adds the same six to the suggestion list; a test keeps the two together).
export const CAPS_BAND_SUBJECTS: string[] = Object.keys(CAPS_BANDS);

// The range for a typed subject, using the spelling of the grade list the screen loaded (so a differently written list still works),
// or null when the subject has no set range or the grade list does not hold both ends.
export function capsGradeBand(subject: string, gradeOptions: string[]): GradeBand | null {
  const band = CAPS_BANDS[subject.trim().replace(/\s+/g, ' ').toLowerCase()];
  if (!band) return null;
  const find = (name: string) => gradeOptions.find((g) => g.toLowerCase() === name.toLowerCase());
  const min = find(band.min);
  const max = find(band.max);
  return min && max ? { min, max } : null;
}
