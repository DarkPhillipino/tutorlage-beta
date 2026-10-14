import React, { useEffect, useState } from 'react';
import { Heart, Shuffle, AlertCircle, Loader2 } from 'lucide-react';
import { clearTutorChoice, fetchTutorChoice, setTutorChoice } from '../lib/queries';
import { KEEP_OR_SWAP_COPY, describeKeepOrSwapError, type TutorChoice } from '../lib/keepOrSwap';
import { useAccountStatus } from './AccountGate';

interface KeepOrSwapChoiceProps {
  // The learner the session was for (a parent chooses for the learner, so this is not always the signed-in user).
  learnerId: string;
  tutorId: string;
  tutorName: string; // full name; only the first name is shown
}

// "Would you like to keep [first name]?" on a completed session (master 7aa + 7da). Keep lets the learner book that tutor
// again; "Try someone else" means that tutor never sees this learner's requests again. The tutor is not told. Rating is
// separate: trying someone else is not a bad rating. A learner under 18 with their own sign-in cannot choose (their
// parent does); the database decides, and this hides the buttons that would be refused.
export const KeepOrSwapChoice: React.FC<KeepOrSwapChoiceProps> = ({ learnerId, tutorId, tutorName }) => {
  const { isViewOnlyLearner } = useAccountStatus();
  const firstName = tutorName.trim().split(/\s+/)[0] || 'this tutor';
  const [choice, setChoice] = useState<TutorChoice | null | undefined>(undefined); // undefined = still loading
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchTutorChoice(learnerId, tutorId)
      .then((c) => {
        if (!cancelled) setChoice(c);
      })
      .catch((err) => {
        console.error('fetchTutorChoice failed:', err);
        if (!cancelled) setChoice(null);
      });
    return () => {
      cancelled = true;
    };
  }, [learnerId, tutorId]);

  if (isViewOnlyLearner || choice === undefined) return null;

  const act = async (action: () => Promise<void>, next: TutorChoice | null) => {
    setIsBusy(true);
    setError(null);
    try {
      await action();
      setChoice(next);
    } catch (e) {
      setError(describeKeepOrSwapError(e));
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <div className="bg-slate-50 rounded-xl p-3 border border-slate-200 space-y-2">
      {choice === 'keep' ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 text-xs font-bold text-[#15803D]">
            <Heart className="w-3.5 h-3.5" /> {KEEP_OR_SWAP_COPY.kept(firstName)}
          </span>
          <button
            onClick={() => act(() => clearTutorChoice(learnerId, tutorId), null)}
            disabled={isBusy}
            className="text-[11px] font-bold text-slate-600 hover:underline cursor-pointer disabled:opacity-60"
          >
            {KEEP_OR_SWAP_COPY.undoSwap}
          </button>
        </div>
      ) : choice === 'avoid' ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-700">
            <Shuffle className="w-3.5 h-3.5" /> {KEEP_OR_SWAP_COPY.swapped(firstName)}
          </span>
          <button
            onClick={() => act(() => clearTutorChoice(learnerId, tutorId), null)}
            disabled={isBusy}
            className="text-[11px] font-bold text-slate-600 hover:underline cursor-pointer disabled:opacity-60"
          >
            {KEEP_OR_SWAP_COPY.undoSwap}
          </button>
        </div>
      ) : (
        <>
          <p className="text-xs font-bold text-[#0F172A]">{KEEP_OR_SWAP_COPY.ratingPrompt(firstName)}</p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => act(() => setTutorChoice(learnerId, tutorId, 'keep'), 'keep')}
              disabled={isBusy}
              className="inline-flex items-center gap-1.5 bg-[#15803D] hover:bg-[#166534] disabled:opacity-60 text-white text-xs font-bold px-3 py-2 rounded-lg cursor-pointer"
            >
              {isBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Heart className="w-3.5 h-3.5" />}
              {KEEP_OR_SWAP_COPY.keep(firstName)}
            </button>
            <button
              onClick={() => act(() => setTutorChoice(learnerId, tutorId, 'avoid'), 'avoid')}
              disabled={isBusy}
              className="inline-flex items-center gap-1.5 bg-white border border-slate-300 hover:bg-slate-100 disabled:opacity-60 text-[#0F172A] text-xs font-bold px-3 py-2 rounded-lg cursor-pointer"
            >
              <Shuffle className="w-3.5 h-3.5" />
              {KEEP_OR_SWAP_COPY.swap}
            </button>
          </div>
          <p className="text-[11px] text-slate-500">{KEEP_OR_SWAP_COPY.ratingNote}</p>
        </>
      )}
      {error && (
        <div className="flex items-start gap-1.5 text-[11px] text-rose-600 font-semibold">
          <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
};
