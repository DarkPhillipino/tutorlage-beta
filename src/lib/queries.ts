import { supabase } from './supabaseClient';
import { Institution, Tutor, TutorSubjectCompetency, TierDefinition, TutorDashboardData, TutorReview, TutorAvailabilitySlot, SubTierDefinition, UserProfile, TutorSession, AvailableSessionRequest, StudentSession, TutorManagedSession, StudentSessionDetail, PriceLevel, PayoutAccount, ProblemReason, AppNotification } from '../types';

// Model 3 (backlog 12a): the price levels a student can book right now for
// this search — only levels with at least one matching verified tutor at or
// above them. Computed in the database (available_price_levels) so counts
// don't depend on which tutor rows the browser is allowed to read.
export async function fetchAvailablePriceLevels(params: {
  subject: string;
  gradeLevel: string;
  institutionId: string | null;
}): Promise<PriceLevel[]> {
  const { data, error } = await supabase.rpc('available_price_levels', {
    p_subject: params.subject,
    p_grade: params.gradeLevel,
    p_institution: params.institutionId,
  });
  if (error) throw error;
  return ((data ?? []) as {
    level_id: string;
    tier_id: number;
    tier_name: string;
    price: number;
    currency_code: string;
    tutors: number;
  }[]).map((row) => ({
    id: row.level_id,
    tierId: row.tier_id,
    tierName: row.tier_name,
    price: Number(row.price),
    currencyCode: row.currency_code,
    tutors: row.tutors,
  }));
}

// The signed-in user's own profiles row (see UserProfile in types.ts). Email
// comes from the auth session: profiles.email isn't readable by clients
// (backlog 7o — it used to be readable by anyone).
export async function fetchProfile(userId: string, email: string): Promise<UserProfile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, role, avatar_url')
    .eq('id', userId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  return {
    id: data.id,
    fullName: data.full_name,
    email,
    role: data.role,
    avatarUrl: data.avatar_url,
  };
}

// The signed-in student's own grade level (student_profiles.grade_level) —
// account-level info set once in account settings, not re-entered per
// search (see the "Not set" nudge on PricesPage.tsx, the same pattern
// already used for institution). null means the student hasn't set one yet.
export async function fetchStudentGradeLevel(studentId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('student_profiles')
    .select('grade_level')
    .eq('id', studentId)
    .maybeSingle();

  if (error) throw error;
  return data?.grade_level ?? null;
}

export async function updateStudentGradeLevel(studentId: string, gradeLevel: string): Promise<void> {
  const { error } = await supabase.from('student_profiles').update({ grade_level: gradeLevel }).eq('id', studentId);
  if (error) throw error;
}

// Switches a brand-new Google sign-up to the role the person picked before
// the Google flow. The on_auth_user_created trigger always makes an OAuth user
// a learner (Google's identity data has no room for our role field the way
// email/password signUp()'s options.data does — see src/lib/oauth.ts).
// The switch happens in the database (convert_new_account_role): clients have
// no UPDATE privilege on profiles, so the old client-side version of this
// silently failed. Idempotent, so a reload of the callback page is harmless.
export async function convertNewAccountRole(role: 'tutor' | 'parent'): Promise<void> {
  const { error } = await supabase.rpc('convert_new_account_role', { p_role: role });
  if (error) throw error;
}

// ---- Account gate (7k/7l): date of birth + Terms/Privacy acceptance ----

export interface PolicyVersions {
  termsVersion: string;
  privacyVersion: string;
  guardianConsentVersion: string;
}

// Readable before sign-in, so the signup form can record which versions were ticked.
export async function fetchCurrentPolicyVersions(): Promise<PolicyVersions | null> {
  const { data, error } = await supabase.rpc('current_policy_versions');
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.terms_version || !row?.privacy_version) return null;
  return {
    termsVersion: row.terms_version,
    privacyVersion: row.privacy_version,
    guardianConsentVersion: row.guardian_consent_version,
  };
}

