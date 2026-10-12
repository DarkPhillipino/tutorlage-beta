import React, { useState } from 'react';
import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import { supabase } from './supabaseClient';
import { signupConfirmationRedirect } from './authRedirects';
import {
  AUTH_COPY,
  cannotReceiveEmail,
  describeResendError,
  isRateLimited,
  rateLimitWaitSeconds,
  resendButtonLabel,
  signupResendKey,
} from './authHelpers';
import { useCooldown } from './useCooldown';

interface ResendConfirmationProps {
  // The address the sign-up confirmation went to. Give the component a `key` of this address, so a different
  // address starts with a fresh cool-down.
  email: string;
  className?: string;
}

type Result = { kind: 'sent' } | { kind: 'failed'; text: string } | null;

// "Send the link again" for the sign-up confirmation email (master 7cl). Used on the "Check your email" screen after
// sign-up and on the sign-in page when the answer is "email not confirmed". The button is off while a send is in
// progress and for 60 seconds after one, and the link comes back to the same address the first email's did.
// Learners who sign in with a name have no email address: they are told to ask their parent or guardian.
export const ResendConfirmation: React.FC<ResendConfirmationProps> = ({ email, className = '' }) => {
  const address = email.trim();
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<Result>(null);
  // Remembered per address, so closing this and opening it again inside the minute does not hand back a fresh button.
  // Sign-up starts the same wait when it sends the first email (CreateAccount.tsx), so on the "Check your email" screen
  // the button is off for the first minute: the server would only answer "too soon", and that answer (against "sent")
  // would tell whoever pressed it whether the address already has an account.
  const { secondsLeft, start } = useCooldown(undefined, signupResendKey(address));

  if (cannotReceiveEmail(address)) {
    return <p className={`text-xs text-slate-500 leading-relaxed ${className}`}>{AUTH_COPY.learnerCannotGetEmail}</p>;
  }

  const handleClick = async () => {
    if (sending || secondsLeft > 0) return;
    setSending(true);
    setResult(null);

    let error: unknown = null;
    try {
      const response = await supabase.auth.resend({
        type: 'signup',
        email: address,
        options: { emailRedirectTo: signupConfirmationRedirect() },
      });
      error = response.error;
    } catch (e) {
      error = e;
    }

    setSending(false);
    if (!error) {
      setResult({ kind: 'sent' });
      start();
      return;
    }
    setResult({ kind: 'failed', text: describeResendError(error) });
    // The server won't send another for a while either, so wait with it: as long as it says is left, else the minute.
    if (isRateLimited(error)) start(rateLimitWaitSeconds(error));
  };

  return (
    <div className={`space-y-2 ${className}`}>
      <button
        type="button"
        onClick={handleClick}
        disabled={sending || secondsLeft > 0}
        className="w-full flex items-center justify-center gap-2 bg-white hover:bg-slate-50 disabled:opacity-60 disabled:cursor-not-allowed text-[#0F172A] font-bold py-3 px-6 rounded-xl border border-slate-300 transition-all cursor-pointer text-sm"
      >
        {sending && <Loader2 className="w-4 h-4 animate-spin" />}
        <span>{resendButtonLabel(sending, secondsLeft)}</span>
      </button>

      <div aria-live="polite">
        {result?.kind === 'sent' && (
          <p className="flex items-start gap-1.5 text-xs font-semibold text-emerald-700">
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-px" />
            <span>{AUTH_COPY.resendSent}</span>
          </p>
        )}
        {result?.kind === 'failed' && (
          <p className="flex items-start gap-1.5 text-xs font-semibold text-rose-700">
            <AlertCircle className="w-4 h-4 shrink-0 mt-px" />
            <span>{result.text}</span>
          </p>
        )}
      </div>

      <p className="text-[11px] text-slate-400 leading-relaxed">{AUTH_COPY.emailArrivalHint}</p>
    </div>
  );
};
