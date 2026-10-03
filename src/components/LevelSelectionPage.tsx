import React, { useEffect, useState } from 'react';
import { ArrowLeft, Loader2, ChevronRight, AlertTriangle, UserX } from 'lucide-react';
import { BookingFormState, PriceLevel } from '../types';
import { fetchAvailablePriceLevels } from '../lib/queries';
import { getCurrencySymbol } from '../lib/currencies';
import { formatRate } from '../lib/format';
import {
  MENU_HEADLINE,
  MARKET_REFERENCE,
  SHOW_TRUST_LINE,
  TRUST_LINE,
  LEVEL_DESCRIPTIONS,
} from '../lib/priceLevelCopy';

interface LevelSelectionPageProps {
  formState: BookingFormState;
  gradeLevel: string;
  onBack: () => void;
  onSelectLevel: (level: PriceLevel) => void;
}

// Model 3, "minimum level" (backlog 12a) — replaces the old tier page that
// showed a range and then charged the floor. The student picks one level and
// pays exactly its price; any tutor at that level or above may accept. Only
// levels with a matching tutor right now are listed, so nothing advertised is
// unavailable. With a single available level this is marketing's "launch
// page": one price, no ladder (Drake/marketing-gtm/pricing-menu-copy.md).
export const LevelSelectionPage: React.FC<LevelSelectionPageProps> = ({
  formState,
  gradeLevel,
  onBack,
  onSelectLevel,
}) => {
  const [levels, setLevels] = useState<PriceLevel[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    setIsLoading(true);
    setLoadError(false);
    fetchAvailablePriceLevels({
      subject: formState.subject,
      gradeLevel,
      institutionId: formState.institutionId,
    })
      .then(setLevels)
      .catch((err) => {
        console.error('fetchAvailablePriceLevels failed:', err);
        setLevels([]);
        setLoadError(true);
      })
      .finally(() => setIsLoading(false));
  }, [formState.subject, gradeLevel, formState.institutionId, retryCount]);

  const tiers = Array.from(new Set(levels.map((l) => l.tierId))).map((tierId) => ({
    tierId,
    tierName: levels.find((l) => l.tierId === tierId)?.tierName ?? '',
    levels: levels.filter((l) => l.tierId === tierId),
  }));

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

        <p className="text-sm text-slate-500 mb-2">
          {formState.subject ? `For ${formState.subject}` : 'For your session'}
          {gradeLevel ? ` · ${gradeLevel}` : ''}
        </p>

        {isLoading ? (
          <div className="flex items-center justify-center py-16 text-slate-400">
            <Loader2 className="w-5 h-5 animate-spin mr-2" />
            <span className="text-sm font-semibold">Loading prices…</span>
          </div>
        ) : loadError ? (
          <div className="text-center py-16 px-4">
            <AlertTriangle className="w-8 h-8 text-rose-400 mx-auto mb-2" />
            <p className="text-sm font-bold text-[#0F172A]">Couldn't load prices</p>
            <p className="text-xs text-slate-500 mt-1">Check your connection and try again.</p>
            <button
              type="button"
              onClick={() => setRetryCount((c) => c + 1)}
              className="mt-3 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-[#0F172A] font-bold text-xs rounded-xl cursor-pointer"
            >
              Retry
            </button>
          </div>
        ) : levels.length === 0 ? (
          <div className="text-center py-16 px-4">
            <UserX className="w-8 h-8 text-slate-300 mx-auto mb-2" />
            <p className="text-sm font-bold text-[#0F172A]">No tutors available for this search yet</p>
            <p className="text-xs text-slate-500 mt-1">Try a different subject, or check back soon.</p>
          </div>
        ) : levels.length === 1 ? (
          // Launch page: one price, no ladder.
          <div className="space-y-4">
            <h1 className="text-2xl sm:text-3xl font-extrabold text-[#0F172A] tracking-tight">
              {getCurrencySymbol(levels[0].currencyCode)}{formatRate(levels[0].price)} an hour. One price, no surprises.
            </h1>
            {SHOW_TRUST_LINE && <p className="text-sm text-slate-700">{TRUST_LINE}</p>}
            <p className="text-sm text-slate-700">You'll see exactly who you've been matched with before your session starts.</p>
            <p className="text-xs text-slate-500">{MARKET_REFERENCE}</p>
            <button
              onClick={() => onSelectLevel(levels[0])}
              className="w-full sm:w-auto px-6 py-3 bg-[#15803D] hover:bg-[#166534] text-white text-sm font-bold rounded-xl cursor-pointer"
            >
              Continue at {getCurrencySymbol(levels[0].currencyCode)}{formatRate(levels[0].price)} an hour
            </button>
          </div>
        ) : (
          <div className="space-y-5">
            <div>
              <h1 className="text-xl sm:text-2xl font-extrabold text-[#0F172A] tracking-tight mb-1">{MENU_HEADLINE}</h1>
              <p className="text-xs text-slate-500">{MARKET_REFERENCE}</p>
              {SHOW_TRUST_LINE && <p className="text-xs text-slate-600 mt-1">{TRUST_LINE}</p>}
            </div>
            {tiers.map((tier) => (
              <div key={tier.tierId}>
                <h2 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">{tier.tierName}</h2>
                <div className="space-y-2">
                  {tier.levels.map((level) => (
                    <button
                      key={level.id}
                      onClick={() => onSelectLevel(level)}
                      className="w-full text-left flex items-center gap-4 p-4 rounded-2xl border border-slate-200 hover:border-[#15803D] hover:bg-emerald-50/40 transition-all cursor-pointer group"
                    >
                      <div className="w-20 shrink-0">
                        <div className="text-base font-black text-[#0F172A]">
                          {getCurrencySymbol(level.currencyCode)}{formatRate(level.price)}
                        </div>
                        <div className="text-[10px] text-slate-400 font-semibold">per hour</div>
                      </div>
                      <p className="flex-1 text-xs text-slate-600">{LEVEL_DESCRIPTIONS[level.id] ?? ''}</p>
                      <ChevronRight className="w-4 h-4 text-slate-400 group-hover:text-[#15803D] shrink-0" />
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

      </div>
    </div>
  );
};
