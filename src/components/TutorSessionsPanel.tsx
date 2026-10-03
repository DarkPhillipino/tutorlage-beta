import React, { useEffect, useState } from 'react';
import { Video, CheckCircle2, Loader2, AlertCircle, Link as LinkIcon, Phone } from 'lucide-react';
import { TutorManagedSession } from '../types';
import { fetchTutorManagedSessions, setSessionMeetingLink, completeSession } from '../lib/queries';
import { getErrorMessage } from '../lib/errors';
import { CancelSessionControl, ReportProblemControl } from './UpcomingSessionsPanel';

interface TutorSessionsPanelProps {
  tutorId: string;
}

// What a tutor has to do for each accepted session: add the link the learner
// joins with before it starts (backlog 7m — without it a matched session had
// no way to happen), and mark it complete afterwards (item 10 — completion is
// what drives ratings, levels and, later, payouts).
export const TutorSessionsPanel: React.FC<TutorSessionsPanelProps> = ({ tutorId }) => {
  const [sessions, setSessions] = useState<TutorManagedSession[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [linkDrafts, setLinkDrafts] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<{ id: string; message: string } | null>(null);
  const [reloadCount, setReloadCount] = useState(0);

  useEffect(() => {
    setIsLoading(true);
    setLoadError(false);
    fetchTutorManagedSessions(tutorId)
      .then((rows) => {
        setSessions(rows);
        setLinkDrafts(Object.fromEntries(rows.map((r) => [r.id, r.meetingUrl ?? ''])));
      })
      .catch((err) => {
        console.error('fetchTutorManagedSessions failed:', err);
        setLoadError(true);
      })
      .finally(() => setIsLoading(false));
  }, [tutorId, reloadCount]);

  const run = async (sessionId: string, action: () => Promise<void>) => {
    setBusyId(sessionId);
    setError(null);
    try {
      await action();
      setReloadCount((c) => c + 1);
    } catch (e) {
      setError({ id: sessionId, message: getErrorMessage(e, 'That didn\'t work — try again.') });
    } finally {
      setBusyId(null);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center text-slate-400 text-xs py-3">
        <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading your sessions…
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="bg-white rounded-2xl p-4 border border-slate-200 text-xs text-slate-600 flex items-center justify-between">
        <span>Couldn't load your sessions.</span>
        <button onClick={() => setReloadCount((c) => c + 1)} className="font-bold text-[#15803D] cursor-pointer">Retry</button>
      </div>
    );
  }

  return (
    <div>
      <h4 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
        <Video className="w-3.5 h-3.5" />
        Your Sessions
      </h4>
      {sessions.length === 0 ? (
        <div className="bg-white rounded-2xl p-4 border border-slate-200 text-center">
          <p className="text-xs text-slate-500">No sessions to manage right now. Accepted requests show up here.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {sessions.map((s) => {
            const start = new Date(s.scheduledStart);
            const end = new Date(start.getTime() + s.durationHours * 3600_000);
            const hasEnded = end.getTime() <= Date.now();
            const draft = linkDrafts[s.id] ?? '';
            return (
              <div key={s.id} className="bg-white rounded-2xl p-4 border border-slate-200 space-y-2">
                <div>
                  <div className="text-sm font-bold text-[#0F172A]">
                    {s.subjectName ?? 'Tutoring session'} with {s.studentName}
                  </div>
                  <div className="text-xs text-slate-500">
                    {start.toLocaleDateString()} · {start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · {s.durationHours}h
                  </div>
                  {s.guardianName && (
                    <div className="text-[11px] text-slate-600 mt-1 flex flex-wrap items-center gap-1">
                      <Phone className="w-3.5 h-3.5 text-slate-400" />
                      Booked by their parent or guardian, {s.guardianName}
                      {s.guardianPhone && (
                        <>
                          {' — '}
                          <a href={`tel:${s.guardianPhone.replace(/[^\d+]/g, '')}`} className="font-bold text-[#15803D] hover:underline">
                            {s.guardianPhone}
                          </a>
                        </>
                      )}
                    </div>
                  )}
                </div>

                {hasEnded ? (
                  <button
                    onClick={() => run(s.id, () => completeSession(s.id))}
                    disabled={busyId === s.id}
                    className="flex items-center gap-1.5 bg-[#15803D] hover:bg-[#166534] disabled:opacity-60 text-white text-xs font-bold px-3 py-2 rounded-lg cursor-pointer"
                  >
                    {busyId === s.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                    Mark session complete
                  </button>
                ) : (
                  <div className="flex flex-col sm:flex-row gap-2">
                    <div className="flex-1 flex items-center bg-slate-100 rounded-lg px-2.5">
                      <LinkIcon className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <input
                        type="url"
                        inputMode="url"
                        value={draft}
                        onChange={(e) => setLinkDrafts((d) => ({ ...d, [s.id]: e.target.value }))}
                        placeholder="https://meet.google.com/…"
                        aria-label="Meeting link"
                        className="w-full bg-transparent text-xs font-semibold text-[#0F172A] py-2 px-2 focus:outline-none"
                      />
                    </div>
                    <button
                      onClick={() => run(s.id, () => setSessionMeetingLink(s.id, draft))}
                      disabled={busyId === s.id || !draft.trim() || draft.trim() === (s.meetingUrl ?? '')}
                      className="bg-[#0F172A] hover:bg-slate-800 disabled:opacity-50 text-white text-xs font-bold px-3 py-2 rounded-lg cursor-pointer shrink-0"
                    >
                      {s.meetingUrl ? 'Update link' : 'Save link'}
                    </button>
                  </div>
                )}

                {!hasEnded && !s.meetingUrl && (
                  <p className="text-[11px] text-amber-700 font-semibold">
                    Add the link your learner will use to join — they can't reach you without it.
                  </p>
                )}
                <div className="flex flex-wrap items-start gap-x-4 gap-y-1">
                  {start.getTime() > Date.now() && (
                    <CancelSessionControl sessionId={s.id} onCancelled={() => setReloadCount((c) => c + 1)} />
                  )}
                  <ReportProblemControl sessionId={s.id} />
                </div>
                {error?.id === s.id && (
                  <div className="flex items-center gap-1.5 text-[11px] text-rose-600 font-semibold">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    <span>{error.message}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
