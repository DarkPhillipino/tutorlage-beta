import { notSwitchedOn } from './subjectApprovals';
import { HOLD_NOT_ACTIVE } from './safetyHold';

// The "Safety holds" screen: everyone who is on a safety hold right now (migration 20261021120000, list_safety_holds()). The function is
// for admins only and returns the people whose newest hold line says "placed". On a database that does not have the migration yet, the
// screen shows HOLD_NOT_ACTIVE: never an error.

interface DbError { code?: string; message?: string }
export interface HoldListClient {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: DbError | null }>;
}

export interface SafetyHoldRow {
  profileId: string;
  name: string;
  email: string;
  // Only a tutor has a page in the admin app to link to.
  isTutor: boolean;
  reason: string;
  placedBy: string;
  placedAt: string;
}
export type SafetyHoldList = { state: 'ok'; holds: SafetyHoldRow[] } | { state: 'not_active'; note: string };

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

export async function fetchSafetyHolds(client: HoldListClient): Promise<SafetyHoldList> {
  const { data, error } = await client.rpc('list_safety_holds', {});
  if (error) {
    if (notSwitchedOn(error)) return { state: 'not_active', note: HOLD_NOT_ACTIVE };
    throw new Error(error.message ?? 'Could not load the safety holds.');
  }
  const holds = ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    profileId: str(r.hold_profile_id),
    name: str(r.hold_name),
    email: str(r.hold_email),
    isTutor: r.hold_is_tutor === true,
    reason: str(r.hold_reason),
    placedBy: str(r.hold_placed_by),
    placedAt: str(r.hold_placed_at),
  }));
  return { state: 'ok', holds };
}

// Where the screen links to for a held person, or null when they have no page (a learner or a guardian).
export const holdPagePath = (row: Pick<SafetyHoldRow, 'profileId' | 'isTutor'>): string | null =>
  row.isTutor && row.profileId ? `/verification/${row.profileId}` : null;
