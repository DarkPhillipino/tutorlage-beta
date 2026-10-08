import React, { useEffect, useState } from 'react';
import { Menu, MapPin, Loader2, CheckCircle2, Circle, Sparkles, UserX, AlertCircle } from 'lucide-react';
import { TutorDashboardData, SubTierDefinition } from '../types';
import { fetchTutorDashboard, fetchSubTierDefinitions, updateTutorProfile } from '../lib/queries';
import { AvailableRequestsQueue } from './AvailableRequestsQueue';
import { getErrorMessage } from '../lib/errors';

interface TeachGoScreenProps {
  tutorId: string;
  onOpenMenu: () => void;
  onViewTeachingProfile: () => void;
}

// Each tip must be true of the app as built (backlog 7aw replaced three that
// weren't: no 15-minute rule exists, and subjects have no descriptions).
const TIPS = [
  'Add your meeting link as soon as you accept. The learner sees it with the session.',
  'Mark the session complete when it ends. Otherwise it completes by itself 48 hours later, unless a problem was reported.',
  'Only add subjects and grades you could teach confidently.',
];

interface ProgressCriterion {
  label: string;
  met: boolean;
}

export const TeachGoScreen: React.FC<TeachGoScreenProps> = ({ tutorId, onOpenMenu, onViewTeachingProfile }) => {
  const [tutor, setTutor] = useState<TutorDashboardData | null>(null);
  const [nextSubTier, setNextSubTier] = useState<SubTierDefinition | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isTogglingOnline, setIsTogglingOnline] = useState(false);
  const [toggleError, setToggleError] = useState<string | null>(null);

  useEffect(() => {
    fetchTutorDashboard(tutorId)
      .then(async (data) => {
        setTutor(data);
        if (data?.tier) {
          const subTiers = await fetchSubTierDefinitions(data.tier.id);
          const currentCode = data.currentSubTierId.slice(-1);
          const currentIndex = subTiers.findIndex((s) => s.subTierCode === currentCode);
          setNextSubTier(subTiers[currentIndex + 1] ?? null);
        }
      })
      .catch(() => setTutor(null))
      .finally(() => setIsLoading(false));
  }, [tutorId]);

  // Real online/offline state — writes tutor_profiles.is_dispatch_active
  // instead of the local-only toggle this was before.
  const handleToggleOnline = async () => {
    if (!tutor) return;
    setToggleError(null);
    setIsTogglingOnline(true);
    const nextValue = !tutor.isDispatchActive;
    try {
      await updateTutorProfile(tutor.id, { isDispatchActive: nextValue });
      setTutor({ ...tutor, isDispatchActive: nextValue });
    } catch (e) {
      setToggleError(getErrorMessage(e, 'Could not update your status.'));
    } finally {
      setIsTogglingOnline(false);
    }
  };

  if (isLoading) {
    return (
      <div className="max-w-md mx-auto w-full bg-white rounded-2xl p-16 shadow-sm border border-slate-200/80 flex items-center justify-center text-slate-400">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        <span className="text-sm font-semibold">Loading…</span>
      </div>
    );
  }

  if (!tutor) {
    return (
      <div className="max-w-md mx-auto w-full bg-white rounded-2xl p-16 shadow-sm border border-slate-200/80 text-center">
        <UserX className="w-8 h-8 text-slate-300 mx-auto mb-2" />
        <p className="text-sm font-bold text-[#0F172A]">No tutor profile found</p>
      </div>
    );
  }

  // A requirement of zero isn't a step, so it's left out (e.g. 1D has no grade uplift since 2026-10-07).
  const criteria: ProgressCriterion[] = nextSubTier
    ? [
        { threshold: nextSubTier.minHours, label: `${nextSubTier.minHours} hrs completed`, met: tutor.totalCompletedHours >= nextSubTier.minHours },
        { threshold: nextSubTier.minRating, label: `${nextSubTier.minRating.toFixed(2)} avg rating`, met: tutor.rating >= nextSubTier.minRating },
        { threshold: nextSubTier.minWrittenReviews, label: `${nextSubTier.minWrittenReviews} written reviews`, met: tutor.reviewsCount >= nextSubTier.minWrittenReviews },
        { threshold: nextSubTier.minRepeatRatePct, label: `${nextSubTier.minRepeatRatePct}% repeat rate`, met: tutor.repeatStudentRatePct >= nextSubTier.minRepeatRatePct },
        { threshold: nextSubTier.minDistinctStudentsUplift, label: `${nextSubTier.minDistinctStudentsUplift} students uplifted`, met: tutor.qualifiedUpliftStudentsCount >= nextSubTier.minDistinctStudentsUplift },
        { threshold: nextSubTier.requiredGradeUpliftPct, label: `${nextSubTier.requiredGradeUpliftPct}% grade uplift`, met: tutor.avgGradeUpliftPct >= nextSubTier.requiredGradeUpliftPct },
      ]
        .filter((c) => c.threshold !== 0)
        .map(({ label, met }) => ({ label, met }))
    : [];
  const metCount = criteria.filter((c) => c.met).length;
  const progressPct = criteria.length ? Math.round((metCount / criteria.length) * 100) : 100;

  return (
    <div className="max-w-md mx-auto w-full">
      <div className="bg-white rounded-2xl overflow-hidden shadow-sm border border-slate-200/80">

        {/* Top bar */}
        <div className="p-4 flex items-center justify-between">
          <button
            onClick={onOpenMenu}
            className="w-10 h-10 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center transition-colors cursor-pointer"
            aria-label="Open account menu"
          >
            <Menu className="w-5 h-5 text-[#0F172A]" />
          </button>
          {/* A hard-coded "R0.00 today" earnings pill sat here; removed
              2026-10-03 (backlog 7aw) until earnings are real. */}
          <div className="w-10 h-10" />
        </div>

        {/* "Map" panel + GO button */}
        <div className="relative mx-4 h-64 sm:h-72 rounded-3xl bg-gradient-to-br from-slate-100 to-emerald-50 border border-slate-200/80 overflow-hidden flex items-center justify-center">
          <MapPin className="w-10 h-10 text-slate-300 absolute top-6 left-6" />
          <MapPin className="w-6 h-6 text-slate-300 absolute bottom-10 right-10" />

          <button
            onClick={handleToggleOnline}
            disabled={isTogglingOnline}
            className={`w-28 h-28 rounded-full flex items-center justify-center text-white font-black text-xl tracking-wide shadow-xl transition-all cursor-pointer active:scale-95 disabled:opacity-70 ${
              tutor.isDispatchActive ? 'bg-[#15803D] hover:bg-[#166534]' : 'bg-[#0F172A] hover:bg-slate-800'
            }`}
          >
            {isTogglingOnline ? <Loader2 className="w-6 h-6 animate-spin" /> : tutor.isDispatchActive ? 'END' : 'GO'}
          </button>
        </div>

        {/* Status + bottom sheet */}
        <div className="p-6 space-y-4">
          <div className="text-center">
            <h2 className="text-lg font-extrabold text-[#0F172A]">
              {tutor.isDispatchActive ? "You're online" : "You're offline"}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {tutor.isDispatchActive ? 'Accepting new session requests' : 'Tap GO to start accepting sessions'}
            </p>
            {toggleError && (
              <p className="mt-2 flex items-center justify-center gap-1.5 text-xs font-semibold text-rose-600">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                {toggleError}
              </p>
            )}
          </div>

          {/* Tier progress */}
          {nextSubTier ? (
            <div className="bg-[#FAF7F2] rounded-2xl p-4 border border-slate-200">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-[#0F172A]">
                  Unlock {tutor.tier?.publicName} {nextSubTier.subTierCode}
                </span>
                <span className="text-xs font-black text-[#15803D]">{progressPct}%</span>
              </div>
              <div className="w-full h-2 rounded-full bg-slate-200 overflow-hidden mb-3">
                <div
                  className="h-full bg-[#15803D] rounded-full transition-all"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
              <div className="space-y-1.5">
                {criteria.map((c, idx) => (
                  <div key={idx} className="flex items-center space-x-2 text-[11px]">
                    {c.met ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-[#15803D] shrink-0" />
                    ) : (
                      <Circle className="w-3.5 h-3.5 text-slate-300 shrink-0" />
                    )}
                    <span className={c.met ? 'text-slate-600' : 'text-slate-400'}>{c.label}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="bg-[#FAF7F2] rounded-2xl p-4 border border-slate-200 text-center">
              <span className="text-xs font-bold text-[#15803D]">Top tier reached — great work!</span>
            </div>
          )}

          {/* Anonymous requests this tutor can browse and claim — accepting
              one turns it into an actual public.sessions row. Shown only
              while online, so GO does what the screen says (backlog 7aw:
              until 2026-10-03 the list showed whether online or not). */}
          {tutor.isDispatchActive ? (
            <AvailableRequestsQueue tutorId={tutor.id} />
          ) : (
            <p className="text-xs text-slate-500 text-center">Tap GO to see and accept waiting requests.</p>
          )}

          {/* Tips (illustrative, not data-driven) */}
          <div className="bg-[#FAF7F2] rounded-2xl p-4 border border-slate-200">
            <div className="flex items-center space-x-1.5 mb-2">
              <Sparkles className="w-3.5 h-3.5 text-[#15803D]" />
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Tips (general advice)</span>
            </div>
            <ul className="space-y-1.5">
              {TIPS.map((tip, idx) => (
                <li key={idx} className="text-[11px] text-slate-600 leading-relaxed">• {tip}</li>
              ))}
            </ul>
          </div>

          <button
            onClick={onViewTeachingProfile}
            className="w-full text-center text-xs font-bold text-[#15803D] hover:underline cursor-pointer py-1"
          >
            View my teaching profile & stats →
          </button>
        </div>

      </div>
    </div>
  );
};
