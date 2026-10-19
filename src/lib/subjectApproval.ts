// How a tutor's subject shows its approval (CEO, 19 Oct 2026: a tutor declares the curriculum and subject, Tutorlage approves it,
// and only approved subjects match learners). No browser or Supabase code, so scripts/dev/subject-approval-test.ts runs it directly.
import type { CompetencyStatus } from '../types';

// The database value to one of the four known ones; anything unknown is treated as still waiting, never as approved.
export function competencyStatus(raw: string | null | undefined): CompetencyStatus {
  return raw === 'verified' || raw === 'rejected' || raw === 'under_review' ? raw : 'pending';
}

export function subjectStatusLabel(status: CompetencyStatus): string {
  if (status === 'verified') return 'Approved';
  if (status === 'rejected') return 'Not approved';
  return 'Waiting for approval';
}

// What follows a subject the tutor has just added, from the status the database actually stored: an approved row (a database
// that has not had the approval migration yet) is live; anything else waits for Tutorlage.
export function subjectAddedLine(subject: string, status: CompetencyStatus, onOfficialList: boolean): string {
  const logged = onOfficialList ? '' : ` We've also logged it as a new subject for review.`;
  return status === 'verified'
    ? `"${subject}" is live on your profile now.${logged}`
    : `"${subject}" is saved. It waits for Tutorlage to approve it, and learners are matched with you for it once it is approved.${logged}`;
}

// The reason shown under a subject that was not approved ("Not approved: <reason>").
export function rejectedReasonLine(note: string | null | undefined): string | null {
  const text = (note ?? '').trim();
  return text ? `Reason: ${text}` : null;
}
