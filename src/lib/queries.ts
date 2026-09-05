import { supabase } from './supabaseClient';
import { Institution, Tutor, TutorSubjectCompetency, TierDefinition, TutorDashboardData, TutorReview, TutorAvailabilitySlot, SubTierDefinition, UserProfile, TutorSession, IncomingSessionRequest, StudentSession } from '../types';

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
    id: string;
    subject_name: string;
    curriculum: string;
    min_grade_level: string;
    max_grade_level: string;
  }[];
}

export interface TutorSearchFilters {
  subject?: string;
  gradeLevel?: string;
  tierId?: number;
}

export interface TutorSearchResult {
  tutors: Tutor[];
  // False only when a gradeLevel filter was actually requested but didn't
  // match any known grade_levels.name (even case-insensitively) — lets the
  // caller tell "we searched and found none" apart from "we didn't
  // recognize your grade level, so we didn't filter by it at all."
  gradeLevelRecognized: boolean;
}

// subject/gradeLevel narrow results to tutors who actually teach that subject
// and grade level (via tutor_subject_competencies); tierId narrows to tutors
// currently in that pricing tier (see fetchTierDefinitions) — used after the
// student picks a tier on TierSelectionPage. All three are optional: an
// unset filter means "don't restrict on this dimension."
export async function fetchTutors(filters: TutorSearchFilters = {}): Promise<TutorSearchResult> {
  const { subject, gradeLevel, tierId } = filters;
  const hasSubjectFilter = !!subject?.trim();

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
      tutor_subject_competencies${hasSubjectFilter ? '!inner' : ''} ( id, subject_name, curriculum, min_grade_level, max_grade_level )
    `);

  if (tierId !== undefined) {
    query = query.eq('current_tier_id', tierId);
  }

  // Filtering through an embedded resource requires the join hint above
  // (!inner) — without it, PostgREST treats this as a left join and the
  // filter is ignored.
  if (hasSubjectFilter) {
    query = query.ilike('tutor_subject_competencies.subject_name', `%${subject!.trim()}%`);
  }

  const { data, error } = await query;

  if (error) throw error;

  let rows = (data ?? []) as unknown as TutorRow[];

  // Grade level is a text name (e.g. "Grade 10"), not a number, so "does this
  // tutor teach Grade 9" is a range check against grade_levels.sort_order —
  // done client-side rather than a query PostgREST can't express directly.
  // Matched case-insensitively (subject matching is already fuzzy; grade
  // level requiring exact case would be an inconsistent, silent trap).
  const trimmedGradeLevel = gradeLevel?.trim();
  let gradeLevelRecognized = true;

  if (trimmedGradeLevel) {
    const { data: levels, error: levelsError } = await supabase
      .from('grade_levels')
      .select('name, sort_order');
    if (levelsError) throw levelsError;

    const sortOrderByName = new Map((levels ?? []).map((l) => [l.name.toLowerCase(), l.sort_order]));
    const targetOrder = sortOrderByName.get(trimmedGradeLevel.toLowerCase());

    if (targetOrder === undefined) {
      // Not a recognized grade level at all (not even case-insensitively) —
      // don't silently drop the filter and pretend nothing was wrong; tell
      // the caller so it can surface that to the user.
      gradeLevelRecognized = false;
    } else {
      rows = rows.filter((row) =>
        row.tutor_subject_competencies.some((c) => {
          const min = sortOrderByName.get(c.min_grade_level.toLowerCase());
          const max = sortOrderByName.get(c.max_grade_level.toLowerCase());
          return min !== undefined && max !== undefined && targetOrder >= min && targetOrder <= max;
        })
      );
    }
  }

  const tutors = rows.map((row) => {
    const subjects: TutorSubjectCompetency[] = row.tutor_subject_competencies.map((c) => ({
      id: c.id,
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

  return { tutors, gradeLevelRecognized };
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
    id: string;
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
      tutor_subject_competencies ( id, subject_name, curriculum, min_grade_level, max_grade_level ),
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
      id: c.id,
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

// Updates the signed-in tutor's own editable profile fields (RLS: "Tutors
// (can) update own profile" — auth.uid() = id). teaching_mode is
// deliberately not editable here — the teaching_mode enum currently only
// has one value ('online'), so there's nothing to choose between yet.
export async function updateTutorProfile(
  tutorId: string,
  updates: { headline?: string; hourlyRate?: number; isDispatchActive?: boolean }
): Promise<void> {
  const patch: Record<string, unknown> = {};
  if (updates.headline !== undefined) patch.headline = updates.headline;
  if (updates.hourlyRate !== undefined) patch.hourly_rate = updates.hourlyRate;
  if (updates.isDispatchActive !== undefined) patch.is_dispatch_active = updates.isDispatchActive;

  const { error } = await supabase.from('tutor_profiles').update(patch).eq('id', tutorId);
  if (error) throw error;
}

// Adds one subject a tutor teaches (RLS: "Tutors manage own competencies" —
// auth.uid() = tutor_id). This is the thing that actually makes a tutor
// show up in subject-filtered search results (see fetchTutors above) — an
// empty tutor_subject_competencies table is why the seeded tutor never
// matched any subject search before this existed.
export async function addTutorSubjectCompetency(
  tutorId: string,
  competency: { subjectName: string; curriculum: string; minGradeLevel: string; maxGradeLevel: string }
): Promise<TutorSubjectCompetency> {
  // verification_status defaults to 'pending', which the "Public can view
  // verified tutor competencies" RLS policy hides from search entirely —
  // there's no per-subject admin review queue built (only the tutor's
  // overall is_verified flag has one), so a subject a tutor adds would
  // otherwise be permanently invisible to students. Auto-verifying here is a
  // deliberate pilot-scoped decision: the tutor's own document verification
  // is the real trust gate; per-subject review is a possible later
  // refinement, not required for launch.
  const { data, error } = await supabase
    .from('tutor_subject_competencies')
    .insert({
      tutor_id: tutorId,
      subject_name: competency.subjectName,
      curriculum: competency.curriculum,
      min_grade_level: competency.minGradeLevel,
      max_grade_level: competency.maxGradeLevel,
      verification_status: 'verified',
    })
    .select('id, subject_name, curriculum, min_grade_level, max_grade_level')
    .single();

  if (error) throw error;

  return {
    id: data.id,
    subjectName: data.subject_name,
    curriculum: data.curriculum,
    minGradeLevel: data.min_grade_level,
    maxGradeLevel: data.max_grade_level,
  };
}

// Removes one of the signed-in tutor's own subject competencies (RLS
// enforces ownership).
export async function deleteTutorSubjectCompetency(competencyId: string): Promise<void> {
  const { error } = await supabase.from('tutor_subject_competencies').delete().eq('id', competencyId);
  if (error) throw error;
}

// Finds the student's existing enrollment for this subject/grade this
// academic year, or creates one — student_subject_enrollments has no unique
// constraint to upsert against, so this is a real find-then-insert rather
// than a single atomic call. Not exported: only ever needed as part of
// creating a session request.
async function findOrCreateStudentEnrollment(
  studentId: string,
  subjectName: string,
  gradeLevel: string
): Promise<string> {
  const academicYear = new Date().getFullYear();

  const { data: existing, error: findError } = await supabase
    .from('student_subject_enrollments')
    .select('id')
    .eq('student_id', studentId)
    .eq('subject_name', subjectName)
    .eq('grade_level', gradeLevel)
    .eq('academic_year', academicYear)
    .maybeSingle();

  if (findError) throw findError;
  if (existing) return existing.id;

  const { data: created, error: insertError } = await supabase
    .from('student_subject_enrollments')
    .insert({ student_id: studentId, subject_name: subjectName, grade_level: gradeLevel, academic_year: academicYear })
    .select('id')
    .single();

  if (insertError) throw insertError;
  return created.id;
}

// Creates a real tutoring request (RLS: "Students manage own session
// requests" — auth.uid() = student_id) — what "Book Session" on
// PricesPage.tsx actually does now, instead of just showing a toast.
// requestedStart is a real timestamp: "now" for instant bookings, or the
// student's chosen ISO date + time combined for a scheduled one.
export async function createSessionRequest(params: {
  studentId: string;
  tutorId: string;
  subjectName: string;
  gradeLevel: string;
  scheduleType: 'now' | 'scheduled';
  scheduledDate: string; // ISO date, e.g. from BookingFormState.scheduledDate
  scheduledTime: string; // "HH:MM"
  durationHours?: number;
}): Promise<{ id: string; requestedStart: string }> {
  const { studentId, tutorId, subjectName, gradeLevel, scheduleType, scheduledDate, scheduledTime, durationHours = 1 } = params;

  const requestedStart =
    scheduleType === 'now' ? new Date().toISOString() : new Date(`${scheduledDate}T${scheduledTime}:00`).toISOString();

  let enrollmentId: string | null = null;
  if (subjectName.trim() && gradeLevel.trim()) {
    enrollmentId = await findOrCreateStudentEnrollment(studentId, subjectName.trim(), gradeLevel.trim());
  }

  const { data, error } = await supabase
    .from('session_requests')
    .insert({
      student_id: studentId,
      tutor_id: tutorId,
      enrollment_id: enrollmentId,
      requested_by_profile_id: studentId,
      requested_start: requestedStart,
      duration_hours: durationHours,
      status: 'pending',
    })
    .select('id, requested_start')
    .single();

  if (error) throw error;
  return { id: data.id, requestedStart: data.requested_start };
}

interface SessionRequestRow {
  id: string;
  student_id: string;
  requested_start: string;
  duration_hours: number;
  enrollment_id: string | null;
  profiles: { full_name: string } | null;
  student_subject_enrollments: { subject_name: string; grade_level: string } | null;
}

// The signed-in tutor's own pending requests (RLS: "Tutors view and respond
// to their requests" — auth.uid() = tutor_id) — the tutor-facing accept/
// decline queue on TeachGoScreen.
export async function fetchIncomingSessionRequests(tutorId: string): Promise<IncomingSessionRequest[]> {
  const { data, error } = await supabase
    .from('session_requests')
    .select(`
      id,
      student_id,
      requested_start,
      duration_hours,
      enrollment_id,
      profiles!session_requests_student_id_fkey ( full_name ),
      student_subject_enrollments ( subject_name, grade_level )
    `)
    .eq('tutor_id', tutorId)
    .eq('status', 'pending')
    .order('requested_start');

  if (error) throw error;

  return ((data ?? []) as unknown as SessionRequestRow[]).map((row) => ({
    id: row.id,
    studentId: row.student_id,
    studentName: row.profiles?.full_name ?? 'Student',
    subjectName: row.student_subject_enrollments?.subject_name ?? null,
    gradeLevel: row.student_subject_enrollments?.grade_level ?? null,
    requestedStart: row.requested_start,
    durationHours: Number(row.duration_hours),
    enrollmentId: row.enrollment_id,
  }));
}

// Accepts a pending request: creates the real public.sessions row (using
// the tutor's *current* rate/tier commission at accept-time, not whatever
// it was when the request was made) and marks the request confirmed,
// linked via resulting_session_id. Two writes, not a DB transaction — if
// the second write fails the session exists but the request stays
// "pending"; acceptable for the pilot (RLS/policy means this can't be made
// atomic from the client, and a stuck "pending" request is a safe failure
// mode, not a silent double-booking).
export async function acceptSessionRequest(request: IncomingSessionRequest, tutorId: string): Promise<void> {
  const { data: tutorProfile, error: tutorError } = await supabase
    .from('tutor_profiles')
    .select('hourly_rate, currency_code, tier_definitions!tutor_profiles_current_tier_id_fkey ( commission_rate_pct )')
    .eq('id', tutorId)
    .single();

  if (tutorError) throw tutorError;

  const hourlyRate = Number(tutorProfile.hourly_rate);
  const commissionPct = Number(
    (tutorProfile.tier_definitions as unknown as { commission_rate_pct: number } | null)?.commission_rate_pct ?? 0
  );
  const grossAmount = hourlyRate * request.durationHours;
  const tutorPayoutAmount = grossAmount * (1 - commissionPct / 100);

  const { data: session, error: sessionError } = await supabase
    .from('sessions')
    .insert({
      student_id: request.studentId,
      tutor_id: tutorId,
      duration_hours: request.durationHours,
      hourly_rate_charged: hourlyRate,
      platform_commission_pct: commissionPct,
      gross_amount: grossAmount,
      tutor_payout_amount: tutorPayoutAmount,
      scheduled_start: request.requestedStart,
      enrollment_id: request.enrollmentId,
      booked_by_profile_id: request.studentId,
      currency_code: tutorProfile.currency_code,
    })
    .select('id')
    .single();

  if (sessionError) throw sessionError;

  const { error: updateError } = await supabase
    .from('session_requests')
    .update({ status: 'accepted', resulting_session_id: session.id, responded_at: new Date().toISOString() })
    .eq('id', request.id);

  if (updateError) throw updateError;
}

// Declines a pending request — no sessions row is created.
export async function declineSessionRequest(requestId: string): Promise<void> {
  const { error } = await supabase
    .from('session_requests')
    .update({ status: 'declined', responded_at: new Date().toISOString() })
    .eq('id', requestId);

  if (error) throw error;
}

interface StudentSessionRow {
  id: string;
  scheduled_start: string;
  duration_hours: number;
  status: string | null;
  tutor_profiles: { profiles: { full_name: string } | null } | null;
  student_subject_enrollments: { subject_name: string } | null;
}

// The signed-in student's own upcoming sessions (RLS: "Students view own
// sessions" — auth.uid() = student_id) — the student-side mirror of
// fetchUpcomingTutorSessions. sessions.tutor_id references tutor_profiles,
// not profiles directly, so getting the tutor's name is a two-hop embed.
export async function fetchUpcomingStudentSessions(studentId: string): Promise<StudentSession[]> {
  const { data, error } = await supabase
    .from('sessions')
    .select(`
      id,
      scheduled_start,
      duration_hours,
      status,
      tutor_profiles!sessions_tutor_id_fkey ( profiles!tutor_profiles_id_fkey ( full_name ) ),
      student_subject_enrollments ( subject_name )
    `)
    .eq('student_id', studentId)
    .gte('scheduled_start', new Date().toISOString())
    .order('scheduled_start');

  if (error) throw error;

  return ((data ?? []) as unknown as StudentSessionRow[]).map((row) => ({
    id: row.id,
    tutorName: row.tutor_profiles?.profiles?.full_name ?? 'Tutor',
    subjectName: row.student_subject_enrollments?.subject_name ?? null,
    scheduledStart: row.scheduled_start,
    durationHours: Number(row.duration_hours),
    status: row.status,
  }));
}
