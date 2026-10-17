// Checks on the price ladder on the request page (CEO, 17 Oct 2026): all 16 levels shown with the minimums a tutor must have
// reached, and no line telling people they cannot pick the tutor. Run: npx tsx scripts/dev/price-ladder-test.ts
import fs from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PriceLadder } from '../../src/components/PriceLadder';
import { CREDENTIAL_LEAD, availabilityLine, chosenLevelLine, requirementLines } from '../../src/lib/ladderCopy';
import type { LadderRow } from '../../src/lib/ladderCopy';

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
};
const root = new URL('../../', import.meta.url);
const read = (p: string) => fs.readFileSync(new URL(p, root), 'utf8');

// The sixteen rows of sub_tier_definitions as read from the database on 17 Oct 2026 (id, tier, price, hours, rating, repeat %,
// reviews, learners measured, mark uplift %).
const T = [
  [1, 'Rising Tutors', 'Tutors new to Tutorlage, building their record.'],
  [2, 'Academic Mentors', 'Tutors with a strong record on Tutorlage.'],
  [3, 'Subject Specialists', 'Experienced tutors.'],
  [4, 'Distinction Strategists', 'Tutors who mark or moderate exam papers.'],
] as const;
const DATA: [string, number, number, number, number, number, number, number, number][] = [
  ['1A', 1, 50, 0, 0, 0, 0, 0, 0], ['1B', 1, 80, 10, 4.8, 0, 0, 0, 0], ['1C', 1, 110, 25, 4.85, 60, 0, 0, 0], ['1D', 1, 150, 45, 4.9, 60, 3, 0, 0],
  ['2A', 2, 180, 50, 4.85, 65, 5, 0, 5], ['2B', 2, 230, 75, 4.88, 68, 7, 0, 5], ['2C', 2, 280, 110, 4.9, 72, 10, 0, 5], ['2D', 2, 350, 150, 4.9, 75, 12, 5, 10],
  ['3A', 3, 400, 160, 4.9, 75, 12, 5, 10], ['3B', 3, 460, 210, 4.92, 78, 15, 6, 12], ['3C', 3, 530, 270, 4.93, 82, 20, 8, 15], ['3D', 3, 600, 350, 4.95, 85, 25, 10, 20],
  ['4A', 4, 650, 360, 4.95, 85, 25, 10, 20], ['4B', 4, 720, 420, 4.96, 88, 30, 12, 22], ['4C', 4, 800, 500, 4.97, 90, 35, 15, 25], ['4D', 4, 1200, 600, 4.98, 92, 40, 20, 25],
];
// credential_definitions as read on 17 Oct 2026 (the admin app sets which level each starts a tutor at): label by level.
const CREDENTIALS: Record<string, string[]> = {
  '2A': ['Higher Certificate in Education'],
  '2C': ['Qualified teacher with a teaching degree or PGCE', 'SACE-registered qualified teacher', 'Student teacher with a completed supervised practicum'],
  '2D': ['Qualified teacher with 2 or more years in the classroom'],
  '3A': ['Qualified teacher with 3 or more years in the classroom', 'SACE-registered teacher of this subject at FET/matric phase'],
  '3B': ['Qualified teacher with 4 or more years in the classroom'],
  '3C': ['Head of department or subject head (or equivalent)'],
  '4A': ['NSC, IEB or Cambridge exam marker (last 5 years)'],
  '4B': ['Exam moderator, chief marker or examiner'],
};
const ROWS: LadderRow[] = DATA.map(([id, tier, price, hours, rating, repeat, reviews, students, uplift]) => ({
  id, tierId: tier, tierName: T[tier - 1][1], tierQuote: T[tier - 1][2], price, currencyCode: 'ZAR',
  minHours: hours, minRating: rating, minRepeatRatePct: repeat, minReviews: reviews, minUpliftStudents: students, requiredUpliftPct: uplift,
  credentials: CREDENTIALS[id] ?? [],
}));
const row = (id: string) => ROWS.find((r) => r.id === id)!;

