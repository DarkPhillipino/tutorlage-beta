import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { checkRecoveryLink, recoveryPending } from './recoveryLink';
import { PASSWORD_RESET_PATH } from './authRedirects';

// A safety net for the password-reset link (master 7cm). The link is meant to land on /reset-password, but if
// Supabase's Redirect URLs list does not include that address it sends the person to its Site URL instead, with the
// same reset session in the address. Without this they would be let into the app without ever choosing a new password.
//
// While a reset is pending in this tab (the link was opened and no new password has been saved yet), any other page
// sends the person on to the "Set a new password" page. It runs again on every change of page, not only the first:
// the sign-in pages also redirect a signed-in person to "/", and without this the two redirects raced and the app won
// (seen in a browser check, 10 Oct). ResetPassword.tsx ends the pending state when the password is saved, when the
// person leaves, and when the link turns out to be dead, so this can never trap anyone.
//
// It waits for supabase-js to finish reading the link first: moving to another address before that would throw the
// tokens away. Renders nothing.
export function RecoveryRedirect(): null {
  const navigate = useNavigate();
  const { pathname } = useLocation();

  useEffect(() => {
    if (pathname === PASSWORD_RESET_PATH || !recoveryPending()) return;
    let cancelled = false;
    // checkRecoveryLink() waits for supabase-js to finish reading the link, then says whether the server stood behind
    // it. A forged address (anyone can type "#type=recovery&access_token=x") is not a reset, so it moves nobody.
    checkRecoveryLink().then((verdict) => {
      if (!cancelled && verdict === 'confirmed' && recoveryPending()) navigate(PASSWORD_RESET_PATH, { replace: true });
    });
    return () => {
      cancelled = true;
    };
  }, [pathname, navigate]);

  return null;
}
