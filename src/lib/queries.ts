import { supabase } from './supabaseClient';
import { Institution, Tutor, TutorSubjectCompetency, TierDefinition, TutorDashboardData, TutorReview, TutorAvailabilitySlot, SubTierDefinition, UserProfile, TutorSession } from '../types';

// The signed-in user's own profiles row (see UserProfile in types.ts).
export async function fetchProfile(userId: string): Promise<UserProfile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, email, role, avatar_url')
    .eq('id', userId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  return {
    id: data.id,
    fullName: data.full_name,
    email: data.email,
    role: data.role,
    avatarUrl: data.avatar_url,
  };
}

export async function fetchInstitutions(): Promise<Institution[]> {
  const { data, error } = await supabase
    .from('schools_institutions')
    .select('id, name, curriculum, institution_type')
    .order('name');

  if (error) throw error;

  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    curriculum: row.curriculum,
    institutionType: row.institution_type,
  }));
}

interface TutorRow {
  id: string;
  headline: string | null;
  hourly_rate: number;
  is_verified: boolean | null;
  avg_rating: number | null;
  total_reviews_count: number | null;
  teaching_mode: string;
  is_dispatch_active: boolean;
  total_sessions_completed: number | null;
  current_tier_id: number;
  profiles: { full_name: string; avatar_url: string | null } | null;
  tutor_subject_competencies: {
    subject_name: string;
    curriculum: string;
    min_grade_level: string;
    max_grade_level: string;
  }[];
}

// tierId narrows results to tutors currently in that pricing tier (see
// fetchTierDefinitions) — used after the student picks a tier on TierSelectionPage.
export async function fetchTutors(tierId?: number): Promise<Tutor[]> {
  let query = supabase
    .from('tutor_profiles')
    .select(`
      id,
      headline,
      hourly_rate,
      is_verified,
      avg_rating,
      total_reviews_count,
      teaching_mode,
      is_dispatch_active,
      total_sessions_completed,
      current_tier_id,
      profiles!tutor_profiles_id_fkey ( full_name, avatar_url ),
      tutor_subject_competencies ( subject_name, curriculum, min_grade_level, max_grade_level )
    `);

  if (tierId !== undefined) {
    query = query.eq('current_tier_id', tierId);
  }

  const { data, error } = await query;

  if (error) throw error;

  return ((data ?? []) as unknown as TutorRow[]).map((row) => {
    const subjects: TutorSubjectCompetency[] = row.tutor_subject_competencies.map((c) => ({
      subjectName: c.subject_name,
      curriculum: c.curriculum,
      minGradeLevel: c.min_grade_level,
      maxGradeLevel: c.max_grade_level,
    }));

    return {
      id: row.id,
      name: row.profiles?.full_name ?? 'Tutorlage Tutor',
      avatarUrl: row.profiles?.avatar_url ?? null,
      headline: row.headline,
      hourlyRate: row.hourly_rate,
      verified: row.is_verified ?? false,
      rating: row.avg_rating ?? 0,
      reviewsCount: row.total_reviews_count ?? 0,
      teachingMode: row.teaching_mode,
      isDispatchActive: row.is_dispatch_active,
      totalSessionsCompleted: row.total_sessions_completed ?? 0,
      subjects,
      currentTierId: row.current_tier_id,
    };
  });
}

// The pricing tiers students choose between, e.g. "Peer-to-Peer Tutors: R50-R150/hr".
export async function fetchTierDefinitions(): Promise<TierDefinition[]> {
  const { data, error } = await supabase
    .from('tier_definitions')
    .select('id, public_name, positioning_quote, min_rate, max_rate, commission_rate_pct')
    .order('min_rate');

  if (error) throw error;

  return (data ?? []).map((row) => ({
    id: row.id,
    publicName: row.public_name,
    positioningQuote: row.positioning_quote,
    minRate: Number(row.min_rate),
    maxRate: Number(row.max_rate),
    commissionRatePct: Number(row.commission_rate_pct),
  }));
}

// Autocomplete source for the subject search field. Sourced from the
// `subjects` reference table (the official CAPS/NSC subject list), not from
// tutor_subject_competencies — that table is empty until tutors actually
// register subjects, which would make the search box useless in the
// meantime.
export async function fetchSubjectSuggestions(): Promise<string[]> {
  const { data, error } = await supabase
    .from('subjects')
    .select('name')
    .order('name');

  if (error) throw error;

  return (data ?? []).map((row) => row.name);
}

