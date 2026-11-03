import { createClient } from '@supabase/supabase-js';
import { getDesktopBridge, secureAuthStorage } from './desktopBridge';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY. Set them in .env (see .env.example).');
}

// Same publishable key as the public Tutorlage app — admin access is
// enforced entirely by RLS policies keyed on admin_profiles.is_active, not
// by holding a more privileged key. See CLAUDE.md / src/CONTEXT.md in the
// main app for the full rationale.
//
// In the installed Windows app the sign-in session is kept by the desktop program, encrypted with Windows (see desktopBridge.ts), instead of in the page's
// own storage in plain text; in a normal browser nothing changes.
const desktop = getDesktopBridge();
export const supabase = desktop
  ? createClient(supabaseUrl, supabaseKey, { auth: { storage: secureAuthStorage(desktop, (() => { try { return window.localStorage; } catch { return undefined; } })()) } })
  : createClient(supabaseUrl, supabaseKey);
