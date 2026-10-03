import React, { useEffect, useState } from 'react';
import { Calendar, Loader2, AlertTriangle, Video, Star, Check, AlertCircle } from 'lucide-react';
import { StudentSessionDetail, ProblemReason } from '../types';
import { fetchStudentSessionDetails, fetchLearnerSessionDetails, submitReview, cancelSession, reportSessionProblem } from '../lib/queries';
import { fetchMyLearners } from '../lib/guardian';
import { getErrorMessage } from '../lib/errors';

interface UpcomingSessionsPanelProps {
  // The signed-in user's id: the learner's own, or the guardian's.
  studentId: string;
  // A parent or guardian sees their learners' sessions instead (backlog 7k).
  isGuardian?: boolean;
}

// The "Sessions & History" tab body in ManageAccountModal.tsx: the learner's
// upcoming sessions (with the link to join, once the tutor adds it — backlog
// 7m) and sessions completed in the last 30 days (rate them — item 10: a
// review is what moves the tutor's rating and level). For a guardian, the
// same list across all their learners, each labelled with who it's for; they
// can cancel what they booked, and rating stays with the learner.
export const UpcomingSessionsPanel: React.FC<UpcomingSessionsPanelProps> = ({ studentId, isGuardian = false }) => {
  const [sessions, setSessions] = useState<StudentSessionDetail[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    setIsLoading(true);
    setLoadError(false);
    const load = isGuardian
      ? fetchMyLearners(studentId).then((learners) =>
          fetchLearnerSessionDetails(learners.map((l) => ({ id: l.id, name: l.firstName }))),
        )
      : fetchStudentSessionDetails(studentId);
    load
      .then(setSessions)
      .catch((err) => {
        console.error('fetchStudentSessionDetails failed:', err);
        setSessions([]);
        setLoadError(true);
      })
      .finally(() => setIsLoading(false));
  }, [studentId, isGuardian, retryCount]);

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

  const now = Date.now();
  const upcoming = sessions
    .filter((s) => s.status === 'scheduled' && new Date(s.scheduledStart).getTime() + s.durationHours * 3600_000 > now)
    .sort((a, b) => a.scheduledStart.localeCompare(b.scheduledStart));
  const completed = sessions.filter((s) => s.status === 'completed');

  if (upcoming.length === 0 && completed.length === 0) {
    return (
      <div className="bg-white rounded-2xl p-6 border border-slate-200 text-center space-y-2">
        <Calendar className="w-8 h-8 text-slate-400 mx-auto" />
        <h4 className="text-sm font-bold text-[#0F172A]">No sessions yet</h4>
        <p className="text-xs text-slate-500 max-w-xs mx-auto">
          {isGuardian
            ? 'When a tutor accepts a request you made for one of your learners, the session and the link to join will appear here.'
            : 'When a tutor accepts your request, the session and the link to join will appear here.'}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {upcoming.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Upcoming</h4>
          {upcoming.map((s) => {
            const start = new Date(s.scheduledStart);
            return (
              <div key={s.id} className="bg-white rounded-2xl p-4 border border-slate-200 space-y-2">
                <div className="text-sm font-bold text-[#0F172A]">
                  {s.subjectName ?? 'Tutoring session'} with {s.tutorName}
                  {s.learnerName && <span className="font-semibold text-slate-500"> · for {s.learnerName}</span>}
                </div>
                <div className="text-xs text-slate-500">
                  {start.toLocaleDateString()} · {start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · {s.durationHours}h
                </div>
                {s.meetingUrl ? (
                  <a
                    href={s.meetingUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 bg-[#15803D] hover:bg-[#166534] text-white text-xs font-bold px-3 py-2 rounded-lg"
                  >
                    <Video className="w-3.5 h-3.5" />
                    Join session
                  </a>
                ) : (
                  <p className="text-[11px] text-slate-500">Your tutor will add the link to join before the session starts.</p>
                )}
                <div className="flex flex-wrap items-start gap-x-4 gap-y-1">
                  <CancelSessionControl sessionId={s.id} onCancelled={() => setRetryCount((c) => c + 1)} />
                  <ReportProblemControl sessionId={s.id} />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {completed.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Recently completed</h4>
          {completed.map((s) =>
            isGuardian ? (
              <div key={s.id} className="bg-white rounded-2xl p-4 border border-slate-200 space-y-1">
                <div className="text-sm font-bold text-[#0F172A]">
                  {s.subjectName ?? 'Tutoring session'} with {s.tutorName}
                  {s.learnerName && <span className="font-semibold text-slate-500"> · for {s.learnerName}</span>}
                </div>
                <div className="text-xs text-slate-500">{new Date(s.scheduledStart).toLocaleDateString()}</div>
                <p className="text-[11px] text-slate-500">
                  {s.learnerName ?? 'Your learner'} can rate this session when they sign in.
                </p>
                <ReportProblemControl sessionId={s.id} />
              </div>
            ) : (
              <CompletedSessionCard
                key={s.id}
                session={s}
                studentId={studentId}
                onReviewed={() => setRetryCount((c) => c + 1)}
              />
            ),
          )}
        </div>
      )}
    </div>
  );
};

// A two-step cancel: first click asks for confirmation, so a stray tap can't
// cancel a booking. The database enforces the window and issues the refund.
export const CancelSessionControl: React.FC<{ sessionId: string; onCancelled: () => void }> = ({
  sessionId,
  onCancelled,
}) => {
  const [isConfirming, setIsConfirming] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCancel = async () => {
    setIsCancelling(true);
    setError(null);
    try {
      await cancelSession(sessionId);
      onCancelled();
    } catch (e) {
      setError(getErrorMessage(e, 'Could not cancel this session.'));
      setIsCancelling(false);
    }
  };

  return (
    <div>
      {isConfirming ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] text-slate-600">
            Cancel this session? The payment is refunded in full to the card — once Paystack has processed it, it can take up to 10 business days to reach the account.
          </span>
          <button
            onClick={handleCancel}
            disabled={isCancelling}
            className="text-[11px] font-bold text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-60 px-2.5 py-1 rounded-lg cursor-pointer"
          >
            {isCancelling ? 'Cancelling…' : 'Yes, cancel'}
          </button>
          <button
            onClick={() => setIsConfirming(false)}
            disabled={isCancelling}
            className="text-[11px] font-bold text-slate-600 px-2.5 py-1 cursor-pointer"
          >
            Keep it
          </button>
        </div>
      ) : (
        <button onClick={() => setIsConfirming(true)} className="text-[11px] font-bold text-rose-600 hover:underline cursor-pointer">
          Cancel session
        </button>
      )}
      {error && (
        <div className="flex items-center gap-1.5 text-[11px] text-rose-600 font-semibold mt-1">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
};

const PROBLEM_REASONS: { value: ProblemReason; label: string }[] = [
  { value: 'no_show', label: "The other person didn't show up" },
  { value: 'late_arrival', label: 'Started very late' },
  { value: 'technical_issue', label: 'The call or link didn’t work' },
  { value: 'poor_quality', label: 'The session wasn’t what was promised' },
  { value: 'billing_error', label: 'A problem with the payment' },
  { value: 'other', label: 'Something else' },
];

// "Report a problem" for the session's learner, the person who booked it, or
// its tutor (backlog 7u). An open report stops the session from completing
// automatically until an admin has looked at it. For anything about a child's
// safety, the safeguarding procedure applies instead of this form.
export const ReportProblemControl: React.FC<{ sessionId: string }> = ({ sessionId }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [reason, setReason] = useState<ProblemReason>('no_show');
  const [description, setDescription] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSent, setIsSent] = useState(false);

  const handleSend = async () => {
    setIsSending(true);
    setError(null);
    try {
      await reportSessionProblem(sessionId, reason, description);
      setIsSent(true);
      setIsOpen(false);
    } catch (e) {
      setError(getErrorMessage(e, 'Could not send your report.'));
    } finally {
      setIsSending(false);
    }
  };

  if (isSent) {
    return (
      <p className="text-[11px] font-semibold text-[#15803D] flex items-center gap-1">
        <Check className="w-3.5 h-3.5" /> Thanks — your report was sent. Tutorlage will be in touch.
      </p>
    );
  }
  if (!isOpen) {
    return (
      <button onClick={() => setIsOpen(true)} className="text-[11px] font-bold text-slate-500 hover:underline cursor-pointer">
        Report a problem
      </button>
    );
  }
  return (
    <div className="space-y-2 bg-slate-50 rounded-xl p-3 border border-slate-200">
      <select
        value={reason}
        onChange={(e) => setReason(e.target.value as ProblemReason)}
        aria-label="What went wrong"
        className="w-full bg-white rounded-lg px-2.5 py-2 text-xs font-semibold text-[#0F172A] border border-slate-200 focus:outline-none"
      >
        {PROBLEM_REASONS.map((r) => (
          <option key={r.value} value={r.value}>
            {r.label}
          </option>
        ))}
      </select>
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="What happened? A sentence or two is enough."
        rows={3}
        maxLength={2000}
        className="w-full bg-white rounded-lg px-2.5 py-2 text-xs text-[#0F172A] border border-slate-200 focus:outline-none"
      />
      {error && (
        <div className="flex items-start gap-1.5 text-[11px] text-rose-600 font-semibold">
          <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}
      <div className="flex items-center gap-2">
        <button
          onClick={handleSend}
          disabled={isSending || description.trim().length < 10}
          className="bg-[#0F172A] hover:bg-slate-800 disabled:opacity-50 text-white text-[11px] font-bold px-3 py-1.5 rounded-lg cursor-pointer"
        >
          {isSending ? 'Sending…' : 'Send report'}
        </button>
        <button onClick={() => setIsOpen(false)} disabled={isSending} className="text-[11px] font-bold text-slate-600 cursor-pointer">
          Cancel
        </button>
      </div>
    </div>
  );
};

const CompletedSessionCard: React.FC<{
  session: StudentSessionDetail;
  studentId: string;
  onReviewed: () => void;
}> = ({ session, studentId, onReviewed }) => {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (rating < 1) {
      setError('Choose a rating from 1 to 5 stars.');
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      await submitReview({ sessionId: session.id, tutorId: session.tutorId, studentId, rating, comment });
      onReviewed();
    } catch (e) {
      setError(getErrorMessage(e, 'Could not save your rating.'));
      setIsSaving(false);
    }
  };

  const start = new Date(session.scheduledStart);
  return (
    <div className="bg-white rounded-2xl p-4 border border-slate-200 space-y-2">
      <div className="text-sm font-bold text-[#0F172A]">
        {session.subjectName ?? 'Tutoring session'} with {session.tutorName}
      </div>
      <div className="text-xs text-slate-500">{start.toLocaleDateString()}</div>

      {session.hasReview ? (
        <div className="flex items-center gap-1.5 text-xs font-bold text-[#15803D]">
          <Check className="w-3.5 h-3.5" /> Thanks — you rated this session.
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center gap-1" role="radiogroup" aria-label="Rating">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={rating === n}
                aria-label={`${n} star${n === 1 ? '' : 's'}`}
                onClick={() => setRating(n)}
                className="p-0.5 cursor-pointer"
              >
                <Star className={`w-5 h-5 ${n <= rating ? 'text-amber-500 fill-current' : 'text-slate-300'}`} />
              </button>
            ))}
          </div>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="What went well? (optional)"
            rows={2}
            maxLength={1000}
            className="w-full bg-slate-100 rounded-lg px-2.5 py-2 text-xs text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[#15803D]/20"
          />
          {error && (
            <div className="flex items-center gap-1.5 text-[11px] text-rose-600 font-semibold">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}
          <button
            onClick={handleSubmit}
            disabled={isSaving}
            className="bg-[#0F172A] hover:bg-slate-800 disabled:opacity-60 text-white text-xs font-bold px-3 py-2 rounded-lg cursor-pointer"
          >
            {isSaving ? 'Saving…' : 'Submit rating'}
          </button>
        </div>
      )}
      <ReportProblemControl sessionId={session.id} />
    </div>
  );
};