// ---- the words, from the numbers --------------------------------------------------------------------------------------------
check('the first level has no minimum (every tutor starts there)', requirementLines(row('1A')).length === 0);
check('1B: hours and rating only', JSON.stringify(requirementLines(row('1B'))) === JSON.stringify(['10 or more hours taught on Tutorlage', 'Rated 4.8 or higher']));
check('1D: hours, rating, learners who come back, reviews (no marks yet)', JSON.stringify(requirementLines(row('1D'))) === JSON.stringify([
  '45 or more hours taught on Tutorlage', 'Rated 4.9 or higher', 'At least 60% of their learners have booked them again', '3 or more reviews']));
check('2A adds the marks line, without a number of learners', requirementLines(row('2A')).at(-1) === "Their learners' marks are up by an average of 5% or more");
check('2D names how many learners were measured', requirementLines(row('2D')).at(-1) === "Their learners' marks are up by an average of 10% or more (measured for at least 5 learners)");
check('4D is the strictest: 600 hours, 4.98, 92%, 40 reviews, 25% for 20 learners', JSON.stringify(requirementLines(row('4D'))) === JSON.stringify([
  '600 or more hours taught on Tutorlage', 'Rated 4.98 or higher', 'At least 92% of their learners have booked them again', '40 or more reviews',
  "Their learners' marks are up by an average of 25% or more (measured for at least 20 learners)"]));
check('ratings drop a trailing zero (4.80 reads 4.8) and keep two places (4.85)', requirementLines(row('1B'))[1].includes('4.8 or') && requirementLines(row('1C'))[1].includes('4.85'));
check('every level above the first has a hours line and a rating line', ROWS.filter((r) => r.id !== '1A').every((r) => requirementLines(r).length >= 2));
check('each level asks for at least as many hours as the one below it (the ladder only climbs)', ROWS.every((r, i) => i === 0 || r.minHours >= ROWS[i - 1].minHours));
check('availability in words: none, one, many, unknown', availabilityLine(0) === 'No tutor at this level yet' && availabilityLine(1) === '1 tutor can take this' && availabilityLine(3) === '3 tutors can take this' && availabilityLine(null) === null);
check('the chosen-level line: with none it says the request waits and nobody is charged unless a tutor accepts', /waits up to 48 hours/.test(chosenLevelLine(0)) && /charged only if a tutor accepts/.test(chosenLevelLine(0)) && chosenLevelLine(1) === '1 tutor at this level or above can take this request' && chosenLevelLine(5) === '5 tutors at this level or above can take this request');

