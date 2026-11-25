import { useCallback, useEffect, useState } from 'react';
import { supabase } from './supabaseClient';
import { getErrorMessage } from './errors';
import { type OnboardingDocument, type OnboardingRow, fetchDocuments, fetchOnboarding } from './tutorOnboardingData';
import { isOnboardingComplete } from './tutorOnboarding';

// Master 7cx. Loads what the tutor has chosen and uploaded, and says where they are in the second and third sign-up pages.
export interface TutorOnboardingState {
  verified: boolean; // tutor_profiles.is_verified: a verified tutor never meets the sign-up pages or the reminder (PM line 81 B)
  onboarding: OnboardingRow | null;
  documents: OnboardingDocument[];
}

export type OnboardingStage =
  | 'not-needed' // a verified tutor, or one that existed before this feature: never asked
  | 'choose-type' // page 2
  | 'documents' // page 3, something still missing or not yet agreed to
  | 'complete';

export function onboardingStage(state: TutorOnboardingState): OnboardingStage {
  const { verified, onboarding, documents } = state;
  // The one rule in the app: registration is over for a verified tutor (the database's twin is police_certificate_age_applies).
  if (verified || onboarding?.grandfathered) return 'not-needed';
  if (!onboarding?.track) return 'choose-type';
  return isOnboardingComplete(onboarding.track, documents, !!onboarding.consentedAt) ? 'complete' : 'documents';
}

export function useTutorOnboarding(tutorId: string | null, enabled: boolean) {
  const [state, setState] = useState<TutorOnboardingState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!tutorId || !enabled) return;
    setError(null);
    try {
      const [onboarding, documents, profile] = await Promise.all([
        fetchOnboarding(supabase, tutorId),
        fetchDocuments(supabase, tutorId),
        supabase.from('tutor_profiles').select('is_verified').eq('id', tutorId).maybeSingle(),
      ]);
      if (profile.error) throw profile.error;
      setState({ verified: profile.data?.is_verified === true, onboarding, documents });
    } catch (e) {
      setError(getErrorMessage(e, 'Could not load your documents.'));
    }
  }, [tutorId, enabled]);

  useEffect(() => {
    load();
  }, [load]);

  return { state, error, reload: load };
}
