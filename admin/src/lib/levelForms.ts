import type { CredentialConfig, LevelConfig, TierConfig } from '../types';

// The forms on the Levels page: what an admin types, checked in plain words before anything is sent. The database checks the
// same rules again (admin_save_sub_tier, admin_save_tier, admin_save_credential_definition), so these are for a friendly
// message, not for safety. No browser or Supabase code here: scripts/dev/levels-admin-test.ts runs it directly.

// "4,5" and " 4.5 " are 4.5; empty or words are null.
export function toNumber(text: string): number | null {
  const t = text.trim().replace(',', '.');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

const isWhole = (n: number | null): n is number => n !== null && Number.isInteger(n);

// ---- a level ------------------------------------------------------------------------------------------------------

export interface LevelDraft {
  id: string;
  tierId: string;
  price: string;
  minHours: string;
  minRating: string;
  minRepeatPct: string;
  minReviews: string;
  minStudents: string;
  uplift: string;
  sharePct: string;
}

export const levelDraftFrom = (l: LevelConfig): LevelDraft => ({
  id: l.id,
  tierId: String(l.tierId),
  price: String(l.price),
  minHours: String(l.minHours),
  minRating: String(l.minRating),
  minRepeatPct: String(l.minRepeatPct),
  minReviews: String(l.minReviews),
  minStudents: String(l.minStudents),
  uplift: String(l.uplift),
  sharePct: String(l.sharePct),
});

export const emptyLevelDraft = (tierId: number): LevelDraft => ({
  id: '',
  tierId: String(tierId),
  price: '',
  minHours: '0',
  minRating: '0',
  minRepeatPct: '0',
  minReviews: '0',
  minStudents: '0',
  uplift: '0',
  sharePct: '',
});

export function levelFromDraft(d: LevelDraft): { level: LevelConfig | null; problem: string | null } {
  const id = d.id.trim().toUpperCase();
  if (!/^[0-9][A-Z]$/.test(id)) return { level: null, problem: 'A level is named by its tier number and a letter, for example 2C.' };
  const tierId = toNumber(d.tierId);
  if (!isWhole(tierId)) return { level: null, problem: 'Choose the tier this level belongs to.' };
  const price = toNumber(d.price);
  if (price === null || price <= 0 || price > 100000) return { level: null, problem: 'The price must be more than 0.' };
  const minHours = toNumber(d.minHours);
  const minReviews = toNumber(d.minReviews);
  const minStudents = toNumber(d.minStudents);
  if (!isWhole(minHours) || !isWhole(minReviews) || !isWhole(minStudents) || minHours < 0 || minReviews < 0 || minStudents < 0) {
    return { level: null, problem: 'Hours, reviews and learners must be whole numbers, 0 or more.' };
  }
  const minRating = toNumber(d.minRating);
  if (minRating === null || minRating < 0 || minRating > 5) return { level: null, problem: 'The rating is a number from 0 to 5.' };
  const minRepeatPct = toNumber(d.minRepeatPct);
  const uplift = toNumber(d.uplift);
  if (minRepeatPct === null || minRepeatPct < 0 || minRepeatPct > 100 || uplift === null || uplift < 0 || uplift > 100) {
    return { level: null, problem: 'The percentages are numbers from 0 to 100.' };
  }
  const sharePct = toNumber(d.sharePct);
  if (sharePct === null || sharePct < 0 || sharePct > 100) return { level: null, problem: "Tutorlage's share is a percentage from 0 to 100." };
  return { level: { id, tierId, price, minHours, minRating, minRepeatPct, minReviews, minStudents, uplift, sharePct }, problem: null };
}

// ---- a tier -------------------------------------------------------------------------------------------------------

export interface TierDraft {
  id: number;
  publicName: string;
  quote: string;
  minRate: string;
  maxRate: string;
  sharePct: string;
}

export const tierDraftFrom = (t: TierConfig): TierDraft => ({
  id: t.id,
  publicName: t.publicName,
  quote: t.quote,
  minRate: String(t.minRate),
  maxRate: String(t.maxRate),
  sharePct: String(t.sharePct),
});

export function tierFromDraft(d: TierDraft): { tier: Omit<TierConfig, 'currencyCode'> | null; problem: string | null } {
  if (d.publicName.trim().length < 2) return { tier: null, problem: 'A tier needs a name.' };
  const minRate = toNumber(d.minRate);
  const maxRate = toNumber(d.maxRate);
  if (minRate === null || maxRate === null || minRate < 0 || maxRate < minRate) {
    return { tier: null, problem: 'The rates must be numbers, the highest not below the lowest.' };
  }
  const sharePct = toNumber(d.sharePct);
  if (sharePct === null || sharePct < 0 || sharePct > 100) return { tier: null, problem: "Tutorlage's share is a percentage from 0 to 100." };
  return { tier: { id: d.id, publicName: d.publicName.trim(), quote: d.quote.trim(), minRate, maxRate, sharePct }, problem: null };
}

// ---- a credential -------------------------------------------------------------------------------------------------

export interface CredentialDraft {
  code: string;
  label: string;
  entrySubTier: string;
  recencyYears: string;
  description: string;
}

export const credentialDraftFrom = (c: CredentialConfig): CredentialDraft => ({
  code: c.code,
  label: c.label,
  entrySubTier: c.entrySubTier ?? '',
  recencyYears: c.recencyYears === null ? '' : String(c.recencyYears),
  description: c.description ?? '',
});

// "Head of department (or equivalent)" becomes head_of_department_or_equivalent: lower case, letters and digits, starting with a
// letter, at most 41 characters (what the database accepts).
export function codeFromLabel(label: string): string {
  const code = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^[^a-z]+/, '')
    .replace(/_+$/, '')
    .slice(0, 41)
    .replace(/_+$/, '');
  return code;
}

