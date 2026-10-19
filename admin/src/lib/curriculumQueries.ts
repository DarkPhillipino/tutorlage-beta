import { supabase } from './supabaseClient';
import { competencyStatus, notSwitchedOn } from './subjectApprovals';
import type {
  CriterionRow,
  CurriculumOption,
  SchoolCurriculaInfo,
  SchoolSearchResult,
  SubjectApprovalRow,
} from '../types';

// Subject approvals and curricula (CEO, 19 Oct 2026; migration 20261019090000). Every change goes through an admin-only database
// function that checks the caller, validates and writes the audit row itself, so nothing here writes a table directly and none
// of it calls logAdminAction().
//
// The admin app runs from the working folder before that migration is applied, so every read here tolerates the new tables,
// columns and functions not being there yet: `notSwitchedOn(e)` (lib/subjectApprovals.ts) is true for exactly that, and the pages
// then say the database update has not been applied instead of showing an error.

// ---- subject approvals ----------------------------------------------------------------------------------------------------------------
type CompetencyDbRow = {
  id: string;
  tutor_id: string;
  subject_name: string;
  curriculum: string;
  min_grade_level: string;
  max_grade_level: string;
  verification_status: string | null;
  updated_at: string | null;
};

type ReviewDbRow = { competency_id: string; review_note: string | null; reviewed_at: string | null; criteria_met: string[] | null };

const COMPETENCY_COLUMNS = 'id, tutor_id, subject_name, curriculum, min_grade_level, max_grade_level, verification_status, updated_at';

// The admin's note and ticks live in their own table (tutor_subject_reviews), because the subject table is readable by the public.
// A separate read: before the migration the table is not there, and then every subject simply has no note yet.
async function fetchReviews(): Promise<Map<string, ReviewDbRow>> {
  const { data, error } = await supabase
    .from('tutor_subject_reviews')
    .select('competency_id, review_note, reviewed_at, criteria_met')
    .limit(1000);
  if (error) {
    if (notSwitchedOn(error)) return new Map();
    throw error;
  }
  return new Map(((data ?? []) as ReviewDbRow[]).map((r) => [r.competency_id, r]));
}

// Every subject any tutor has declared. Before the migration an admin can only see the approved ones (the old policy) and there are
// no notes. A note and ticks are only attached to a subject that has been decided: a changed subject goes back to waiting, and the
// old decision must not be pre-filled in front of the new one.
export async function fetchSubjectApprovals(): Promise<SubjectApprovalRow[]> {
  const [result, reviews] = await Promise.all([
    supabase.from('tutor_subject_competencies').select(COMPETENCY_COLUMNS).limit(1000),
    fetchReviews(),
  ]);
  if (result.error) throw result.error;
  const rows = (result.data ?? []) as unknown as CompetencyDbRow[];
  const tutorIds = Array.from(new Set(rows.map((r) => r.tutor_id)));
  const names = new Map<string, string>();
  if (tutorIds.length > 0) {
    const { data, error } = await supabase.from('profiles').select('id, full_name').in('id', tutorIds);
    if (error) throw error;
    for (const p of (data ?? []) as { id: string; full_name: string | null }[]) names.set(p.id, p.full_name ?? '');
  }
  return rows.map((r) => {
    const status = competencyStatus(r.verification_status);
    const review = status === 'verified' || status === 'rejected' ? reviews.get(r.id) : undefined;
    return {
      id: r.id,
      tutorId: r.tutor_id,
      tutorName: names.get(r.tutor_id) || 'Unnamed tutor',
      subjectName: r.subject_name,
      curriculum: r.curriculum,
      minGradeLevel: r.min_grade_level,
      maxGradeLevel: r.max_grade_level,
      status,
      reviewNote: review?.review_note ?? null,
      reviewedAt: review?.reviewed_at ?? null,
      criteriaMet: review?.criteria_met ?? [],
      addedAt: r.updated_at ?? '',
    };
  });
}

