import { supabase } from './supabaseClient';
import {
  TutorForVerification, TutorVerificationDetail, VerificationDocument,
  Dispute, AdminUserRow, PayoutBatch, SystemSetting, AuditLogEntry, AuditAction,
  OnboardingStatus, DisputeStatus, DocumentStatus, PaymentAttentionItem, TutorPayoutAccountRow,
  Phase1Metrics,
} from '../types';

// Every admin mutation below calls this alongside its main write — the
// admin_audit_logs.action enum names exactly what needs logging
// (tutor_approved, dispute_resolved, refund_issued, etc.), so this is a
// hard convention, not an afterthought.
export async function logAdminAction(
  adminId: string,
  action: AuditAction,
  targetEntityType: string,
  targetEntityId: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  const { error } = await supabase.from('admin_audit_logs').insert({
    admin_id: adminId,
    action,
    target_entity_type: targetEntityType,
    target_entity_id: targetEntityId,
    metadata: metadata ?? null,
  });
  if (error) throw error;
}

// Email, phone and date of birth aren't readable from profiles by any client
// (backlog 7o); admins get them through this admin-only database function.
interface PrivateProfile {
  id: string;
  email: string | null;
  phone_number: string | null;
  date_of_birth: string | null;
}

async function fetchPrivateProfiles(ids: string[]): Promise<Map<string, PrivateProfile>> {
  if (ids.length === 0) return new Map();
  const { data, error } = await supabase.rpc('admin_profile_private', { p_ids: ids });
  if (error) throw error;
  return new Map(((data ?? []) as PrivateProfile[]).map((row) => [row.id, row]));
}

// --- Tutor verification queue ---

export async function fetchTutorVerificationQueue(): Promise<TutorForVerification[]> {
  const { data, error } = await supabase
    .from('tutor_profiles')
    .select(`
      id,
      headline,
      onboarding_status,
      is_verified,
      created_at,
      profiles!tutor_profiles_id_fkey ( full_name ),
      tutor_verification_documents ( status )
    `)
    .order('created_at', { ascending: true });

  if (error) throw error;
  const privateProfiles = await fetchPrivateProfiles((data ?? []).map((row: any) => row.id));

  return (data ?? []).map((row: any) => ({
    id: row.id,
    name: row.profiles?.full_name ?? 'Unknown',
    email: privateProfiles.get(row.id)?.email ?? '',
    headline: row.headline,
    onboardingStatus: row.onboarding_status as OnboardingStatus,
    isVerified: row.is_verified ?? false,
    createdAt: row.created_at,
    documentCount: row.tutor_verification_documents.length,
    pendingDocumentCount: row.tutor_verification_documents.filter(
      (d: { status: string | null }) => d.status === 'pending' || d.status === 'under_review'
    ).length,
  }));
}

