import React, { useEffect, useState } from 'react';
import { UserMinus, Loader2, AlertCircle } from 'lucide-react';
import { endTutorPairing, fetchLearnersITaught, fetchMyEndedPairings, resumeTutorPairing, type TaughtLearner } from '../lib/queries';
import { KEEP_OR_SWAP_COPY, describeKeepOrSwapError } from '../lib/keepOrSwap';

interface LearnersITaughtPanelProps {
  tutorId: string;
}

// "Learners you have taught" for a tutor (master 7da, default 4): a tutor who cannot carry on with a learner says so here.
// It is private: the learner is told, in neutral words, that the tutor cannot continue, and can still send requests to any
// available tutor. The tutor stops seeing that learner's requests. Undo any time. Only learners taught in the last 90 days.
export const LearnersITaughtPanel: React.FC<LearnersITaughtPanelProps> = ({ tutorId }) => {
  const [learners, setLearners] = useState<TaughtLearner[] | null>(null);
  const [ended, setEnded] = useState<Set<string>>(new Set());
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<{ id: string; message: string } | null>(null);
  const [reloadCount, setReloadCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchLearnersITaught(tutorId), fetchMyEndedPairings()])
      .then(([rows, endedIds]) => {
        if (cancelled) return;
        setLearners(rows);
        setEnded(new Set(endedIds));
      })
      .catch((err) => {
        console.error('LearnersITaughtPanel load failed:', err);
        if (!cancelled) setLearners([]);
      });
    return () => {
      cancelled = true;
    };
  }, [tutorId, reloadCount]);

  if (!learners || learners.length === 0) return null;

  const run = async (id: string, action: () => Promise<void>) => {
    setBusyId(id);
    setError(null);
    try {
      await action();
      setConfirmId(null);
      setReloadCount((c) => c + 1);
    } catch (e) {
      setError({ id, message: describeKeepOrSwapError(e) });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="mt-6">
      <h4 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1 flex items-center gap-1.5">
        <UserMinus className="w-3.5 h-3.5" />
        {KEEP_OR_SWAP_COPY.tutorHeading}
      </h4>
      <p className="text-[11px] text-slate-500 mb-2">{KEEP_OR_SWAP_COPY.tutorIntro}</p>
      <div className="space-y-2">
        {learners.map((l) => {
          const first = l.name.trim().split(/\s+/)[0] || 'this learner';
          const isEnded = ended.has(l.learnerId);
          const isBusy = busyId === l.learnerId;
          return (
            <div key={l.learnerId} className="bg-white rounded-2xl p-3 border border-slate-200 space-y-1.5">
              <div className="text-sm font-bold text-[#0F172A]">
                {first}
                <span className="font-semibold text-slate-500">
                  {l.lastSubject ? ` · ${l.lastSubject}` : ''} · last session {new Date(l.lastSessionAt).toLocaleDateString()}
                </span>
              </div>
              {isEnded ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-semibold text-slate-600">{KEEP_OR_SWAP_COPY.tutorEnded}</span>
                  <button
                    onClick={() => run(l.learnerId, () => resumeTutorPairing(l.learnerId))}
                    disabled={isBusy}
                    className="text-[11px] font-bold text-[#15803D] hover:underline cursor-pointer disabled:opacity-60"
                  >
                    {KEEP_OR_SWAP_COPY.tutorResume}
                  </button>
                </div>
              ) : confirmId === l.learnerId ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[11px] text-slate-600">{KEEP_OR_SWAP_COPY.tutorEndConfirm(first)}</span>
                  <button
                    onClick={() => run(l.learnerId, () => endTutorPairing(l.learnerId))}
                    disabled={isBusy}
                    className="text-[11px] font-bold text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-60 px-2.5 py-1 rounded-lg cursor-pointer"
                  >
                    {isBusy ? 'Saving…' : 'Yes, tell them'}
                  </button>
                  <button onClick={() => setConfirmId(null)} disabled={isBusy} className="text-[11px] font-bold text-slate-600 cursor-pointer">
                    Keep tutoring
                  </button>
                </div>
              ) : (
                <button onClick={() => setConfirmId(l.learnerId)} className="text-[11px] font-bold text-rose-600 hover:underline cursor-pointer">
                  {KEEP_OR_SWAP_COPY.tutorEnd(first)}
                </button>
              )}
              {isBusy && <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-400" />}
              {error?.id === l.learnerId && (
                <div className="flex items-start gap-1.5 text-[11px] text-rose-600 font-semibold">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>{error.message}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