// ---- the page ---------------------------------------------------------------------------------------------------------------------
const picked: string[] = [];
const html = renderToStaticMarkup(
  React.createElement(PriceLadder, {
    rows: ROWS,
    available: new Map([['1A', 3]]),
    selectedId: null,
    onSelect: (level) => picked.push(level.id),
    currencySymbol: () => 'R',
  }),
);
check('all 16 levels are shown, one button each', (html.match(/data-level="/g) ?? []).length === 16 && ROWS.every((r) => html.includes(`data-level="${r.id}"`)));
check('the four tiers have a heading and their description', T.every(([, name, quote]) => html.includes(name) && html.includes(quote)));
check('every price is shown with "per hour"', ROWS.every((r) => html.includes(`R${r.price.toFixed(2)}`)) && (html.match(/per hour/g) ?? []).length === 16);
check('the only level with a tutor says so, the other fifteen say none yet', (html.match(/3 tutors can take this/g) ?? []).length === 1 && (html.match(/No tutor at this level yet/g) ?? []).length === 15);
check('when the counts are unknown no count is shown and every level can still be chosen', (() => {
  const unknown = renderToStaticMarkup(React.createElement(PriceLadder, { rows: ROWS, available: null, selectedId: null, onSelect: () => undefined, currencySymbol: () => 'R' }));
  return !/tutors? can take this|No tutor at this level yet/.test(unknown) && (unknown.match(/data-level="/g) ?? []).length === 16;
})());
check('a note says each tally counts every tutor at that level or higher (shown when the counts are known, not when they are not)',
  html.includes('counts every tutor at that level or higher') &&
    !renderToStaticMarkup(React.createElement(PriceLadder, { rows: ROWS, available: null, selectedId: null, onSelect: () => undefined, currencySymbol: () => 'R' })).includes('counts every tutor'));
// Proved on the database on 17 Oct 2026 (rolled back; tutors at 1A, 2A and 3C teaching one subject: 1A=3, 1B to 2A=2, 2B to 3C=1,
// nothing above), and the sources agree: the tally counts every tutor whose rate is at or above the level's, the tutor's request
// list shows requests at or below their own level, and accepting is refused only when the request is for a higher level.
check('the database counts every tutor at or above a level towards it, the request list and the accept step use the same rule',
  /select count\(\*\)::integer from eligible_tutors e where e\.tutor_rate >= s\.max_allowed_rate/.test(read('supabase/migrations/20260930160000_model3_pricing_levels.sql')) &&
    /s\.max_allowed_rate <= ts\.max_allowed_rate/.test(read('supabase/migrations/20261014200000_keep_or_swap.sql')) &&
    /if v_tutor\.tutor_rate < v_level_rate then/.test(read('supabase/migrations/20261014200000_keep_or_swap.sql')));
check('what can start a tutor at a level is listed under it, from the rows (eight levels have a credential; the others none)',
  (html.match(/data-credentials="/g) ?? []).length === 8 && ['2A', '2C', '2D', '3A', '3B', '3C', '4A', '4B'].every((id) => html.includes(`data-credentials="${id}"`)) &&
    (html.match(new RegExp(CREDENTIAL_LEAD, 'g')) ?? []).length === 8 && Object.values(CREDENTIALS).flat().every((label) => html.includes(label.replace(/&/g, '&amp;'))));
check('a level that no credential reaches shows no credential line', (() => {
  const none = renderToStaticMarkup(React.createElement(PriceLadder, { rows: ROWS.map((r) => ({ ...r, credentials: [] })), available: null, selectedId: null, onSelect: () => undefined, currencySymbol: () => 'R' }));
  return !none.includes(CREDENTIAL_LEAD);
})());
check('the minimums lead line is on every level but the first', (html.match(/To be at this level a tutor has:/g) ?? []).length === 15 && html.includes('No minimum yet'));

// ---- the source -----------------------------------------------------------------------------------------------------------------------
const prices = read('src/components/PricesPage.tsx');
const level = read('src/components/LevelSelectionPage.tsx');
const queries = read('src/lib/queries.ts');
const app = read('src/App.tsx');
const terms = read('src/content/legal/terms.md');
check('the request page shows the ladder where the "Choose a price" card was, and the button is gone', /<PriceLadder rows=\{ladder\} available=\{available\}/.test(prices) && !/Choose a price<\/button>|>\s*Choose a price\s*<\/button>/.test(prices));
check('choosing a level on the ladder sets the level, with its count of tutors (App passes onSelectLevel)', /onSelect=\{onSelectLevel\}/.test(prices) && /onSelectLevel=\{\(level\) => setSelectedLevel\(level\)\}/.test(app) && /tutors: tutors \?\? 0/.test(read('src/components/PriceLadder.tsx')));
check('Search re-runs the search on the same page instead of opening a second page', /handleApplySearch\(\);\s*\};/.test(prices) && !/onSearch/.test(prices) && !/onSearch=/.test(app));
check('no line tells people they cannot pick the tutor, or that the first to accept is matched, on the request pages (CEO, 17 Oct 2026)',
  !/You don't pick the tutor/.test(prices + level) && !/first to accept is matched/.test(prices + level) && !/cannot pick who accepts/.test(terms));
check('the ladder reads the minimums from the database\'s own table, in one read', /from\('sub_tier_definitions'\)[\s\S]{0,400}min_hours, min_rating, min_repeat_rate_pct, min_written_reviews, min_distinct_students_uplift, required_grade_uplift_pct/.test(queries) && /ladderCache/.test(queries));
check('the credential lines are read from credential_definitions (the admin app sets them), not written in the page', /from\('credential_definitions'\)[\s\S]{0,200}entry_sub_tier_id/.test(queries) && /credentials: credentialsByLevel\.get/.test(queries) && !/CREDENTIAL_ROUTES/.test(read('src/lib/ladderCopy.ts') + read('src/components/PriceLadder.tsx')));
check('the counts come from the same database function the old page used', /fetchAvailablePriceLevels\(\{ subject: appliedSubject/.test(prices));
check('the waiting-list prompt is still on the dead end when nobody teaches the subject', /FEATURES\.tutorWaitlist && waitlistLearnerId && appliedSubject\.trim\(\) !== ''/.test(prices));

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
