import { supabase } from './supabaseClient';
import { SignupRole, parseSignupRole } from './accountRules';
import { siteUrl } from './siteUrl';
import { forgetGoogleBooking, rememberGoogleBooking } from './bookingPath';

// The role the person picked before starting a Google sign-in, stashed so
// AuthCallback.tsx can read it back after the OAuth redirect round-trip —
// Google's own identity data has no room for our app-specific role choice the
// way email/password signUp()'s options.data does.
const PENDING_ROLE_KEY = 'tutorlage_oauth_role';

// `bookingCode`: set on a tutor's booking path, so the person comes back to that tutor's booking page.
export async function signInWithGoogle(role: SignupRole, bookingCode?: string): Promise<void> {
  localStorage.setItem(PENDING_ROLE_KEY, role);
  if (bookingCode) rememberGoogleBooking(bookingCode);
  else forgetGoogleBooking();

  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: siteUrl('/auth/callback') },
  });

  if (error) {
    localStorage.removeItem(PENDING_ROLE_KEY);
    forgetGoogleBooking();
    throw error;
  }
}

export function takePendingOAuthRole(): SignupRole | null {
  const role = localStorage.getItem(PENDING_ROLE_KEY);
  localStorage.removeItem(PENDING_ROLE_KEY);
  return role ? parseSignupRole(role) : null;
}
