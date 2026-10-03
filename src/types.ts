// Mirrors public.schools_institutions. No city/country/studentCount in the
// schema — those were mock-only fields.
export interface Institution {
  id: string;
  name: string;
  curriculum: string;
  institutionType: string;
}

// Mirrors public.tutor_subject_competencies for one tutor.
export interface TutorSubjectCompetency {
  id: string;
  subjectName: string;
  curriculum: string;
  minGradeLevel: string;
  maxGradeLevel: string;
}

// Mirrors public.tutor_profiles joined with public.profiles (name/avatar)
// and public.tutor_subject_competencies (subjects). The schema has no bio
// or free-text availability for tutors — those were mock-only fields;
// dropped rather than faked. institutionId is null until the tutor sets
// one (see TeachingProfilePanel.tsx) — null means "not
// institution-restricted," matching students anywhere, not "matches no
// one" (see fetchTutors/fetchAvailableRequests in queries.ts). currencyCode
// drives which symbol hourlyRate renders with (see getCurrencySymbol in
// lib/currencies.ts) — every real row is 'ZAR' today, but nothing in the
// UI should hardcode that.
export interface Tutor {
  id: string;
  name: string;
  avatarUrl: string | null;
  headline: string | null;
  hourlyRate: number;
  currencyCode: string;
  verified: boolean;
  rating: number;
  reviewsCount: number;
  teachingMode: string;
  isDispatchActive: boolean;
  totalSessionsCompleted: number;
  subjects: TutorSubjectCompetency[];
  currentTierId: number;
  institutionId: string | null;
}

// Mirrors public.tier_definitions — the pricing bands students choose
// between (like Uber's ride classes), not the tutor-progression sub-tiers.
export interface TierDefinition {
  id: number;
  publicName: string;
  positioningQuote: string;
  minRate: number;
  maxRate: number;
  commissionRatePct: number;
  currencyCode: string;
}

// Mirrors public.reviews for one tutor. student_id exists in the schema but
// isn't surfaced here — reviewer identity isn't needed for a tutor's own
// dashboard view of feedback they've received.
export interface TutorReview {
  id: string;
  rating: number | null;
  comment: string | null;
  createdAt: string;
}

// Mirrors public.tutor_availability — a single recurring weekly slot.
export interface TutorAvailabilitySlot {
  id: string;
  dayOfWeek: number; // 0 = Sunday .. 6 = Saturday
  startTime: string; // "HH:MM:SS"
  endTime: string;
}

// Mirrors public.sessions for one tutor (their own rows only — RLS is
// owner-scoped, readable now because real tutor auth exists). Used to mark
// which of the tutor's availability slots are already booked, and to list
// upcoming sessions on the dashboard calendar.
export interface TutorSession {
  id: string;
  studentName: string;
  subjectName: string | null;
  scheduledStart: string; // ISO timestamptz
  durationHours: number;
  status: string | null;
}

// The student-side mirror of TutorSession above — the same public.sessions
// row, from the other participant's point of view. Used for the student's
// "upcoming sessions" surfaces (SubHeaderBanner count, ManageAccountModal's
// Sessions & History tab) that were placeholder zeros until this existed.
export interface StudentSession {
  id: string;
  tutorName: string;
  subjectName: string | null;
  scheduledStart: string; // ISO timestamptz
  durationHours: number;
  status: string | null;
}

// A bookable price level under Model 3 ("minimum level", backlog 12a): one of
// the 16 sub-tiers, offered only while at least one matching tutor sits at it
// or above (available_price_levels). The student pays `price`; any tutor at
// this level or higher may accept.
export interface PriceLevel {
  id: string;        // sub-tier id, e.g. '1A', '2C'
  tierId: number;
  tierName: string;
  price: number;     // per hour, in currencyCode
  currencyCode: string;
  tutors: number;    // matching tutors at this level or above
}

// A session as its tutor manages it: add the meeting link before it starts,
// mark it complete after it ends (backlog 7m and item 10).
export interface TutorManagedSession {
  id: string;
  studentName: string;
  subjectName: string | null;
  scheduledStart: string; // ISO timestamptz
  durationHours: number;
  status: string | null;
  meetingUrl: string | null;
  // Set when a parent or guardian booked the session for their learner
  // (legal spec §5: a parent must be reachable during a minor's session).
  guardianName?: string;
  guardianPhone?: string;
}

// A session as its learner sees it on the Sessions tab: the link to join,
// and — once completed — whether they've rated it yet.
export interface StudentSessionDetail {
  id: string;
  tutorId: string;
  tutorName: string;
  subjectName: string | null;
  scheduledStart: string; // ISO timestamptz
  durationHours: number;
  status: string | null;
  meetingUrl: string | null;
  hasReview: boolean;
  // Set on a parent's or guardian's view: which of their learners it's for.
  learnerName?: string;
}

