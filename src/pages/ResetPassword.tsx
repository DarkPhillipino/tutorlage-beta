import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertCircle, ArrowLeft, CheckCircle2, KeyRound, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { AUTH_COPY, MIN_PASSWORD_LENGTH, describeUpdatePasswordError, validateNewPassword } from '../lib/authHelpers';
import { arrivedWithLinkError, checkRecoveryLink, clearRecoveryPending, markRecoveryPending } from '../lib/recoveryLink';

// "Set a new password" (master 7cm): where the link in the password-reset email lands (see passwordResetRedirect in
// src/lib/authRedirects.ts). This route is public in main.tsx, outside RequireAuth and AccountGate on purpose: the
// link signs the person in with a short-lived "recovery" session, and without this page they would be dropped into
// the app without ever choosing a password.
//
// How the link arrives: supabase-js (implicit flow, BrowserRouter) reads #access_token=...&type=recovery from the
// address on start-up, stores the session and announces PASSWORD_RECOVERY. src/lib/recoveryLink.ts noted from the
// address that this load CLAIMS to be a reset link and then checks the claim with supabase-js's own result of reading
// it (checkRecoveryLink): the form only shows when Supabase accepted the token. That is what separates "arrived from
// the email" from "someone who is simply signed in typed the address", forged or not. Without it, the page says the
// link has expired. If Supabase could not be reached to ask, the page says so (and offers a reload) rather than
// calling a possibly good link used up.
type Phase = 'checking' | 'ready' | 'expired' | 'unreachable' | 'done';

const inputClass =
  'w-full bg-slate-100 text-[#0F172A] placeholder-slate-400 text-sm font-semibold px-4 py-3.5 rounded-xl border border-transparent focus:outline-none focus:border-[#15803D] focus:bg-white focus:ring-2 focus:ring-[#15803D]/20 transition-all';

