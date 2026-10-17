import React, { useEffect, useState } from 'react';
import { Video, CheckCircle2, Loader2, AlertCircle, Link as LinkIcon, Phone } from 'lucide-react';
import { TutorManagedSession } from '../types';
import { fetchTutorManagedSessions, setSessionMeetingLink, completeSession } from '../lib/queries';
import { getErrorMessage } from '../lib/errors';
import { FEATURES } from '../lib/features';
import { sessionHasEnded } from '../lib/sessionTiming';
import { CancelSessionControl, ReportProblemControl, SessionRoomControl } from './UpcomingSessionsPanel';
import { LearnersITaughtPanel } from './LearnersITaughtPanel';

interface TutorSessionsPanelProps {
  tutorId: string;
}

// What a tutor has to do for each accepted session. CEO, 17 Oct 2026: it was not clear how a tutor starts the video call, because
// the only obvious button was "Mark session complete" (the session list was oldest first, so a finished session from the day
// before sat on top). Now: sessions that are coming up or under way come FIRST, each with "Start video call" as its main button
// (it appears 15 minutes before the start; until then the card says when it opens); the tutor's own meeting link (Google Meet and
// the like) is an optional extra below it; a session that has ended is listed after them, with "Mark session complete" (item 10:
// completion is what drives ratings, levels and, later, payouts).
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

  // Coming up or under way first (soonest first), then the ones that have ended and wait to be marked complete.
  const now = Date.now();
  const byStart = (a: TutorManagedSession, b: TutorManagedSession) => new Date(a.scheduledStart).getTime() - new Date(b.scheduledStart).getTime();
  const current = sessions.filter((s) => !sessionHasEnded(s.scheduledStart, s.durationHours, now)).sort(byStart);
  const ended = sessions.filter((s) => sessionHasEnded(s.scheduledStart, s.durationHours, now)).sort(byStart);

  const renderSession = (s: TutorManagedSession) => {
    const start = new Date(s.scheduledStart);
    const hasEnded = sessionHasEnded(s.scheduledStart, s.durationHours, now);
    const draft = linkDrafts[s.id] ?? '';
    return (
      <div key={s.id} className="bg-white rounded-2xl p-4 border border-slate-200 space-y-2" data-session={s.id}>
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

        {/* Tutorlage's own video call for this session (master 7bm): the main way to hold it. Shown from 15 minutes before the start
            until an hour after the session should have ended (the card says when it opens until then). */}
        {!hasEnded && FEATURES.videoRooms && (
          <SessionRoomControl sessionId={s.id} scheduledStart={s.scheduledStart} durationHours={s.durationHours} isTutor />
        )}

        {hasEnded ? (
          <>
            <button
              onClick={() => run(s.id, () => completeSession(s.id))}
              disabled={busyId === s.id}
              className="flex items-center gap-1.5 bg-[#15803D] hover:bg-[#166534] disabled:opacity-60 text-white text-xs font-bold px-3 py-2 rounded-lg cursor-pointer"
            >
              {busyId === s.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
              Mark session complete
            </button>
            {FEATURES.videoRooms && (
              <SessionRoomControl sessionId={s.id} scheduledStart={s.scheduledStart} durationHours={s.durationHours} isTutor />
            )}
          </>
        ) : (
          <div className="space-y-1">
            {FEATURES.videoRooms && <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Or use your own meeting link (optional)</p>}
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
          </div>
        )}

        {/* Only when there is no video call to fall back on (video rooms off): without a link the learner cannot reach the tutor. */}
        {!hasEnded && !s.meetingUrl && !FEATURES.videoRooms && (
          <p className="text-[11px] text-amber-700 font-semibold">
            Add the link your learner will use to join — they can't reach you without it.
          </p>
        )}
        {/* Found 16 Oct 2026: Google Meet refused a learner who was not signed in to Google ("You can't join this video call"). */}
        {!hasEnded && s.meetingUrl && /meet\.google\.com/i.test(s.meetingUrl) && (
          <p className="text-[11px] text-slate-500">
            With Google Meet, your learner has to be signed in to Google and ask to join. Open the meeting and let them in.
          </p>
        )}
        <div className="flex flex-wrap items-start gap-x-4 gap-y-1">
          {start.getTime() > now && <CancelSessionControl sessionId={s.id} onCancelled={() => setReloadCount((c) => c + 1)} />}
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
  };

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
          {current.length > 0 && ended.length > 0 && <p className="text-[11px] font-bold text-slate-500">Coming up</p>}
          {current.map(renderSession)}
          {ended.length > 0 && (
            <>
              {current.length > 0 && <p className="text-[11px] font-bold text-slate-500 pt-2">Finished: mark complete when you are done</p>}
              {ended.map(renderSession)}
            </>
          )}
        </div>
      )}
      {/* Keep or swap (master 7da, default 4): a tutor who cannot carry on with a learner says so here. Off until FEATURES.keepOrSwap. */}
      {FEATURES.keepOrSwap && <LearnersITaughtPanel tutorId={tutorId} />}
    </div>
  );
};
