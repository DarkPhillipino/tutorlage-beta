import { supabase } from './supabaseClient';

// The role the person picked before starting a Google sign-in, stashed so
// AuthCallback.tsx can read it back after the OAuth redirect round-trip —
// Google's own identity data has no room for our app-specific "tutor" vs
// "student" choice the way email/password signUp()'s options.data does.
const PENDING_ROLE_KEY = 'tutorlage_oauth_role';

export async function signInWithGoogle(role: 'tutor' | 'student'): Promise<void> {
  localStorage.setItem(PENDING_ROLE_KEY, role);

  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: `${window.location.origin}/auth/callback` },
  });

  if (error) {
    localStorage.removeItem(PENDING_ROLE_KEY);
    throw error;
  }
}

export function takePendingOAuthRole(): 'tutor' | 'student' | null {
  const role = localStorage.getItem(PENDING_ROLE_KEY);
  localStorage.removeItem(PENDING_ROLE_KEY);
  return role === 'tutor' || role === 'student' ? role : null;
}
