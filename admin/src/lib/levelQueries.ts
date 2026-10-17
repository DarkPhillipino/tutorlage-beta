import { supabase } from './supabaseClient';
import type { CredentialConfig, LevelConfig, TierConfig, TutorCredentialRow, TutorLevelInfo } from '../types';

// The tiers, the 16 levels and the credentials that start a tutor at a level, plus who is at which level (CEO, 17 Oct 2026:
// "admins should be able to assign tier roles from the admin app and the tiers should be defined in the admin app as well").
// Every change goes through an admin-only database function that checks the caller, validates the numbers and writes the
// audit row itself (migration 20261017120000). Nothing here writes a table directly.

export async function fetchLevelsConfig(): Promise<{ tiers: TierConfig[]; levels: LevelConfig[]; credentials: CredentialConfig[] }> {
  const [tiersRes, levelsRes, credsRes, heldRes] = await Promise.all([
    supabase.from('tier_definitions').select('id, public_name, positioning_quote, min_rate, max_rate, commission_rate_pct, currency_code').order('id'),
    supabase
      .from('sub_tier_definitions')
      .select('id, tier_id, max_allowed_rate, min_hours, min_rating, min_repeat_rate_pct, min_written_reviews, min_distinct_students_uplift, required_grade_uplift_pct, commission_rate_pct')
      .order('max_allowed_rate'),
    supabase.from('credential_definitions').select('code, label, entry_sub_tier_id, recency_years, description').order('label'),
    supabase.from('tutor_credentials').select('credential_code'),
  ]);
  if (tiersRes.error) throw tiersRes.error;
  if (levelsRes.error) throw levelsRes.error;
  if (credsRes.error) throw credsRes.error;
  const held = new Map<string, number>();
  for (const row of (heldRes.data ?? []) as { credential_code: string }[]) held.set(row.credential_code, (held.get(row.credential_code) ?? 0) + 1);
  return {
    tiers: (tiersRes.data ?? []).map((t) => ({
      id: t.id,
      publicName: t.public_name,
      quote: t.positioning_quote ?? '',
      minRate: Number(t.min_rate),
      maxRate: Number(t.max_rate),
      sharePct: Number(t.commission_rate_pct),
      currencyCode: String(t.currency_code ?? 'ZAR').trim(),
    })),
    levels: (levelsRes.data ?? []).map((s) => ({
      id: s.id,
      tierId: s.tier_id,
      price: Number(s.max_allowed_rate),
      minHours: s.min_hours ?? 0,
      minRating: Number(s.min_rating ?? 0),
      minRepeatPct: Number(s.min_repeat_rate_pct ?? 0),
      minReviews: s.min_written_reviews ?? 0,
      minStudents: s.min_distinct_students_uplift ?? 0,
      uplift: Number(s.required_grade_uplift_pct ?? 0),
      sharePct: Number(s.commission_rate_pct ?? 0),
    })),
    credentials: (credsRes.data ?? []).map((c) => ({
      code: c.code,
      label: c.label,
      entrySubTier: c.entry_sub_tier_id ?? null,
      recencyYears: c.recency_years ?? null,
      description: c.description ?? null,
      heldBy: held.get(c.code) ?? 0,
    })),
  };
}

export async function saveTier(t: Omit<TierConfig, 'currencyCode'>): Promise<void> {
  const { error } = await supabase.rpc('admin_save_tier', {
    p_id: t.id,
    p_public_name: t.publicName,
    p_quote: t.quote,
    p_min_rate: t.minRate,
    p_max_rate: t.maxRate,
    p_commission: t.sharePct,
  });
  if (error) throw error;
}

