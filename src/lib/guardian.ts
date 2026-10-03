import { supabase } from './supabaseClient';
import { apiUrl } from './api';

// Parents and guardians: the learners they're responsible for (backlog 7k).
// A learner under 18 is added by their guardian — the guardian is the
// account holder who books, pays and consents; the learner gets a view-only
// sign-in (CEO, 2026-09-30).

export type GuardianRelationship = 'mother' | 'father' | 'guardian';

export const RELATIONSHIP_LABELS: Record<GuardianRelationship, string> = {
  mother: 'Mother',
  father: 'Father',
  guardian: 'Legal guardian',
};

export interface LinkedLearner {
  id: string;
  firstName: string;
  surname: string;
  gradeLevel: string | null;
  relationship: string;
  // Consent given and not withdrawn — only then can the guardian book.
  canBook: boolean;
}

export async function fetchMyLearners(guardianId: string): Promise<LinkedLearner[]> {
  const [links, consents] = await Promise.all([
    supabase
      .from('parent_student_links')
      .select('student_id, relationship, can_book_sessions, student_profiles ( first_name, surname, grade_level )')
      .eq('parent_id', guardianId),
    supabase
      .from('guardian_consents')
      .select('learner_profile_id, withdrawn_at')
      .eq('guardian_profile_id', guardianId),
  ]);
  if (links.error) throw links.error;
  if (consents.error) throw consents.error;

  const activeConsent = new Set(
    (consents.data ?? []).filter((c) => !c.withdrawn_at).map((c) => c.learner_profile_id as string),
  );

  return (links.data ?? []).map((row: any) => ({
    id: row.student_id,
    firstName: row.student_profiles?.first_name ?? 'Learner',
    surname: row.student_profiles?.surname ?? '',
    gradeLevel: row.student_profiles?.grade_level ?? null,
    relationship: row.relationship,
    canBook: row.can_book_sessions && activeConsent.has(row.student_id),
  }));
}

export interface AddLearnerInput {
  firstName: string;
  surname: string;
  dateOfBirth: string;
  gradeLevel: string;
  relationship: GuardianRelationship;
  learnerEmail?: string;
  password: string;
  consentVersion: string;
  acceptedTermsVersion: string;
  acceptedPrivacyVersion: string;
}

// Creating an account for someone else needs the service-role key, so this
// goes through server/index.ts (POST /api/guardian/learners), which takes the
// guardian's identity from their access token, never from this request body.
// Returns what the learner signs in with.
export async function addLearner(input: AddLearnerInput): Promise<{ learnerId: string; signIn: string }> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Sign in again to add a learner.');

  const response = await fetch(apiUrl('/api/guardian/learners'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ ...input, consentGiven: true }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? 'Could not add the learner.');
  return { learnerId: body.learnerId, signIn: body.signIn };
}

// The guardian's own phone number (parent_profiles.phone_number). Legal spec
// §5: for a learner under 18 it must be on the account and shown to the
// tutor, so the database refuses a guardian's booking until it's there.
export async function fetchMyPhone(guardianId: string): Promise<string> {
  const { data, error } = await supabase
    .from('parent_profiles')
    .select('phone_number')
    .eq('id', guardianId)
    .maybeSingle();
  if (error) throw error;
  return data?.phone_number ?? '';
}

// Matches the database rule: at least 9 digits.
export function isUsablePhone(phone: string): boolean {
  return phone.replace(/\D/g, '').length >= 9;
}

export async function saveMyPhone(guardianId: string, phone: string): Promise<void> {
  const { data, error } = await supabase
    .from('parent_profiles')
    .update({ phone_number: phone.trim() })
    .eq('id', guardianId)
    .select('id');
  if (error) throw error;
  if (!data || data.length === 0) throw new Error('Your parent account record is missing — contact support.');
}

// Stops new bookings immediately (legal spec §4). Existing sessions stand.
export async function withdrawGuardianConsent(learnerId: string): Promise<void> {
  const { error } = await supabase.rpc('withdraw_guardian_consent', { p_learner: learnerId });
  if (error) throw error;
}
