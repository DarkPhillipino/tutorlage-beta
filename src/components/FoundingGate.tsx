import React from 'react';
import { Loader2 } from 'lucide-react';
import { useAuth } from '../lib/AuthContext';
import { useFoundingGate } from '../lib/foundingGateHooks';
import { FOUNDING_COPY, gateBlocksTutorSide } from '../lib/foundingList';
import { FoundingGateInline, FoundingGateNotice, type BlockedGateState } from './FoundingGateNotice';

// THE TEACH BUTTON'S GATE (founding tutors list, CEO 10 Nov 2026, plan D5). While the gate is on (it ships OFF; src/lib/foundingList.ts, migration
// 20261110200000) the Teach screen has four states, read from the database:
//   not on the list      -> "Tutoring places open in groups. Join the founding tutors list ..." with a button to the list page
//   on the list, waiting -> "Your place has not opened yet ..."
//   released             -> the Teach screen as it is today (the tutor sign-up pages and the document upload come first, see TutorOnboardingGate)
//   verified             -> the full tutor side as it is today
// With the gate off, or if the database cannot say, this renders its children exactly as before. The database enforces the gate itself (documents, tutor type,
// accepting); this only decides what the person is shown.

// The document upload on the Teaching tab (Manage account): a tutor whose place has not opened sees the same sentence there, not a database refusal.
export const FoundingDocumentsGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { gate, loading } = useFoundingGate();
  if (loading) return null;
  if (gateBlocksTutorSide(gate.state)) return <FoundingGateInline state={gate.state as BlockedGateState} />;
  return <>{children}</>;
};

// The Teaching tab (Manage account): not reachable by a place that has not opened (not on the list, or waiting). A released tutor needs it for subjects, hours and documents.
export const FoundingTeachingGate = FoundingDocumentsGate;

// /room: video rooms are a TUTOR's tool until the tutor is verified (Programmer C found no verification check in the room code, so an unapproved tutor could open a room and
// share its link). While the gate is on, a tutor who is not on the list or is waiting sees their message; a released tutor sees that rooms open once they are verified. A learner or
// parent joining a room by its code is never held (only a tutor account is). The database holds the same rule (a room cannot be opened by an unverified tutor).
export const FoundingRoomGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { profile } = useAuth();
  const { gate, loading } = useFoundingGate();
  if (profile?.role !== 'tutor') return <>{children}</>;
  if (loading) return null;
  if (gateBlocksTutorSide(gate.state)) return <FoundingGateNotice state={gate.state as BlockedGateState} />;
  if (gate.state === 'released') {
    return (
      <div data-founding-gate="released-room" className="max-w-md mx-auto w-full bg-white rounded-2xl p-8 shadow-sm border border-slate-200/80 text-center my-8">
        <p role="status" className="text-sm font-semibold text-[#0F172A] leading-relaxed">{FOUNDING_COPY.gateRoom}</p>
      </div>
    );
  }
  return <>{children}</>;
};

export const FoundingTeachGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { gate, loading } = useFoundingGate();
  if (loading) {
    return (
      <div className="max-w-md mx-auto w-full bg-white rounded-2xl p-16 shadow-sm border border-slate-200/80 flex items-center justify-center text-slate-400">
        <Loader2 className="w-5 h-5 animate-spin mr-2" aria-hidden="true" />
        <span className="text-sm font-semibold">{FOUNDING_COPY.gateLoading}</span>
      </div>
    );
  }
  if (gateBlocksTutorSide(gate.state)) return <FoundingGateNotice state={gate.state as BlockedGateState} />;
  return <>{children}</>;
};