export async function fetchTutorVerificationDetail(tutorId: string): Promise<TutorVerificationDetail | null> {
  const { data, error } = await supabase
    .from('tutor_profiles')
    .select(`
      id,
      headline,
      onboarding_status,
      is_verified,
      hourly_rate,
      created_at,
      profiles!tutor_profiles_id_fkey ( full_name ),
      tutor_subject_competencies ( subject_name, curriculum, min_grade_level, max_grade_level, verification_status ),
      tutor_verification_documents ( id, tutor_id, document_type, document_url, status, admin_notes, uploaded_at, reviewed_at )
    `)
    .eq('id', tutorId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  const row = data as any;

  const privateRow = (await fetchPrivateProfiles([tutorId])).get(tutorId);

  return {
    id: row.id,
    name: row.profiles?.full_name ?? 'Unknown',
    email: privateRow?.email ?? '',
    phoneNumber: privateRow?.phone_number || null,
    dateOfBirth: privateRow?.date_of_birth ?? null,
    headline: row.headline,
    onboardingStatus: row.onboarding_status,
    isVerified: row.is_verified ?? false,
    hourlyRate: row.hourly_rate,
    createdAt: row.created_at,
    subjects: row.tutor_subject_competencies.map((s: any) => ({
      subjectName: s.subject_name,
      curriculum: s.curriculum,
      minGradeLevel: s.min_grade_level,
      maxGradeLevel: s.max_grade_level,
      verificationStatus: s.verification_status,
    })),
    documents: row.tutor_verification_documents.map((d: any): VerificationDocument => ({
      id: d.id,
      tutorId: d.tutor_id,
      documentType: d.document_type,
      documentUrl: d.document_url,
      status: d.status,
      adminNotes: d.admin_notes,
      uploadedAt: d.uploaded_at,
      reviewedAt: d.reviewed_at,
    })),
  };
}

export async function reviewDocument(
  documentId: string,
  tutorId: string,
  decision: DocumentStatus,
  adminId: string,
  adminNotes?: string,
  rejectionReason?: string
): Promise<void> {
  const { error: docError } = await supabase
    .from('tutor_verification_documents')
    .update({ status: decision, admin_notes: adminNotes ?? null, reviewed_at: new Date().toISOString() })
    .eq('id', documentId);
  if (docError) throw docError;

  const { error: auditError } = await supabase.from('tutor_verification_audits').insert({
    tutor_id: tutorId,
    document_id: documentId,
    reviewer_id: adminId,
    decision: decision === 'verified' ? 'verified' : decision === 'rejected' ? 'rejected' : 'under_review',
    rejection_reason: rejectionReason ?? null,
    reviewed_at: new Date().toISOString(),
  });
  if (auditError) throw auditError;
}

// A Supabase update that matches no rows (because a row-level-security
// policy filtered it out, or the id is wrong) returns no error — it just
// changes nothing. These tutor actions silently did nothing for any tutor
// but the admin's own profile until an admin UPDATE policy was added on
// 2026-09-30, so fail loudly rather than log an action that never happened.
function assertUpdated(rows: { id: string }[] | null, tutorId: string): void {
  if (!rows || rows.length === 0) {
    throw new Error(`No tutor profile was updated for ${tutorId} — check that you have admin access.`);
  }
}

// From the tutor's ID document. The database writes the audit entry itself
// (admin_set_date_of_birth), so there's no logAdminAction call here.
export async function recordDateOfBirth(profileId: string, isoDate: string): Promise<void> {
  const { error } = await supabase.rpc('admin_set_date_of_birth', { p_profile: profileId, p_dob: isoDate });
  if (error) throw error;
}

export async function approveTutor(tutorId: string, adminId: string): Promise<void> {
  const { data, error } = await supabase
    .from('tutor_profiles')
    .update({ onboarding_status: 'verified', is_verified: true })
    .eq('id', tutorId)
    .select('id');
  if (error) throw error;
  assertUpdated(data, tutorId);

  await logAdminAction(adminId, 'tutor_approved', 'tutor_profiles', tutorId);
}

export async function rejectTutor(tutorId: string, adminId: string, reason: string): Promise<void> {
  const { data, error } = await supabase
    .from('tutor_profiles')
    .update({ onboarding_status: 'rejected', is_verified: false })
    .eq('id', tutorId)
    .select('id');
  if (error) throw error;
  assertUpdated(data, tutorId);

  await logAdminAction(adminId, 'tutor_rejected', 'tutor_profiles', tutorId, { reason });
}

export async function suspendTutor(tutorId: string, adminId: string, reason: string): Promise<void> {
  const { data, error } = await supabase
    .from('tutor_profiles')
    .update({ is_dispatch_active: false, tier_frozen: true, freeze_reason: reason })
    .eq('id', tutorId)
    .select('id');
  if (error) throw error;
  assertUpdated(data, tutorId);

  await logAdminAction(adminId, 'tutor_suspended', 'tutor_profiles', tutorId, { reason });
}

// --- Disputes ---

export async function fetchDisputes(): Promise<Dispute[]> {
  const { data, error } = await supabase
    .from('platform_disputes')
    .select(`
      id, session_id, reason, description, status, resolution_notes,
      refund_amount, currency_code, created_at, resolved_at,
      profiles!platform_disputes_raised_by_id_fkey ( full_name )
    `)
    .order('created_at', { ascending: false });

  if (error) throw error;

  return (data ?? []).map((row: any) => ({
    id: row.id,
    sessionId: row.session_id,
    raisedByName: row.profiles?.full_name ?? 'Unknown',
    reason: row.reason,
    description: row.description,
    status: row.status,
    resolutionNotes: row.resolution_notes,
    refundAmount: row.refund_amount !== null ? Number(row.refund_amount) : null,
    currencyCode: row.currency_code,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
  }));
}

export async function resolveDispute(
  disputeId: string,
  adminId: string,
  status: DisputeStatus,
  resolutionNotes: string,
  refundAmount?: number
): Promise<void> {
  const { error } = await supabase
    .from('platform_disputes')
    .update({
      status,
      resolution_notes: resolutionNotes,
      refund_amount: refundAmount ?? null,
      resolved_at: new Date().toISOString(),
      assigned_admin_id: adminId,
    })
    .eq('id', disputeId);
  if (error) throw error;

  await logAdminAction(adminId, 'dispute_resolved', 'platform_disputes', disputeId, { status });
  if (status === 'resolved_refunded' && refundAmount) {
    await logAdminAction(adminId, 'refund_issued', 'platform_disputes', disputeId, { amount: refundAmount });
  }
}

// --- User management ---

// Name or email search, newest first, 50 at most. A database function (not a
// profiles query) because email isn't readable by clients (backlog 7o).
export async function fetchUsers(searchTerm: string): Promise<AdminUserRow[]> {
  const { data, error } = await supabase.rpc('admin_search_profiles', { p_term: searchTerm });
  if (error) throw error;

  return (data ?? []).map((row: any) => ({
    id: row.id,
    fullName: row.full_name,
    email: row.email,
    role: row.role,
    createdAt: row.created_at,
    isVerifiedTutor: row.is_verified ?? null,
    onboardingStatus: row.onboarding_status ?? null,
  }));
}

export async function banUser(profileId: string, adminId: string, reason: string): Promise<void> {
  // No `is_banned` column exists on profiles yet — logged for the audit
  // trail and paper trail now; enforcing an actual account lock (e.g. via a
  // banned_at column + RequireAuth check in the main app) is a follow-up,
  // not silently invented here.
  await logAdminAction(adminId, 'user_banned', 'profiles', profileId, { reason });
}

// --- Payouts ---

export async function fetchPayoutBatches(): Promise<PayoutBatch[]> {
  const { data, error } = await supabase
    .from('payout_batches')
    .select('id, batch_reference, total_tutors_paid, total_amount_paid, platform_commission_retained, status, created_at, processed_at')
    .order('created_at', { ascending: false });

  if (error) throw error;

  return (data ?? []).map((row) => ({
    id: row.id,
    batchReference: row.batch_reference,
    totalTutorsPaid: row.total_tutors_paid,
    totalAmountPaid: Number(row.total_amount_paid),
    platformCommissionRetained: Number(row.platform_commission_retained),
    status: row.status,
    createdAt: row.created_at,
    processedAt: row.processed_at,
  }));
}

// --- Payments needing a person (backlogs 7a and 7z) ---
//
// Split payments settle automatically, so there are no payout runs to do; what
// needs a person is the exceptions the database flags. RLS: "Admins manage
// session requests".
export async function fetchPaymentsNeedingAttention(): Promise<PaymentAttentionItem[]> {
  const { data, error } = await supabase
    .from('session_requests')
    .select('id, payment_status, refund_last_status, charge_failure_reason, charge_check_request_id, card_check_refund_status, paystack_reference, charge_reference, charged_amount, currency_code, created_at')
    .or('payment_status.in.(refund_needs_attention,refund_failed),charge_check_request_id.eq.-1,card_check_refund_status.like."not refunded*"')
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) throw error;

  return (data ?? []).map((row) => {
    let problem = 'Needs checking';
    let detail: string | null = null;
    if (row.payment_status === 'refund_needs_attention') {
      problem = 'Refund needs attention';
      detail = row.refund_last_status === 'needs-attention'
        ? "Paystack needs the customer's bank details — use Retry Refund in the Paystack dashboard."
        : row.refund_last_status;
    } else if (row.payment_status === 'refund_failed') {
      problem = 'Refund failed';
      detail = `${row.refund_last_status ?? 'Paystack reported a failure'}. The learner still needs refunding.`;
    } else if (row.charge_check_request_id === -1) {
      problem = "Acceptance couldn't be settled";
      detail = row.charge_failure_reason;
    } else if (String(row.card_check_refund_status ?? '').startsWith('not refunded')) {
      problem = 'R1 card check not refunded';
      detail = row.card_check_refund_status;
    }
    return {
      requestId: row.id,
      problem,
      paymentStatus: row.payment_status,
      detail,
      reference: row.charge_reference ?? row.paystack_reference,
      amount: Number(row.charged_amount ?? 0),
      currencyCode: String(row.currency_code ?? 'ZAR').trim(),
      createdAt: row.created_at,
    };
  });
}