export interface AccountGateState {
  dateOfBirth: string | null; // yyyy-mm-dd
  pendingDocuments: ('terms' | 'privacy')[];
  hasGuardian: boolean; // a learner account a parent/guardian created
}

export async function fetchAccountGateState(userId: string): Promise<AccountGateState> {
  const [dob, pending, links] = await Promise.all([
    supabase.rpc('my_date_of_birth'),
    supabase.rpc('my_pending_acceptances'),
    supabase.from('parent_student_links').select('id', { count: 'exact', head: true }).eq('student_id', userId),
  ]);
  if (dob.error) throw dob.error;
  if (pending.error) throw pending.error;
  if (links.error) throw links.error;
  return {
    dateOfBirth: (dob.data as string | null) ?? null,
    pendingDocuments: ((pending.data ?? []) as { document: 'terms' | 'privacy' }[]).map((row) => row.document),
    hasGuardian: (links.count ?? 0) > 0,
  };
}

// Once only — correcting a recorded date of birth takes an admin.
export async function setMyDateOfBirth(isoDate: string): Promise<void> {
  const { error } = await supabase.rpc('set_my_date_of_birth', { p_dob: isoDate });
  if (error) throw error;
}

export async function acceptCurrentPolicies(): Promise<void> {
  const { error } = await supabase.rpc('accept_current_policies');
  if (error) throw error;
}

// curriculum comes from the real curricula table via curriculum_id (fully
// backfilled — every schools_institutions row has one), not the old fixed
// curriculum enum column, which only ever meant something in South Africa
// (see the "Internationalization plan" section in the game plan doc).
//
// Real institutions table is 25k+ rows — Supabase/PostgREST caps an
// unfiltered fetch at 1000, which silently drops the vast majority of real
// schools (found 2026-09-08: 2,550 institutions alone sort before "Curro").
// Search must happen server-side via `.ilike()`, not by fetching everything
// and filtering client-side. Pass a blank/undefined search to get a capped
// alphabetical browse list rather than the (impossible) full table.
const INSTITUTION_FETCH_LIMIT = 50;

export async function fetchInstitutions(search?: string): Promise<Institution[]> {
  let query = supabase
    .from('schools_institutions')
    .select('id, name, institution_type, curricula ( name )')
    .order('name')
    .limit(INSTITUTION_FETCH_LIMIT);

  const trimmed = search?.trim();
  if (trimmed) {
    query = query.ilike('name', `%${trimmed}%`);
  }

  const { data, error } = await query;

  if (error) throw error;

  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    curriculum: (row.curricula as unknown as { name: string } | null)?.name ?? 'Other',
    institutionType: row.institution_type,
  }));
}

interface TutorRow {
  id: string;
  headline: string | null;
  hourly_rate: number;
  currency_code: string;
  is_verified: boolean | null;
  avg_rating: number | null;
  total_reviews_count: number | null;
  teaching_mode: string;
  is_dispatch_active: boolean;
  total_sessions_completed: number | null;
  current_tier_id: number;
  institution_id: string | null;
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
  institutionId?: string;
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
  const { subject, gradeLevel, tierId, institutionId } = filters;
  const hasSubjectFilter = !!subject?.trim();

  let query = supabase
    .from('tutor_profiles')
    .select(`
      id,
      headline,
      hourly_rate,
      currency_code,
      is_verified,
      avg_rating,
      total_reviews_count,
      teaching_mode,
      is_dispatch_active,
      total_sessions_completed,
      current_tier_id,
      institution_id,
      profiles!tutor_profiles_id_fkey ( full_name, avatar_url ),
      tutor_subject_competencies${hasSubjectFilter ? '!inner' : ''} ( id, subject_name, curriculum, min_grade_level, max_grade_level )
    `);

  if (tierId !== undefined) {
    query = query.eq('current_tier_id', tierId);
  }

