import { supabase } from './supabaseClient';
import type { SuggestionClient } from './platformSuggestions';

// The Suggestions box (platformSuggestions.ts) bound to the app's own signed-in client. The real client's query builder is far richer than
// SuggestionClient describes, so it is passed through one cast here (the same pattern as walletDb in walletHooks.ts). Kept apart from the box so the
// box and its words load under Node in the tests.
export const suggestionDb = supabase as unknown as SuggestionClient;
