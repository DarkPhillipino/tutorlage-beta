import React from 'react';
import App from '../App';
import RoomPage from './RoomPage';
import TutorDocuments from './TutorDocuments';
import { RequireAuth } from '../components/RequireAuth';
import { AccountGate } from '../components/AccountGate';
import { TutorOnboardingGate } from '../components/TutorOnboardingGate';
import { FoundingRoomGate } from '../components/FoundingGate';

// The signed-in pages, each wrapped in the checks it needs. They live in one file so that main.tsx can load them on demand: a visitor who
// is not signed in downloads the start page and the sign-in pages without any of this code (release gate PERF-BUNDLE-01).

export const GuardedApp: React.FC = () => (
  <RequireAuth>
    {/* Date of birth + Terms/Privacy acceptance before the app (7k/7l). */}
    <AccountGate>
      {/* Tutors: "beginner or experienced?" and their documents, when switched on (master 7cx). */}
      <TutorOnboardingGate>
        <App />
      </TutorOnboardingGate>
    </AccountGate>
  </RequireAuth>
);

export const GuardedRoom: React.FC = () => (
  <RequireAuth>
    <AccountGate>
      {/* Founding tutors list (off until the CEO says on): an unverified tutor cannot open or use /room; learners and parents joining by a code are not held. */}
      <FoundingRoomGate>
        <RoomPage />
      </FoundingRoomGate>
    </AccountGate>
  </RequireAuth>
);

export const GuardedTutorDocuments: React.FC = () => (
  <RequireAuth>
    <AccountGate>
      <TutorDocuments />
    </AccountGate>
  </RequireAuth>
);
