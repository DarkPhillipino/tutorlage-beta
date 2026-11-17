import React, { useState } from 'react';
import { AlertCircle, Loader2, MailCheck } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { passwordResetRedirect } from '../lib/authRedirects';
import { AUTH_COPY, cannotReceiveEmail, isRateLimited, resendButtonLabel, resetRequestOutcome } from '../lib/authHelpers';
import { useCooldown } from '../lib/useCooldown';

// CHANGE YOUR PASSWORD, in Manage Account (17 Nov 2026; the CEO: "users must be able to change their own password through a confirmation email").
// It asks Supabase to email the signed-in person's own address the same link the "Forgot your password?" page sends; the link opens the "Set a new password" page
// (/reset-password, ResetPassword.tsx). Nothing is typed here and no password passes through this card. A learner a guardian added has a sign-in name with no inbox, so
// they are told to ask their guardian (the same words as the forgot-password page).
type Status = 'idle' | 'sent' | 'unreachable' | 'busy' | 'no-email';

export const ChangePasswordCard: React.FC<{ email: string }> = ({ email }) => {
  const [status, setStatus] = useState<Status>('idle');
  const [isSending, setIsSending] = useState(false);
  const { secondsLeft, start } = useCooldown();
  const waiting = secondsLeft > 0 && status === 'sent';

  const send = async () => {
    if (isSending || waiting) return;
    if (cannotReceiveEmail(email)) {
      setStatus('no-email');
      return;
    }
    setIsSending(true);
    let error: unknown = null;
    try {
      const response = await supabase.auth.resetPasswordForEmail(email, { redirectTo: passwordResetRedirect() });
      error = response.error;
    } catch (caught) {
      error = caught;
    }
    setIsSending(false);
    if (resetRequestOutcome(error) === 'unreachable') {
      setStatus('unreachable');
      return;
    }
    if (error && isRateLimited(error)) {
      setStatus('busy');
      return;
    }
    setStatus('sent');
    start();
  };

  return (
    <div data-change-password className="bg-white rounded-2xl p-4 border border-slate-200">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Password</div>
          <div className="text-xs text-slate-600 mt-0.5 leading-relaxed">We email a link to {email || 'your address'} so you can choose a new one.</div>
        </div>
        <button
          type="button"
          onClick={() => void send()}
          disabled={isSending || waiting || !email}
          className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 disabled:opacity-60 disabled:cursor-not-allowed text-[#0F172A] font-bold text-xs rounded-xl transition-colors cursor-pointer"
        >
          {isSending && <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />}
          {resendButtonLabel(isSending, waiting ? secondsLeft : 0, status === 'sent' ? 'Send the link again' : 'Change password')}
        </button>
      </div>

      {status === 'sent' && (
        <div role="status" className="mt-3 flex items-start gap-2 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2.5 text-xs font-semibold text-emerald-800">
          <MailCheck className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
          <span>
            We have sent a link to {email}. Open it to choose a new password, then sign in with the new one.
            <span className="block font-medium text-emerald-700 mt-1">{AUTH_COPY.emailArrivalHint}</span>
          </span>
        </div>
      )}
      {status === 'no-email' && (
        <div role="status" className="mt-3 flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5 text-xs font-semibold text-amber-800">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
          <span>{AUTH_COPY.learnerCannotGetEmail}</span>
        </div>
      )}
      {status === 'busy' && (
        <div role="alert" className="mt-3 flex items-start gap-2 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2.5 text-xs font-semibold text-rose-700">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
          <span>{AUTH_COPY.rateLimited}</span>
        </div>
      )}
      {status === 'unreachable' && (
        <div role="alert" className="mt-3 flex items-start gap-2 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2.5 text-xs font-semibold text-rose-700">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
          <span>{AUTH_COPY.unreachable}</span>
        </div>
      )}
    </div>
  );
};
