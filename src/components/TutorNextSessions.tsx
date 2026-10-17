import React, { useEffect, useState } from 'react';
import { CalendarClock } from 'lucide-react';
import { TutorSession } from '../types';
import { fetchUpcomingTutorSessions } from '../lib/queries';
import { describeWhen } from '../lib/sessionTiming';
import { FEATURES } from '../lib/features';
import { SessionRoomControl } from './UpcomingSessionsPanel';

interface TutorNextSessionsProps {
  tutorId: string;
  // Changes when the tutor accepts a request, so the new session shows at once.
  refreshKey: number;
  onOpenSessions: () => void;
}

// The tutor's upcoming sessions on the Teach screen itself, each with "Start video call" (CEO, 17 Oct 2026: after accepting a
// request a tutor could not tell where the session was or how to start the call: it was a button called "Mark session complete"
// in the Teaching tab of the account menu). A session that has started and is not over counts as upcoming. Shows nothing at all
// when there are none, so a tutor with no sessions sees no empty box.
export const TutorNextSessions: React.FC<TutorNextSessionsProps> = ({ tutorId, refreshKey, onOpenSessions }) => {
  const [sessions, setSessions] = useState<TutorSession[]>([]);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      fetchUpcomingTutorSessions(tutorId)
        .then((rows) => {
          if (!cancelled) setSessions(rows);
        })
        .catch((err) => console.error('fetchUpcomingTutorSessions failed:', err));
    load();
    // New sessions can arrive while the page is open, and the call opens on its own 15 minutes before the start.
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') load();
    }, 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [tutorId, refreshKey]);

  if (sessions.length === 0) return null;

  return (
    <div className="bg-[#FAF7F2] rounded-2xl p-4 border border-slate-200 space-y-3" data-section="tutor-next-sessions">
      <div className="flex items-center gap-1.5">
        <CalendarClock className="w-3.5 h-3.5 text-[#15803D]" />
        <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Your upcoming sessions</span>
      </div>
      <div className="space-y-3">
        {sessions.slice(0, 3).map((s) => (
          <div key={s.id} className="bg-white rounded-xl p-3 border border-slate-200 space-y-2">
            <div>
              <div className="text-sm font-bold text-[#0F172A]">
                {s.subjectName ?? 'Tutoring session'} with {s.studentName.split(' ')[0]}
              </div>
              <div className="text-xs text-slate-500">
                {describeWhen(s.scheduledStart)} · {s.durationHours}h
              </div>
            </div>
            {FEATURES.videoRooms && (
              <SessionRoomControl sessionId={s.id} scheduledStart={s.scheduledStart} durationHours={s.durationHours} isTutor />
            )}
          </div>
        ))}
      </div>
      <button type="button" onClick={onOpenSessions} className="text-xs font-bold text-[#15803D] hover:underline cursor-pointer">
        {sessions.length > 3 ? `See all ${sessions.length} sessions →` : 'More about my sessions →'}
      </button>
    </div>
  );
};
