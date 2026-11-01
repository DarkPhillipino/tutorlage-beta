import { createClient } from '@supabase/supabase-js';
import { withReadTimeout } from './readTimeout';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY. Set them in .env (see .env.example).');
}

// Reads that get no answer for 30 seconds are given up on, so a screen shows its error and "Try again" instead of "Loading…" for ever on a
// stalled mobile connection. Writes, uploads, sign-in and token refresh are never cut short: see readTimeout.ts for exactly which calls.
export const supabase = createClient(supabaseUrl, supabaseKey, { global: { fetch: withReadTimeout(fetch.bind(globalThis)) } });
