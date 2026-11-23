import type { SubTierDefinition } from '../types';

// The level a tutor is working towards (the Teach screen's "Unlock ..." box).
// Until 23 Nov 2026 the screen looked only inside the tutor's own tier, so a tutor at 1D, 2D or 3D was told "Top tier reached" although 2A, 3A or
// 4A exist. The next level is the next one in the tier or, from the last level of a tier, the first level of the next tier.
// Tier 4 is never offered as a next step: the public price ladder hides it until a tutor is in it (PM decision 6, 23 Nov 2026), so a tutor at 3D
// sees no next step, as before. A tutor already IN tier 4 moves inside tier 4 as usual.
export const LAST_TIER_SHOWN_AS_NEXT_STEP = 3;

// sameTier: the sub-levels of the tutor's own tier, in the order the database returns them (lowest hours first).
// firstOfNextTier: the first sub-level of the tier above, or null when it was not read.
export function pickNextSubTier(
  currentSubTierId: string,
  currentTierId: number,
  sameTier: SubTierDefinition[],
  firstOfNextTier: SubTierDefinition | null,
): SubTierDefinition | null {
  const currentCode = currentSubTierId.slice(-1);
  const currentIndex = sameTier.findIndex((s) => s.subTierCode === currentCode);
  const inTier = sameTier[currentIndex + 1] ?? null;
  if (inTier) return inTier;
  if (currentIndex === -1) return null;
  if (currentTierId + 1 > LAST_TIER_SHOWN_AS_NEXT_STEP) return null;
  return firstOfNextTier && firstOfNextTier.tierId === currentTierId + 1 ? firstOfNextTier : null;
}

// True when the next level is in another tier (the label then names the level, "level 2A", as the progression notice already does).
export function isNextTierStep(current: { tierId: number }, next: SubTierDefinition): boolean {
  return next.tierId !== current.tierId;
}