// Mirrors public.session_requests while it's still anonymous — tutor_id is
// null, so this is a request any qualifying tutor can browse and claim
// (see fetchAvailableRequests in queries.ts and acceptRequest in payments.ts).
// Deliberately has no student name/identity: that's the whole point of
// anonymous matching — a tutor only learns who they're paired with after
// accepting (see StudentSession/TutorSession, the post-match reveal
// surfaces). student_id still travels internally (needed to create the
// resulting public.sessions row on accept), but is never rendered.
export interface AvailableSessionRequest {
  id: string;
  studentId: string;
  subjectName: string | null;
  gradeLevel: string | null;
  tierId: number | null;
  tierName: string | null;
  levelId: string | null; // the Model 3 minimum level, e.g. '2A' (null on pre-Model-3 requests)
  requestedStart: string; // ISO timestamptz
  durationHours: number;
  enrollmentId: string | null;
  // The price the database set for this request (guard_session_request_insert).
  // The learner's saved card is charged exactly this when a tutor accepts
  // (backlog 7a), and it becomes the resulting sessions.gross_amount.
  chargedAmount: number;
  tutorPayout: number | null; // what the tutor earns if they accept (price less the level's commission)
  currencyCode: string;
}

// A tutor's payout account (public.tutor_payout_accounts, backlog 7a) — where
// Paystack pays their share of each session. Only the bank and the last 4
// digits are stored; canReceivePayments means a Paystack subaccount exists.
export interface PayoutAccount {
  bankName: string;
  accountHolderName: string;
  last4: string | null;
  validationStatus: 'validated' | 'bank_not_supported' | 'recorded_test_mode' | 'refuted' | null;
  canReceivePayments: boolean;
}

// Mirrors public.dispute_reason — what a learner, guardian or tutor can report
// about a session (report_session_problem, backlog 7u).
export type ProblemReason = 'no_show' | 'late_arrival' | 'poor_quality' | 'technical_issue' | 'billing_error' | 'other';

// A row of public.notifications, the signed-in user's own.
export interface AppNotification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  createdAt: string;
  readAt: string | null;
}

// Mirrors public.sub_tier_definitions — the progression thresholds a tutor
// climbs through within a tier (not a student-facing price point, see
// TierDefinition above).
export interface SubTierDefinition {
  id: string; // e.g. "1A"
  tierId: number;
  subTierCode: string; // "A" | "B" | "C" | "D"
  maxAllowedRate: number;
  minHours: number;
  minRating: number;
  minRepeatRatePct: number;
  minWrittenReviews: number;
  minDistinctStudentsUplift: number;
  requiredGradeUpliftPct: number;
}

// Composed view for TeachingProfilePanel.tsx (the "Teaching" tab in
// ManageAccountModal): a tutor's own profile plus the data only they (or
// the public, per RLS) can see. Deliberately excludes sessions, payout
// account, and verification documents — RLS on those tables is owner-only
// (auth.uid() = tutor_id) with no public-read policy, and there's no tutor
// auth yet, so the anon client correctly cannot read them. Don't add those
// without building real tutor auth first.
export interface TutorDashboardData {
  id: string;
  name: string;
  avatarUrl: string | null;
  headline: string | null;
  hourlyRate: number;
  currencyCode: string;
  verified: boolean;
  onboardingStatus: string | null;
  rating: number;
  reviewsCount: number;
  totalCompletedHours: number;
  totalSessionsCompleted: number;
  teachingMode: string;
  isDispatchActive: boolean;
  tier: { id: number; publicName: string; minRate: number; maxRate: number } | null;
  currentSubTierId: string;
  repeatStudentRatePct: number;
  avgGradeUpliftPct: number;
  qualifiedUpliftStudentsCount: number;
  subjects: TutorSubjectCompetency[];
  institutionId: string | null;
  institutionName: string | null;
}

export interface SuggestionItem {
  id: string;
  title: string;
  description: string;
  iconName: '1-on-1' | 'scheduled' | 'homework' | 'examprep' | 'group' | 'teens';
  badge?: string;
}

// Grade level deliberately isn't here — it's account-level info (see
// UserAccount.gradeLevel below), set once in account settings, not
// re-entered per search the way subject is.
export interface BookingFormState {
  institution: string; // display name — see institutionId below for the real FK used to filter/match
  institutionId: string | null;
  subject: string;
  scheduleType: 'now' | 'scheduled';
  scheduledDate: string;
  scheduledTime: string;
}

export interface UserAccount {
  name: string;
  email: string;
  institution: string;
  gradeLevel: string; // student_profiles.grade_level — empty string means "not set yet"
  upcomingSessions: number;
  completedSessions: number;
  savedTutorsCount: number;
}

export type UserRole = 'student' | 'parent' | 'tutor' | 'admin';

// Mirrors public.profiles for the signed-in user. Created automatically by
// the `on_auth_user_created` DB trigger (handle_new_user_role_expansion)
// when someone signs up — see src/pages/CreateAccount.tsx.
export interface UserProfile {
  id: string;
  fullName: string;
  email: string;
  role: UserRole;
  avatarUrl: string | null;
}
