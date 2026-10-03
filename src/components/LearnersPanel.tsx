import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, CheckCircle2, Loader2, Phone, Plus, UserRound, Users, X } from 'lucide-react';
import {
  GuardianRelationship,
  LinkedLearner,
  RELATIONSHIP_LABELS,
  addLearner,
  fetchMyLearners,
  fetchMyPhone,
  isUsablePhone,
  saveMyPhone,
  withdrawGuardianConsent,
} from '../lib/guardian';
import { fetchCurrentPolicyVersions, fetchGradeLevelSuggestions } from '../lib/queries';
import { ADULT_AGE, COPY, ageFromIsoDate, guardianConsentText, isPlausibleDateOfBirth } from '../lib/accountRules';
import { getErrorMessage } from '../lib/errors';

// The parent/guardian home (backlog 7k): the learners they're responsible
// for, adding one, choosing who a booking is for, and withdrawing consent.

const inputClass = 'w-full bg-slate-100 text-[#0F172A] placeholder-slate-400 text-sm font-semibold px-3.5 py-3 rounded-xl border border-transparent focus:outline-none focus:border-[#15803D] focus:bg-white focus:ring-2 focus:ring-[#15803D]/20 transition-all';
const labelClass = 'block text-xs font-bold text-slate-500 mb-1.5';

interface LearnersPanelProps {
  guardianId: string;
  selectedLearnerId: string | null;
  onSelectLearner: (learner: LinkedLearner | null) => void;
}