// Autocomplete source for the grade-level search field. Sourced from the
// `grade_levels` reference table (same role as `subjects` above).
export async function fetchGradeLevelSuggestions(): Promise<string[]> {
  const { data, error } = await supabase
    .from('grade_levels')
    .select('name')
    .order('sort_order');

  if (error) throw error;

  return (data ?? []).map((row) => row.name);
}

interface TutorDashboardRow {
  id: string;
  headline: string | null;
  hourly_rate: number;
  is_verified: boolean | null;
  onboarding_status: string | null;
  avg_rating: number | null;
  total_reviews_count: number | null;
  total_completed_hours: number | null;
  total_sessions_completed: number | null;
  teaching_mode: string;
  is_dispatch_active: boolean;
  current_sub_tier_id: string;
  repeat_student_rate_pct: number | null;
  avg_grade_uplift_pct: number | null;
  qualified_uplift_students_count: number | null;
  profiles: { full_name: string; avatar_url: string | null } | null;
  tutor_subject_competencies: {
    subject_name: string;
    curriculum: string;
    min_grade_level: string;
    max_grade_level: string;
  }[];
  tier_definitions: { id: number; public_name: string; min_rate: number; max_rate: number } | null;
}

// Loads the signed-in tutor's own profile — tutorId should be auth user id
// (== tutor_profiles.id, they share a primary key with profiles/auth.users).
export async function fetchTutorDashboard(tutorId: string): Promise<TutorDashboardData | null> {
  const { data, error } = await supabase
    .from('tutor_profiles')
    .select(`
      id,
      headline,
      hourly_rate,
      is_verified,
      onboarding_status,
      avg_rating,
      total_reviews_count,
      total_completed_hours,
      total_sessions_completed,
      teaching_mode,
      is_dispatch_active,
      current_sub_tier_id,
      repeat_student_rate_pct,
      avg_grade_uplift_pct,
      qualified_uplift_students_count,
      profiles!tutor_profiles_id_fkey ( full_name, avatar_url ),
      tutor_subject_competencies ( subject_name, curriculum, min_grade_level, max_grade_level ),
      tier_definitions!tutor_profiles_current_tier_id_fkey ( id, public_name, min_rate, max_rate )
    `)
    .eq('id', tutorId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const row = data as unknown as TutorDashboardRow;

  return {
    id: row.id,
    name: row.profiles?.full_name ?? 'Tutorlage Tutor',
    avatarUrl: row.profiles?.avatar_url ?? null,
    headline: row.headline,
    hourlyRate: row.hourly_rate,
    verified: row.is_verified ?? false,
    onboardingStatus: row.onboarding_status,
    rating: row.avg_rating ?? 0,
    reviewsCount: row.total_reviews_count ?? 0,
    totalCompletedHours: row.total_completed_hours ?? 0,
    totalSessionsCompleted: row.total_sessions_completed ?? 0,
    teachingMode: row.teaching_mode,
    isDispatchActive: row.is_dispatch_active,
    tier: row.tier_definitions
      ? {
          id: row.tier_definitions.id,
          publicName: row.tier_definitions.public_name,
          minRate: Number(row.tier_definitions.min_rate),
          maxRate: Number(row.tier_definitions.max_rate),
        }
      : null,
    currentSubTierId: row.current_sub_tier_id,
    repeatStudentRatePct: Number(row.repeat_student_rate_pct ?? 0),
    avgGradeUpliftPct: Number(row.avg_grade_uplift_pct ?? 0),
    qualifiedUpliftStudentsCount: row.qualified_uplift_students_count ?? 0,
    subjects: row.tutor_subject_competencies.map((c) => ({
      subjectName: c.subject_name,
      curriculum: c.curriculum,
      minGradeLevel: c.min_grade_level,
      maxGradeLevel: c.max_grade_level,
    })),
  };
}

// Progression thresholds within one tier (e.g. the 4 sub-tiers A-D inside
// "Peer-to-Peer Tutors"), used to compute a real "progress to next sub-tier"
// indicator on TeachGoScreen instead of a fabricated percentage.
export async function fetchSubTierDefinitions(tierId: number): Promise<SubTierDefinition[]> {
  const { data, error } = await supabase
    .from('sub_tier_definitions')
    .select('id, tier_id, sub_tier_code, max_allowed_rate, min_hours, min_rating, min_repeat_rate_pct, min_written_reviews, min_distinct_students_uplift, required_grade_uplift_pct')
    .eq('tier_id', tierId)
    .order('min_hours');

  if (error) throw error;

  return (data ?? []).map((row) => ({
    id: row.id,
    tierId: row.tier_id,
    subTierCode: row.sub_tier_code,
    maxAllowedRate: Number(row.max_allowed_rate),
    minHours: row.min_hours ?? 0,
    minRating: Number(row.min_rating ?? 0),
    minRepeatRatePct: Number(row.min_repeat_rate_pct ?? 0),
    minWrittenReviews: row.min_written_reviews ?? 0,
    minDistinctStudentsUplift: row.min_distinct_students_uplift ?? 0,
    requiredGradeUpliftPct: Number(row.required_grade_uplift_pct ?? 0),
  }));
}

// Public reviews (RLS: "Public can view reviews" — qual true) for one tutor.
export async function fetchTutorReviews(tutorId: string): Promise<TutorReview[]> {
  const { data, error } = await supabase
    .from('reviews')
    .select('id, rating, comment, created_at')
    .eq('tutor_id', tutorId)
    .order('created_at', { ascending: false });

  if (error) throw error;

  return (data ?? []).map((row) => ({
    id: row.id,
    rating: row.rating,
    comment: row.comment,
    createdAt: row.created_at,
  }));
}

// Public availability (RLS: "Public can view tutor availability" — qual true).
export async function fetchTutorAvailability(tutorId: string): Promise<TutorAvailabilitySlot[]> {
  const { data, error } = await supabase
    .from('tutor_availability')
    .select('id, day_of_week, start_time, end_time')
    .eq('tutor_id', tutorId)
    .order('day_of_week');

  if (error) throw error;

  return (data ?? []).map((row) => ({
    id: row.id,
    dayOfWeek: row.day_of_week,
    startTime: row.start_time,
    endTime: row.end_time,
  }));
}

// Creates one recurring weekly slot for the signed-in tutor (RLS: "Tutors
// manage own availability" — auth.uid() = tutor_id).
export async function addTutorAvailabilitySlot(
  tutorId: string,
  dayOfWeek: number,
  startTime: string,
  endTime: string
): Promise<TutorAvailabilitySlot> {
  const { data, error } = await supabase
    .from('tutor_availability')
    .insert({ tutor_id: tutorId, day_of_week: dayOfWeek, start_time: startTime, end_time: endTime })
    .select('id, day_of_week, start_time, end_time')
    .single();

  if (error) throw error;

  return {
    id: data.id,
    dayOfWeek: data.day_of_week,
    startTime: data.start_time,
    endTime: data.end_time,
  };
}

// Removes one of the signed-in tutor's own slots (RLS enforces ownership).
export async function deleteTutorAvailabilitySlot(slotId: string): Promise<void> {
  const { error } = await supabase.from('tutor_availability').delete().eq('id', slotId);
  if (error) throw error;
}

interface TutorSessionRow {
  id: string;
  scheduled_start: string;
  duration_hours: number;
  status: string | null;
  profiles: { full_name: string } | null;
  student_subject_enrollments: { subject_name: string } | null;
}

// The signed-in tutor's own upcoming sessions (RLS: auth.uid() = tutor_id).
// Used to mark availability slots as booked and to list what's coming up on
// the dashboard calendar.
export async function fetchUpcomingTutorSessions(tutorId: string): Promise<TutorSession[]> {
  const { data, error } = await supabase
    .from('sessions')
    .select(`
      id,
      scheduled_start,
      duration_hours,
      status,
      profiles!sessions_student_id_fkey ( full_name ),
      student_subject_enrollments ( subject_name )
    `)
    .eq('tutor_id', tutorId)
    .gte('scheduled_start', new Date().toISOString())
    .order('scheduled_start');

  if (error) throw error;

  return ((data ?? []) as unknown as TutorSessionRow[]).map((row) => ({
    id: row.id,
    studentName: row.profiles?.full_name ?? 'Student',
    subjectName: row.student_subject_enrollments?.subject_name ?? null,
    scheduledStart: row.scheduled_start,
    durationHours: Number(row.duration_hours),
    status: row.status,
  }));
}
