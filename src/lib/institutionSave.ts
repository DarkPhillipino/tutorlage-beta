import type { SupabaseClient } from '@supabase/supabase-js';
import type { UserRole } from '../types';

// Master 7cv. Where a picked institution can be kept depends on who is signed in, and what the person is told
// must match what really happened (the 7cq fix only saved for 'student', and every other account was still shown
// "Institution updated" with nothing written).
//
//  - own-profile:        a learner, or an admin (an admin account has a learner row too): saved on the person's own
//                        student_profiles row, and loaded back on sign-in.
//  - device-for-learner: a guardian who has chosen a learner to book for. A guardian can read a linked learner's
//                        profile but not change it, so the choice is remembered in this browser only (institutionMemory.ts).
//  - this-search-only:   a tutor (their own institution is set under Teaching), or a guardian with no learner chosen
//                        yet. It filters this search and is not kept.

export type InstitutionSaveTarget = 'own-profile' | 'device-for-learner' | 'this-search-only';

export function savesOnOwnProfile(role: UserRole | undefined): boolean {
  return role === 'student' || role === 'admin';
}

export function institutionSaveTarget(role: UserRole | undefined, guardianHasChosenLearner: boolean): InstitutionSaveTarget {
  if (savesOnOwnProfile(role)) return 'own-profile';
  if (role === 'parent' && guardianHasChosenLearner) return 'device-for-learner';
  return 'this-search-only';
}

// What to tell the person once the choice has been handled. 'own-profile' is told separately, only after the
// database confirms the write.
export function institutionMessage(role: UserRole | undefined, target: InstitutionSaveTarget, institutionName: string): string {
  switch (target) {
    case 'own-profile':
      return `Institution saved: "${institutionName}"`;
    case 'device-for-learner':
      return `"${institutionName}" is remembered for this learner on this device only.`;
    case 'this-search-only':
      return role === 'parent'
        ? `"${institutionName}" is used for this search only. Choose a learner first to have it remembered.`
        : `"${institutionName}" is used for this search only. Tutors set their own institution under Teaching in Manage account.`;
  }
}

// supabase-js reports a write that the row-level rules filtered out as success with no rows. Every account-level
// write asks for the changed row back (.select('id')) and fails loudly when none comes back, so the app can never
// say "saved" about a write that changed nothing. The text is shown to the person as it is.
export function requireChangedRow(rows: unknown[] | null | undefined): void {
  if (!rows || rows.length === 0) {
    throw new Error('Your account has no learner profile to save this on, so nothing was changed.');
  }
}

// The one write behind both the institution and the grade level: a person's own row on student_profiles. The client
// is passed in (queries.ts passes the real one) so scripts/dev/institution-save-test.ts can drive the real
// supabase-js against a pretend database that filters the update out, as the row-level rules would.
export async function updateOwnLearnerRow(
  client: Pick<SupabaseClient, 'from'>,
  studentId: string,
  patch: { school_id?: string; grade_level?: string },
): Promise<void> {
  const { data, error } = await client.from('student_profiles').update(patch).eq('id', studentId).select('id');
  if (error) throw error;
  requireChangedRow(data);
}
