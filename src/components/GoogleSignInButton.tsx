import React, { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { signInWithGoogle } from '../lib/oauth';
import { getErrorMessage } from '../lib/errors';
import { SignupRole } from '../lib/accountRules';

interface GoogleSignInButtonProps {
  role: SignupRole;
  label: string; // e.g. "Continue with Google" / "Sign up with Google"
  onError: (message: string) => void;
}

// The multi-color "G" mark, inline — no icon library ships Google's actual
// logo, and this is the standard way OAuth buttons render it without
// pulling in an image asset.
const GoogleMark: React.FC = () => (
  <svg className="w-4 h-4" viewBox="0 0 48 48" aria-hidden="true">
    <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.6-6 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.1 8 3l6-6C34 5.1 29.3 3 24 3 12.4 3 3 12.4 3 24s9.4 21 21 21 21-9.4 21-21c0-1.2-.1-2.4-.4-3.5z" />
    <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.6 15.9 18.9 13 24 13c3.1 0 5.8 1.1 8 3l6-6C34 5.1 29.3 3 24 3c-7.4 0-13.8 4.2-17 10.3z" />
    <path fill="#4CAF50" d="M24 45c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 36.4 26.7 37 24 37c-5.3 0-9.7-3.4-11.3-8l-6.5 5C9.1 40.6 15.9 45 24 45z" />
    <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4.1 5.6l6.2 5.2C40.7 36 44 30.6 44 24c0-1.2-.1-2.4-.4-3.5z" />
  </svg>
);

export const GoogleSignInButton: React.FC<GoogleSignInButtonProps> = ({ role, label, onError }) => {
  const [isSigningIn, setIsSigningIn] = useState(false);

  const handleClick = async () => {
    setIsSigningIn(true);
    try {
      await signInWithGoogle(role);
      // On success the browser navigates away to Google — this component
      // never re-renders past this point during the happy path.
    } catch (e) {
      onError(getErrorMessage(e, 'Could not start Google sign-in.'));
      setIsSigningIn(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isSigningIn}
      className="w-full flex items-center justify-center gap-2 bg-white hover:bg-slate-50 disabled:opacity-60 text-[#0F172A] font-bold py-3 px-6 rounded-xl border border-slate-300 transition-all cursor-pointer text-sm"
    >
      {isSigningIn ? <Loader2 className="w-4 h-4 animate-spin" /> : <GoogleMark />}
      <span>{label}</span>
    </button>
  );
};
