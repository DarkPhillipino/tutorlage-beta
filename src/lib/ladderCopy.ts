// The words on the price ladder (CEO, 17 Oct 2026: "apply all 16 tier prices on the right side ... show the message on each tier
// that shows the experience of each tier, their ratings etc. all the things we require as the minimum"). Every requirement shown is
// read from the database's own table (sub_tier_definitions), the same numbers fn_recalculate_tutor_tier uses to move a tutor up,
// so the page can never promise a level the rules do not enforce. Pure functions: tested by scripts/dev/price-ladder-test.ts.

// One of the 16 levels with its price and the minimums a tutor must have reached to be at it.
export interface LadderRow {
  id: string; // '1A' to '4D'
  tierId: number;
  tierName: string;
  tierQuote: string;
  price: number; // per hour
  currencyCode: string;
  minHours: number;
  minRating: number;
  minRepeatRatePct: number;
  minReviews: number;
  minUpliftStudents: number;
  requiredUpliftPct: number;
  // What can start a tutor at this level without the record above (the credential route): the names of the credentials that the
  // admin app sets to this level (credential_definitions.label). Empty for a level no credential reaches.
  credentials: string[];
}

// The line above them. The list itself is read from the database, so the page always agrees with what the admin app sets
// (CEO, 17 Oct 2026: the tiers and what starts a tutor at one are defined in the admin app).
export const CREDENTIAL_LEAD = 'A tutor can also start at this level with:';

// 4.80 reads "4.8", 4.85 reads "4.85" (trailing zeros dropped).
const trim = (n: number) => String(Number(n.toFixed(2)));

// The minimums, in plain words, in the order a person would weigh them. Only the ones that matter at that level are listed; the first
// level has none, because every tutor starts there.
export function requirementLines(row: LadderRow): string[] {
  const lines: string[] = [];
  if (row.minHours > 0) lines.push(`${row.minHours} or more hours taught on Tutorlage`);
  if (row.minRating > 0) lines.push(`Rated ${trim(row.minRating)} or higher`);
  if (row.minRepeatRatePct > 0) lines.push(`At least ${trim(row.minRepeatRatePct)}% of their learners have booked them again`);
  if (row.minReviews > 0) lines.push(`${row.minReviews} or more reviews`);
  if (row.requiredUpliftPct > 0) {
    lines.push(
      row.minUpliftStudents > 0
        ? `Their learners' marks are up by an average of ${trim(row.requiredUpliftPct)}% or more (measured for at least ${row.minUpliftStudents} learners)`
        : `Their learners' marks are up by an average of ${trim(row.requiredUpliftPct)}% or more`,
    );
  }
  return lines;
}

// The line above the minimums.
export const FIRST_LEVEL_LINE = 'Every tutor starts here, new to Tutorlage and building their record. No minimum yet.';
export const MINIMUMS_LEAD = 'To be at this level a tutor has:';

// Said once above the ladder (CEO, 17 Oct 2026): a tutor can take any request priced at or below their own level, so tutors at
// higher levels count towards the tally of every lower level. The database does this (available_price_levels counts every
// eligible tutor whose level's rate is at or above the level's), and the tutor's request list and the accept step use the same rule.
export const TALLY_NOTE =
  'Each number counts every tutor at that level or higher, because a tutor can take any request priced at or below their own level.';

// How many tutors can take a request at this level (this level or above), in words.
export function availabilityLine(tutors: number | null): string | null {
  if (tutors === null) return null;
  if (tutors <= 0) return 'No tutor at this level yet';
  return tutors === 1 ? '1 tutor can take this' : `${tutors} tutors can take this`;
}

// What the request card says once a level is chosen (the count is of tutors at this level or above).
export function chosenLevelLine(tutors: number): string {
  if (tutors <= 0) {
    return 'No tutor is at this level or above yet. You can still send the request: it waits up to 48 hours and you are charged only if a tutor accepts.';
  }
  return tutors === 1 ? '1 tutor at this level or above can take this request' : `${tutors} tutors at this level or above can take this request`;
}
