export type AdminRole = 'support_agent' | 'verification_officer' | 'finance_manager' | 'super_admin';

export interface AdminProfile {
  id: string;
  fullName: string;
  email: string;
  adminRole: AdminRole;
  isActive: boolean;
}

export type OnboardingStatus = 'pending_academic' | 'pending_pedagogy' | 'pending_diagnostic' | 'verified' | 'rejected';

// A tutor row in the verification queue — enough to triage without opening
// the detail view.
export interface TutorForVerification {
  id: string;
  name: string;
  email: string;
  headline: string | null;
  onboardingStatus: OnboardingStatus;
  isVerified: boolean;
  createdAt: string;
  documentCount: number;
  pendingDocumentCount: number;
  // Master 7cx: 'beginner' or 'experienced' once the tutor has chosen; null for a tutor who has not, and for a
  // test-phase tutor who is not asked.
  tutorType: 'beginner' | 'experienced' | null;
}

export type DocumentType =
  | 'identity_doc'
  | 'matric_certificate'
  | 'university_transcript'
  | 'police_clearance'
  | 'proof_of_address'
  | 'nrso_clearance'
  | 'child_protection_register_clearance'
  | 'teaching_qualification'
  | 'sace_certificate'
  | 'practicum_letter'
  | 'marking_appointment_letter'
  | 'subject_results'
  | 'proof_of_experience';
export type DocumentStatus = 'pending' | 'under_review' | 'verified' | 'rejected';

export interface VerificationDocument {
  id: string;
  tutorId: string;
  documentType: DocumentType;
  // A private storage path for a file, or an https link (proof of experience may be a link).
  documentUrl: string;
  status: DocumentStatus | null;
  adminNotes: string | null;
  uploadedAt: string | null;
  reviewedAt: string | null;
  // The date printed on a police clearance certificate (master 7cx); null for other documents.
  issuedOn: string | null;
}

// Master 7cx: which kind of tutor this is and whether they agreed to Tutorlage keeping their documents.
// null = the tutor has not reached the "beginner or experienced?" page yet. grandfathered = a test-phase tutor
// who existed before the document steps and is never asked.
export interface TutorOnboardingInfo {
  track: 'beginner' | 'experienced' | null;
  grandfathered: boolean;
  consentedAt: string | null;
  consentVersion: string | null;
}

export interface TutorVerificationDetail {
  id: string;
  name: string;
  email: string;
  phoneNumber: string | null;
  // Not readable from profiles directly (hidden column) — comes from
  // admin_profile_private(). Required before a tutor can be verified (7l).
  dateOfBirth: string | null;
  headline: string | null;
  onboardingStatus: OnboardingStatus;
  isVerified: boolean;
  hourlyRate: number;
  createdAt: string;
  subjects: { subjectName: string; curriculum: string; minGradeLevel: string; maxGradeLevel: string; verificationStatus: string | null }[];
  documents: VerificationDocument[];
  onboarding: TutorOnboardingInfo | null;
}

export type DisputeReason = 'billing_error' | 'technical_issue' | 'poor_quality' | 'late_arrival' | 'no_show' | 'other';
export type DisputeStatus = 'open' | 'under_investigation' | 'resolved_payout' | 'resolved_refunded' | 'dismissed';

