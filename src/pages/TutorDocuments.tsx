import React from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { AlertCircle, Loader2 } from 'lucide-react';
import { useAuth } from '../lib/AuthContext';
import { onboardingStage, useTutorOnboarding } from '../lib/useTutorOnboarding';
import { TutorOnboardingFlow } from '../components/TutorOnboardingGate';

// Master 7cx: the same second and third sign-up pages, opened from the reminder on the Teach screen. Only for tutors
// who still have something to do (a tutor that existed before the feature goes straight back to the app).
export default function TutorDocuments() {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const { state, error, reload } = useTutorOnboarding(user?.id ?? null, true);

  if (profile && profile.role !== 'tutor') return <Navigate to="/" replace />;

  if (error && !state) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#FAF7F2] px-6">
        <div className="flex items-start space-x-2 bg-rose-50 border border-rose-200 rounded-xl px-4 py-3 text-xs font-semibold text-rose-700 max-w-md">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      </div>
    );
  }

  if (!state || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#FAF7F2] text-slate-400">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        <span className="text-sm font-semibold">Loading…</span>
      </div>
    );
  }

  if (onboardingStage(state) === 'not-needed') return <Navigate to="/" replace />;

  return <TutorOnboardingFlow tutorId={user.id} state={state} reload={reload} onDone={() => navigate('/')} onSkip={() => navigate('/')} />;
}
