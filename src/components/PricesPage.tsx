import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, MapPin, Clock, ChevronDown, ShieldCheck, Search, Loader2, UserX, Tag, X, AlertTriangle, Users, CreditCard, GraduationCap } from 'lucide-react';
import { BookingFormState, PriceLevel, SuggestionItem } from '../types';
import { fetchTutors, createSessionRequest } from '../lib/queries';
import { initializePayment } from '../lib/payments';
import { getCurrencySymbol } from '../lib/currencies';
import { formatRate, describeDate } from '../lib/format';
import { useAuth } from '../lib/AuthContext';
import { getErrorMessage } from '../lib/errors';
import { useAccountStatus } from './AccountGate';
import { COPY } from '../lib/accountRules';

interface PricesPageProps {
  // Set when a parent/guardian is booking for one of their learners (7k).
  learner?: { id: string; firstName: string } | null;
  formState: BookingFormState;
  setFormState: React.Dispatch<React.SetStateAction<BookingFormState>>;
  gradeLevel: string; // account-level — see onChangeGradeLevel
  onChangeGradeLevel: () => void;
  onBack: () => void;
  onChangeInstitution: () => void;
  onOpenScheduleModal: () => void;
  onSearch: () => void;
  selectedLevel: PriceLevel | null;
  onClearLevel: () => void;
  selectedFormat: SuggestionItem | null;
  onClearFormat: () => void;
}

