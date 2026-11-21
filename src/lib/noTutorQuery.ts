// P5-b: why no tutor is shown and when one is open (database function no_tutor_reason). Null when the function is not there yet.
// Kept out of queries.ts so the start page's script does not grow: only the prices page, which loads later, needs it.
import { supabase } from './supabaseClient';
import { askNoTutorReason, type NoTutorReason, type NoTutorSearch } from './noTutorReason';

export async function fetchNoTutorReason(params: NoTutorSearch): Promise<NoTutorReason | null> {
  return askNoTutorReason((fn, args) => supabase.rpc(fn, args), params);
}
