import { supabase } from './supabaseClient';

// Phase 2: the Tier 1 route's admin side (migration 20261012090200). Checks and sign-offs go through database
// functions that write their own audit rows ('tier1_record_checked', 'tier1_training_signed_off').

export interface Tier1RecordForCheck {
  id: string;
  tutorId: string;
  tutorName: string;
  subjectName: string;
  markPct: number;
  source: string;
  documentPath: string;
  createdAt: string;
}

export async function fetchTier1RecordsForCheck(): Promise<Tier1RecordForCheck[]> {
  const { data, error } = await supabase
    .from('tier1_academic_records')
    .select('id, tutor_id, subject_name, mark_pct, source, document_path, created_at')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(200);
  if (error) throw error;
  const rows = data ?? [];
  const ids = [...new Set(rows.map((r) => r.tutor_id))];
  const names = new Map<string, string>();
  if (ids.length > 0) {
    const { data: profiles, error: profileError } = await supabase.from('profiles').select('id, full_name').in('id', ids);
    if (profileError) throw profileError;
    for (const p of profiles ?? []) names.set(p.id, p.full_name ?? '');
  }
  return rows.map((r) => ({
    id: r.id,
    tutorId: r.tutor_id,
    tutorName: names.get(r.tutor_id) || r.tutor_id.slice(0, 8),
    subjectName: r.subject_name,
    markPct: Number(r.mark_pct),
    source: r.source,
    documentPath: r.document_path,
    createdAt: r.created_at,
  }));
}

export async function checkTier1Record(id: string, verdict: 'verified' | 'rejected', note: string): Promise<void> {
  const { error } = await supabase.rpc('admin_check_tier1_record', { p_id: id, p_verdict: verdict, p_note: note });
  if (error) throw error;
}

export async function signedTutorDocumentUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from('tutor-documents').createSignedUrl(path, 300);
  if (error) throw error;
  return data.signedUrl;
}

export async function recordTier1Signoff(tutorId: string, module: 2 | 5, trainerName: string,
                                         result: 'pass' | 'not_yet', missingItems: string): Promise<void> {
  const { error } = await supabase.rpc('admin_record_tier1_signoff', {
    p_tutor: tutorId, p_module: module, p_trainer_name: trainerName, p_result: result, p_missing_items: missingItems,
  });
  if (error) throw error;
}

export interface Tier1TrainingSummary {
  module: number;
  result: string;
  trainerName: string | null;
  missingItems: string | null;
  recordedAt: string;
}

export async function fetchTutorTier1Training(tutorId: string): Promise<Tier1TrainingSummary[]> {
  const { data, error } = await supabase
    .from('tier1_training')
    .select('module, result, trainer_name, missing_items, recorded_at')
    .eq('tutor_id', tutorId)
    .order('module');
  if (error) throw error;
  return (data ?? []).map((r) => ({
    module: r.module, result: r.result, trainerName: r.trainer_name, missingItems: r.missing_items, recordedAt: r.recorded_at,
  }));
}

export interface ItemAnalysisRow {
  itemId: string;
  title: string;
  attempts: number;
  q1RightPct: number | null;
  q2RightPct: number | null;
}

export async function fetchItemAnalysis(subject: string): Promise<ItemAnalysisRow[]> {
  const { data, error } = await supabase.rpc('admin_tier1_item_analysis', { p_subject: subject });
  if (error) throw error;
  return ((data ?? []) as Record<string, any>[]).map((r) => ({
    itemId: r.item_id,
    title: r.title,
    attempts: r.attempts,
    q1RightPct: r.q1_right_pct === null ? null : Number(r.q1_right_pct),
    q2RightPct: r.q2_right_pct === null ? null : Number(r.q2_right_pct),
  }));
}

export async function fetchTier1SubjectNames(): Promise<string[]> {
  const { data, error } = await supabase.from('tier1_subjects').select('subject_name').order('subject_name');
  if (error) throw error;
  return (data ?? []).map((r) => r.subject_name);
}
