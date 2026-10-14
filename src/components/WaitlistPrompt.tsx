import React, { useEffect, useState } from 'react';
import { BellRing, Check, Loader2 } from 'lucide-react';
import { fetchMyOpenWaitlistEntries, joinTutorWaitlist, leaveTutorWaitlist } from '../lib/queries';
import { WAITLIST_COPY, WaitlistEntry, describeWaitlistError, findOpenEntry } from '../lib/waitlist';

// Shown on the "No tutor can take this request yet" screen (master 7cz) when FEATURES.tutorWaitlist is on.
// A learner, or the parent who looks after them, asks to be told when an approved tutor teaches this subject and
// grade. They are told through the notification bell; nothing else is collected or sent.
interface WaitlistPromptProps {
  learnerId: string;
  subject: string;
  gradeLevel: string | null;
  institutionId: string | null;
}

export const WaitlistPrompt: React.FC<WaitlistPromptProps> = ({ learnerId, subject, gradeLevel, institutionId }) => {
  const [entry, setEntry] = useState<WaitlistEntry | null>(null);
  const [isChecking, setIsChecking] = useState(true);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = { studentId: learnerId, subject, gradeLevel, institutionId };

  useEffect(() => {
    let cancelled = false;
    setIsChecking(true);
    setError(null);
    fetchMyOpenWaitlistEntries()
      .then((entries) => {
        if (!cancelled) setEntry(findOpenEntry(entries, { studentId: learnerId, subject, gradeLevel, institutionId }));
      })
      .catch((err) => {
        // Not being able to look is not a reason to hide the button; joining again just returns the same entry.
        console.error('fetchMyOpenWaitlistEntries failed:', err);
      })
      .finally(() => {
        if (!cancelled) setIsChecking(false);
      });
    return () => {
      cancelled = true;
    };
  }, [learnerId, subject, gradeLevel, institutionId]);

  const join = async () => {
    setIsBusy(true);
    setError(null);
    try {
      const id = await joinTutorWaitlist(search);
      setEntry({ id, studentId: learnerId, subject, gradeLevel, institutionId, createdAt: new Date().toISOString() });
    } catch (err) {
      console.error('joinTutorWaitlist failed:', err);
      setError(describeWaitlistError(err));
    } finally {
      setIsBusy(false);
    }
  };

  const leave = async () => {
    if (!entry) return;
    setIsBusy(true);
    setError(null);
    try {
      await leaveTutorWaitlist(entry.id);
      setEntry(null);
    } catch (err) {
      console.error('leaveTutorWaitlist failed:', err);
      setError(describeWaitlistError(err));
    } finally {
      setIsBusy(false);
    }
  };

  if (isChecking) {
    return (
      <div className="mt-6 flex items-center justify-center text-slate-400">
        <Loader2 className="w-4 h-4 animate-spin" />
      </div>
    );
  }

  return (
    <div className="mt-6 max-w-sm mx-auto text-left bg-emerald-50/60 border border-emerald-100 rounded-2xl p-4">
      {entry ? (
        <>
          <div className="flex items-center gap-2 text-sm font-bold text-[#15803D]">
            <Check className="w-4 h-4" /> {WAITLIST_COPY.joinedTitle}
          </div>
          <p className="text-xs text-slate-600 mt-1.5 leading-relaxed">{WAITLIST_COPY.joinedBody}</p>
          <p className="text-[11px] text-slate-400 mt-1">{WAITLIST_COPY.keptFor}</p>
          <button
            type="button"
            onClick={leave}
            disabled={isBusy}
            className="mt-3 text-xs font-bold text-slate-500 hover:text-[#0F172A] underline disabled:opacity-50 cursor-pointer"
          >
            {WAITLIST_COPY.leave}
          </button>
        </>
      ) : (
        <>
          <p className="text-xs text-slate-600 leading-relaxed">{WAITLIST_COPY.intro}</p>
          <button
            type="button"
            onClick={join}
            disabled={isBusy}
            className="mt-3 inline-flex items-center gap-2 px-4 py-2 bg-[#15803D] hover:bg-[#166534] text-white text-xs font-bold rounded-xl disabled:opacity-60 cursor-pointer"
          >
            {isBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <BellRing className="w-3.5 h-3.5" />}
            {isBusy ? WAITLIST_COPY.joining : WAITLIST_COPY.button}
          </button>
          <p className="text-[11px] text-slate-400 mt-2">{WAITLIST_COPY.keptFor}</p>
        </>
      )}
      {error && <p className="text-xs font-semibold text-rose-600 mt-2">{error}</p>}
    </div>
  );
};
