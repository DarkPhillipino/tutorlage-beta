import { supabase } from './supabaseClient';

// Learners' school results (phase 2; migration 20261012090100). A parent or guardian (or an adult learner for
// themselves) gives a separate consent, then adds report-card marks or individual assessment marks for the
// subjects the learner has booked. Tutorlage checks each against its document before it counts towards a
// tutor's level (CEO, 9 Oct). Every write goes through a database function; files live in the private
// 'school-results' bucket under the learner's folder.

export const SCHOOL_RESULTS_BUCKET = 'school-results';
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const ALLOWED_FILE_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];

// Shown once, before the first result (privacy policy v4 §6). Keep in step with that section.
export function schoolResultsConsentText(learnerName: string, isSelf: boolean): string {
  const whose = isSelf ? 'my' : `${learnerName}'s`;
  return `I agree that Tutorlage may keep ${whose} school results that I add here, only for the subjects booked on ` +
    `Tutorlage, to show progress and to measure whether tutoring helps. Tutorlage checks each result against its ` +
    `document. A tutor sees only the change in the mark for the subject they taught, never the report card. I can ` +
    `delete any result, or withdraw this consent and have them all deleted, at any time.`;
}

export type ResultKind = 'report_card' | 'test' | 'assignment' | 'exam' | 'other';
export const KIND_LABELS: Record<ResultKind, string> = {
  report_card: 'Report card',
  test: 'Test',
  assignment: 'Assignment',
  exam: 'Exam',
  other: 'Other assessment',
};

export interface SchoolResult {
  id: string;
  subjectName: string;
  kind: ResultKind;
  title: string;
  assessedOn: string;
  term: number | null;
  mark: number;
  outOf: number;
  percent: number;
  documentPath: string | null;
  status: 'pending' | 'verified' | 'rejected';
  checkNote: string | null;
}

export interface SubjectOverview {
  subjectName: string;
  firstSessionOn: string;
  lastSessionOn: string;
  completedSessions: number;
  tutors: number;
  hasBefore: boolean;
  hasDuring: boolean;
}

export interface SubjectProgress {
  subjectName: string;
  upliftPoints: number;
}

export async function fetchSchoolResultsConsent(learnerId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('school_results_consents')
    .select('withdrawn_at')
    .eq('student_id', learnerId)
    .maybeSingle();
  if (error) throw error;
  return !!data && data.withdrawn_at === null;
}

export async function giveSchoolResultsConsent(learnerId: string): Promise<void> {
  const { error } = await supabase.rpc('give_school_results_consent', { p_learner: learnerId });
  if (error) throw error;
}

export async function fetchSchoolResults(learnerId: string): Promise<SchoolResult[]> {
  const { data, error } = await supabase
    .from('school_results')
    .select('id, subject_name, kind, title, assessed_on, term, mark, out_of, percent, document_path, status, check_note')
    .eq('student_id', learnerId)
    .order('assessed_on', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id,
    subjectName: r.subject_name,
    kind: r.kind as ResultKind,
    title: r.title,
    assessedOn: r.assessed_on,
    term: r.term,
    mark: Number(r.mark),
    outOf: Number(r.out_of),
    percent: Number(r.percent),
    documentPath: r.document_path,
    status: r.status as SchoolResult['status'],
    checkNote: r.check_note,
  }));
}

export async function fetchSchoolResultsOverview(learnerId: string): Promise<SubjectOverview[]> {
  const { data, error } = await supabase.rpc('school_results_overview', { p_learner: learnerId });
  if (error) throw error;
  return ((data ?? []) as {
    subject_name: string; first_session_on: string; last_session_on: string; completed_sessions: number;
    tutors: number; has_before: boolean; has_during: boolean;
  }[]).map((r) => ({
    subjectName: r.subject_name,
    firstSessionOn: r.first_session_on,
    lastSessionOn: r.last_session_on,
    completedSessions: r.completed_sessions,
    tutors: r.tutors,
    hasBefore: r.has_before,
    hasDuring: r.has_during,
  }));
}

// The checked change, per subject (one row per tutor; shown as the average when there's more than one).
export async function fetchSchoolProgress(learnerId: string): Promise<SubjectProgress[]> {
  const { data, error } = await supabase
    .from('student_academic_records')
    .select('subject_name, uplift_delta_pct')
    .eq('student_id', learnerId);
  if (error) throw error;
  const bySubject = new Map<string, number[]>();
  for (const r of data ?? []) {
    if (r.uplift_delta_pct === null) continue;
    const list = bySubject.get(r.subject_name) ?? [];
    list.push(Number(r.uplift_delta_pct));
    bySubject.set(r.subject_name, list);
  }
  return [...bySubject.entries()].map(([subjectName, values]) => ({
    subjectName,
    upliftPoints: Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10,
  }));
}

export interface NewSchoolResult {
  learnerId: string;
  subjectName: string;
  kind: ResultKind;
  title: string;
  assessedOn: string;
  term: number | null;
  mark: number;
  outOf: number;
  file: File | null;
}

// Uploads the file (if any) to the learner's folder, then records the result. If recording fails, the file is
// removed again so nothing is left behind.
export async function addSchoolResult(input: NewSchoolResult): Promise<void> {
  let path: string | null = null;
  if (input.file) {
    const f = input.file;
    if (!ALLOWED_FILE_TYPES.includes(f.type)) throw new Error('Upload a PDF, JPG or PNG file.');
    if (f.size > MAX_FILE_BYTES) throw new Error('That file is over 5 MB. Try a smaller photo or scan.');
    const extension = f.type === 'application/pdf' ? 'pdf' : f.type === 'image/png' ? 'png' : 'jpg';
    path = `${input.learnerId}/${crypto.randomUUID()}.${extension}`;
    const { error: uploadError } = await supabase.storage
      .from(SCHOOL_RESULTS_BUCKET)
      .upload(path, f, { contentType: f.type, upsert: false });
    if (uploadError) throw uploadError;
  }
  const { error } = await supabase.rpc('add_school_result', {
    p_learner: input.learnerId,
    p_subject: input.subjectName,
    p_kind: input.kind,
    p_title: input.title,
    p_assessed_on: input.assessedOn,
    p_term: input.term,
    p_mark: input.mark,
    p_out_of: input.outOf,
    p_document_path: path,
  });
  if (error) {
    if (path) await supabase.storage.from(SCHOOL_RESULTS_BUCKET).remove([path]);
    throw error;
  }
}

export async function deleteSchoolResult(id: string): Promise<void> {
  const { data, error } = await supabase.rpc('delete_school_result', { p_id: id });
  if (error) throw error;
  if (typeof data === 'string' && data) {
    await supabase.storage.from(SCHOOL_RESULTS_BUCKET).remove([data]);
  }
}

export async function withdrawSchoolResultsConsent(learnerId: string): Promise<void> {
  const { data, error } = await supabase.rpc('withdraw_school_results_consent', { p_learner: learnerId });
  if (error) throw error;
  const paths = (data ?? []) as string[];
  if (paths.length > 0) {
    await supabase.storage.from(SCHOOL_RESULTS_BUCKET).remove(paths);
  }
}

export async function openSchoolResultDocument(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from(SCHOOL_RESULTS_BUCKET).createSignedUrl(path, 300);
  if (error) throw error;
  return data.signedUrl;
}

// "2026-10-09" → "9 Oct 2026"
export function formatDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function todayIso(): string {
  const d = new Date();
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}
