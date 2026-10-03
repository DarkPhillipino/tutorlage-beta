import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY. Set them in .env (see .env.example).');
}

// Same publishable key as the public Tutorlage app — admin access is
// enforced entirely by RLS policies keyed on admin_profiles.is_active, not
// by holding a more privileged key. See CLAUDE.md / src/CONTEXT.md in the
// main app for the full rationale.
export const supabase = createClient(supabaseUrl, supabaseKey);
