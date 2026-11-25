import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, ArrowLeft, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { toSignInEmail } from '../lib/accountRules';
import { describeSignInError } from '../lib/authHelpers';
import { ResendConfirmation } from '../lib/ResendConfirmation';
import { FEATURES } from '../lib/features';
import { pagePath, signUpPath, type PublicTutorPage } from '../lib/publicTutorPage';
import { GoogleSignInButton } from './GoogleSignInButton';
import { PasswordInput } from './PasswordInput';
import { LinkRolePicker, type BookingRole } from './LinkRolePicker';
import { LINK_BUTTON, LINK_CARD, LINK_INPUT, LINK_LABEL, LinkShell, TutorHero } from './LinkShell';

// SIGNING IN ON A TUTOR'S BOOKING PATH (PM line 79 C, 25 Nov 2026): the "Welcome back" card of /signin/parent, with "Parent or guardian" and "Learner", no tutor choice anywhere, and Back to the
// tutor's page. It stands at /t/CODE/book itself, so signing in with a password simply shows the booking page in the same place. Google waits until one of the two is chosen.
export function LinkSignIn({ page }: { page: PublicTutorPage }) {
  const [role, setRole] = useState<BookingRole | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unconfirmedAddress, setUnconfirmedAddress] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setUnconfirmedAddress(null);
    setBusy(true);
    // Learners a guardian added may sign in with a sign-in name instead of an email.
    const address = toSignInEmail(email);
    const { error: signInError } = await supabase.auth.signInWithPassword({ email: address, password });
    setBusy(false);
    if (signInError) {
      const problem = describeSignInError(signInError, role === 'parent' ? 'email' : 'email or sign-in name', address);
      setError(problem.text);
      if (problem.needsConfirmation) setUnconfirmedAddress(address);
    }
  };

  return (
    <LinkShell homeTo={pagePath(page.code)} hero={<TutorHero name={page.firstName} photo={page.photo} title={`Book with ${page.firstName}`} subtitle="Sign in to choose your lesson" />}>
      <section className={LINK_CARD} data-link-signin>
        <Link to={pagePath(page.code)} className="inline-flex items-center gap-1.5 text-sm font-bold text-slate-600 hover:text-[#0F172A] py-2 -mt-2">
          <ArrowLeft className="w-4 h-4" aria-hidden="true" />
          <span>Back</span>
        </Link>
        <h2 className="font-serif text-3xl mb-3">Welcome back</h2>

        <div className="mb-3">
          <LinkRolePicker value={role} onChange={setRole} />
        </div>

        {error && (
          <div role="alert" className="mb-4 flex items-start gap-2 bg-rose-50 border border-rose-200 rounded-xl px-4 py-3 text-xs font-semibold text-rose-700">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}
        {unconfirmedAddress && <ResendConfirmation key={unconfirmedAddress} email={unconfirmedAddress} className="mb-4" />}

        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className={LINK_LABEL} htmlFor="email">{role === 'student' ? 'Email or sign-in name' : 'Email'}</label>
            <input
              id="email"
              type="text"
              inputMode="email"
              autoComplete="username"
              autoCapitalize="none"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={role === 'student' ? 'you@example.com, or the name your parent gave you' : 'you@example.com'}
              className={LINK_INPUT}
            />
          </div>
          <div>
            <label className={LINK_LABEL} htmlFor="password">Password</label>
            <PasswordInput id="password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" className={LINK_INPUT} />
            <div className="flex justify-end mt-1.5">
              {/* What was typed travels in the router's state, not the address bar (no personal data in URLs). */}
              <Link to={`/forgot-password/${role ?? 'parent'}`} state={{ email }} className="text-xs font-bold text-[#15803D] hover:underline py-1">Forgot your password?</Link>
            </div>
          </div>
          <button type="submit" disabled={busy} className={`${LINK_BUTTON} flex items-center justify-center gap-2`}>
            {busy && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
            <span>Sign In</span>
          </button>
        </form>

        {FEATURES.googleSignIn && (
          <>
            <div className="flex items-center gap-3 my-5">
              <div className="flex-1 h-px bg-slate-200" />
              <span className="text-[11px] font-bold text-slate-600 uppercase tracking-wider">or</span>
              <div className="flex-1 h-px bg-slate-200" />
            </div>
            <GoogleSignInButton role={role ?? 'student'} bookingCode={page.code} disabled={role === null} label="Continue with Google" onError={setError} />
            {role === null && <p className="text-[11px] text-slate-600 mt-2 text-center">To use Google, first choose Parent or guardian, or Learner.</p>}
          </>
        )}

        <p className="text-center text-sm text-slate-600 mt-5">
          New to Tutorlage?{' '}
          <Link to={signUpPath(page.code)} state={{ role }} className="font-bold text-[#15803D] hover:underline">Create account</Link>
        </p>
        <p className="text-center text-xs mt-3">
          <Link to="/privacy" target="_blank" className="font-bold text-[#15803D] hover:underline">Privacy Policy</Link>
        </p>
      </section>
    </LinkShell>
  );
}
