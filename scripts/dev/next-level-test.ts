// The Teach screen's "Unlock ..." box (23 Nov 2026): the next level is looked for ACROSS tiers. Before, a tutor at 1D, 2D or 3D was told "Top tier reached".
//   npx --no-install tsx scripts/dev/next-level-test.ts
import fs from 'node:fs';
import { isNextTierStep, pickNextSubTier } from '../../src/lib/nextLevel';
import type { SubTierDefinition } from '../../src/types';

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
};

const def = (tierId: number, code: string): SubTierDefinition => ({
  id: `${tierId}${code}`, tierId, subTierCode: code, maxAllowedRate: 0, minHours: 0, minRating: 0, minRepeatRatePct: 0, minWrittenReviews: 0, minDistinctStudentsUplift: 0, requiredGradeUpliftPct: 0,
});
const tier = (n: number) => ['A', 'B', 'C', 'D'].map((c) => def(n, c));
const next = (current: string) => {
  const t = Number(current[0]);
  return pickNextSubTier(current, t, tier(t), t < 4 ? tier(t + 1)[0] : null)?.id ?? null;
};

check('1A goes to 1B (inside the tier, as before)', next('1A') === '1B');
check('1C goes to 1D', next('1C') === '1D');
check('1D goes to 2A (was "Top tier reached")', next('1D') === '2A');
check('2D goes to 3A (Odi is at 2D)', next('2D') === '3A');
check('3D shows no next step: tier 4 is not offered while the public ladder hides it', next('3D') === null);
check('4A to 4C still move inside tier 4 for a tutor who is there', next('4A') === '4B' && next('4C') === '4D');
check('4D is the real top: no next step', next('4D') === null);
check('a next tier that was not read gives no step (not a wrong one)', pickNextSubTier('1D', 1, tier(1), null) === null);
check('a "next tier" that is the wrong tier is ignored', pickNextSubTier('1D', 1, tier(1), def(3, 'A')) === null);
check('the label names the level only when the step crosses tiers', isNextTierStep({ tierId: 1 }, def(2, 'A')) && !isNextTierStep({ tierId: 1 }, def(1, 'B')));

const screen = fs.readFileSync(new URL('../../src/components/TeachGoScreen.tsx', import.meta.url), 'utf8');
check('the screen uses pickNextSubTier and still says "Top tier reached" only when there is no next step', /pickNextSubTier\(/.test(screen) && /nextSubTier \? \(/.test(screen) && /Top tier reached/.test(screen));
check('the screen does not read tier 4 as a next step', /LAST_TIER_SHOWN_AS_NEXT_STEP/.test(screen));

console.log(failures ? `\n${failures} FAILED` : '\nall checks passed');
process.exit(failures ? 1 : 0);
