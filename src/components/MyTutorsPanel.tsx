import React, { useEffect, useState } from 'react';
import { Heart, Shuffle, Send, Loader2, AlertCircle, CheckCircle2, Clock } from 'lucide-react';
import { clearTutorChoice, fetchMyTutors, resendRequestToAnyone, setTutorChoice } from '../lib/queries';
import {
  KEEP_OR_SWAP_COPY,
  describeKeepOrSwapError,
  endedLabel,
  sortMyTutors,
  waitingLabel,
  type MyTutor,
} from '../lib/keepOrSwap';

export interface BookAgainLearner {
  id: string;
  firstName: string;
  gradeLevel?: string | null;
}

interface MyTutorsPanelProps {
  // The learner whose tutors these are: the signed-in learner, or one of the learners a parent looks after.
  learner: BookAgainLearner;
  // Show whose tutors these are (a parent with several learners).
  showLearnerName?: boolean;
  // "Book again": the page behind this one fills in the request page for the tutor and opens it.
  onBookAgain: (tutor: MyTutor, learner: BookAgainLearner) => void;
}

// "My tutors" on the Sessions tab (master 7aa + 7da): the tutors a learner has had a session with, what they chose about each
// (keep, or try someone else), any request waiting for that tutor, and the buttons: book again, keep or try someone else,
// and the one tap that sends a request on to any available tutor when the tutor did not accept in time. Only the learner
// (an adult) or the person who looks after them gets a list; anyone else gets nothing and this renders nothing.
export const MyTutorsPanel: React.FC<MyTutorsPanelProps> = ({ learner, showLearnerName = false, onBookAgain }) => {
  const [tutors, setTutors] = useState<MyTutor[] | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<{ key: string; message: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reloadCount, setReloadCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetchMyTutors(learner.id)
      .then((rows) => {
        if (!cancelled) setTutors(sortMyTutors(rows));
      })
      .catch((err) => {
        console.error('fetchMyTutors failed:', err);
        if (!cancelled) setTutors([]);
      });
    return () => {
      cancelled = true;
    };
  }, [learner.id, reloadCount]);

  if (!tutors || tutors.length === 0) return null;

  const run = async (key: string, action: () => Promise<void>, done?: string) => {
    setBusyKey(key);
    setError(null);
    setNotice(null);
    try {
      await action();
      if (done) setNotice(done);
      setReloadCount((c) => c + 1);
    } catch (e) {
      setError({ key, message: describeKeepOrSwapError(e) });
    } finally {
      setBusyKey(null);
    }
  };

  const now = new Date();
  return (
    <div className="space-y-2">
      <h4 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
        {KEEP_OR_SWAP_COPY.heading}
        {showLearnerName ? ` · ${learner.firstName}` : ''}
      </h4>
      <p className="text-[11px] text-slate-500">{KEEP_OR_SWAP_COPY.intro}</p>
      {notice && (
        <div className="flex items-center gap-1.5 text-[11px] font-semibold text-[#15803D]">
          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
          <span>{notice}</span>
        </div>
      )}
      {tutors.map((t) => {
        const key = `${learner.id}:${t.tutorId}`;
        const isBusy = busyKey === key;
        const waiting = waitingLabel(t.request, t.firstName, now);
        const ended = endedLabel(t.request, t.firstName);
        const pending = t.request?.status === 'pending';
        const requestId = t.request?.id ?? null;
        return (
          <div key={t.tutorId} className="bg-white rounded-2xl p-4 border border-slate-200 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-bold text-[#0F172A]">{t.firstName}</span>
              {t.choice === 'keep' && (
                <span className="inline-flex items-center gap-1 text-[10px] font-bold text-[#15803D] bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5">
                  <Heart className="w-3 h-3" /> Kept
                </span>
              )}
              {t.choice === 'avoid' && (
                <span className="inline-flex items-center gap-1 text-[10px] font-bold text-slate-600 bg-slate-100 border border-slate-200 rounded-full px-2 py-0.5">
                  <Shuffle className="w-3 h-3" /> Trying someone else
                </span>
              )}
            </div>
            <div className="text-xs text-slate-500">
              {t.sessionsTogether} session{t.sessionsTogether === 1 ? '' : 's'} together
              {t.lastSubject ? ` · last: ${t.lastSubject}${t.lastGrade ? ` (${t.lastGrade})` : ''}` : ''}
              {t.lastSessionAt ? ` · ${new Date(t.lastSessionAt).toLocaleDateString()}` : ''}
            </div>

            {waiting && (
              <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-700">
                <Clock className="w-3.5 h-3.5 shrink-0" />
                <span>{waiting}</span>
              </div>
            )}
            {ended && <p className="text-xs font-semibold text-slate-600">{ended}</p>}
            {!pending && t.request && !t.request.canResend && (t.request.status === 'expired' || t.request.status === 'declined') && (
              <p className="text-[11px] text-slate-500">{KEEP_OR_SWAP_COPY.chooseNewTime}</p>
            )}

            <div className="flex flex-wrap items-center gap-2">
              {requestId && (pending || t.request?.canResend) && (
                <button
                  onClick={() => run(key, async () => { await resendRequestToAnyone(requestId); }, KEEP_OR_SWAP_COPY.sentToAnyone)}
                  disabled={isBusy}
                  className="inline-flex items-center gap-1.5 bg-[#0F172A] hover:bg-slate-800 disabled:opacity-60 text-white text-xs font-bold px-3 py-2 rounded-lg cursor-pointer"
                >
                  {isBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                  {KEEP_OR_SWAP_COPY.sendToAnyone}
                </button>
              )}
              {!pending && t.canBookAgain && t.choice !== 'avoid' && (
                <button
                  onClick={() => onBookAgain(t, learner)}
                  disabled={isBusy}
                  className="inline-flex items-center gap-1.5 bg-[#15803D] hover:bg-[#166534] disabled:opacity-60 text-white text-xs font-bold px-3 py-2 rounded-lg cursor-pointer"
                >
                  <Heart className="w-3.5 h-3.5" />
                  {KEEP_OR_SWAP_COPY.bookAgain(t.firstName)}
                </button>
              )}
              {t.choice === null && (
                <>
                  <button
                    onClick={() => run(key, () => setTutorChoice(learner.id, t.tutorId, 'keep'))}
                    disabled={isBusy}
                    className="text-xs font-bold text-[#15803D] hover:underline cursor-pointer disabled:opacity-60"
                  >
                    {KEEP_OR_SWAP_COPY.keep(t.firstName)}
                  </button>
                  <button
                    onClick={() => run(key, () => setTutorChoice(learner.id, t.tutorId, 'avoid'))}
                    disabled={isBusy}
                    className="text-xs font-bold text-slate-600 hover:underline cursor-pointer disabled:opacity-60"
                  >
                    {KEEP_OR_SWAP_COPY.swap}
                  </button>
                </>
              )}
              {t.choice === 'keep' && (
                <button
                  onClick={() => run(key, () => setTutorChoice(learner.id, t.tutorId, 'avoid'))}
                  disabled={isBusy}
                  className="text-xs font-bold text-slate-600 hover:underline cursor-pointer disabled:opacity-60"
                >
                  {KEEP_OR_SWAP_COPY.swap}
                </button>
              )}
              {t.choice !== null && (
                <button
                  onClick={() => run(key, () => clearTutorChoice(learner.id, t.tutorId))}
                  disabled={isBusy}
                  className="text-[11px] font-bold text-slate-500 hover:underline cursor-pointer disabled:opacity-60"
                >
                  {KEEP_OR_SWAP_COPY.undoSwap}
                </button>
              )}
            </div>
            {!t.canBookAgain && t.choice !== 'avoid' && <p className="text-[11px] text-slate-500">{KEEP_OR_SWAP_COPY.bookAgainBlocked}</p>}
            {error?.key === key && (
              <div className="flex items-start gap-1.5 text-[11px] text-rose-600 font-semibold">
                <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>{error.message}</span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