// The approval checklist, every curriculum. null when the table is not there yet (the migration is not applied).
export async function fetchCriteria(): Promise<CriterionRow[] | null> {
  const { data, error } = await supabase
    .from('curriculum_criteria')
    .select('id, curriculum, sort_order, criterion, required, active')
    .order('curriculum')
    .order('sort_order');
  if (error) {
    if (notSwitchedOn(error)) return null;
    throw error;
  }
  return ((data ?? []) as { id: string; curriculum: string; sort_order: number; criterion: string; required: boolean; active: boolean }[]).map((c) => ({
    id: c.id,
    curriculum: c.curriculum,
    sortOrder: c.sort_order,
    text: c.criterion,
    required: c.required,
    active: c.active,
  }));
}

export async function reviewSubject(competencyId: string, decision: 'approve' | 'reject', reason: string, criteria: string[]): Promise<void> {
  const { error } = await supabase.rpc('admin_review_tutor_subject', {
    p_competency: competencyId,
    p_decision: decision,
    p_reason: reason,
    p_criteria: criteria,
  });
  if (error) throw error;
}

// ---- the checklist editor ------------------------------------------------------------------------------------------------------------
export async function saveCriterion(c: { id: string | null; curriculum: string; text: string; required: boolean; active: boolean; sortOrder: number }): Promise<void> {
  const { error } = await supabase.rpc('admin_save_curriculum_criterion', {
    p_id: c.id,
    p_curriculum: c.curriculum,
    p_criterion: c.text,
    p_required: c.required,
    p_active: c.active,
    p_sort_order: c.sortOrder,
  });
  if (error) throw error;
}

export async function deleteCriterion(id: string): Promise<void> {
  const { error } = await supabase.rpc('admin_delete_curriculum_criterion', { p_id: id });
  if (error) throw error;
}

// ---- schools ---------------------------------------------------------------------------------------------------------------------------
export async function fetchCurricula(): Promise<CurriculumOption[]> {
  const { data, error } = await supabase.from('curricula').select('id, code, name').order('name');
  if (error) throw error;
  return (data ?? []) as CurriculumOption[];
}

export async function searchSchools(term: string): Promise<SchoolSearchResult[]> {
  const cleaned = term.trim().replace(/[%,()]/g, ' ');
  if (cleaned.length < 3) return [];
  const { data, error } = await supabase.from('schools_institutions').select('id, name').ilike('name', `%${cleaned}%`).order('name').limit(20);
  if (error) throw error;
  return (data ?? []) as SchoolSearchResult[];
}

// What one school follows now: school_curricula is the full list (own + extras); the extras are the rows in institution_curricula,
// so the rest is the school's own. null when the functions are not there yet (the migration is not applied).
export async function fetchSchoolCurriculaInfo(school: SchoolSearchResult): Promise<SchoolCurriculaInfo | null> {
  const [all, extras] = await Promise.all([
    supabase.rpc('school_curricula', { p_institution: school.id }),
    supabase.from('institution_curricula').select('curriculum_id').eq('institution_id', school.id),
  ]);
  for (const r of [all, extras]) {
    if (r.error) {
      if (notSwitchedOn(r.error)) return null;
      throw r.error;
    }
  }
  const chosenIds = ((all.data ?? []) as { curriculum_id: string }[]).map((r) => r.curriculum_id);
  const extraIds = new Set(((extras.data ?? []) as { curriculum_id: string }[]).map((r) => r.curriculum_id));
  return { schoolId: school.id, schoolName: school.name, chosenIds, ownIds: chosenIds.filter((id) => !extraIds.has(id)) };
}

export async function setSchoolCurricula(schoolId: string, curriculumIds: string[]): Promise<void> {
  const { error } = await supabase.rpc('admin_set_institution_curricula', { p_institution: schoolId, p_curricula: curriculumIds });
  if (error) throw error;
}