// RLS: "Admins view payout accounts". Only the last 4 digits are ever stored.
export async function fetchTutorPayoutAccounts(): Promise<TutorPayoutAccountRow[]> {
  const { data, error } = await supabase
    .from('tutor_payout_accounts')
    .select('tutor_id, bank_name, account_number_last4, validation_status, paystack_subaccount_code, updated_at')
    .order('updated_at', { ascending: false });
  if (error) throw error;
  const rows = data ?? [];
  const names = new Map<string, string>();
  if (rows.length > 0) {
    const { data: profiles, error: profileError } = await supabase
      .from('profiles')
      .select('id, full_name')
      .in('id', rows.map((r) => r.tutor_id));
    if (profileError) throw profileError;
    for (const p of profiles ?? []) names.set(p.id, p.full_name);
  }
  return rows.map((r) => ({
    tutorId: r.tutor_id,
    tutorName: names.get(r.tutor_id) ?? 'Tutor',
    bankName: r.bank_name,
    last4: r.account_number_last4,
    validationStatus: r.validation_status,
    subaccountCode: r.paystack_subaccount_code,
    updatedAt: r.updated_at,
  }));
}

// --- System settings ---

export async function fetchSystemSettings(): Promise<SystemSetting[]> {
  const { data, error } = await supabase
    .from('system_settings')
    .select('setting_key, setting_value, description, updated_at')
    .order('setting_key');

  if (error) throw error;

  return (data ?? []).map((row) => ({
    settingKey: row.setting_key,
    settingValue: row.setting_value,
    description: row.description,
    updatedAt: row.updated_at,
  }));
}