export function credentialFromDraft(d: CredentialDraft): { credential: Omit<CredentialConfig, 'heldBy'> | null; problem: string | null } {
  const code = d.code.trim().toLowerCase();
  if (!/^[a-z][a-z0-9_]{2,40}$/.test(code)) return { credential: null, problem: 'The code is lower-case letters, digits and underscores, 3 to 41 characters, starting with a letter.' };
  if (d.label.trim().length < 3) return { credential: null, problem: 'A credential needs a name.' };
  if (!d.entrySubTier) return { credential: null, problem: 'Choose the level this credential starts a tutor at.' };
  let recencyYears: number | null = null;
  if (d.recencyYears.trim() !== '') {
    const years = toNumber(d.recencyYears);
    if (!isWhole(years) || years < 1 || years > 50) return { credential: null, problem: 'Years of validity is a whole number from 1 to 50, or empty for no limit.' };
    recencyYears = years;
  }
  return {
    credential: { code, label: d.label.trim(), entrySubTier: d.entrySubTier, recencyYears, description: d.description.trim() || null },
    problem: null,
  };
}

// ---- does the ladder still climb? ---------------------------------------------------------------------------------

// Levels in price order. A level that costs more but asks for fewer hours than the level below it is almost always a typo, and two
// levels at one price cannot be told apart, so say so (a warning, never a block: the CEO may mean it). The other minimums are
// not compared: the live ladder already has the rating dip a little between tiers, on purpose.
export function ladderWarnings(levels: LevelConfig[]): string[] {
  const sorted = [...levels].sort((a, b) => a.price - b.price);
  const warnings: string[] = [];
  for (let i = 1; i < sorted.length; i += 1) {
    const lower = sorted[i - 1];
    const higher = sorted[i];
    if (higher.price === lower.price) warnings.push(`${higher.id} and ${lower.id} have the same price.`);
    else if (higher.minHours < lower.minHours) {
      warnings.push(`${higher.id} (R${higher.price}) asks for fewer hours (${higher.minHours}) than ${lower.id} (R${lower.price}, ${lower.minHours} hours).`);
    }
  }
  return warnings;
}
