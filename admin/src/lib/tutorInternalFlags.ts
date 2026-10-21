import { supabase } from './supabaseClient';
import { notSwitchedOn } from './subjectApprovals';

export interface TutorInternalFlags {
  credentialFloor: string | null;
  frozen: boolean;
  freezeReason: string | null;
}

// A tutor's freeze flag, freeze reason and credential floor are admin-only since migration 20261020170000 (public read fixes): the
// browser roles can no longer select those columns, so the admin app asks admin_tutor_internal_flags(), which checks the caller is an
// active admin. Until that migration is applied the function does not exist and the columns are still readable, so the old direct read
// is used then. Both ways give the same answer.
export async function fetchTutorInternalFlags(tutorId: string): Promise<TutorInternalFlags> {
  const viaFunction = await supabase.rpc('admin_tutor_internal_flags', { p_tutor: tutorId });
  if (!viaFunction.error) return toFlags((viaFunction.data as Record<string, unknown>[] | null)?.[0]);
  if (!notSwitchedOn(viaFunction.error)) throw viaFunction.error;
  const { data, error } = await supabase
    .from('tutor_profiles')
    .select('credential_floor_sub_tier_id, tier_frozen, freeze_reason')
    .eq('id', tutorId)
    .maybeSingle();
  if (error) throw error;
  return toFlags(data as Record<string, unknown> | null);
}

function toFlags(row: Record<string, unknown> | null | undefined): TutorInternalFlags {
  return {
    credentialFloor: (row?.credential_floor_sub_tier_id as string | null | undefined) ?? null,
    frozen: row?.tier_frozen === true,
    freezeReason: (row?.freeze_reason as string | null | undefined) ?? null,
  };
}
