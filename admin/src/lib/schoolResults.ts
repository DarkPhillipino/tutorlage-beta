import { supabase } from './supabaseClient';

// Phase 2 (migration 20261012090100): parents' school results waiting for a check. Admins read them through
// RLS and decide through admin_check_school_result(), which writes its own audit row
// ('school_result_checked') and recalculates the tutors' grade uplift, like admin_set_date_of_birth.

export interface SchoolResultForCheck {
  id: string;
  studentId: string;
  learnerName: string;
  subjectName: string;
  kind: string;
  title: string;
  assessedOn: string;
  term: number | null;
  mark: number;
  outOf: number;
  percent: number;
  documentPath: string | null;
  status: 'pending' | 'verified' | 'rejected';
  checkNote: string | null;
  createdAt: string;
}

export async function fetchSchoolResultsForCheck(status: 'pending' | 'verified' | 'rejected'): Promise<SchoolResultForCheck[]> {
  const { data, error } = await supabase
    .from('school_results')
    .select('id, student_id, subject_name, kind, title, assessed_on, term, mark, out_of, percent, document_path, status, check_note, created_at')
    .eq('status', status)
    .order('created_at', { ascending: true })
    .limit(200);
  if (error) throw error;
  const rows = data ?? [];
  const ids = [...new Set(rows.map((r) => r.student_id))];
  const names = new Map<string, string>();
  if (ids.length > 0) {
    const { data: profiles, error: profileError } = await supabase.from('profiles').select('id, full_name').in('id', ids);
    if (profileError) throw profileError;
    for (const p of profiles ?? []) names.set(p.id, p.full_name ?? '');
  }
  return rows.map((r) => ({
    id: r.id,
    studentId: r.student_id,
    learnerName: names.get(r.student_id) || r.student_id.slice(0, 8),
    subjectName: r.subject_name,
    kind: r.kind,
    title: r.title,
    assessedOn: r.assessed_on,
    term: r.term,
    mark: Number(r.mark),
    outOf: Number(r.out_of),
    percent: Number(r.percent),
    documentPath: r.document_path,
    status: r.status,
    checkNote: r.check_note,
    createdAt: r.created_at,
  }));
}

export async function checkSchoolResult(id: string, verdict: 'verified' | 'rejected', note: string): Promise<void> {
  const { error } = await supabase.rpc('admin_check_school_result', { p_id: id, p_verdict: verdict, p_note: note });
  if (error) throw error;
}

export async function signedSchoolResultUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from('school-results').createSignedUrl(path, 300);
  if (error) throw error;
  return data.signedUrl;
}
