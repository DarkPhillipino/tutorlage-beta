import { siteUrl } from './siteUrl';

// Where the links in Tutorlage's account emails bring the person back to: this same site (local or GitHub
// Pages, with its /tutorlage-beta/ base path, which siteUrl adds). Supabase only honours an address on its
// allow list (Authentication → URL Configuration → Redirect URLs) and otherwise uses its Site URL instead.
// Both the first sign-up email and "send the link again" use signupConfirmationRedirect(), so they cannot differ.

// The sign-up confirmation link: the login page signs the person straight in.
export const signupConfirmationRedirect = (): string => siteUrl('/login');

// The password-reset link: the "set a new password" page.
export const PASSWORD_RESET_PATH = '/reset-password';
export const passwordResetRedirect = (): string => siteUrl(PASSWORD_RESET_PATH);
