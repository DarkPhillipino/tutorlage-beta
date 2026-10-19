// The call that counts the tutors who can take a request at each price level (database function available_price_levels).
// Since 19 Oct 2026 the function can also take the start, the length and the curriculum; until that migration is applied it only
// knows the three old values, and the page must work before and after. No browser or Supabase code, so
// scripts/dev/request-schedule-test.ts runs it with a pretend database.
import { isMissingDatabaseFunction } from './keepOrSwap';

export interface PriceLevelSearch {
  subject: string;
  gradeLevel: string;
  institutionId: string | null;
  start?: string | null; // ISO moment
  hours?: number | null;
  curriculumId?: string | null;
}

export type PriceLevelRpc = (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;

// Asks with the new values when there are any; if the database says the function with those arguments is missing (the migration is
// not applied yet), asks again with the three old values. Any other error is the caller's to handle.
export async function askAvailablePriceLevels(rpc: PriceLevelRpc, search: PriceLevelSearch): Promise<unknown[]> {
  const base = { p_subject: search.subject, p_grade: search.gradeLevel, p_institution: search.institutionId };
  const extended = !!(search.start || search.hours || search.curriculumId);
  let { data, error } = await rpc(
    'available_price_levels',
    extended
      ? { ...base, p_start: search.start ?? null, p_hours: search.hours ?? null, p_curriculum: search.curriculumId ?? null }
      : base,
  );
  if (error && extended && isMissingDatabaseFunction(error)) {
    ({ data, error } = await rpc('available_price_levels', base));
  }
  if (error) throw error;
  return (data ?? []) as unknown[];
}
