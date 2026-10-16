import React from 'react';
import { ArrowLeft } from 'lucide-react';
import { UpcomingSessionsPanel } from './UpcomingSessionsPanel';
import { TutorSessionsPanel } from './TutorSessionsPanel';
import type { MyTutor } from '../lib/keepOrSwap';
import type { BookAgainLearner } from './MyTutorsPanel';

interface SessionsHistoryPageProps {
  userId: string;
  role: string | undefined;
  isGuardian: boolean;
  onBack: () => void;
  // Keep or swap (master 7aa): "Book again" from My tutors; only passed when that feature is on.
  onBookAgain?: (tutor: MyTutor, learner: BookAgainLearner) => void;
}

// The "Sessions & history" page (the CEO, 16 Oct 2026: tapping a notification in the header should show the upcoming
// session, not make the person dig through Manage Account). Reached from a notification in the bell and from the
// "upcoming sessions" line in the dark banner. A learner or a parent sees what is waiting for a tutor, what is booked
// (with the link to join), what is finished and what was cancelled; a tutor sees the sessions they have to run.
export const SessionsHistoryPage: React.FC<SessionsHistoryPageProps> = ({ userId, role, isGuardian, onBack, onBookAgain }) => {
  const isTutor = role === 'tutor';
  return (
    <div className="max-w-2xl mx-auto w-full">
      <div className="bg-white rounded-2xl p-6 sm:p-8 shadow-sm border border-slate-200/80">
        <button
          onClick={onBack}
          className="inline-flex items-center space-x-1.5 text-sm font-bold text-slate-600 hover:text-[#0F172A] mb-6 cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back</span>
        </button>

        <h1 className="text-2xl sm:text-3xl font-extrabold text-[#0F172A] tracking-tight mb-1">Sessions &amp; history</h1>
        <p className="text-sm text-slate-500 mb-6">
          {isTutor
            ? 'The sessions you have accepted: add the link, hold them and mark them complete.'
            : isGuardian
              ? "Your learners' requests waiting for a tutor, their booked sessions with the link to join, and what has already happened."
              : 'Your requests waiting for a tutor, your booked sessions with the link to join, and what has already happened.'}
        </p>

        <div className="bg-[#FAF7F2] rounded-2xl p-4 sm:p-5">
          {isTutor ? (
            <TutorSessionsPanel tutorId={userId} />
          ) : (
            <UpcomingSessionsPanel studentId={userId} isGuardian={isGuardian} onBookAgain={onBookAgain} page />
          )}
        </div>
      </div>
    </div>
  );
};
