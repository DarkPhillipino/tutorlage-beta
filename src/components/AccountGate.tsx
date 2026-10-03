import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, AlertCircle, ShieldCheck, Users } from 'lucide-react';
import { useAuth } from '../lib/AuthContext';
import {
  AccountGateState,
  acceptCurrentPolicies,
  fetchAccountGateState,
  setMyDateOfBirth,
} from '../lib/queries';
import { ADULT_AGE, COPY, ageFromIsoDate, isPlausibleDateOfBirth } from '../lib/accountRules';
import { getErrorMessage } from '../lib/errors';

// Sits between sign-in and the app (7k/7l). Before anyone can use Tutorlage it
// makes sure we have (1) their date of birth — tutors must be 18+, and a learner
// under 18 is booked for by a guardian — and (2) their acceptance of the current
// Terms of Service and Privacy Policy. Google sign-ups and older accounts arrive
// here without either; email sign-ups normally pass straight through because
// the signup form already collected both. A change of document version brings
// everyone back here once.
//
// The database is the real control (booking, verification and guardian checks
// all refuse without a recorded adult date of birth); this screen is how people
// actually provide it.

const inputClass = 'w-full bg-slate-100 text-[#0F172A] placeholder-slate-400 text-sm font-semibold px-4 py-3.5 rounded-xl border border-transparent focus:outline-none focus:border-[#15803D] focus:bg-white focus:ring-2 focus:ring-[#15803D]/20 transition-all';

// What the app needs to know once someone is past the gate.
export interface AccountStatus {
  dateOfBirth: string;
  // A learner under 18 that a guardian added: they can see their sessions
  // and tutor, but the guardian books and pays (CEO, 2026-09-30).
  isViewOnlyLearner: boolean;
}

const AccountStatusContext = createContext<AccountStatus | null>(null);

export function useAccountStatus(): AccountStatus {
  const status = useContext(AccountStatusContext);
  if (!status) throw new Error('useAccountStatus must be used inside AccountGate');
  return status;
}