export default function ResetPassword() {
  const navigate = useNavigate();
  const [phase, setPhase] = useState<Phase>('checking');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set while "Back to sign in" is signing the reset session out, so that sign-out is not shown as an expired link.
  const leaving = useRef(false);

  useEffect(() => {
    let cancelled = false;

    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (cancelled) return;
      if (event === 'PASSWORD_RECOVERY') {
        markRecoveryPending();
        setPhase((current) => (current === 'done' ? current : 'ready'));
      } else if (event === 'SIGNED_OUT' && !leaving.current) {
        setPhase((current) => (current === 'done' ? current : 'expired'));
      }
    });

    const check = async () => {
      // Supabase sent us back with an error: the link is past its time or was already used.
      if (arrivedWithLinkError) {
        setPhase('expired');
        return;
      }
      // Waits for supabase-js to finish reading the link, then says whether the server stood behind it.
      const verdict = await checkRecoveryLink();
      if (cancelled) return;
      if (verdict === 'could-not-check') {
        // No answer from Supabase: nothing is known about the link. The address still holds its tokens (supabase-js
        // only clears them after a good answer), so a reload tries again.
        setPhase((phaseNow) => (phaseNow === 'checking' ? 'unreachable' : phaseNow));
        return;
      }
      // The session is in by now (if the link was good).
      const { data: current } = await supabase.auth.getSession();
      if (cancelled) return;
      setPhase((phaseNow) => {
        if (phaseNow !== 'checking') return phaseNow;
        return current.session && verdict === 'confirmed' ? 'ready' : 'expired';
      });
    };
    check();

    return () => {
      cancelled = true;
      data.subscription.unsubscribe();
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving) return;
    setError(null);

    const problem = validateNewPassword(password, confirmation);
    if (problem) {
      setError(problem);
      return;
    }

    setIsSaving(true);
    let failure: unknown = null;
    try {
      const response = await supabase.auth.updateUser({ password });
      failure = response.error;
    } catch (caught) {
      failure = caught;
    }
    setIsSaving(false);

    if (failure) {
      const described = describeUpdatePasswordError(failure);
      if (described.kind === 'link_expired') {
        clearRecoveryPending();
        setPhase('expired');
        return;
      }
      setError(described.text);
      return;
    }

    clearRecoveryPending();
    // The reset link had signed the person in. They go on to sign in with the new password, which also shows them
    // that it works. "local" ends only this browser's session: signed-in phones and other tabs are left alone.
    leaving.current = true;
    try {
      await supabase.auth.signOut({ scope: 'local' });
    } catch {
      // Still signed in on this device: "Go to sign in" then lands in the app, which is where they were headed.
    }
    setPhase('done');
  };

  // The link signed the person in. Leaving without choosing a password should not leave them signed in.
  const leave = async () => {
    leaving.current = true;
    clearRecoveryPending();
    try {
      await supabase.auth.signOut({ scope: 'local' });
    } catch {
      // Nothing more to do: the sign-in page below is still where they go.
    }
    navigate('/login', { replace: true });
  };

  // A dead link ends the "reset pending" state, or the safety net in RecoveryRedirect would keep sending the person
  // back here from the "Back to sign in" and "Ask for a new link" buttons below.
  useEffect(() => {
    if (phase === 'expired') clearRecoveryPending();
  }, [phase]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#FAF7F2] px-6 py-12">
      <div className="w-full max-w-md">
        {phase === 'checking' && (
          <div className="bg-white rounded-2xl p-8 shadow-sm border border-slate-200/80 text-center">
            <Loader2 className="w-8 h-8 text-slate-400 animate-spin mx-auto mb-4" />
            <h1 className="text-base font-extrabold text-[#0F172A] mb-1">Checking your link…</h1>
            <p className="text-xs text-slate-500">Just a moment.</p>
          </div>
        )}

        {phase === 'expired' && (
          <div className="bg-white rounded-2xl p-8 shadow-sm border border-slate-200/80 text-center">
            <div className="w-12 h-12 bg-rose-100 rounded-full flex items-center justify-center text-rose-600 mx-auto mb-4">
              <AlertCircle className="w-6 h-6" />
            </div>
            <h1 className="font-serif text-2xl text-[#0F172A] mb-2">This link has expired or was already used</h1>
            <p className="text-sm text-slate-500 mb-6">
              Ask for a new one and we will email you another. A link works once, and only for a short time.
            </p>
            <Link
              to="/forgot-password"
              className="inline-block w-full bg-[#15803D] hover:bg-[#166534] text-white font-bold py-3 px-6 rounded-xl transition-all text-sm"
            >
              Ask for a new link
            </Link>
            <Link to="/login" className="inline-block mt-4 text-xs font-bold text-slate-600 hover:underline">
              Back to sign in
            </Link>
          </div>
        )}

        {phase === 'unreachable' && (
          <div className="bg-white rounded-2xl p-8 shadow-sm border border-slate-200/80 text-center">
            <div className="w-12 h-12 bg-amber-100 rounded-full flex items-center justify-center text-amber-600 mx-auto mb-4">
              <AlertCircle className="w-6 h-6" />
            </div>
            <h1 className="font-serif text-2xl text-[#0F172A] mb-2">{AUTH_COPY.linkNotCheckedTitle}</h1>
            <p className="text-sm text-slate-500 mb-6">{AUTH_COPY.linkNotCheckedBody}</p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="w-full bg-[#15803D] hover:bg-[#166534] text-white font-bold py-3 px-6 rounded-xl transition-all text-sm cursor-pointer"
            >
              Reload this page
            </button>
            <Link to="/login" className="inline-block mt-4 text-xs font-bold text-slate-600 hover:underline">
              Back to sign in
            </Link>
          </div>
        )}

        {phase === 'done' && (
          <div className="bg-white rounded-2xl p-8 shadow-sm border border-slate-200/80 text-center">
            <div className="w-14 h-14 bg-emerald-100 rounded-full flex items-center justify-center text-[#15803D] mx-auto mb-4">
              <CheckCircle2 className="w-7 h-7" />
            </div>
            <h1 className="font-serif text-2xl text-[#0F172A] mb-2">Your password is changed</h1>
            <p className="text-sm text-slate-500 mb-6">Sign in with your new password.</p>
            <button
              type="button"
              onClick={() => navigate('/login', { replace: true })}
              className="w-full bg-[#15803D] hover:bg-[#166534] text-white font-bold py-3 px-6 rounded-xl transition-all text-sm cursor-pointer"
            >
              Go to sign in
            </button>
          </div>
        )}

        {phase === 'ready' && (
          <>
            <button
              type="button"
              onClick={leave}
              className="inline-flex items-center space-x-1.5 text-sm font-bold text-slate-600 hover:text-[#0F172A] mb-6 cursor-pointer"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Back to sign in</span>
            </button>

            <div className="bg-white rounded-2xl p-8 shadow-sm border border-slate-200/80">
              <div className="flex items-center space-x-2 mb-1">
                <div className="w-10 h-10 rounded-xl bg-emerald-100 text-[#15803D] flex items-center justify-center shrink-0">
                  <KeyRound className="w-5 h-5" />
                </div>
                <span className="text-xs font-bold text-[#15803D] uppercase tracking-wider">Reset your password</span>
              </div>

              <h1 className="font-serif text-3xl text-[#0F172A] mb-6">Set a new password</h1>

              {error && (
                <div className="mb-4 flex items-start space-x-2 bg-rose-50 border border-rose-200 rounded-xl px-4 py-3 text-xs font-semibold text-rose-700" role="alert">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-3">
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1.5" htmlFor="newPassword">New password</label>
                  <input
                    id="newPassword"
                    type="password"
                    autoComplete="new-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
                    className={inputClass}
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1.5" htmlFor="confirmNewPassword">Confirm new password</label>
                  <input
                    id="confirmNewPassword"
                    type="password"
                    autoComplete="new-password"
                    required
                    value={confirmation}
                    onChange={(e) => setConfirmation(e.target.value)}
                    placeholder="••••••••"
                    className={inputClass}
                  />
                </div>

                <button
                  type="submit"
                  disabled={isSaving}
                  className="w-full bg-[#15803D] hover:bg-[#166534] disabled:opacity-60 disabled:cursor-not-allowed text-white font-bold py-3.5 px-6 rounded-xl transition-all shadow-md hover:shadow-lg active:scale-[0.99] flex items-center justify-center space-x-2 text-sm cursor-pointer mt-2"
                >
                  {isSaving && <Loader2 className="w-4 h-4 animate-spin" />}
                  <span>Save new password</span>
                </button>
              </form>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
