// The rules and words for approving a tutor's subjects and for the curricula pages (CEO, 19 Oct 2026). No browser or Supabase
// code, so scripts/dev/subject-approvals-admin-test.ts runs it directly. The database checks everything again
// (admin_review_tutor_subject, admin_save_curriculum_criterion, admin_set_institution_curricula); these only say it sooner.
import type { CompetencyStatus, CriterionRow, SubjectApprovalRow } from '../types';

// The six values of the curriculum_type column a tutor's subject and a checklist line carry, in the order they are shown.
export const CURRICULUM_TYPES: { value: string; label: string }[] = [
  { value: 'caps', label: 'CAPS' },
  { value: 'ieb', label: 'IEB' },
  { value: 'cambridge', label: 'Cambridge' },
  { value: 'tertiary', label: 'Tertiary' },
  { value: 'primary_caps', label: 'Primary CAPS' },
  { value: 'other', label: 'Other' },
];

export function curriculumLabel(value: string): string {
  return CURRICULUM_TYPES.find((c) => c.value === value)?.label ?? value;
}

// True when an error only means the 19 Oct 2026 migration is not applied yet (a table, a column or a function is missing).
export function notSwitchedOn(e: unknown): boolean {
  const code = (e as { code?: string } | null)?.code;
  const message = String((e as { message?: string } | null)?.message ?? '');
  return (
    code === '42P01' || code === 'PGRST205' || code === '42703' || code === 'PGRST202' || code === '42883' ||
    /does not exist|could not find the (table|function)|schema cache/i.test(message)
  );
}

export function competencyStatus(raw: string | null | undefined): CompetencyStatus {
  return raw === 'verified' || raw === 'rejected' || raw === 'under_review' ? raw : 'pending';
}

export function statusLabel(status: CompetencyStatus): string {
  if (status === 'verified') return 'Approved';
  if (status === 'rejected') return 'Not approved';
  return 'Waiting for approval';
}

export const isWaiting = (status: CompetencyStatus) => status === 'pending' || status === 'under_review';

// Waiting subjects first (the longest waiting first), then the ones not approved, then the approved (the newest decision first).
export function orderApprovals(rows: SubjectApprovalRow[]): SubjectApprovalRow[] {
  const rank = (r: SubjectApprovalRow) => (isWaiting(r.status) ? 0 : r.status === 'rejected' ? 1 : 2);
  return [...rows].sort((a, b) => {
    const byRank = rank(a) - rank(b);
    if (byRank !== 0) return byRank;
    if (rank(a) === 0) return a.addedAt.localeCompare(b.addedAt);
    return (b.reviewedAt ?? b.addedAt).localeCompare(a.reviewedAt ?? a.addedAt);
  });
}

// The active checklist lines for one curriculum, in the order set in the editor.
export function checklistFor(criteria: CriterionRow[], curriculum: string): CriterionRow[] {
  return criteria
    .filter((c) => c.curriculum === curriculum && c.active)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.text.localeCompare(b.text));
}

// Why a subject cannot be approved yet, or null. Every required line ticked; and when the curriculum has no checklist at all, a
// written note saying what was checked (the same rule as the database).
export function approvalProblem(params: { checklist: CriterionRow[]; ticked: string[]; note: string }): string | null {
  const { checklist, ticked, note } = params;
  if (checklist.length === 0) {
    return note.trim().length >= 3 ? null : 'There is no checklist for this curriculum yet. Write a note saying what you checked.';
  }
  const left = checklist.filter((c) => c.required && !ticked.includes(c.id)).length;
  if (left > 0) return `Tick every required line before approving (${left} left).`;
  return null;
}

export function rejectionProblem(reason: string): string | null {
  return reason.trim().length >= 3 ? null : 'Give the reason for not approving this subject.';
}

// Only lines that are on this curriculum's active checklist are sent as ticked.
export function tickedForSending(checklist: CriterionRow[], ticked: string[]): string[] {
  const allowed = new Set(checklist.map((c) => c.id));
  return ticked.filter((id) => allowed.has(id));
}

// ---- the audit log -------------------------------------------------------------------------------------------------------------------
// The new database functions write their rows with a `kind` in the details, so one action name can be told apart.
const KIND_LABELS: Record<string, string> = {
  subject_approved: 'Subject approved',
  subject_rejected: 'Subject not approved',
  curriculum_criterion: 'Approval checklist line saved',
  curriculum_criterion_deleted: 'Approval checklist line deleted',
  institution_curricula: "A school's curricula changed",
};

export function auditKindLabel(metadata: Record<string, unknown> | null | undefined): string | null {
  const kind = metadata && typeof metadata.kind === 'string' ? metadata.kind : null;
  return kind ? KIND_LABELS[kind] ?? null : null;
}

// A short line of what the action was about, for the kinds above.
export function auditKindDetail(metadata: Record<string, unknown> | null | undefined): string | null {
  if (!metadata || typeof metadata.kind !== 'string' || !KIND_LABELS[metadata.kind]) return null;
  const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  if (metadata.kind === 'subject_approved' || metadata.kind === 'subject_rejected') {
    const subject = text(metadata.subject);
    const curriculum = text(metadata.curriculum);
    const reason = text(metadata.reason) ?? text(metadata.note);
    return [subject && curriculum ? `${subject} (${curriculumLabel(curriculum)})` : subject, reason].filter(Boolean).join(': ') || null;
  }
  if (metadata.kind === 'curriculum_criterion' || metadata.kind === 'curriculum_criterion_deleted') {
    const curriculum = text(metadata.curriculum);
    const criterion = text(metadata.criterion);
    return [curriculum ? curriculumLabel(curriculum) : null, criterion].filter(Boolean).join(': ') || null;
  }
  if (metadata.kind === 'institution_curricula' && Array.isArray(metadata.curricula)) {
    return `${metadata.curricula.length} extra curricul${metadata.curricula.length === 1 ? 'um' : 'a'}`;
  }
  return null;
}
