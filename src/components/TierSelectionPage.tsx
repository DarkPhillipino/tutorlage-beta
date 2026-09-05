import React, { useEffect, useState } from 'react';
import { ArrowLeft, Loader2, ChevronRight, Users, GraduationCap, Award, Crown, AlertTriangle } from 'lucide-react';
import { BookingFormState, TierDefinition } from '../types';
import { fetchTierDefinitions } from '../lib/queries';
import { formatRateRange } from '../lib/format';

interface TierSelectionPageProps {
  formState: BookingFormState;
  onBack: () => void;
  onSelectTier: (tier: TierDefinition) => void;
}

// Purely presentational — cosmetic pairing of each fixed tier id to an icon,
// same idea as Uber assigning a car icon per ride class.
const TIER_ICONS: Record<number, React.ElementType> = {
  1: Users,
  2: GraduationCap,
  3: Award,
  4: Crown,
};

export const TierSelectionPage: React.FC<TierSelectionPageProps> = ({
  formState,
  onBack,
  onSelectTier,
}) => {
  const [tiers, setTiers] = useState<TierDefinition[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    setIsLoading(true);
    setLoadError(false);
    fetchTierDefinitions()
      .then(setTiers)
      .catch((err) => {
        console.error('fetchTierDefinitions failed:', err);
        setTiers([]);
        setLoadError(true);
      })
      .finally(() => setIsLoading(false));
  }, [retryCount]);

  return (
    <div className="max-w-2xl mx-auto w-full">
      <div className="bg-white rounded-2xl p-6 sm:p-8 shadow-sm border border-slate-200/80">

        <button
          onClick={onBack}
          className="inline-flex items-center space-x-1.5 text-sm font-bold text-slate-600 hover:text-[#0F172A] mb-6 cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to search</span>
        </button>

        <h1 className="text-2xl sm:text-3xl font-extrabold text-[#0F172A] tracking-tight mb-1">
          Choose a pricing tier
        </h1>
        <p className="text-sm text-slate-500 mb-6">
          {formState.subject ? `For ${formState.subject}` : 'For your session'}
          {formState.gradeLevel ? ` · ${formState.gradeLevel}` : ''}
        </p>

        {isLoading ? (
          <div className="flex items-center justify-center py-16 text-slate-400">
            <Loader2 className="w-5 h-5 animate-spin mr-2" />
            <span className="text-sm font-semibold">Loading pricing tiers…</span>
          </div>
        ) : loadError ? (
          <div className="text-center py-16 px-4">
            <AlertTriangle className="w-8 h-8 text-rose-400 mx-auto mb-2" />
            <p className="text-sm font-bold text-[#0F172A]">Couldn't load pricing tiers</p>
            <p className="text-xs text-slate-500 mt-1">Check your connection and try again.</p>
            <button
              type="button"
              onClick={() => setRetryCount((c) => c + 1)}
              className="mt-3 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-[#0F172A] font-bold text-xs rounded-xl cursor-pointer"
            >
              Retry
            </button>
          </div>
        ) : tiers.length === 0 ? (
          <div className="text-center py-16 px-4">
            <p className="text-sm font-bold text-[#0F172A]">No pricing tiers configured yet</p>
            <p className="text-xs text-slate-500 mt-1">Check back soon.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {tiers.map((tier) => {
              const Icon = TIER_ICONS[tier.id] ?? Users;
              return (
                <button
                  key={tier.id}
                  onClick={() => onSelectTier(tier)}
                  className="w-full text-left flex items-center gap-4 p-4 rounded-2xl border border-slate-200 hover:border-[#15803D] hover:bg-emerald-50/40 transition-all cursor-pointer group"
                >
                  <div className="w-14 h-14 rounded-2xl bg-slate-100 group-hover:bg-emerald-100 flex items-center justify-center text-[#0F172A] group-hover:text-[#15803D] shrink-0 transition-colors">
                    <Icon className="w-7 h-7" />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-base font-bold text-[#0F172A]">{tier.publicName}</h3>
                      <div className="text-right shrink-0">
                        <div className="text-sm font-black text-[#0F172A]">
                          {formatRateRange(tier.minRate, tier.maxRate)}
                        </div>
                        <div className="text-[10px] text-slate-400 font-semibold">/ hr</div>
                      </div>
                    </div>
                    <p className="text-xs text-slate-500 mt-1 line-clamp-2">
                      {tier.positioningQuote}
                    </p>
                  </div>

                  <ChevronRight className="w-4 h-4 text-slate-400 group-hover:text-[#15803D] shrink-0" />
                </button>
              );
            })}
          </div>
        )}

      </div>
    </div>
  );
};