export async function upsertSystemSetting(key: string, value: unknown, adminId: string, description?: string): Promise<void> {
  const { error } = await supabase
    .from('system_settings')
    .upsert({ setting_key: key, setting_value: value, description: description ?? null, last_updated_by: adminId, updated_at: new Date().toISOString() });
  if (error) throw error;

  // admin_audit_logs.target_entity_id is a uuid column, but system_settings
  // is keyed by a text setting_key, not a uuid — there's no real uuid to
  // put here. Use the nil uuid as a placeholder and rely on `metadata` to
  // carry the actual key; target_entity_type still distinguishes this from
  // every other logged action type.
  await logAdminAction(adminId, 'system_setting_updated', 'system_settings', '00000000-0000-0000-0000-000000000000', { key, value });
}

// --- Audit log ---

export async function fetchAuditLog(limit = 100): Promise<AuditLogEntry[]> {
  const { data, error } = await supabase
    .from('admin_audit_logs')
    .select(`
      id, action, target_entity_type, target_entity_id, metadata, created_at,
      admin_profiles ( first_name, surname )
    `)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw error;

  return (data ?? []).map((row: any) => ({
    id: row.id,
    adminName: row.admin_profiles ? `${row.admin_profiles.first_name} ${row.admin_profiles.surname}` : null,
    action: row.action,
    targetEntityType: row.target_entity_type,
    targetEntityId: row.target_entity_id,
    metadata: row.metadata,
    createdAt: row.created_at,
  }));
}

