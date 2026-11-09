// Reads for the Tutor Verification queue that the original queue query (queries.ts) does not make (burst-readiness, 4 Nov 2026):
// when each tutor's oldest waiting document was uploaded, and "who is next". A separate file on purpose: queries.ts is being changed by
// another piece of work. Both reads use the admin's own sign-in and the rules that already let an admin read these tables; no database change.
import { supabase } from './supabaseClient';
import { fetchTutorVerificationQueue } from './queries';
import { nextToReview, type WaitingSince } from './verificationQueueOrder';
import type { TutorForVerification } from '../types';

// tutor id -> the upload time of their OLDEST document that is pending or under review. If the read fails the queue still works: it
// falls back to sign-up order (an empty map), it never blocks.
export async function fetchWaitingSince(): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  try {
    const { data, error } = await supabase
      .from('tutor_verification_documents')
      .select('tutor_id, uploaded_at')
      .in('status', ['pending', 'under_review'])
      .order('uploaded_at', { ascending: true })
      .limit(5000);
    if (error) throw error;
    for (const row of (data ?? []) as { tutor_id: string; uploaded_at: string | null }[]) {
      if (row.uploaded_at && !out.has(row.tutor_id)) out.set(row.tutor_id, row.uploaded_at);
    }
  } catch {
    out.clear();
  }
  return out;
}

// The tutor to open after a decision on `currentId` (the longest-waiting one with a document to review), or null when nobody else waits.
// Never throws: if the list cannot be read the caller just goes back to the queue.
export async function findNextTutor(currentId: string): Promise<TutorForVerification | null> {
  try {
    const [tutors, since] = await Promise.all([fetchTutorVerificationQueue(), fetchWaitingSince()]);
    return nextToReview(tutors, since as WaitingSince, currentId);
  } catch {
    return null;
  }
}
