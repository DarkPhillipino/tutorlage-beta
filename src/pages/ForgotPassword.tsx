import React, { useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { AlertCircle, ArrowLeft, KeyRound, Loader2, MailCheck } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { parseSignupRole } from '../lib/accountRules';
import { passwordResetRedirect } from '../lib/authRedirects';
import {
  AUTH_COPY,
  cannotReceiveEmail,
  resendButtonLabel,
  resetRequestOutcome,
} from '../lib/authHelpers';
import { useCooldown } from '../lib/useCooldown';

// "Forgot your password?" (master 7cm). Asks Supabase to email a link that opens the "Set a new password" page
// (/reset-password, ResetPassword.tsx).
//
// Whatever the answer, the person sees the same neutral message, so this page cannot be used to find out which
// addresses have accounts. The one exception says nothing about any account: the request never reached Supabase.
// A learner's sign-in name (or its stored .invalid address) cannot receive mail, so those are told to ask their
// parent or guardian, decided from what was typed alone, before anything is sent.
type Status = 'idle' | 'sent' | 'unreachable' | 'no-email';

export default function ForgotPassword() {
  // /forgot-password/:role comes from the sign-in page; plain /forgot-password from an expired reset link.
  const { role: rawRole } = useParams<{ role?: string }>();
  const role = rawRole ? parseSignupRole(rawRole) : null;
  const location = useLocation();
  const carried = (location.state as { email?: unknown } | null)?.email;

  const [email, setEmail] = useState(typeof carried === 'string' ? carried : '');
  const [isSending, setIsSending] = useState(false);
  const [status, setStatus] = useState<Status>('idle');
  const { secondsLeft, start } = useCooldown();
  // The wait applies to the address a link was just sent to, not to a different one typed afterwards.
  const [lastSentTo, setLastSentTo] = useState<string | null>(null);

  const typed = email.trim();
  const waiting = secondsLeft > 0 && lastSentTo !== null && typed.toLowerCase() === lastSentTo;
  const sentBefore = lastSentTo !== null && typed.toLowerCase() === lastSentTo;
  // The "we have sent a link" message belongs to the address it was sent to.
  const showSent = status === 'sent' && sentBefore;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSending || waiting || !typed) return;

    if (cannotReceiveEmail(typed)) {
      setStatus('no-email');
      return;
    }

    setIsSending(true);
    let error: unknown = null;
    try {
      const response = await supabase.auth.resetPasswordForEmail(typed, { redirectTo: passwordResetRedirect() });
      error = response.error;
    } catch (caught) {
      error = caught;
    }
    setIsSending(false);

    if (resetRequestOutcome(error) === 'unreachable') {
      setStatus('unreachable');
      return;
    }
    setStatus('sent');
    setLastSentTo(typed.toLowerCase());
    start();
  };

  const backTo = role ? `/signin/${role}` : '/login';
  const isStudentBox = role === 'student';

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#FAF7F2] px-6 py-12">
      <div className="w-full max-w-md">
        <Link
          to={backTo}
          className="inline-flex items-center space-x-1.5 text-sm font-bold text-slate-600 hover:text-[#0F172A] mb-6"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to sign in</span>
        </Link>

        <div className="bg-white rounded-2xl p-8 shadow-sm border border-slate-200/80">
          <div className="flex items-center space-x-2 mb-1">
            <div className="w-10 h-10 rounded-xl bg-emerald-100 text-[#15803D] flex items-center justify-center shrink-0">
              <KeyRound className="w-5 h-5" />
            </div>
            <span className="text-xs font-bold text-[#15803D] uppercase tracking-wider">Reset your password</span>
          </div>

          <h1 className="font-serif text-3xl text-[#0F172A] mb-2">Forgot your password?</h1>
          <p className="text-sm text-slate-500 mb-6">
            Enter the email address you signed up with. We will send you a link to choose a new password.
          </p>

          {showSent && (
            <div
              className="mb-4 flex items-start space-x-2 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 text-xs font-semibold text-emerald-800"
              role="status"
            >
              <MailCheck className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                {AUTH_COPY.resetNeutral}
                <span className="block font-medium text-emerald-700 mt-1">{AUTH_COPY.emailArrivalHint}</span>
              </span>
            </div>
          )}

          {status === 'no-email' && (
            <div className="mb-4 flex items-start space-x-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-xs font-semibold text-amber-800" role="status">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{AUTH_COPY.learnerCannotGetEmail}</span>
            </div>
          )}

          {status === 'unreachable' && (
            <div className="mb-4 flex items-start space-x-2 bg-rose-50 border border-rose-200 rounded-xl px-4 py-3 text-xs font-semibold text-rose-700" role="alert">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{AUTH_COPY.unreachable}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1.5" htmlFor="email">
                {isStudentBox ? 'Email or sign-in name' : 'Email'}
              </label>
              <input
                id="email"
                type={isStudentBox ? 'text' : 'email'}
                inputMode="email"
                autoCapitalize="none"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (status === 'no-email' || status === 'unreachable') setStatus('idle');
                }}
                placeholder={isStudentBox ? 'you@example.com, or the name your parent gave you' : 'you@example.com'}
                className="w-full bg-slate-100 text-[#0F172A] placeholder-slate-400 text-sm font-semibold px-4 py-3.5 rounded-xl border border-transparent focus:outline-none focus:border-[#15803D] focus:bg-white focus:ring-2 focus:ring-[#15803D]/20 transition-all"
              />
            </div>

            <button
              type="submit"
              disabled={isSending || waiting}
              className="w-full bg-[#15803D] hover:bg-[#166534] disabled:opacity-60 disabled:cursor-not-allowed text-white font-bold py-3.5 px-6 rounded-xl transition-all shadow-md hover:shadow-lg active:scale-[0.99] flex items-center justify-center space-x-2 text-sm cursor-pointer mt-2"
            >
              {isSending && <Loader2 className="w-4 h-4 animate-spin" />}
              <span>{resendButtonLabel(isSending, waiting ? secondsLeft : 0, sentBefore ? 'Send the link again' : 'Send reset link')}</span>
            </button>
          </form>

          {!showSent && (
            <p className="text-[11px] text-slate-400 mt-4 leading-relaxed">{AUTH_COPY.emailArrivalHint}</p>
          )}

          <p className="text-center text-xs text-slate-500 mt-6">
            Remembered it?{' '}
            <Link to={backTo} className="font-bold text-[#15803D] hover:underline">
              Back to sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