export const PricesPage: React.FC<PricesPageProps> = ({
  learner = null,
  formState,
  setFormState,
  gradeLevel,
  onChangeGradeLevel,
  onBack,
  onChangeInstitution,
  onOpenScheduleModal,
  onSearch,
  selectedLevel,
  onClearLevel,
  selectedFormat,
  onClearFormat,
}) => {
  const { user, profile } = useAuth();
  const { isViewOnlyLearner } = useAccountStatus();
  const isGuardian = profile?.role === 'parent';
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [tutorCount, setTutorCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [gradeLevelUnrecognized, setGradeLevelUnrecognized] = useState(false);

  // What the search is actually run against — separate from formState so
  // editing the subject field below doesn't re-query on every keystroke.
  // Only updates when the student re-runs the search (button below), a
  // tier is picked/cleared, or their account-level grade level changes.
  const [appliedSubject, setAppliedSubject] = useState(formState.subject);

  useEffect(() => {
    setIsLoading(true);
    setLoadError(false);
    fetchTutors({
      subject: appliedSubject,
      gradeLevel,
      institutionId: formState.institutionId ?? undefined,
    })
      .then(({ tutors, gradeLevelRecognized }) => {
        setTutorCount(tutors.length);
        setGradeLevelUnrecognized(!gradeLevelRecognized);
      })
      .catch((err) => {
        console.error('fetchTutors failed:', err);
        setTutorCount(0);
        setLoadError(true);
      })
      .finally(() => setIsLoading(false));
  }, [appliedSubject, gradeLevel, retryCount, formState.institutionId]);

  const searchIsStale = formState.subject !== appliedSubject;

  const handleApplySearch = () => {
    setAppliedSubject(formState.subject);
  };

  // A pricing tier can't be reached before the search itself is filled out —
  // clicking Search with something missing jumps to the first unfilled
  // field (subject → grade level → institution) instead of proceeding.
  const subjectInputRef = useRef<HTMLInputElement>(null);
  const [missingField, setMissingField] = useState<'subject' | 'gradeLevel' | 'institution' | null>(null);

  const handleSearchClick = () => {
    if (!formState.subject.trim()) {
      setMissingField('subject');
      subjectInputRef.current?.focus();
      return;
    }
    if (!gradeLevel.trim()) {
      setMissingField('gradeLevel');
      onChangeGradeLevel();
      return;
    }
    if (!formState.institution.trim()) {
      setMissingField('institution');
      onChangeInstitution();
      return;
    }
    setMissingField(null);
    onSearch();
  };

  // Institution and grade level are both set elsewhere (a modal, and
  // account settings, respectively), not typed here directly — clear the
  // missing-field flag once either is filled, same as the subject input's
  // onChange does for itself above.
  useEffect(() => {
    if (missingField === 'institution' && formState.institution.trim()) {
      setMissingField(null);
    }
    if (missingField === 'gradeLevel' && gradeLevel.trim()) {
      setMissingField(null);
    }
  }, [formState.institution, gradeLevel, missingField]);

  // A tier is required before Send Request can charge anything real. The
  // amount shown here is for display only — the database sets the real
  // price on insert (guard_session_request_insert), and the payments server
  // charges that stored amount, never a number sent from the browser.
  const durationHours = 1;
  const chargedAmount = selectedLevel ? selectedLevel.price * durationHours : null;

  // Creates the request (payment_status 'initiated', invisible to tutors),
  // then hands off to Paystack's hosted checkout for the R1 card check that
  // saves the card (backlog 7a). The server, not this page, confirms it with
  // Paystack on /payment/callback and the database makes the request visible
  // to tutors. The price is charged only when a tutor accepts.
  const handleSendRequest = async () => {
    if (!user?.email || !selectedLevel || chargedAmount === null) return;
    if (isGuardian && !learner) return;
    setSendError(null);
    setIsSending(true);
    try {
      const reference = crypto.randomUUID();

      await createSessionRequest({
        // A guardian books for their learner and pays with their own email.
        studentId: learner?.id ?? user.id,
        requestedById: user.id,
        subjectName: appliedSubject,
        gradeLevel,
        minSubTierId: selectedLevel.id,
        institutionId: formState.institutionId,
        scheduleType: formState.scheduleType,
        scheduledDate: formState.scheduledDate,
        scheduledTime: formState.scheduledTime,
        durationHours,
        paystackReference: reference,
      });

      const { authorizationUrl } = await initializePayment(reference);

      window.location.href = authorizationUrl;
    } catch (e) {
      setSendError(getErrorMessage(e, 'Could not start the card check.'));
      setIsSending(false);
    }
  };

  // What to tell the student when the search came back empty — distinguishes
  // "the platform genuinely has no tutors yet" from "your subject/grade
  // level/tier just didn't match anyone," which used to collapse into the
  // same misleading "no tutors have registered" message regardless of cause.
  const hasSearchFilter = !!appliedSubject.trim() || !!gradeLevel.trim();
  const noTutorsMessage = hasSearchFilter
    ? `No tutors match "${appliedSubject || 'any subject'}" (${gradeLevel || 'any grade level'}) yet — try a different subject or check back soon.`
    : 'No tutors have registered on Tutorlage yet — check back soon.';

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">

      {/* Left Column: Search Card */}
      <div className="lg:col-span-4 w-full">
        <div className="bg-white rounded-2xl p-6 sm:p-8 shadow-sm border border-slate-200/80">

          <button
            onClick={onBack}
            className="inline-flex items-center space-x-1.5 text-sm font-bold text-slate-600 hover:text-[#0F172A] mb-6 cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back to search</span>
          </button>

          <div className="mb-6 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 text-xs font-bold text-[#15803D] flex items-center space-x-2">
            <ShieldCheck className="w-4 h-4 shrink-0" />
            <span>One clear price for the level you choose — nothing added at checkout</span>
          </div>

          <h1 className="text-2xl sm:text-3xl font-extrabold text-[#0F172A] tracking-tight mb-6">
            Find a tutor
          </h1>

          {selectedLevel && (
            <div className="mb-6 flex items-center justify-between gap-2 px-4 py-3 rounded-xl bg-[#0F172A] text-white">
              <div className="flex items-center space-x-2 min-w-0">
                <Tag className="w-4 h-4 text-emerald-400 shrink-0" />
                <div className="min-w-0">
                  <div className="text-xs font-bold truncate">
                    {getCurrencySymbol(selectedLevel.currencyCode)}{formatRate(selectedLevel.price)} / hr · {selectedLevel.tierName}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={onClearLevel}
                className="p-1 rounded-full hover:bg-slate-800 text-slate-400 hover:text-white transition-colors cursor-pointer shrink-0"
                aria-label="Clear price level"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {selectedFormat && (
            <div className="mb-6 flex items-center justify-between gap-2 px-4 py-3 rounded-xl bg-emerald-50 border border-emerald-200">
              <div className="flex items-center space-x-2 min-w-0">
                <Tag className="w-4 h-4 text-[#15803D] shrink-0" />
                <div className="min-w-0">
                  <div className="text-xs font-bold text-[#0F172A] truncate">{selectedFormat.title}</div>
                  <div className="text-[10px] text-slate-500">Preferred format — doesn't narrow results yet</div>
                </div>
              </div>
              <button
                type="button"
                onClick={onClearFormat}
                className="p-1 rounded-full hover:bg-emerald-100 text-slate-400 hover:text-[#15803D] transition-colors cursor-pointer shrink-0"
                aria-label="Clear preferred format"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          <div className="space-y-3 mb-6">
            {/* Subject field */}
            <div className={`relative flex items-center bg-slate-100 rounded-xl px-4 py-3.5 border transition-all focus-within:border-[#15803D] focus-within:bg-white focus-within:ring-2 focus-within:ring-[#15803D]/20 ${missingField === 'subject' ? 'border-rose-400 ring-2 ring-rose-200' : 'border-transparent'}`}>
              <div className="mr-3 w-2.5 h-2.5 rounded-full bg-[#0F172A] ring-4 ring-slate-200 shrink-0" />
              <input
                ref={subjectInputRef}
                type="text"
                value={formState.subject}
                onChange={(e) => {
                  setFormState(prev => ({ ...prev, subject: e.target.value }));
                  if (missingField === 'subject') setMissingField(null);
                }}
                placeholder="Subject or skill"
                className="w-full bg-transparent text-[#0F172A] placeholder-slate-500 text-sm font-semibold focus:outline-none"
              />
            </div>
            {missingField === 'subject' && (
              <p className="text-xs font-semibold text-rose-600 -mt-2">Enter a subject to start searching.</p>
            )}

            {/* Grade level — account-level info, not re-entered per search */}
            <div className={`flex items-center bg-slate-100 rounded-xl px-4 py-3.5 border ${missingField === 'gradeLevel' ? 'border-rose-400 ring-2 ring-rose-200' : 'border-transparent'}`}>
              <GraduationCap className="w-4 h-4 mr-2 text-[#0F172A] shrink-0" />
              <span className="flex-1 text-[#0F172A] text-sm font-semibold truncate">
                {gradeLevel || 'Grade level not set'}
              </span>
              <button
                type="button"
                onClick={onChangeGradeLevel}
                className="text-xs font-bold text-[#15803D] hover:underline shrink-0 ml-2 cursor-pointer"
              >
                {gradeLevel ? 'Change' : 'Set in account'}
              </button>
            </div>
            {missingField === 'gradeLevel' && (
              <p className="text-xs font-semibold text-rose-600 -mt-2">Set your grade level in account settings to start searching.</p>
            )}

            {searchIsStale && (
              <button
                type="button"
                onClick={handleApplySearch}
                className="w-full flex items-center justify-center space-x-2 py-2.5 rounded-xl bg-[#0F172A] hover:bg-slate-800 text-white text-xs font-bold transition-all cursor-pointer"
              >
                <Search className="w-3.5 h-3.5" />
                <span>Update results for "{formState.subject || 'any subject'}"</span>
              </button>
            )}
          </div>

          {/* Institution row */}
          <div className={`flex items-center justify-between px-4 py-3.5 rounded-xl bg-slate-100 mb-1 border ${missingField === 'institution' ? 'border-rose-400 ring-2 ring-rose-200' : 'border-transparent'}`}>
            <div className="flex items-center text-sm text-[#0F172A] font-semibold min-w-0">
              <MapPin className="w-4 h-4 mr-1.5 text-[#15803D] shrink-0" />
              <span className="truncate">{formState.institution || 'Select your institution'}</span>
            </div>
            <button
              type="button"
              onClick={onChangeInstitution}
              className="text-xs font-bold text-[#15803D] hover:underline shrink-0 ml-2 cursor-pointer"
            >
              Change
            </button>
          </div>
          {missingField === 'institution' && (
            <p className="text-xs font-semibold text-rose-600 mb-2">Select your institution to start searching.</p>
          )}

          {/* Schedule button */}
          <button
            type="button"
            onClick={onOpenScheduleModal}
            className="w-full flex items-center justify-between px-4 py-3.5 rounded-xl bg-slate-100 hover:bg-slate-200/80 mb-6 transition-colors cursor-pointer"
          >
            <span className="flex items-center space-x-2.5 text-sm font-semibold text-[#0F172A]">
              <Clock className="w-4 h-4 text-[#0F172A]" />
              <span>
                {formState.scheduleType === 'now'
                  ? 'As soon as possible'
                  : `Scheduled: ${describeDate(formState.scheduledDate)}, ${formState.scheduledTime || '14:00'}`}
              </span>
            </span>
            <ChevronDown className="w-4 h-4 text-slate-600" />
          </button>

          <button
            type="button"
            onClick={handleSearchClick}
            className="w-full bg-[#15803D] hover:bg-[#166534] text-white font-bold py-4 px-6 rounded-xl transition-all shadow-md hover:shadow-lg active:scale-[0.99] flex items-center justify-center space-x-2 text-base cursor-pointer"
          >
            <Search className="w-4 h-4" />
            <span>Search</span>
          </button>

        </div>
      </div>

      {/* Right Column: Results */}
      <div className="lg:col-span-8 w-full">
        <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden">

          <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between flex-wrap gap-2">
            <div>
              <h2 className="text-lg font-extrabold text-[#0F172A]">
                {tutorCount} tutor{tutorCount === 1 ? '' : 's'} available
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Matching for <span className="font-semibold text-[#0F172A]">{appliedSubject || 'any subject'}</span> ({gradeLevel || 'any grade level'})
              </p>
              {gradeLevelUnrecognized && (
                <p className="text-xs text-amber-600 font-semibold mt-1">
                  We don't recognize "{gradeLevel}" as a grade level — showing results for any grade level instead.
                </p>
              )}
            </div>
          </div>

          <div className="p-6 space-y-4 bg-[#FAF7F2]">
            {sendError && (
              <div className="flex items-start gap-2 bg-rose-50 border border-rose-200 rounded-xl px-4 py-3 text-xs font-semibold text-rose-700">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{sendError}</span>
              </div>
            )}
            {isLoading ? (
              <div className="flex items-center justify-center py-16 text-slate-400">
                <Loader2 className="w-5 h-5 animate-spin mr-2" />
                <span className="text-sm font-semibold">Loading tutors…</span>
              </div>
            ) : loadError ? (
              <div className="text-center py-16 px-4">
                <AlertTriangle className="w-8 h-8 text-rose-400 mx-auto mb-2" />
                <p className="text-sm font-bold text-[#0F172A]">Couldn't load tutors</p>
                <p className="text-xs text-slate-500 mt-1">Check your connection and try again.</p>
                <button
                  type="button"
                  onClick={() => setRetryCount((c) => c + 1)}
                  className="mt-3 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-[#0F172A] font-bold text-xs rounded-xl cursor-pointer"
                >
                  Retry
                </button>
              </div>
            ) : tutorCount === 0 ? (
              <div className="text-center py-16 px-4">
                <UserX className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                <p className="text-sm font-bold text-[#0F172A]">No tutors match yet</p>
                <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
                  {noTutorsMessage}
                </p>
              </div>
            ) : !selectedLevel ? (
              <div className="bg-white rounded-2xl p-6 border border-slate-200/90 shadow-xs flex flex-col items-center text-center">
                <div className="w-14 h-14 rounded-2xl bg-emerald-50 border border-emerald-200 shadow-xs flex items-center justify-center text-[#15803D] mb-3">
                  <Users className="w-7 h-7" />
                </div>
                <p className="text-sm font-bold text-[#0F172A] mb-1">
                  {tutorCount} tutor{tutorCount === 1 ? '' : 's'} teach{tutorCount === 1 ? 'es' : ''} this subject
                </p>
                <p className="text-xs text-slate-500 mb-5 max-w-sm">
                  Choose a price level so you know exactly what you'll pay before you send your request.
                </p>
                <button
                  onClick={onSearch}
                  className="px-6 py-3 bg-[#0F172A] hover:bg-slate-800 text-white text-sm font-bold rounded-xl transition-all shadow-xs cursor-pointer"
                >
                  Choose a price
                </button>
              </div>
            ) : (
              <div className="bg-white rounded-2xl p-6 border border-slate-200/90 shadow-xs flex flex-col items-center text-center">
                <div className="w-14 h-14 rounded-2xl bg-emerald-50 border border-emerald-200 shadow-xs flex items-center justify-center text-[#15803D] mb-3">
                  <CreditCard className="w-7 h-7" />
                </div>
                <p className="text-sm font-bold text-[#0F172A] mb-1">
                  {selectedLevel.tutors} tutor{selectedLevel.tutors === 1 ? '' : 's'} at this level or above can take this request
                </p>
                {isViewOnlyLearner ? (
                  <p className="text-xs text-slate-600 max-w-sm bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3">
                    {COPY.viewOnlyLearner}
                  </p>
                ) : isGuardian && !learner ? (
                  <>
                    <p className="text-xs text-slate-500 mb-5 max-w-sm">
                      Choose which of your learners this session is for on the home page, then come back to send the request.
                    </p>
                    <button
                      onClick={onBack}
                      className="px-6 py-3 bg-[#0F172A] hover:bg-slate-800 text-white text-sm font-bold rounded-xl transition-all shadow-xs cursor-pointer"
                    >
                      Choose a learner
                    </button>
                  </>
                ) : (
                  <>
                    <p className="text-xs text-slate-500 mb-5 max-w-sm">
                      You'll pay <span className="font-bold text-[#0F172A]">{getCurrencySymbol(selectedLevel.currencyCode)}{formatRate(chargedAmount ?? 0)}</span>,
                      charged to your card only when a tutor at this level or above accepts. The first to accept is matched with{' '}
                      {learner ? learner.firstName : 'you'}, and you'll see who they are before the session. If nobody accepts in time, you're never charged.
                    </p>
                    <p className="text-[11px] text-slate-500 mb-5 max-w-sm">
                      To save your card, Paystack makes a {getCurrencySymbol(selectedLevel.currencyCode)}1 check now and refunds it straight away.
                    </p>
                    <button
                      onClick={handleSendRequest}
                      disabled={isSending}
                      className="px-6 py-3 bg-[#15803D] hover:bg-[#166534] disabled:opacity-60 text-white text-sm font-bold rounded-xl transition-all shadow-xs cursor-pointer"
                    >
                      {isSending
                        ? 'Redirecting to secure checkout…'
                        : `Save card & send request${learner ? ` for ${learner.firstName}` : ''}`}
                    </button>
                  </>
                )}
              </div>
            )}
          </div>

        </div>
      </div>

    </div>
  );
};
