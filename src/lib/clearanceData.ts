// Reads the signed-in tutor's police clearance status (migration 20261020180000, not applied yet). Works before and after the migration: until
// it is applied the database function does not exist, the status comes back as null and the request list shows nothing extra.
import { supabase } from './supabaseClient';
import { isMissingDatabaseFunction } from './keepOrSwap';
import { type ClearanceStatus, toClearanceStatus } from './clearance';

// null when the database function is not there yet (the migration is not applied) or on any failure: the list then just shows nothing extra.
export async function fetchMyClearanceStatus(): Promise<ClearanceStatus | null> {
  const { data, error } = await supabase.rpc('my_police_clearance_status');
  if (error) {
    if (!isMissingDatabaseFunction(error)) console.error('my_police_clearance_status failed:', error);
    return null;
  }
  return toClearanceStatus(Array.isArray(data) ? data[0] : data);
}
