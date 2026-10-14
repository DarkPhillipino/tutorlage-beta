import React, { Suspense, lazy, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, FileWarning, Loader2 } from 'lucide-react';
import { useAuth } from '../lib/AuthContext';
import { supabase } from '../lib/supabaseClient';
import { FEATURES } from '../lib/features';
import { getErrorMessage } from '../lib/errors';
import { type TutorTrack } from '../lib/tutorOnboarding';
import { chooseTrack } from '../lib/tutorOnboardingData';
import { type TutorOnboardingState, onboardingStage, useTutorOnboarding } from '../lib/useTutorOnboarding';

// The two pages are loaded only when a tutor actually reaches them, so everyone else (learners, parents, tutors who are
// finished or were never asked) does not download them; that keeps the first load small for people on prepaid data.
const TutorTypePage = lazy(() => import('./TutorTypePage').then((m) => ({ default: m.TutorTypePage })));
const TutorDocumentsPage = lazy(() => import('./TutorDocumentsPage').then((m) => ({ default: m.TutorDocumentsPage })));

const PageLoading: React.FC = () => (
  <div className="min-h-screen flex items-center justify-center bg-[#FAF7F2] text-slate-400">
    <Loader2 className="w-5 h-5 animate-spin mr-2" />
    <span className="text-sm font-semibold">Loading…</span>
  </div>
);

// Master 7cx. Sits between the account gate and the app (like AccountGate). A tutor who has not finished the second and
// third sign-up pages is shown them first: "beginner or experienced?" and then the documents that kind of tutor needs.
// Nothing here applies unless FEATURES.tutorOnboarding is on, and never to a tutor that existed before the feature
// (the database marks those "grandfathered"). "I will finish this later" lets a tutor into the app for this visit
// (the police certificate can take weeks to get); they are reminded on the Teach screen, and they cannot be approved
// until every required document is in (the admin app shows what is missing).

const SKIP_KEY = 'tutorlage.tutorOnboarding.skippedFor';

const wasSkipped = (tutorId: string) => {
  try {
    return window.sessionStorage.getItem(SKIP_KEY) === tutorId;
  } catch {
    return false;
  }
};
const markSkipped = (tutorId: string) => {
  try {
    window.sessionStorage.setItem(SKIP_KEY, tutorId);
  } catch {
    // Storage blocked: they simply see the pages again on the next page load.
  }
};

interface FlowProps {
  tutorId: string;
  state: TutorOnboardingState;
  reload: () => Promise<void>;
  onDone: () => void;
  onSkip?: () => void;
}

// Page 2 when no kind has been chosen (or the tutor wants to change it), otherwise page 3.
export const TutorOnboardingFlow: React.FC<FlowProps> = ({ tutorId, state, reload, onDone, onSkip }) => {
  const { signOut } = useAuth();
  const track = state.onboarding?.track ?? null;
  const [editingType, setEditingType] = useState(false);
  const [selected, setSelected] = useState<TutorTrack | null>(track);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!track || editingType || !state.onboarding) {
    const handleContinue = async () => {
      if (!selected) return;
      setSaving(true);
      setError(null);
      try {
        if (selected !== track) await chooseTrack(supabase, selected);
        await reload();
        setEditingType(false);
      } catch (e) {
        setError(getErrorMessage(e, 'We could not save your choice. Please try again.'));
      } finally {
        setSaving(false);
      }
    };
    return (
      <Suspense fallback={<PageLoading />}>
        <TutorTypePage selected={selected} onSelect={setSelected} onContinue={handleContinue} isSaving={saving} error={error} onSignOut={signOut} />
      </Suspense>
    );
  }

  return (
    <Suspense fallback={<PageLoading />}>
      <TutorDocumentsPage
        tutorId={tutorId}
        track={track}
        onboarding={state.onboarding}
        documents={state.documents}
        reload={reload}
        onChangeType={() => {
          setSelected(track);
          setEditingType(true);
        }}
        onDone={onDone}
        onSkip={onSkip}
        onSignOut={signOut}
      />
    </Suspense>
  );
};

const GateForTutor: React.FC<{ tutorId: string; children: React.ReactNode }> = ({ tutorId, children }) => {
  const { signOut } = useAuth();
  const { state, error, reload } = useTutorOnboarding(tutorId, true);
  // Decided once, from the first load, so finishing the last upload does not pull the page away before the tutor
  // has pressed "Submit".
  const [showFlow, setShowFlow] = useState<boolean | null>(null);

  useEffect(() => {
    if (state && showFlow === null) {
      const stage = onboardingStage(state);
      setShowFlow(stage !== 'not-needed' && stage !== 'complete' && !wasSkipped(tutorId));
    }
  }, [state, showFlow, tutorId]);

  if (error && !state) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#FAF7F2] px-6 py-12">
        <div className="w-full max-w-md bg-white rounded-2xl p-8 shadow-sm border border-slate-200/80">
          <div className="flex items-start space-x-2 bg-rose-50 border border-rose-200 rounded-xl px-4 py-3 text-xs font-semibold text-rose-700 mb-4">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
          <button onClick={() => reload()} className="w-full bg-[#0F172A] text-white font-bold py-3 rounded-xl text-sm cursor-pointer">
            Try again
          </button>
          <button onClick={signOut} className="w-full mt-3 text-xs font-bold text-slate-400 hover:text-slate-600 cursor-pointer">
            Sign out
          </button>
        </div>
      </div>
    );
  }

  if (!state || showFlow === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#FAF7F2] text-slate-400">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        <span className="text-sm font-semibold">Loading Tutorlage…</span>
      </div>
    );
  }

  if (!showFlow) return <>{children}</>;

  return (
    <TutorOnboardingFlow
      tutorId={tutorId}
      state={state}
      reload={reload}
      onDone={() => setShowFlow(false)}
      onSkip={() => {
        markSkipped(tutorId);
        setShowFlow(false);
      }}
    />
  );
};

export const TutorOnboardingGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, profile } = useAuth();
  if (!FEATURES.tutorOnboarding || !user || profile?.role !== 'tutor') return <>{children}</>;
  return <GateForTutor tutorId={user.id}>{children}</GateForTutor>;
};

// A line on the Teach screen for a tutor who chose "finish later".
export const TutorDocumentsReminder: React.FC<{ tutorId: string }> = ({ tutorId }) => {
  const enabled = FEATURES.tutorOnboarding;
  const { state } = useTutorOnboarding(tutorId, enabled);
  if (!enabled || !state) return null;
  const stage = onboardingStage(state);
  if (stage === 'not-needed' || stage === 'complete') return null;
  return (
    <Link
      to="/tutor-documents"
      className="flex items-start space-x-3 bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3 mb-4 hover:bg-amber-100/60 transition-colors"
    >
      <FileWarning className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
      <span className="text-xs text-amber-900 leading-snug">
        <span className="block text-sm font-bold">Finish your documents</span>
        You cannot be approved or accept requests until every required document is uploaded. Tap to continue.
      </span>
    </Link>
  );
};