export const LearnersPanel: React.FC<LearnersPanelProps> = ({ guardianId, selectedLearnerId, onSelectLearner }) => {
  const [learners, setLearners] = useState<LinkedLearner[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [justAdded, setJustAdded] = useState<{ name: string; signIn: string } | null>(null);
  const [confirmWithdrawId, setConfirmWithdrawId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  // null while loading. Booking waits for a usable number (legal spec §5).
  const [phone, setPhone] = useState<string | null>(null);
  const phoneReady = phone !== null && isUsablePhone(phone);

  useEffect(() => {
    fetchMyPhone(guardianId)
      .then(setPhone)
      .catch((e) => {
        console.error('fetchMyPhone failed:', e);
        setPhone('');
      });
  }, [guardianId]);

  // If the number is cleared, a learner chosen earlier can't be booked for.
  useEffect(() => {
    if (phone !== null && !isUsablePhone(phone) && selectedLearnerId) onSelectLearner(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phone]);

  const load = useCallback(() => {
    setLoadError(null);
    fetchMyLearners(guardianId)
      .then((rows) => {
        setLearners(rows);
        // Keep the selection in step with what the database says now.
        if (selectedLearnerId) {
          const current = rows.find((l) => l.id === selectedLearnerId);
          onSelectLearner(current && current.canBook ? current : null);
        }
      })
      .catch((e) => setLoadError(getErrorMessage(e, 'Could not load your learners.')));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guardianId]);

  useEffect(load, [load]);

  const handleWithdraw = async (learner: LinkedLearner) => {
    setActionError(null);
    try {
      await withdrawGuardianConsent(learner.id);
      setConfirmWithdrawId(null);
      if (selectedLearnerId === learner.id) onSelectLearner(null);
      load();
    } catch (e) {
      setActionError(getErrorMessage(e, 'Could not withdraw consent.'));
    }
  };

  return (
    <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-xs mb-8">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-xl bg-emerald-100 text-[#15803D] flex items-center justify-center">
            <Users className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-extrabold text-[#0F172A]">Your learners</h2>
            <p className="text-xs text-slate-500">Choose who you're booking for, then search below.</p>
          </div>
        </div>
        {!isAdding && (
          <button
            onClick={() => { setIsAdding(true); setJustAdded(null); }}
            className="inline-flex items-center gap-1.5 text-xs font-bold text-[#15803D] hover:underline cursor-pointer"
          >
            <Plus className="w-4 h-4" /> Add a learner
          </button>
        )}
      </div>

      {loadError && (
        <div className="flex items-center gap-2 text-xs font-semibold text-rose-600 mb-3">
          <AlertCircle className="w-4 h-4" /> {loadError}
          <button onClick={load} className="underline cursor-pointer">Try again</button>
        </div>
      )}
      {actionError && (
        <div className="flex items-center gap-2 text-xs font-semibold text-rose-600 mb-3">
          <AlertCircle className="w-4 h-4" /> {actionError}
        </div>
      )}

      {phone !== null && <GuardianPhoneRow guardianId={guardianId} phone={phone} onSaved={setPhone} />}

      {justAdded && (
        <div className="mb-4 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 text-xs text-slate-700">
          <p className="font-bold text-[#0F172A] flex items-center gap-1.5 mb-1">
            <CheckCircle2 className="w-4 h-4 text-[#15803D]" /> {justAdded.name} has been added.
          </p>
          <p>
            They sign in on the student sign-in page with <span className="font-mono font-bold">{justAdded.signIn}</span> and
            the password you chose. Keep this somewhere safe — it isn't shown again.
          </p>
        </div>
      )}

      {learners === null && !loadError ? (
        <div className="flex items-center text-slate-400 text-sm py-2">
          <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…
        </div>
      ) : learners && learners.length === 0 && !isAdding ? (
        <p className="text-sm text-slate-500">
          You haven't added a learner yet. Add each child you'll book sessions for — you'll give consent for them as their
          parent or guardian.
        </p>
      ) : (
        <div className="space-y-2">
          {(learners ?? []).map((learner) => {
            const isSelected = learner.id === selectedLearnerId;
            return (
              <div
                key={learner.id}
                className={`rounded-xl border px-4 py-3 flex flex-wrap items-center justify-between gap-3 ${isSelected ? 'border-[#15803D] bg-emerald-50/50' : 'border-slate-200'}`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <UserRound className="w-5 h-5 text-slate-400 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-[#0F172A] truncate">{learner.firstName} {learner.surname}</p>
                    <p className="text-[11px] text-slate-500">
                      {learner.gradeLevel ?? 'Grade not set'} · {RELATIONSHIP_LABELS[learner.relationship as GuardianRelationship] ?? learner.relationship}
                      {!learner.canBook && ' · consent withdrawn'}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {learner.canBook && (
                    <button
                      onClick={() => onSelectLearner(isSelected ? null : learner)}
                      disabled={!phoneReady}
                      title={phoneReady ? undefined : 'Add your phone number first'}
                      className={`text-xs font-bold px-3 py-2 rounded-lg cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${isSelected ? 'bg-[#15803D] text-white' : 'bg-slate-100 text-[#0F172A] hover:bg-slate-200'}`}
                    >
                      {isSelected ? `Booking for ${learner.firstName}` : `Book for ${learner.firstName}`}
                    </button>
                  )}
                  {learner.canBook && confirmWithdrawId !== learner.id && (
                    <button
                      onClick={() => setConfirmWithdrawId(learner.id)}
                      className="text-[11px] font-bold text-slate-400 hover:text-rose-600 cursor-pointer"
                    >
                      Withdraw consent
                    </button>
                  )}
                  {confirmWithdrawId === learner.id && (
                    <span className="flex items-center gap-2 text-[11px]">
                      <span className="text-slate-600">Stops all new bookings for {learner.firstName}.</span>
                      <button onClick={() => handleWithdraw(learner)} className="font-bold text-rose-600 hover:underline cursor-pointer">Withdraw</button>
                      <button onClick={() => setConfirmWithdrawId(null)} className="font-bold text-slate-500 hover:underline cursor-pointer">Keep</button>
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {isAdding && (
        <AddLearnerForm
          onCancel={() => setIsAdding(false)}
          onAdded={(name, signIn) => {
            setIsAdding(false);
            setJustAdded({ name, signIn });
            load();
          }}
        />
      )}
    </div>
  );
};

// The guardian's own phone number (legal spec §5). Shown as a prompt until a
// usable number is saved — the database refuses a guardian's booking without
// one — then as a single line with a Change link.
const GuardianPhoneRow: React.FC<{ guardianId: string; phone: string; onSaved: (phone: string) => void }> = ({
  guardianId,
  phone,
  onSaved,
}) => {
  const hasPhone = isUsablePhone(phone);
  const [isEditing, setIsEditing] = useState(!hasPhone);
  const [draft, setDraft] = useState(phone);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    if (!isUsablePhone(draft)) {
      setError('Enter a phone number with at least 9 digits.');
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      await saveMyPhone(guardianId, draft);
      onSaved(draft.trim());
      setIsEditing(false);
    } catch (e) {
      setError(getErrorMessage(e, 'Could not save your phone number.'));
    } finally {
      setIsSaving(false);
    }
  };

  if (!isEditing) {
    return (
      <p className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500 mb-4">
        <Phone className="w-3.5 h-3.5" /> {COPY.guardianPhoneOnFile}
        <span className="font-bold text-[#0F172A]">{phone}</span>
        <button onClick={() => { setDraft(phone); setIsEditing(true); }} className="font-bold text-[#15803D] hover:underline cursor-pointer">
          Change
        </button>
      </p>
    );
  }

  return (
    <div className={`mb-4 rounded-xl px-4 py-3 border ${hasPhone ? 'border-slate-200' : 'border-amber-200 bg-amber-50'}`}>
      <p className="text-xs text-slate-700 mb-2 flex items-start gap-1.5">
        <Phone className="w-4 h-4 shrink-0 mt-0.5 text-amber-700" /> {COPY.guardianPhoneNeeded}
      </p>
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          type="tel"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="081 234 5678"
          aria-label="Your phone number"
          className={inputClass}
        />
        <button
          onClick={handleSave}
          disabled={isSaving}
          className="bg-[#15803D] hover:bg-[#166534] disabled:opacity-60 text-white text-xs font-bold px-4 py-3 rounded-xl cursor-pointer shrink-0 flex items-center justify-center gap-1.5"
        >
          {isSaving && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Save number
        </button>
        {hasPhone && (
          <button onClick={() => setIsEditing(false)} className="text-xs font-bold text-slate-500 px-3 cursor-pointer">
            Cancel
          </button>
        )}
      </div>
      {error && (
        <div className="flex items-center gap-1.5 text-[11px] text-rose-600 font-semibold mt-2">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" /> {error}
        </div>
      )}
    </div>
  );
};

const AddLearnerForm: React.FC<{ onCancel: () => void; onAdded: (name: string, signIn: string) => void }> = ({
  onCancel,
  onAdded,
}) => {
  const [firstName, setFirstName] = useState('');
  const [surname, setSurname] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [gradeLevel, setGradeLevel] = useState('');
  const [relationship, setRelationship] = useState<GuardianRelationship | ''>('');
  const [learnerEmail, setLearnerEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [consent, setConsent] = useState(false);
  const [acceptOnBehalf, setAcceptOnBehalf] = useState(false);
  const [grades, setGrades] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    fetchGradeLevelSuggestions().then(setGrades).catch(() => setGrades([]));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!isPlausibleDateOfBirth(dateOfBirth)) {
      setError("Enter the learner's real date of birth.");
      return;
    }
    if (ageFromIsoDate(dateOfBirth)! >= ADULT_AGE) {
      setError('Learners 18 or older create their own account.');
      return;
    }
    if (!relationship) {
      setError('Choose your relationship to the learner.');
      return;
    }
    if (password.length < 8) {
      setError('Choose a password of at least 8 characters for the learner.');
      return;
    }
    if (password !== confirmPassword) {
      setError('The passwords do not match.');
      return;
    }
    if (!consent || !acceptOnBehalf) {
      setError('Please tick both boxes to add the learner.');
      return;
    }

    setIsSubmitting(true);
    try {
      const versions = await fetchCurrentPolicyVersions();
      if (!versions) throw new Error('Could not load the current consent wording — try again.');
      const result = await addLearner({
        firstName,
        surname,
        dateOfBirth,
        gradeLevel,
        relationship,
        learnerEmail: learnerEmail.trim() || undefined,
        password,
        consentVersion: versions.guardianConsentVersion,
        acceptedTermsVersion: versions.termsVersion,
        acceptedPrivacyVersion: versions.privacyVersion,
      });
      onAdded(firstName.trim(), result.signIn);
    } catch (err) {
      setError(getErrorMessage(err, 'Could not add the learner.'));
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="mt-5 border-t border-slate-200 pt-5 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-extrabold text-[#0F172A]">Add a learner under 18</h3>
        <button type="button" onClick={onCancel} className="text-slate-400 hover:text-slate-600 cursor-pointer" aria-label="Cancel">
          <X className="w-4 h-4" />
        </button>
      </div>

      {error && (
        <div className="flex items-start gap-2 bg-rose-50 border border-rose-200 rounded-xl px-3.5 py-2.5 text-xs font-semibold text-rose-700">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /> <span>{error}</span>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className={labelClass} htmlFor="learnerFirstName">First name</label>
          <input id="learnerFirstName" required value={firstName} onChange={(e) => setFirstName(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="learnerSurname">Surname</label>
          <input id="learnerSurname" required value={surname} onChange={(e) => setSurname(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="learnerDob">Date of birth</label>
          <input id="learnerDob" type="date" required value={dateOfBirth} onChange={(e) => setDateOfBirth(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="learnerGrade">Grade</label>
          <select id="learnerGrade" required value={gradeLevel} onChange={(e) => setGradeLevel(e.target.value)} className={inputClass}>
            <option value="">Choose…</option>
            {grades.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor="learnerRelationship">You are their</label>
          <select id="learnerRelationship" required value={relationship} onChange={(e) => setRelationship(e.target.value as GuardianRelationship)} className={inputClass}>
            <option value="">Choose…</option>
            {(Object.keys(RELATIONSHIP_LABELS) as GuardianRelationship[]).map((r) => (
              <option key={r} value={r}>{RELATIONSHIP_LABELS[r]}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor="learnerEmail">Learner's email (optional)</label>
          <input id="learnerEmail" type="email" value={learnerEmail} onChange={(e) => setLearnerEmail(e.target.value)} placeholder="Leave blank for a sign-in name" className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="learnerPassword">Password for the learner</label>
          <input id="learnerPassword" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" className={inputClass} autoComplete="new-password" />
        </div>
        <div>
          <label className={labelClass} htmlFor="learnerPasswordConfirm">Confirm password</label>
          <input id="learnerPasswordConfirm" type="password" required value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className={inputClass} autoComplete="new-password" />
        </div>
      </div>

      {/* Legal spec §4: separate from the Terms checkbox, never pre-ticked. */}
      <label className="flex items-start gap-2.5 text-xs text-slate-600 leading-relaxed cursor-pointer pt-1">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 w-4 h-4 accent-[#15803D] shrink-0" />
        <span>{guardianConsentText(firstName)}</span>
      </label>
      <label className="flex items-start gap-2.5 text-xs text-slate-600 leading-relaxed cursor-pointer">
        <input type="checkbox" checked={acceptOnBehalf} onChange={(e) => setAcceptOnBehalf(e.target.checked)} className="mt-0.5 w-4 h-4 accent-[#15803D] shrink-0" />
        <span>
          On {firstName.trim() || 'the learner'}'s behalf, I accept the{' '}
          <Link to="/terms" target="_blank" className="font-bold text-[#15803D] hover:underline">Terms of Service</Link> and the{' '}
          <Link to="/privacy" target="_blank" className="font-bold text-[#15803D] hover:underline">Privacy Policy</Link>.
        </span>
      </label>

      <div className="flex items-center gap-2 pt-1">
        <button
          type="submit"
          disabled={isSubmitting}
          className="flex-1 bg-[#15803D] hover:bg-[#166534] disabled:opacity-60 text-white font-bold py-3 rounded-xl text-sm cursor-pointer flex items-center justify-center gap-2"
        >
          {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />} Add learner
        </button>
        <button type="button" onClick={onCancel} className="px-4 py-3 text-sm font-bold text-slate-500 hover:text-slate-700 cursor-pointer">
          Cancel
        </button>
      </div>
    </form>
  );
};
