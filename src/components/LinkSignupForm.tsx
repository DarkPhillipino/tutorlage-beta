import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { PasswordInput } from './PasswordInput';
import type { PolicyVersions } from '../lib/queries';
import { COPY } from '../lib/accountRules';
import { MIN_PASSWORD_LENGTH, validateNewPassword } from '../lib/authHelpers';
import { apiUrl } from '../lib/api';
import { ONE_STEP_COPY, createAccountByLink, type LinkDetails } from '../lib/signupByLink';

// THE ONE-STEP TUTOR SIGN-UP (job T, 18 Nov 2026): shown by src/pages/CreateAccount.tsx ONLY when the Worker says this personal link can make the account already confirmed (the database
// switch signup_link_confirms is on and the link is good; see src/lib/signupByLink.ts). The person sees the details from the list, answers "Is this the right email?", chooses a password and
// ticks the Terms (never pre-ticked). Everything else comes from the list row on the server. "No, change my details" hands over to the ordinary form (a confirmation email is then sent, as always).
const inputClass = 'w-full bg-slate-100 text-[#0F172A] placeholder-slate-400 text-sm font-semibold px-4 py-3.5 rounded-xl border border-transparent focus:outline-none focus:border-[#15803D] focus:bg-white focus:ring-2 focus:ring-[#15803D]/20 transition-all';
const labelClass = 'block text-xs font-bold text-slate-500 mb-1.5';

const niceDate = (iso: string): string => {
  const [y, m, d] = iso.split('-').map(Number);
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return y && m && d ? `${d} ${months[m - 1]} ${y}` : iso;
};

interface Props {
  details: LinkDetails;
  token: string;
  versions: PolicyVersions | null;
  // Hands over to the ordinary form. `message` is shown above it (why we switched), if any.
  onUseFullForm: (message?: string) => void;
}

export function LinkSignupForm({ details, token, versions, onUseFullForm }: Props) {
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [madeButNotSignedIn, setMadeButNotSignedIn] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const problem = validateNewPassword(password, confirmPassword);
    if (problem) {
      setError(problem);
      return;
    }
    if (!accepted) {
      setError('Please accept the Terms of Service and the Privacy Policy to create an account.');
      return;
    }
    setBusy(true);
    const made = await createAccountByLink({ token, password, termsVersion: versions?.termsVersion ?? null, privacyVersion: versions?.privacyVersion ?? null }, apiUrl);
    if (made.ok === false) {
      setBusy(false);
      if (made.kind === 'fallback') onUseFullForm(made.message);
      else setError(made.message);
      return;
    }
    // The account exists and its email is confirmed: sign in with the password just chosen.
    const { error: signInError } = await supabase.auth.signInWithPassword({ email: details.email, password });
    setBusy(false);
    if (signInError) {
      setMadeButNotSignedIn(true);
      return;
    }
    navigate('/', { replace: true });
  };

  if (madeButNotSignedIn) {
    return (
      <div data-link-signup="ready" role="status" className="text-center">
        <div className="w-14 h-14 bg-emerald-100 rounded-full flex items-center justify-center text-[#15803D] mx-auto mb-4">
          <CheckCircle2 className="w-7 h-7" />
        </div>
        <h2 className="font-serif text-2xl text-[#0F172A] mb-2">{ONE_STEP_COPY.ready}</h2>
        <p className="text-sm text-slate-600 mb-6">{ONE_STEP_COPY.readyBody}</p>
        <Link to="/signin/tutor" state={{ email: details.email }} className="inline-block w-full bg-[#15803D] hover:bg-[#166534] text-white font-bold py-3 px-6 rounded-xl transition-all text-sm">
          Go to Sign In
        </Link>
      </div>
    );
  }

  return (
    <div data-link-signup="form">
      <p data-prefilled="true" role="status" className="mb-4 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 text-xs font-semibold text-emerald-900 leading-relaxed">{ONE_STEP_COPY.notice}</p>

      {error && (
        <div role="alert" className="mb-4 flex items-start space-x-2 bg-rose-50 border border-rose-200 rounded-xl px-4 py-3 text-xs font-semibold text-rose-700">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      <dl data-link-details className="mb-4 rounded-xl border border-slate-200 divide-y divide-slate-200 text-sm">
        <div className="px-4 py-2.5 flex justify-between gap-4"><dt className="text-slate-600 font-semibold">Name</dt><dd className="text-[#0F172A] font-bold text-right">{details.firstName} {details.surname}</dd></div>
        <div className="px-4 py-2.5 flex justify-between gap-4"><dt className="text-slate-600 font-semibold">Email</dt><dd data-link-email className="text-[#0F172A] font-bold text-right break-all">{details.email}</dd></div>
        {details.phone && <div className="px-4 py-2.5 flex justify-between gap-4"><dt className="text-slate-600 font-semibold">Phone</dt><dd className="text-[#0F172A] font-bold text-right">{details.phone}</dd></div>}
        <div className="px-4 py-2.5 flex justify-between gap-4"><dt className="text-slate-600 font-semibold">Date of birth</dt><dd className="text-[#0F172A] font-bold text-right">{niceDate(details.dateOfBirth)}</dd></div>
      </dl>

      <div data-link-email-question className="mb-4 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3">
        <p className="text-sm font-bold text-[#0F172A]">{ONE_STEP_COPY.emailQuestion}</p>
        <p className="text-xs text-slate-600 leading-relaxed mt-1">{ONE_STEP_COPY.emailWhy}</p>
        <button type="button" onClick={() => onUseFullForm(ONE_STEP_COPY.changeDetailsNote)} className="mt-2 text-xs font-bold text-[#15803D] hover:underline cursor-pointer">
          {ONE_STEP_COPY.changeDetails}
        </button>
      </div>

      <form onSubmit={submit} className="space-y-3">
        <div>
          <label className={labelClass} htmlFor="link-password">Choose a password</label>
          <PasswordInput id="link-password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="link-confirm-password">Confirm password</label>
          <PasswordInput id="link-confirm-password" required value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="••••••••" className={inputClass} />
        </div>

        {/* Legal spec §1: never pre-ticked; the account can't be created without it. */}
        <label className="flex items-start space-x-2.5 text-sm text-slate-600 cursor-pointer pt-1">
          <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} className="mt-0.5 w-4 h-4 accent-[#15803D] shrink-0" />
          <span>
            {COPY.acceptTermsLead}{' '}
            <Link to="/terms" target="_blank" className="font-bold text-[#15803D] hover:underline">Terms of Service</Link>
            {' '}and the{' '}
            <Link to="/privacy" target="_blank" className="font-bold text-[#15803D] hover:underline">Privacy Policy</Link>.
          </span>
        </label>
        <p className="text-[11px] text-slate-600 leading-relaxed">{COPY.termsSummary}</p>

        <button
          type="submit"
          disabled={busy}
          className="w-full bg-[#15803D] hover:bg-[#166534] disabled:opacity-60 disabled:cursor-not-allowed text-white font-bold py-3.5 px-6 rounded-xl transition-all shadow-md hover:shadow-lg active:scale-[0.99] flex items-center justify-center space-x-2 text-sm cursor-pointer mt-2"
        >
          {busy && <Loader2 className="w-4 h-4 animate-spin" />}
          <span>Create Tutor Account</span>
        </button>
      </form>
    </div>
  );
}