export const AccountGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, profile, signOut } = useAuth();
  const [state, setState] = useState<AccountGateState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [dateOfBirth, setDateOfBirth] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!user) return;
    setLoadError(null);
    fetchAccountGateState(user.id)
      .then(setState)
      .catch((e) => setLoadError(getErrorMessage(e, 'Could not load your account.')));
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

  const shell = (content: React.ReactNode) => (
    <div className="min-h-screen flex items-center justify-center bg-[#FAF7F2] px-6 py-12">
      <div className="w-full max-w-md bg-white rounded-2xl p-8 shadow-sm border border-slate-200/80">{content}</div>
    </div>
  );

  if (loadError) {
    return shell(
      <>
        <div className="flex items-start space-x-2 bg-rose-50 border border-rose-200 rounded-xl px-4 py-3 text-xs font-semibold text-rose-700 mb-4">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{loadError}</span>
        </div>
        <button onClick={load} className="w-full bg-[#0F172A] text-white font-bold py-3 rounded-xl text-sm cursor-pointer">
          Try again
        </button>
      </>,
    );
  }

  if (!state || !profile) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#FAF7F2] text-slate-400">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        <span className="text-sm font-semibold">Loading Tutorlage…</span>
      </div>
    );
  }

  const recordedAge = state.dateOfBirth ? ageFromIsoDate(state.dateOfBirth) : null;

  // A learner under 18 who signed up on their own (e.g. with Google) — not
  // one a guardian added. They can't book, so say why instead of letting them
  // hit a refusal at checkout.
  if (profile.role === 'student' && recordedAge !== null && recordedAge < ADULT_AGE && !state.hasGuardian) {
    return shell(
      <>
        <div className="w-12 h-12 rounded-xl bg-emerald-100 text-[#15803D] flex items-center justify-center mb-4">
          <Users className="w-6 h-6" />
        </div>
        <h1 className="font-serif text-2xl text-[#0F172A] mb-2">{COPY.learnerUnder18Title}</h1>
        <p className="text-sm text-slate-600 leading-relaxed mb-6">{COPY.learnerUnder18Body}</p>
        <button
          onClick={signOut}
          className="w-full bg-[#0F172A] hover:bg-slate-800 text-white font-bold py-3 rounded-xl text-sm cursor-pointer"
        >
          Sign out
        </button>
      </>,
    );
  }

  const needsDateOfBirth = !state.dateOfBirth;
  const needsAcceptance = state.pendingDocuments.length > 0;
  if (!needsDateOfBirth && !needsAcceptance) {
    const status: AccountStatus = {
      dateOfBirth: state.dateOfBirth!,
      isViewOnlyLearner:
        profile.role === 'student' && state.hasGuardian && recordedAge !== null && recordedAge < ADULT_AGE,
    };
    return <AccountStatusContext.Provider value={status}>{children}</AccountStatusContext.Provider>;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (needsDateOfBirth) {
      if (!isPlausibleDateOfBirth(dateOfBirth)) {
        setFormError('Enter your real date of birth.');
        return;
      }
      const age = ageFromIsoDate(dateOfBirth)!;
      if (age < ADULT_AGE && profile.role === 'tutor') {
        setFormError(COPY.tutorUnder18);
        return;
      }
      if (age < ADULT_AGE && profile.role === 'parent') {
        setFormError(COPY.parentUnder18);
        return;
      }
    }
    if (needsAcceptance && !accepted) {
      setFormError('Please accept the Terms of Service and the Privacy Policy to continue.');
      return;
    }

    setIsSubmitting(true);
    try {
      if (needsDateOfBirth) await setMyDateOfBirth(dateOfBirth);
      if (needsAcceptance) await acceptCurrentPolicies();
      load();
    } catch (err) {
      setFormError(getErrorMessage(err, 'Could not save. Please try again.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return shell(
    <>
      <div className="w-12 h-12 rounded-xl bg-emerald-100 text-[#15803D] flex items-center justify-center mb-4">
        <ShieldCheck className="w-6 h-6" />
      </div>
      <h1 className="font-serif text-2xl text-[#0F172A] mb-2">
        {needsDateOfBirth ? 'One more step' : 'Our terms have been updated'}
      </h1>
      <p className="text-sm text-slate-500 mb-6">
        {needsDateOfBirth
          ? 'Before you start, we need a couple of details.'
          : 'Please read and accept the current versions to keep using Tutorlage.'}
      </p>

      {formError && (
        <div className="mb-4 flex items-start space-x-2 bg-rose-50 border border-rose-200 rounded-xl px-4 py-3 text-xs font-semibold text-rose-700">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{formError}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        {needsDateOfBirth && (
          <div>
            <label className="block text-xs font-bold text-slate-500 mb-1.5" htmlFor="gateDateOfBirth">
              Date of birth
            </label>
            <input
              id="gateDateOfBirth"
              type="date"
              required
              value={dateOfBirth}
              onChange={(e) => setDateOfBirth(e.target.value)}
              className={inputClass}
            />
            <p className="text-[11px] text-slate-400 mt-1.5 leading-relaxed">{COPY.dateOfBirthWhy}</p>
          </div>
        )}

        {needsAcceptance && (
          <label className="flex items-start space-x-2.5 text-sm text-slate-600 cursor-pointer">
            <input
              type="checkbox"
              checked={accepted}
              onChange={(e) => setAccepted(e.target.checked)}
              className="mt-0.5 w-4 h-4 accent-[#15803D] shrink-0"
            />
            <span>
              {COPY.acceptTermsLead}{' '}
              <Link to="/terms" target="_blank" className="font-bold text-[#15803D] hover:underline">Terms of Service</Link>
              {' '}and the{' '}
              <Link to="/privacy" target="_blank" className="font-bold text-[#15803D] hover:underline">Privacy Policy</Link>.
            </span>
          </label>
        )}

        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full bg-[#15803D] hover:bg-[#166534] disabled:opacity-60 disabled:cursor-not-allowed text-white font-bold py-3.5 px-6 rounded-xl transition-all flex items-center justify-center space-x-2 text-sm cursor-pointer"
        >
          {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
          <span>Continue</span>
        </button>
      </form>

      <button onClick={signOut} className="w-full mt-4 text-xs font-bold text-slate-400 hover:text-slate-600 cursor-pointer">
        Sign out
      </button>
    </>,
  );
};
