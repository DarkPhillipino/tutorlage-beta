import React, { useEffect, useState } from 'react';
import { Calendar, Loader2, AlertTriangle } from 'lucide-react';
import { StudentSession } from '../types';
import { fetchUpcomingStudentSessions } from '../lib/queries';

interface UpcomingSessionsPanelProps {
  studentId: string;
}

// The "Sessions & History" tab body in ManageAccountModal.tsx — was a
// permanently-static "No Active Sessions Pending" placeholder regardless of
// reality; now a real list of the student's own upcoming public.sessions
// rows (RLS: "Students view own sessions" — auth.uid() = student_id).
export const UpcomingSessionsPanel: React.FC<UpcomingSessionsPanelProps> = ({ studentId }) => {
  const [sessions, setSessions] = useState<StudentSession[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    setIsLoading(true);
    setLoadError(false);
    fetchUpcomingStudentSessions(studentId)
      .then(setSessions)
      .catch((err) => {
        console.error('fetchUpcomingStudentSessions failed:', err);
        setSessions([]);
        setLoadError(true);
      })
      .finally(() => setIsLoading(false));
  }, [studentId, retryCount]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-10 text-slate-400">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        <span className="text-sm font-semibold">Loading sessions…</span>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="bg-white rounded-2xl p-6 border border-slate-200 text-center space-y-2">
        <AlertTriangle className="w-8 h-8 text-rose-400 mx-auto" />
        <h4 className="text-sm font-bold text-[#0F172A]">Couldn't load your sessions</h4>
        <p className="text-xs text-slate-500 max-w-xs mx-auto">Check your connection and try again.</p>
        <button
          onClick={() => setRetryCount((c) => c + 1)}
          className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-[#0F172A] font-bold text-xs rounded-xl cursor-pointer"
        >
          Retry
        </button>
      </div>
    );
  }

  if (sessions.length === 0) {
    return (
      <div className="bg-white rounded-2xl p-6 border border-slate-200 text-center space-y-2">
        <Calendar className="w-8 h-8 text-slate-400 mx-auto" />
        <h4 className="text-sm font-bold text-[#0F172A]">No Active Sessions Pending</h4>
        <p className="text-xs text-slate-500 max-w-xs mx-auto">
          When you book a tutor for 1-on-1, homework help, or exam prep, your schedule will appear right here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {sessions.map((s) => {
        const start = new Date(s.scheduledStart);
        return (
          <div key={s.id} className="bg-white rounded-2xl p-4 border border-slate-200">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-sm font-bold text-[#0F172A] truncate">
                  {s.subjectName ?? 'Tutoring session'} with {s.tutorName}
                </div>
                <div className="text-xs text-slate-500 mt-0.5">
                  {start.toLocaleDateString()} · {start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · {s.durationHours}h
                </div>
              </div>
              {s.status && (
                <span className="text-[10px] font-bold bg-emerald-100 text-[#15803D] px-2 py-0.5 rounded-full capitalize shrink-0">
                  {s.status}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};
