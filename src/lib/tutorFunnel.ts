import { supabase } from './supabaseClient';

// Marketing's T11 ("first request received", 11 Nov 2026): nothing records a request being "offered" to a tutor, because tutors pull their list. So the Teach screen tells the
// database ONCE, the first time its request list returns a row (note_first_request_seen(), migration 20261110200000: it sets tutor_profiles.first_request_seen_at only if it is still
// empty, for the signed-in tutor only). Fire and forget: before the migration is applied, or on any error, nothing happens and nothing is shown.
let noted = false;

export function noteFirstRequestSeen(): void {
  if (noted) return;
  noted = true;
  void Promise.resolve(supabase.rpc('note_first_request_seen')).then(
    () => undefined,
    () => undefined,
  );
}