export async function saveLevel(l: LevelConfig): Promise<void> {
  const { error } = await supabase.rpc('admin_save_sub_tier', {
    p_id: l.id,
    p_tier_id: l.tierId,
    p_price: l.price,
    p_min_hours: l.minHours,
    p_min_rating: l.minRating,
    p_min_repeat: l.minRepeatPct,
    p_min_reviews: l.minReviews,
    p_min_students: l.minStudents,
    p_uplift: l.uplift,
    p_commission: l.sharePct,
  });
  if (error) throw error;
}

export async function saveCredentialDefinition(c: Omit<CredentialConfig, 'heldBy'>): Promise<void> {
  const { error } = await supabase.rpc('admin_save_credential_definition', {
    p_code: c.code,
    p_label: c.label,
    p_entry_sub_tier: c.entrySubTier,
    p_recency_years: c.recencyYears,
    p_description: c.description ?? '',
  });
  if (error) throw error;
}

export async function deleteCredentialDefinition(code: string): Promise<void> {
  const { error } = await supabase.rpc('admin_delete_credential_definition', { p_code: code });
  if (error) throw error;
}

// Works every tutor's level out again with the current prices and minimums. Returns how many tutors were worked out.
export async function recalculateAllLevels(): Promise<number> {
  const { data, error } = await supabase.rpc('admin_recalculate_all_tiers');
  if (error) throw error;
  return Number(data ?? 0);
}

// ---- one tutor ----

export async function fetchTutorLevelInfo(tutorId: string): Promise<TutorLevelInfo> {
  const [profileRes, credsRes, defsRes] = await Promise.all([
    supabase.from('tutor_profiles').select('current_sub_tier_id, credential_floor_sub_tier_id, tier_frozen, freeze_reason').eq('id', tutorId).maybeSingle(),
    supabase
      .from('tutor_credentials')
      .select('id, credential_code, document_id, status, obtained_on, assigned_sub_tier_id, note')
      .eq('tutor_id', tutorId)
      .order('created_at', { ascending: false }),
    supabase.from('credential_definitions').select('code, label, entry_sub_tier_id'),
  ]);
  if (profileRes.error) throw profileRes.error;
  if (credsRes.error) throw credsRes.error;
  if (defsRes.error) throw defsRes.error;
  const defs = new Map((defsRes.data ?? []).map((d) => [d.code as string, d as { code: string; label: string; entry_sub_tier_id: string | null }]));
  const profile = profileRes.data;
  const credentials: TutorCredentialRow[] = (credsRes.data ?? []).map((c) => {
    const def = defs.get(c.credential_code as string);
    return {
      id: c.id,
      code: c.credential_code,
      label: def?.label ?? c.credential_code,
      level: c.assigned_sub_tier_id ?? def?.entry_sub_tier_id ?? null,
      obtainedOn: c.obtained_on ?? null,
      note: c.note ?? null,
      documentId: c.document_id ?? null,
      status: c.status,
    };
  });
  return {
    currentLevel: profile?.current_sub_tier_id ?? null,
    floorLevel: profile?.credential_floor_sub_tier_id ?? null,
    frozen: profile?.tier_frozen === true,
    freezeReason: profile?.freeze_reason ?? null,
    credentials,
  };
}

export async function assignTutorLevel(tutorId: string, level: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc('admin_assign_tier', { p_tutor: tutorId, p_sub_tier: level, p_reason: reason });
  if (error) throw error;
}

export async function clearTutorAssignedLevel(tutorId: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc('admin_clear_assigned_tier', { p_tutor: tutorId, p_reason: reason });
  if (error) throw error;
}

export async function recordTutorCredential(tutorId: string, code: string, obtainedOn: string | null, documentId: string | null, note: string): Promise<void> {
  const { error } = await supabase.rpc('admin_record_credential', {
    p_tutor: tutorId,
    p_code: code,
    p_obtained_on: obtainedOn,
    p_document: documentId,
    p_note: note,
  });
  if (error) throw error;
}

export async function removeTutorCredential(id: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc('admin_remove_credential', { p_id: id, p_reason: reason });
  if (error) throw error;
}