// ---- Test phase 1 numbers (backlog 7ad) ----
// Read straight from session_requests, sessions, platform_disputes and reviews
// (admins can read all four); no migration. Phase 1 volumes are small, so the
// arithmetic happens here rather than in a database function.
export async function fetchPhase1Metrics(): Promise<Phase1Metrics> {
  const [requests, sessions, disputes, reviews, autoHours] = await Promise.all([
    supabase.from('session_requests').select('status, payment_status, created_at, responded_at, claimed_at, charged_at'),
    supabase.from('sessions').select('status, scheduled_start, duration_hours, completed_at'),
    supabase.from('platform_disputes').select('status'),
    supabase.from('reviews').select('rating'),
    supabase.from('system_settings').select('setting_value').eq('setting_key', 'session_auto_complete_hours').maybeSingle(),
  ]);
  for (const result of [requests, sessions, disputes, reviews, autoHours]) {
    if (result.error) throw result.error;
  }

  // A request reaches tutors once its card check succeeds; before that it's
  // only a started checkout.
  const notSent = new Set(['unpaid', 'initiated', 'failed']);
  const allRequests: any[] = requests.data ?? [];
  const sent = allRequests.filter((r) => r.status === 'accepted' || !notSent.has(r.payment_status));
  const accepted = sent.filter((r) => r.status === 'accepted');
  const expired = sent.filter((r) => r.status === 'expired');
  const minutesToAccept = accepted
    .map((r) => {
      const at = r.responded_at ?? r.charged_at ?? r.claimed_at;
      return at ? (new Date(at).getTime() - new Date(r.created_at).getTime()) / 60_000 : null;
    })
    .filter((m): m is number => m !== null)
    .sort((a, b) => a - b);
  const median = (values: number[]) => {
    if (values.length === 0) return null;
    const mid = Math.floor(values.length / 2);
    return values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
  };

  // A session the job completed has completed_at at least the configured
  // delay after its end; one the tutor marked is earlier. The job runs every
  // 15 minutes, hence the small allowance.
  const delayHours = Number(autoHours.data?.setting_value ?? 48);
  const allSessions: any[] = sessions.data ?? [];
  const completed = allSessions.filter((s) => s.status === 'completed' && s.completed_at);
  const isAuto = (s: any) => {
    const end = new Date(s.scheduled_start).getTime() + Number(s.duration_hours) * 3_600_000;
    return new Date(s.completed_at).getTime() >= end + delayHours * 3_600_000 - 15 * 60_000;
  };
  const ratings = (reviews.data ?? []).map((r: any) => Number(r.rating)).filter((n) => Number.isFinite(n));
  const allDisputes: any[] = disputes.data ?? [];

  return {
    requestsSent: sent.length,
    requestsWaiting: sent.filter((r) => r.status === 'pending').length,
    requestsAccepted: accepted.length,
    requestsExpired: expired.length,
    requestsCancelled: sent.filter((r) => r.status === 'cancelled').length,
    acceptanceRatePct: accepted.length + expired.length > 0
      ? Math.round((accepted.length / (accepted.length + expired.length)) * 100)
      : null,
    medianMinutesToAccept: median(minutesToAccept),
    slowestMinutesToAccept: minutesToAccept.length ? minutesToAccept[minutesToAccept.length - 1] : null,
    chargeFailures: allRequests.filter((r) => r.payment_status === 'charge_failed').length,
    sessionsScheduled: allSessions.filter((s) => s.status === 'scheduled').length,
    sessionsCompletedByTutor: completed.filter((s) => !isAuto(s)).length,
    sessionsCompletedAutomatically: completed.filter(isAuto).length,
    sessionsCancelledByLearner: allSessions.filter((s) => s.status === 'cancelled_by_student').length,
    sessionsCancelledByTutor: allSessions.filter((s) => s.status === 'cancelled_by_tutor').length,
    problemReportsOpen: allDisputes.filter((d) => d.status === 'open' || d.status === 'under_investigation').length,
    problemReportsTotal: allDisputes.length,
    ratingsCount: ratings.length,
    averageRating: ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : null,
  };
}
