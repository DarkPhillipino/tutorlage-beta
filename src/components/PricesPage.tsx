import React, { useEffect, useState } from 'react';
import { ArrowLeft, MapPin, Clock, ChevronDown, Star, ShieldCheck, CheckCircle2, ChevronRight, Search, Loader2, UserX, Radio, Tag, X } from 'lucide-react';
import { BookingFormState, Tutor, TierDefinition } from '../types';
import { fetchTutors } from '../lib/queries';

interface PricesPageProps {
  formState: BookingFormState;
  setFormState: React.Dispatch<React.SetStateAction<BookingFormState>>;
  onBack: () => void;
  onChangeInstitution: () => void;
  onOpenScheduleModal: () => void;
  onBookTutor: (tutor: Tutor) => void;
  onSearch: () => void;
  selectedTier: TierDefinition | null;
  onClearTier: () => void;
}

export const PricesPage: React.FC<PricesPageProps> = ({
  formState,
  setFormState,
  onBack,
  onChangeInstitution,
  onOpenScheduleModal,
  onBookTutor,
  onSearch,
  selectedTier,
  onClearTier,
}) => {
  const [selectedFilter, setSelectedFilter] = useState<'all' | 'verified' | 'today'>('all');
  const [bookedTutorSuccess, setBookedTutorSuccess] = useState<Tutor | null>(null);
  const [tutors, setTutors] = useState<Tutor[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    setIsLoading(true);
    fetchTutors(selectedTier?.id)
      .then(setTutors)
      .catch(() => setTutors([]))
      .finally(() => setIsLoading(false));
  }, [selectedTier]);

  const filteredTutors = tutors.filter(t => {
    if (selectedFilter === 'verified' && !t.verified) return false;
    if (selectedFilter === 'today' && !t.isDispatchActive) return false;
    return true;
  });

  const rates = tutors.map(t => t.hourlyRate);
  const rateRange = rates.length
    ? `R${Math.min(...rates)} - R${Math.max(...rates)} / hr`
    : '—';

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
                  <div className="text-[10px] text-slate-300">R{selectedTier.minRate} - R{selectedTier.maxRate} / hr</div>
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

          <div className="space-y-3 mb-6">
            {/* Subject field */}
            <div className="relative flex items-center bg-slate-100 rounded-xl px-4 py-3.5 border border-transparent focus-within:border-[#15803D] focus-within:bg-white focus-within:ring-2 focus-within:ring-[#15803D]/20 transition-all">
              <div className="mr-3 w-2.5 h-2.5 rounded-full bg-[#0F172A] ring-4 ring-slate-200 shrink-0" />
              <input
                type="text"
                value={formState.subject}
                onChange={(e) => setFormState(prev => ({ ...prev, subject: e.target.value }))}
                placeholder="Subject or skill"
                className="w-full bg-transparent text-[#0F172A] placeholder-slate-500 text-sm font-semibold focus:outline-none"
              />
            </div>

            {/* Grade level field */}
            <div className="relative flex items-center bg-slate-100 rounded-xl px-4 py-3.5 border border-transparent focus-within:border-[#15803D] focus-within:bg-white focus-within:ring-2 focus-within:ring-[#15803D]/20 transition-all">
              <div className="mr-3 w-2.5 h-2.5 bg-[#0F172A] shrink-0" />
              <input
                type="text"
                value={formState.gradeLevel}
                onChange={(e) => setFormState(prev => ({ ...prev, gradeLevel: e.target.value }))}
                placeholder="Grade level or topic"
                className="w-full bg-transparent text-[#0F172A] placeholder-slate-500 text-sm font-semibold focus:outline-none"
              />
            </div>
          </div>

          {/* Institution row */}
          <div className="flex items-center justify-between px-4 py-3.5 rounded-xl bg-slate-100 mb-3">
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

          {/* Schedule button */}
          <button
            type="button"
            onClick={onOpenScheduleModal}
            className="w-full flex items-center justify-between px-4 py-3.5 rounded-xl bg-slate-100 hover:bg-slate-200/80 mb-3 transition-colors cursor-pointer"
          >
            <span className="flex items-center space-x-2.5 text-sm font-semibold text-[#0F172A]">
              <Clock className="w-4 h-4 text-[#0F172A]" />
              <span>
                {formState.scheduleType === 'now'
                  ? 'Pickup now — instant matching'
                  : `Scheduled: ${formState.scheduledDate || 'Today'}, ${formState.scheduledTime || '14:00'}`}
              </span>
            </span>
            <ChevronDown className="w-4 h-4 text-slate-600" />
          </button>

          {/* Filter dropdown */}
          <select
            value={selectedFilter}
            onChange={(e) => setSelectedFilter(e.target.value as 'all' | 'verified' | 'today')}
            className="w-full px-4 py-3.5 rounded-xl bg-slate-100 text-sm font-semibold text-[#0F172A] mb-6 focus:outline-none focus:ring-2 focus:ring-[#15803D]/20 cursor-pointer"
          >
            <option value="all">All tutors ({tutors.length})</option>
            <option value="verified">Verified only</option>
            <option value="today">Accepting sessions now</option>
          </select>

          <button
            type="button"
            onClick={onSearch}
            className="w-full bg-[#15803D] hover:bg-[#166534] text-white font-bold py-4 px-6 rounded-xl transition-all shadow-md hover:shadow-lg active:scale-[0.99] flex items-center justify-center space-x-2 text-base cursor-pointer"
          >
            <Search className="w-4 h-4" />
            <span>{selectedTier ? 'See pricing tiers again' : 'See pricing tiers'}</span>
          </button>

        </div>
      </div>

      {/* Right Column: Results */}
      <div className="lg:col-span-8 w-full">
        <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden">

          <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between flex-wrap gap-2">
            <div>
              <h2 className="text-lg font-extrabold text-[#0F172A]">
                {filteredTutors.length} tutor{filteredTutors.length === 1 ? '' : 's'} available
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Matching for <span className="font-semibold text-[#0F172A]">{formState.subject || 'any subject'}</span> ({formState.gradeLevel || 'any grade level'})
                {selectedTier && <> · <span className="font-semibold text-[#0F172A]">{selectedTier.publicName}</span> tier</>}
              </p>
            </div>
            <div className="text-xs font-medium text-slate-500">
              Avg Rate: <span className="font-bold text-[#0F172A]">{rateRange}</span>
            </div>
          </div>

          <div className="p-6 space-y-4 bg-[#FAF7F2]">
            {isLoading ? (
              <div className="flex items-center justify-center py-16 text-slate-400">
                <Loader2 className="w-5 h-5 animate-spin mr-2" />
                <span className="text-sm font-semibold">Loading tutors…</span>
              </div>
            ) : bookedTutorSuccess ? (
              <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-6 text-center">
                <div className="w-12 h-12 bg-emerald-100 rounded-full flex items-center justify-center text-[#15803D] mx-auto mb-3">
                  <CheckCircle2 className="w-7 h-7" />
                </div>
                <h4 className="text-xl font-extrabold text-[#0F172A] mb-1">
                  Session Requested with {bookedTutorSuccess.name}!
                </h4>
                <p className="text-xs text-slate-600 mb-4 max-w-md mx-auto">
                  We have sent your confirmation details for {formState.subject || 'Tutoring'}. Your tutor will confirm within 15 minutes.
                </p>
                <button
                  onClick={() => setBookedTutorSuccess(null)}
                  className="px-5 py-2.5 bg-[#15803D] text-white font-bold rounded-xl text-sm hover:bg-[#166534] transition-all cursor-pointer"
                >
                  View Other Tutors
                </button>
              </div>
            ) : filteredTutors.length === 0 ? (
              <div className="text-center py-16 px-4">
                <UserX className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                <p className="text-sm font-bold text-[#0F172A]">No tutors match yet</p>
                <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
                  {tutors.length === 0
                    ? selectedTier
                      ? `No tutors are currently in the ${selectedTier.publicName} tier — try another tier.`
                      : 'No tutors have registered on Tutorlage yet — check back soon.'
                    : 'Try a different filter, subject, or grade level.'}
                </p>
              </div>
            ) : (
              filteredTutors.map((tutor) => (
                <div
                  key={tutor.id}
                  className="bg-white rounded-2xl p-5 border border-slate-200/90 shadow-xs hover:shadow-md transition-all flex flex-col md:flex-row md:items-center md:justify-between gap-4"
                >
                  <div className="flex items-start space-x-4">
                    {tutor.avatarUrl ? (
                      <img
                        src={tutor.avatarUrl}
                        alt={tutor.name}
                        className="w-14 h-14 rounded-2xl object-cover border border-slate-200 shadow-xs shrink-0"
                      />
                    ) : (
                      <div className="w-14 h-14 rounded-2xl bg-slate-100 border border-slate-200 shadow-xs shrink-0 flex items-center justify-center text-slate-500 font-bold text-lg">
                        {tutor.name.charAt(0)}
                      </div>
                    )}
                    <div>
                      <div className="flex items-center space-x-2">
                        <h4 className="text-base font-bold text-[#0F172A]">{tutor.name}</h4>
                        {tutor.verified && (
                          <span className="inline-flex items-center text-[10px] font-bold bg-emerald-100 text-[#15803D] px-2 py-0.5 rounded-full border border-emerald-200">
                            <ShieldCheck className="w-3 h-3 mr-0.5" />
                            Verified
                          </span>
                        )}
                      </div>
                      <div className="text-xs font-medium text-slate-600 mt-0.5">{tutor.headline || 'Tutorlage Tutor'}</div>

                      <div className="flex items-center space-x-3 text-xs mt-2 flex-wrap gap-y-1">
                        <div className="flex items-center text-amber-500 font-bold">
                          <Star className="w-3.5 h-3.5 fill-current mr-1" />
                          <span>{tutor.rating.toFixed(2)}</span>
                          <span className="text-slate-400 font-normal ml-1">({tutor.reviewsCount})</span>
                        </div>
                        <span className="text-slate-300">•</span>
                        <div className="flex items-center text-slate-600 font-medium capitalize">
                          <span>{tutor.teachingMode}</span>
                        </div>
                        {tutor.isDispatchActive && (
                          <>
                            <span className="text-slate-300">•</span>
                            <div className="flex items-center text-[#15803D] font-medium">
                              <Radio className="w-3.5 h-3.5 mr-1" />
                              <span>Accepting sessions now</span>
                            </div>
                          </>
                        )}
                      </div>

                      {tutor.subjects.length > 0 && (
                        <p className="text-xs text-slate-500 mt-2 line-clamp-2">
                          {tutor.subjects.map(s => s.subjectName).join(', ')}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex md:flex-col items-center md:items-end justify-between border-t md:border-t-0 border-slate-100 pt-3 md:pt-0 shrink-0">
                    <div className="text-left md:text-right mb-0 md:mb-3">
                      <div className="text-2xl font-black text-[#0F172A]">
                        R{tutor.hourlyRate}
                        <span className="text-xs text-slate-500 font-semibold"> / hr</span>
                      </div>
                      <div className="text-[11px] text-emerald-700 font-bold">
                        Zero platform markup
                      </div>
                    </div>

                    <button
                      onClick={() => {
                        setBookedTutorSuccess(tutor);
                        onBookTutor(tutor);
                      }}
                      className="px-5 py-2.5 bg-[#15803D] hover:bg-[#166534] text-white text-xs font-bold rounded-xl transition-all shadow-xs cursor-pointer flex items-center space-x-1"
                    >
                      <span>Book Session</span>
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>

                </div>
              ))
            )}
          </div>

        </div>
      </div>

    </div>
  );
};