export interface Dispute {
  id: string;
  sessionId: string;
  raisedByName: string;
  reason: DisputeReason;
  description: string;
  status: DisputeStatus;
  resolutionNotes: string | null;
  refundAmount: number | null;
  currencyCode: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

export interface AdminUserRow {
  id: string;
  fullName: string;
  email: string;
  role: 'student' | 'parent' | 'tutor' | 'admin';
  createdAt: string;
  isVerifiedTutor: boolean | null;
  onboardingStatus: OnboardingStatus | null;
}

export interface PayoutBatch {
  id: string;
  batchReference: string;
  totalTutorsPaid: number;
  totalAmountPaid: number;
  platformCommissionRetained: number;
  status: string;
  createdAt: string;
  processedAt: string | null;
}

// A session request whose payment needs a person (backlogs 7a and 7z).
export interface PaymentAttentionItem {
  requestId: string;
  problem: string;
  paymentStatus: string;
  detail: string | null;
  reference: string | null;
  amount: number;
  currencyCode: string;
  createdAt: string;
}

// A tutor's payout account (public.tutor_payout_accounts, backlog 7a).
export interface TutorPayoutAccountRow {
  tutorId: string;
  tutorName: string;
  bankName: string;
  last4: string | null;
  validationStatus: string | null;
  subaccountCode: string | null;
  updatedAt: string;
}

export interface SystemSetting {
  settingKey: string;
  settingValue: unknown;
  description: string | null;
  updatedAt: string | null;
}

export type AuditAction =
  | 'tutor_approved' | 'tutor_rejected' | 'tutor_suspended' | 'user_banned'
  | 'dispute_resolved' | 'refund_issued' | 'payout_batch_executed'
  | 'manual_tier_override' | 'system_setting_updated'
  // Written by the database itself (admin_set_date_of_birth), not logAdminAction.
  | 'date_of_birth_recorded'
  // Phase 2 (migration 20261012090000): written by database functions, not by logAdminAction().
  | 'school_result_checked'
  | 'tier1_record_checked'
  | 'tier1_training_signed_off';

export interface AuditLogEntry {
  id: string;
  adminName: string | null;
  action: AuditAction;
  targetEntityType: string;
  targetEntityId: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

// Test phase 1 numbers (backlog 7ad), computed in the browser from tables
// admins can already read — see fetchPhase1Metrics.
export interface Phase1Metrics {
  requestsSent: number;          // reached tutors (card checked) or further
  requestsWaiting: number;       // sent, not yet accepted or expired
  requestsAccepted: number;
  requestsExpired: number;       // nobody accepted in time (never charged)
  requestsCancelled: number;
  acceptanceRatePct: number | null;   // accepted ÷ (accepted + expired)
  medianMinutesToAccept: number | null;
  slowestMinutesToAccept: number | null;
  chargeFailures: number;
  sessionsScheduled: number;
  sessionsCompletedByTutor: number;
  sessionsCompletedAutomatically: number; // estimated: completed 48h+ after the end
  sessionsCancelledByLearner: number;   // the learner or their guardian
  sessionsCancelledByTutor: number;
  problemReportsOpen: number;
  problemReportsTotal: number;
  ratingsCount: number;
  averageRating: number | null;
}

// ---- Levels, tiers and credentials (CEO, 17 Oct 2026: set from the admin app) ----

// One of the four tiers (a group of levels). "Share" is Tutorlage's commission, used when a level has none of its own.
export interface TierConfig {
  id: number;
  publicName: string;
  quote: string;
  minRate: number;
  maxRate: number;
  sharePct: number;
  currencyCode: string;
}

// One of the 16 levels (1A to 4D) with its price and the minimums a tutor must have reached to be at it.
export interface LevelConfig {
  id: string;
  tierId: number;
  price: number;
  minHours: number;
  minRating: number;
  minRepeatPct: number;
  minReviews: number;
  minStudents: number;
  uplift: number;
  sharePct: number;
}

// What can start a tutor at a level. entrySubTier is empty only for "level assigned by Tutorlage".
export interface CredentialConfig {
  code: string;
  label: string;
  entrySubTier: string | null;
  recencyYears: number | null;
  description: string | null;
  heldBy: number;
}

export interface TutorCredentialRow {
  id: string;
  code: string;
  label: string;
  // The level this credential gives this tutor: the one chosen for them, or the credential's own.
  level: string | null;
  obtainedOn: string | null;
  note: string | null;
  documentId: string | null;
  status: string;
}

export interface TutorLevelInfo {
  currentLevel: string | null;
  floorLevel: string | null;
  frozen: boolean;
  freezeReason: string | null;
  credentials: TutorCredentialRow[];
}
