import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, MapPin, Clock, ChevronDown, ShieldCheck, Search, Loader2, UserX, Tag, X, AlertTriangle, Users, CreditCard } from 'lucide-react';
import { BookingFormState, TierDefinition, SuggestionItem } from '../types';
import { fetchTutors, createSessionRequest } from '../lib/queries';
import { initializePayment } from '../lib/payments';
import { getCurrencySymbol } from '../lib/currencies';
import { formatRate, describeDate } from '../lib/format';
import { useAuth } from '../lib/AuthContext';

interface PricesPageProps {
  formState: BookingFormState;
  setFormState: React.Dispatch<React.SetStateAction<BookingFormState>>;
  onBack: () => void;
  onChangeInstitution: () => void;
  onOpenScheduleModal: () => void;
  onSearch: () => void;
  selectedTier: TierDefinition | null;
  onClearTier: () => void;
  selectedFormat: SuggestionItem | null;
  onClearFormat: () => void;
}

export const PricesPage: React.FC<PricesPageProps> = ({
  formState,
  setFormState,
  onBack,
  onChangeInstitution,
  onOpenScheduleModal,
  onSearch,
  selectedTier,
  onClearTier,
  selectedFormat,
  onClearFormat,
}) => {
  const { user } = useAuth();
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [tutorCount, setTutorCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [gradeLevelUnrecognized, setGradeLevelUnrecognized] = useState(false);
  const [rateBounds, setRateBounds] = useState<{ min: number; max: number } | null>(null);
  const [rateCurrency, setRateCurrency] = useState('ZAR');

  // What the search is actually run against — separate from formState so
  // editing the subject/grade fields below doesn't re-query on every
  // keystroke. Only updates when the student re-runs the search (button
  // below) or a tier is picked/cleared.
  const [appliedSearch, setAppliedSearch] = useState({
    subject: formState.subject,
    gradeLevel: formState.gradeLevel,
  });

  useEffect(() => {
    setIsLoading(true);
    setLoadError(false);
    fetchTutors({
      subject: appliedSearch.subject,
      gradeLevel: appliedSearch.gradeLevel,
      tierId: selectedTier?.id,
      institutionId: formState.institutionId ?? undefined,
    })
      .then(({ tutors, gradeLevelRecognized }) => {
        setTutorCount(tutors.length);
        setGradeLevelUnrecognized(!gradeLevelRecognized);
        const rates = tutors.map((t) => t.hourlyRate);
        setRateBounds(rates.length ? { min: Math.min(...rates), max: Math.max(...rates) } : null);
        if (tutors[0]) setRateCurrency(tutors[0].currencyCode);
      })
      .catch((err) => {
        console.error('fetchTutors failed:', err);
        setTutorCount(0);
        setRateBounds(null);
        setLoadError(true);
      })
      .finally(() => setIsLoading(false));
  }, [appliedSearch, selectedTier, retryCount, formState.institutionId]);

  const searchIsStale = formState.subject !== appliedSearch.subject || formState.gradeLevel !== appliedSearch.gradeLevel;

  const handleApplySearch = () => {
    setAppliedSearch({ subject: formState.subject, gradeLevel: formState.gradeLevel });
  };

  // A pricing tier can't be reached before the search itself is filled out —
  // clicking Search with something missing jumps to the first unfilled
  // field (subject → grade level → institution) instead of proceeding.
  const subjectInputRef = useRef<HTMLInputElement>(null);
  const gradeLevelInputRef = useRef<HTMLInputElement>(null);
  const [missingField, setMissingField] = useState<'subject' | 'gradeLevel' | 'institution' | null>(null);

  const handleSearchClick = () => {
    if (!formState.subject.trim()) {
      setMissingField('subject');
      subjectInputRef.current?.focus();
      return;
    }
    if (!formState.gradeLevel.trim()) {
      setMissingField('gradeLevel');
      gradeLevelInputRef.current?.focus();
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

  // Institution is set via a modal (InstitutionModal), not typed here directly —
  // clear the missing-field flag once it's filled, same as the onChange handlers
  // above do for subject/grade level.
  useEffect(() => {
    if (missingField === 'institution' && formState.institution.trim()) {
      setMissingField(null);
    }
  }, [formState.institution, missingField]);

  // A tier is required before Send Request can charge anything real — it's
  // the only firm number available before a specific tutor is known (see
  // the note on acceptAvailableRequest in queries.ts: whatever gets charged
  // here becomes the session's gross_amount verbatim once a tutor accepts).
  const durationHours = 1;
  const chargedAmount = selectedTier ? selectedTier.minRate * durationHours : null;

  // Charges the student via Paystack *before* the anonymous request becomes
  // visible to any tutor (see createSessionRequest/confirmSessionRequestPayment
  // in queries.ts — payment_status starts at 'initiated' and only the
  // Paystack redirect + PaymentCallback.tsx flips it to 'paid'), then sends
  // the browser to Paystack's own hosted checkout. This function's own
  // "success" is just handing off to Paystack — the actual confirmation
  // happens on /payment/callback after the student pays (or doesn't).
  const handleSendRequest = async () => {
    if (!user?.email || !selectedTier || chargedAmount === null) return;
    setSendError(null);
    setIsSending(true);
    try {
      const reference = crypto.randomUUID();

      await createSessionRequest({
        studentId: user.id,
        subjectName: appliedSearch.subject,
        gradeLevel: appliedSearch.gradeLevel,
        tierId: selectedTier.id,
        institutionId: formState.institutionId,
        scheduleType: formState.scheduleType,
        scheduledDate: formState.scheduledDate,
        scheduledTime: formState.scheduledTime,
        durationHours,
        paystackReference: reference,
        chargedAmount,
        currencyCode: selectedTier.currencyCode,
      });

      const { authorizationUrl } = await initializePayment({
        email: user.email,
        amountRands: chargedAmount,
        reference,
        currency: selectedTier.currencyCode,
        metadata: { subject: appliedSearch.subject, gradeLevel: appliedSearch.gradeLevel },
      });

      window.location.href = authorizationUrl;
    } catch (e) {
      setSendError(e instanceof Error ? e.message : 'Could not start payment.');
      setIsSending(false);
    }
  };

  const rateRangeText = rateBounds
    ? `${getCurrencySymbol(rateCurrency)}${formatRate(rateBounds.min)} - ${getCurrencySymbol(rateCurrency)}${formatRate(rateBounds.max)} / hr`
    : '—';

  // What to tell the student when the search came back empty — distinguishes
  // "the platform genuinely has no tutors yet" from "your subject/grade
  // level/tier just didn't match anyone," which used to collapse into the
  // same misleading "no tutors have registered" message regardless of cause.
  const hasSearchFilter = !!appliedSearch.subject.trim() || !!appliedSearch.gradeLevel.trim();
  const noTutorsMessage = hasSearchFilter
    ? `No tutors match "${appliedSearch.subject || 'any subject'}" (${appliedSearch.gradeLevel || 'any grade level'})${selectedTier ? ` in the ${selectedTier.publicName} tier` : ''} yet — try a different subject, grade level, or tier.`
    : selectedTier
      ? `No tutors are currently in the ${selectedTier.publicName} tier — try another tier.`
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
            <span>Zero platform markup on every tutor rate shown</span>
          </div>

          <h1 className="text-2xl sm:text-3xl font-extrabold text-[#0F172A] tracking-tight mb-6">
            Find a tutor
          </h1>

          {selectedTier && (
            <div className="mb-6 flex items-center justify-between gap-2 px-4 py-3 rounded-xl bg-[#0F172A] text-white">
              <div className="flex items-center space-x-2 min-w-0">
                <Tag className="w-4 h-4 text-emerald-400 shrink-0" />
                <div className="min-w-0">
                  <div className="text-xs font-bold truncate">{selectedTier.publicName}</div>
                </div>
              </div>
              <button
                type="button"
                onClick={onClearTier}
                className="p-1 rounded-full hover:bg-slate-800 text-slate-400 hover:text-white transition-colors cursor-pointer shrink-0"
                aria-label="Clear pricing tier"
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

            {/* Grade level field */}
            <div className={`relative flex items-center bg-slate-100 rounded-xl px-4 py-3.5 border transition-all focus-within:border-[#15803D] focus-within:bg-white focus-within:ring-2 focus-within:ring-[#15803D]/20 ${missingField === 'gradeLevel' ? 'border-rose-400 ring-2 ring-rose-200' : 'border-transparent'}`}>
              <div className="mr-3 w-2.5 h-2.5 bg-[#0F172A] shrink-0" />
              <input
                ref={gradeLevelInputRef}
                type="text"
                value={formState.gradeLevel}
                onChange={(e) => {
                  setFormState(prev => ({ ...prev, gradeLevel: e.target.value }));
                  if (missingField === 'gradeLevel') setMissingField(null);
                }}
                placeholder="Grade level or topic"
                className="w-full bg-transparent text-[#0F172A] placeholder-slate-500 text-sm font-semibold focus:outline-none"
              />
            </div>
            {missingField === 'gradeLevel' && (
              <p className="text-xs font-semibold text-rose-600 -mt-2">Enter a grade level to start searching.</p>
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
                  ? 'Pickup now — instant matching'
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
                Matching for <span className="font-semibold text-[#0F172A]">{appliedSearch.subject || 'any subject'}</span> ({appliedSearch.gradeLevel || 'any grade level'})
                {selectedTier && <> · <span className="font-semibold text-[#0F172A]">{selectedTier.publicName}</span> tier</>}
              </p>
              {gradeLevelUnrecognized && (
                <p className="text-xs text-amber-600 font-semibold mt-1">
                  We don't recognize "{appliedSearch.gradeLevel}" as a grade level — showing results for any grade level instead.
                </p>
              )}
            </div>
            <div className="text-xs font-medium text-slate-500">
              Avg Rate: <span className="font-bold text-[#0F172A]">{rateRangeText}</span>
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
            ) : !selectedTier ? (
              <div className="bg-white rounded-2xl p-6 border border-slate-200/90 shadow-xs flex flex-col items-center text-center">
                <div className="w-14 h-14 rounded-2xl bg-emerald-50 border border-emerald-200 shadow-xs flex items-center justify-center text-[#15803D] mb-3">
                  <Users className="w-7 h-7" />
                </div>
                <p className="text-sm font-bold text-[#0F172A] mb-1">
                  {tutorCount} qualifying tutor{tutorCount === 1 ? '' : 's'} in range ({rateRangeText})
                </p>
                <p className="text-xs text-slate-500 mb-5 max-w-sm">
                  Choose a pricing tier so we know the exact amount to charge — payment happens before your
                  request goes out to tutors, so the price has to be firm first.
                </p>
                <button
                  onClick={onSearch}
                  className="px-6 py-3 bg-[#0F172A] hover:bg-slate-800 text-white text-sm font-bold rounded-xl transition-all shadow-xs cursor-pointer"
                >
                  Choose a pricing tier
                </button>
              </div>
            ) : (
              <div className="bg-white rounded-2xl p-6 border border-slate-200/90 shadow-xs flex flex-col items-center text-center">
                <div className="w-14 h-14 rounded-2xl bg-emerald-50 border border-emerald-200 shadow-xs flex items-center justify-center text-[#15803D] mb-3">
                  <CreditCard className="w-7 h-7" />
                </div>
                <p className="text-sm font-bold text-[#0F172A] mb-1">
                  {tutorCount} qualifying tutor{tutorCount === 1 ? '' : 's'} ready to take this request
                </p>
                <p className="text-xs text-slate-500 mb-5 max-w-sm">
                  You'll be charged <span className="font-bold text-[#0F172A]">{getCurrencySymbol(selectedTier.currencyCode)}{formatRate(chargedAmount ?? 0)}</span> now
                  via Paystack ({selectedTier.publicName} tier). The first qualifying tutor to accept is matched with
                  you — no need to pick one yourself.
                </p>
                <button
                  onClick={handleSendRequest}
                  disabled={isSending}
                  className="px-6 py-3 bg-[#15803D] hover:bg-[#166534] disabled:opacity-60 text-white text-sm font-bold rounded-xl transition-all shadow-xs cursor-pointer"
                >
                  {isSending ? 'Redirecting to secure payment…' : `Pay ${getCurrencySymbol(selectedTier.currencyCode)}${formatRate(chargedAmount ?? 0)} & Send Request`}
                </button>
              </div>
            )}
          </div>

        </div>
      </div>

    </div>
  );
};