  // Hyper-local matching: a tutor who hasn't set an institution teaches
  // anywhere (null is a wildcard, not "matches nobody"); one who has only
  // matches students at that same institution.
  if (institutionId) {
    query = query.or(`institution_id.is.null,institution_id.eq.${institutionId}`);
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
      currencyCode: row.currency_code.trim(),
      verified: row.is_verified ?? false,
      rating: row.avg_rating ?? 0,
      reviewsCount: row.total_reviews_count ?? 0,
      teachingMode: row.teaching_mode,
      isDispatchActive: row.is_dispatch_active,
      totalSessionsCompleted: row.total_sessions_completed ?? 0,
      subjects,
      currentTierId: row.current_tier_id,
      institutionId: row.institution_id,
    };
  });

  return { tutors, gradeLevelRecognized };
}

// The pricing tiers students choose between, e.g. "Peer-to-Peer Tutors: R50-R150/hr".
export async function fetchTierDefinitions(): Promise<TierDefinition[]> {
  const { data, error } = await supabase
    .from('tier_definitions')
    .select('id, public_name, positioning_quote, min_rate, max_rate, commission_rate_pct, currency_code')
    .order('min_rate');

  if (error) throw error;

  return (data ?? []).map((row) => ({
    id: row.id,
    publicName: row.public_name,
    positioningQuote: row.positioning_quote,
    minRate: Number(row.min_rate),
    maxRate: Number(row.max_rate),
    commissionRatePct: Number(row.commission_rate_pct),
    currencyCode: row.currency_code.trim(),
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
  currency_code: string;
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
  institution_id: string | null;
  schools_institutions: { id: string; name: string } | null;
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
      currency_code,
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
      institution_id,
      profiles!tutor_profiles_id_fkey ( full_name, avatar_url ),
      tutor_subject_competencies ( id, subject_name, curriculum, min_grade_level, max_grade_level ),
      tier_definitions!tutor_profiles_current_tier_id_fkey ( id, public_name, min_rate, max_rate ),
      schools_institutions ( id, name )
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
    currencyCode: row.currency_code.trim(),
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
    institutionId: row.institution_id,
    institutionName: row.schools_institutions?.name ?? null,
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
  updates: { headline?: string; hourlyRate?: number; isDispatchActive?: boolean; institutionId?: string | null }
): Promise<void> {
  const patch: Record<string, unknown> = {};
  if (updates.headline !== undefined) patch.headline = updates.headline;
  if (updates.hourlyRate !== undefined) patch.hourly_rate = updates.hourlyRate;
  if (updates.isDispatchActive !== undefined) patch.is_dispatch_active = updates.isDispatchActive;
  if (updates.institutionId !== undefined) patch.institution_id = updates.institutionId;

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

// Logs a subject a tutor typed that isn't on the official `subjects` list —
// the self-expanding taxonomy idea: instead of blocking the tutor from
// teaching it, addTutorSubjectCompetency above still adds it to their
// profile immediately, and this just records it as a candidate for the
// official list (admin review, not built yet — see subject_candidates RLS,
// which already grants admins read/update via is_active_admin() for when
// that screen exists). Best-effort: SubjectCompetencyEditor.tsx doesn't let
// a failure here block the real subject add.
export async function logSubjectCandidate(tutorId: string, subjectName: string, curriculum: string): Promise<void> {
  const { error } = await supabase
    .from('subject_candidates')
    .insert({ subject_name: subjectName, curriculum, requested_by: tutorId });

  if (error) throw error;
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

// Creates a real, anonymous tutoring request — what "Send Request" on
// PricesPage.tsx does. RLS ("Learners or their guardians create session
// requests"): the requester is the signed-in user, and the learner is either
// themselves (an adult with a date of birth on file) or a learner they're
// the consenting guardian of (backlog 7k). tutor_id is deliberately left
// unset (defaults to NULL): no tutor is chosen up front — any qualifying
// tutor can browse and claim it (see fetchAvailableRequests/
// acceptAvailableRequest below). requestedStart is a real timestamp: "now"
// for instant requests, or the chosen ISO date + time combined.
export async function createSessionRequest(params: {
  studentId: string; // the learner the session is for
  requestedById: string; // the signed-in user — the learner themselves, or their guardian
  subjectName: string;
  gradeLevel: string;
  minSubTierId: string; // the Model 3 price level chosen as a floor (backlog 12a)
  institutionId?: string | null;
  scheduleType: 'now' | 'scheduled';
  scheduledDate: string; // ISO date, e.g. from BookingFormState.scheduledDate
  scheduledTime: string; // "HH:MM"
  durationHours?: number;
  paystackReference: string;
}): Promise<{ id: string; requestedStart: string; chargedAmount: number }> {
  const {
    studentId,
    requestedById,
    subjectName,
    gradeLevel,
    minSubTierId,
    institutionId,
    scheduleType,
    scheduledDate,
    scheduledTime,
    durationHours = 1,
    paystackReference,
  } = params;

  const requestedStart =
    scheduleType === 'now' ? new Date().toISOString() : new Date(`${scheduledDate}T${scheduledTime}:00`).toISOString();

  let enrollmentId: string | null = null;
  if (subjectName.trim() && gradeLevel.trim()) {
    enrollmentId = await findOrCreateStudentEnrollment(studentId, subjectName.trim(), gradeLevel.trim());
  }

  // The database decides everything money- and status-related on insert
  // (guard_session_request_insert, backlog 7i): payment_status starts at
  // 'initiated', the price comes from the chosen level (and tier_id is derived
  // from it), and tutor/status fields are reset. Tutors only see a request
  // once server/index.ts has confirmed the card check with Paystack and the
  // database has marked it 'card_verified' (backlog 7a) — the browser can't
  // update this row. The price itself is charged when a tutor accepts.
  const { data, error } = await supabase
    .from('session_requests')
    .insert({
      student_id: studentId,
      enrollment_id: enrollmentId,
      min_sub_tier_id: minSubTierId,
      institution_id: institutionId ?? null,
      requested_by_profile_id: requestedById,
      requested_start: requestedStart,
      duration_hours: durationHours,
      paystack_reference: paystackReference,
    })
    .select('id, requested_start, charged_amount')
    .single();

  if (error) throw error;
  return { id: data.id, requestedStart: data.requested_start, chargedAmount: Number(data.charged_amount) };
}

interface AvailableRequestRow {
  id: string;
  student_id: string;
  requested_start: string;
  duration_hours: number;
  enrollment_id: string | null;
  charged_amount: number;
  currency_code: string;
  institution_id: string | null;
  student_subject_enrollments: { subject_name: string; grade_level: string } | null;
  tier_definitions: { id: number; public_name: string } | null;
  level: { id: string; max_allowed_rate: number; commission_rate_pct: number | null } | null;
}

// Anonymous, unclaimed pending requests a tutor can browse and claim (RLS:
// "Tutors view unclaimed pending requests" — tutor_id is null, status =
// 'pending', and the card checked ('card_verified'; 'paid' for requests paid
// up front before 7a)). Filtered client-side to requests this tutor is
// actually positioned to take (claim_session_request re-checks all of it): under
// Model 3, a request at this tutor's level or below (older requests without
// a level: same tier); same institution (null on either side is a
// wildcard); and — when the request named a subject — one this tutor
// actually teaches (case-insensitive, like the database check).
export async function fetchAvailableRequests(tutorId: string): Promise<AvailableSessionRequest[]> {
  const { data: tutorProfile, error: tutorError } = await supabase
    .from('tutor_profiles')
    .select(`
      current_tier_id,
      institution_id,
      tutor_subject_competencies ( subject_name ),
      level:sub_tier_definitions!tutor_profiles_current_sub_tier_id_fkey ( max_allowed_rate )
    `)
    .eq('id', tutorId)
    .single();

  if (tutorError) throw tutorError;

  const mySubjects = new Set(
    ((tutorProfile.tutor_subject_competencies ?? []) as { subject_name: string }[]).map((c) => c.subject_name.toLowerCase())
  );
  const myLevelRate = Number((tutorProfile.level as unknown as { max_allowed_rate: number } | null)?.max_allowed_rate ?? 0);

  const { data, error } = await supabase
    .from('session_requests')
    .select(`
      id,
      student_id,
      requested_start,
      duration_hours,
      enrollment_id,
      charged_amount,
      currency_code,
      institution_id,
      student_subject_enrollments ( subject_name, grade_level ),
      tier_definitions ( id, public_name ),
      level:sub_tier_definitions!session_requests_min_sub_tier_id_fkey ( id, max_allowed_rate, commission_rate_pct )
    `)
    .is('tutor_id', null)
    .eq('status', 'pending')
    .in('payment_status', ['card_verified', 'paid'])
    .order('requested_start');

  if (error) throw error;

  const rows = (data ?? []) as unknown as AvailableRequestRow[];

  return rows
    .filter((row) => {
      const levelMatches = row.level
        ? Number(row.level.max_allowed_rate) <= myLevelRate
        : row.tier_definitions === null || row.tier_definitions.id === tutorProfile.current_tier_id;
      const institutionMatches =
        row.institution_id === null || tutorProfile.institution_id === null || row.institution_id === tutorProfile.institution_id;
      const subjectMatches =
        !row.student_subject_enrollments || mySubjects.has(row.student_subject_enrollments.subject_name.toLowerCase());
      return levelMatches && institutionMatches && subjectMatches;
    })
    .map((row) => {
      const chargedAmount = Number(row.charged_amount);
      const commissionPct = row.level?.commission_rate_pct != null ? Number(row.level.commission_rate_pct) : null;
      return {
        id: row.id,
        studentId: row.student_id,
        subjectName: row.student_subject_enrollments?.subject_name ?? null,
        gradeLevel: row.student_subject_enrollments?.grade_level ?? null,
        tierId: row.tier_definitions?.id ?? null,
        tierName: row.tier_definitions?.public_name ?? null,
        levelId: row.level?.id ?? null,
        requestedStart: row.requested_start,
        durationHours: Number(row.duration_hours),
        enrollmentId: row.enrollment_id,
        chargedAmount,
        // What the tutor would earn: the price less Tutorlage's commission for
        // the level, as claim_session_request computes it. Paystack's fee comes
        // out of Tutorlage's commission (paystack_fee_bearer = 'account', CEO
        // 2026-09-30), so this is what reaches the tutor's bank account.
        tutorPayout:
          commissionPct != null
            ? (Math.round(chargedAmount * 100) - Math.round(chargedAmount * commissionPct)) / 100
            : null,
        currencyCode: row.currency_code,
      };
    });
}

// Accepting a request goes through server/index.ts (acceptRequest in
// payments.ts), not the database directly: the learner's card is charged at
// that moment, and the charge needs Paystack's secret key (backlog 7a).

// The tutor's payout account, if they've added one (RLS: "Tutors view own
// payout account"). Only the bank, the last 4 digits and the validation
// result are stored — never the full account number or the ID number.
export async function fetchMyPayoutAccount(tutorId: string): Promise<PayoutAccount | null> {
  const { data, error } = await supabase
    .from('tutor_payout_accounts')
    .select('bank_name, account_holder_name, account_number_last4, validation_status, paystack_subaccount_code')
    .eq('tutor_id', tutorId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    bankName: data.bank_name,
    accountHolderName: data.account_holder_name,
    last4: data.account_number_last4,
    validationStatus: data.validation_status,
    canReceivePayments: !!data.paystack_subaccount_code,
  };
}

interface StudentSessionRow {
  id: string;
  scheduled_start: string;
  duration_hours: number;
  status: string | null;
  tutor_profiles: { profiles: { full_name: string } | null } | null;
  student_subject_enrollments: { subject_name: string } | null;
}

// Upcoming sessions for the given learners — the signed-in student's own
// (RLS: "Students view own sessions"), or a guardian's learners' ("Parents
// view linked student sessions") — the student-side mirror of
// fetchUpcomingTutorSessions. sessions.tutor_id references tutor_profiles,
// not profiles directly, so getting the tutor's name is a two-hop embed.
export async function fetchUpcomingStudentSessions(studentIds: string[]): Promise<StudentSession[]> {
  if (studentIds.length === 0) return [];
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
    .in('student_id', studentIds)
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

// --- Session lifecycle (backlog 7m and item 10) -------------------------------

// The tutor's sessions that still need something from them: an upcoming one
// (add or change the meeting link) or one that has ended in the last two weeks
// but isn't marked complete yet. RLS: "Tutors view own sessions". For a
// session a parent or guardian booked, their name and phone come from
// my_session_guardian_contacts() — the tutor can't read parent profiles
// directly, and legal spec §5 requires the parent to be reachable.
export async function fetchTutorManagedSessions(tutorId: string): Promise<TutorManagedSession[]> {
  const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 3600_000).toISOString();
  const contactsRequest = supabase.rpc('my_session_guardian_contacts');
  const { data, error } = await supabase
    .from('sessions')
    .select(`
      id,
      scheduled_start,
      duration_hours,
      status,
      meeting_url,
      profiles!sessions_student_id_fkey ( full_name ),
      student_subject_enrollments ( subject_name )
    `)
    .eq('tutor_id', tutorId)
    .eq('status', 'scheduled')
    .gte('scheduled_start', twoWeeksAgo)
    .order('scheduled_start');

  if (error) throw error;
  // A failure here shouldn't hide the tutor's sessions, so it's logged, not thrown.
  const { data: contacts, error: contactsError } = await contactsRequest;
  if (contactsError) console.error('my_session_guardian_contacts failed:', contactsError);
  const contactBySession = new Map(
    ((contacts ?? []) as { session_id: string; guardian_name: string; guardian_phone: string | null }[])
      .map((c) => [c.session_id, c]),
  );

  return ((data ?? []) as unknown as (TutorSessionRow & { meeting_url: string | null })[]).map((row) => {
    const contact = contactBySession.get(row.id);
    return {
      id: row.id,
      studentName: row.profiles?.full_name ?? 'Student',
      subjectName: row.student_subject_enrollments?.subject_name ?? null,
      scheduledStart: row.scheduled_start,
      durationHours: Number(row.duration_hours),
      status: row.status,
      meetingUrl: row.meeting_url,
      guardianName: contact?.guardian_name,
      guardianPhone: contact?.guardian_phone ?? undefined,
    };
  });
}

// Only the session's own tutor can set it (set_session_meeting_link checks),
// and only an https:// link; the learner is notified.
export async function setSessionMeetingLink(sessionId: string, url: string): Promise<void> {
  const { error } = await supabase.rpc('set_session_meeting_link', { p_session_id: sessionId, p_url: url.trim() });
  if (error) throw error;
}

// Marks a session complete once its scheduled time has ended. This is what
// makes tier progression run: the database recalculates the tutor's stats and
// level straight after (trigger_session_completed → fn_recalculate_tutor_tier).
export async function completeSession(sessionId: string): Promise<void> {
  const { error } = await supabase.rpc('complete_session', { p_session_id: sessionId });
  if (error) throw error;
}

interface StudentSessionDetailRow {
  id: string;
  student_id: string;
  tutor_id: string;
  scheduled_start: string;
  duration_hours: number;
  status: string | null;
  meeting_url: string | null;
  tutor_profiles: { profiles: { full_name: string } | null } | null;
  student_subject_enrollments: { subject_name: string } | null;
}

// Upcoming sessions plus those completed in the last 30 days, for the given
// learners.
async function fetchSessionDetailRows(studentIds: string[]): Promise<StudentSessionDetailRow[]> {
  if (studentIds.length === 0) return [];
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 3600_000).toISOString();
  const { data, error } = await supabase
    .from('sessions')
    .select(`
      id,
      student_id,
      tutor_id,
      scheduled_start,
      duration_hours,
      status,
      meeting_url,
      tutor_profiles!sessions_tutor_id_fkey ( profiles!tutor_profiles_id_fkey ( full_name ) ),
      student_subject_enrollments ( subject_name )
    `)
    .in('student_id', studentIds)
    .in('status', ['scheduled', 'completed'])
    .gte('scheduled_start', thirtyDaysAgo)
    .order('scheduled_start', { ascending: false });

  if (error) throw error;
  return (data ?? []) as unknown as StudentSessionDetailRow[];
}

function toSessionDetail(row: StudentSessionDetailRow, hasReview: boolean): StudentSessionDetail {
  return {
    id: row.id,
    tutorId: row.tutor_id,
    tutorName: row.tutor_profiles?.profiles?.full_name ?? 'Tutor',
    subjectName: row.student_subject_enrollments?.subject_name ?? null,
    scheduledStart: row.scheduled_start,
    durationHours: Number(row.duration_hours),
    status: row.status,
    meetingUrl: row.meeting_url,
    hasReview,
  };
}

// The learner's own sessions, each flagged with whether they've reviewed it.
export async function fetchStudentSessionDetails(studentId: string): Promise<StudentSessionDetail[]> {
  const rows = await fetchSessionDetailRows([studentId]);
  const { data: reviews, error: reviewError } = await supabase
    .from('reviews')
    .select('session_id')
    .eq('student_id', studentId);
  if (reviewError) throw reviewError;
  const reviewed = new Set((reviews ?? []).map((r) => r.session_id));

  return rows.map((row) => toSessionDetail(row, reviewed.has(row.id)));
}

// A parent's or guardian's view of their learners' sessions (backlog 7k).
// RLS: "Parents view linked student sessions". Rating stays with the learner,
// who took the session, so reviews aren't looked up here.
export async function fetchLearnerSessionDetails(
  learners: { id: string; name: string }[],
): Promise<StudentSessionDetail[]> {
  const nameById = new Map(learners.map((l) => [l.id, l.name]));
  const rows = await fetchSessionDetailRows(learners.map((l) => l.id));
  return rows.map((row) => ({ ...toSessionDetail(row, false), learnerName: nameById.get(row.student_id) }));
}

// Cancels an upcoming session with a full refund. The database decides who
// may and when (cancel_session): the learner or whoever booked, inside the
// cancellation window set in system_settings (7 days by default, per legal's
// ECTA s44 working answer), and the tutor any time before it starts.
export async function cancelSession(sessionId: string, reason?: string): Promise<void> {
  const { error } = await supabase.rpc('cancel_session', { p_session_id: sessionId, p_reason: reason ?? null });
  if (error) throw error;
}

// One review per completed session, by that session's learner — the database
// enforces both ("Students review their own completed sessions" + a unique
// index). Submitting it updates the tutor's rating and level straight away.
export async function submitReview(params: {
  sessionId: string;
  tutorId: string;
  studentId: string;
  rating: number;
  comment: string;
}): Promise<void> {
  const { error } = await supabase.from('reviews').insert({
    session_id: params.sessionId,
    tutor_id: params.tutorId,
    student_id: params.studentId,
    rating: params.rating,
    comment: params.comment.trim() || null,
  });
  if (error) throw error;
}

// Reports a problem with a session (backlog 7u). The database checks the
// caller is the session's learner, the person who booked it, or its tutor,
// and within 14 days of the session; an open report stops the session from
// completing automatically until an admin has looked at it.
export async function reportSessionProblem(sessionId: string, reason: ProblemReason, description: string): Promise<void> {
  const { error } = await supabase.rpc('report_session_problem', {
    p_session_id: sessionId,
    p_reason: reason,
    p_description: description.trim(),
  });
  if (error) throw error;
}

// The signed-in user's latest notifications (RLS: "Users view own notifications").
export async function fetchMyNotifications(profileId: string): Promise<AppNotification[]> {
  const { data, error } = await supabase
    .from('notifications')
    .select('id, type, title, body, created_at, read_at')
    .eq('profile_id', profileId)
    .order('created_at', { ascending: false })
    .limit(30);
  if (error) throw error;
  return (data ?? []).map((n) => ({
    id: n.id,
    type: n.type,
    title: n.title,
    body: n.body,
    createdAt: n.created_at,
    readAt: n.read_at,
  }));
}

export async function markNotificationsRead(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .in('id', ids)
    .is('read_at', null);
  if (error) throw error;
}
