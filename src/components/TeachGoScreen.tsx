import React, { useEffect, useState } from 'react';
import { Menu, MapPin, Loader2, CheckCircle2, Circle, Sparkles, UserX } from 'lucide-react';
import { TutorDashboardData, SubTierDefinition } from '../types';
import { fetchTutorDashboard, fetchSubTierDefinitions } from '../lib/queries';
import { IncomingSessionRequests } from './IncomingSessionRequests';

interface TeachGoScreenProps {
  tutorId: string;
  onOpenMenu: () => void;
  onViewTeachingProfile: () => void;
}

const TIPS = [
  'Respond to session requests within 15 minutes to stay dispatch-active.',
  'Detailed subject descriptions help students find the right fit faster.',
  'Consistent weekly availability tends to earn more repeat students.',
];

interface ProgressCriterion {
  label: string;
  met: boolean;
}

export const TeachGoScreen: React.FC<TeachGoScreenProps> = ({ tutorId, onOpenMenu, onViewTeachingProfile }) => {
  const [tutor, setTutor] = useState<TutorDashboardData | null>(null);
  const [nextSubTier, setNextSubTier] = useState<SubTierDefinition | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isOnline, setIsOnline] = useState(false);

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

  const criteria: ProgressCriterion[] = nextSubTier
    ? [
        { label: `${nextSubTier.minHours} hrs completed`, met: tutor.totalCompletedHours >= nextSubTier.minHours },
        { label: `${nextSubTier.minRating.toFixed(2)} avg rating`, met: tutor.rating >= nextSubTier.minRating },
        { label: `${nextSubTier.minWrittenReviews} written reviews`, met: tutor.reviewsCount >= nextSubTier.minWrittenReviews },
        { label: `${nextSubTier.minRepeatRatePct}% repeat rate`, met: tutor.repeatStudentRatePct >= nextSubTier.minRepeatRatePct },
        { label: `${nextSubTier.minDistinctStudentsUplift} students uplifted`, met: tutor.qualifiedUpliftStudentsCount >= nextSubTier.minDistinctStudentsUplift },
        { label: `${nextSubTier.requiredGradeUpliftPct}% grade uplift`, met: tutor.avgGradeUpliftPct >= nextSubTier.requiredGradeUpliftPct },
      ]
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
          <div className="px-4 py-2 rounded-full bg-[#0F172A] text-white text-sm font-bold">
            R0.00 <span className="text-slate-400 font-medium">today</span>
          </div>
          <div className="w-10 h-10" />
        </div>

        {/* "Map" panel + GO button */}
        <div className="relative mx-4 h-64 sm:h-72 rounded-3xl bg-gradient-to-br from-slate-100 to-emerald-50 border border-slate-200/80 overflow-hidden flex items-center justify-center">
          <MapPin className="w-10 h-10 text-slate-300 absolute top-6 left-6" />
          <MapPin className="w-6 h-6 text-slate-300 absolute bottom-10 right-10" />

          <button
            onClick={() => setIsOnline((v) => !v)}
            className={`w-28 h-28 rounded-full flex items-center justify-center text-white font-black text-xl tracking-wide shadow-xl transition-all cursor-pointer active:scale-95 ${
              isOnline ? 'bg-[#15803D] hover:bg-[#166534]' : 'bg-[#0F172A] hover:bg-slate-800'
            }`}
          >
            {isOnline ? 'END' : 'GO'}
          </button>
        </div>

        {/* Status + bottom sheet */}
        <div className="p-6 space-y-4">
          <div className="text-center">
            <h2 className="text-lg font-extrabold text-[#0F172A]">
              {isOnline ? "You're online" : "You're offline"}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {isOnline ? 'Accepting new session requests' : 'Tap GO to start accepting sessions'}
            </p>
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

          {/* Real, pending session requests — accept/decline turns one into
              an actual public.sessions row. */}
          <IncomingSessionRequests tutorId={tutor.id} />

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
