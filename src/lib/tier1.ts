import { supabase } from './supabaseClient';

// The Tier 1 route (master backlog item 7; migration 20261012090200). The database decides every gate and grades
// the test: this file only calls its functions. The test's keys never reach the browser.

export interface Tier1Subject {
  subjectName: string;
  status: 'closed' | 'evidence_gathering' | 'validated';
}

export interface Tier1Module {
  module: number;
  title: string;
  kind: 'self_paced' | 'live';
  needsCheck: boolean;
  summary: string;
  content: string;
}

export interface Tier1TrainingRow {
  module: number;
  result: 'complete' | 'pass' | 'not_yet';
  method: string;
  trainerName: string | null;
  missingItems: string | null;
}

export interface Tier1Status {
  subject: string;
  subjectStatus: Tier1Subject['status'];
  rules: { items: number; marks: number; passTotal: number; passDiagnosis: number; minutes: number; retakeWaitDays: number };
  academic: { status: 'pending' | 'verified' | 'rejected'; markPct: number; checkNote: string | null } | null;
  academicOk: boolean;
  trainingComplete: boolean;
  attempts: { id: string; status: string; totalScore: number | null; diagnosisScore: number | null; passed: boolean | null; startedAt: string }[];
  passed: boolean;
  canStart: boolean;
  reason: string | null;
  nextRetakeAt: string | null;
  openAttempt: string | null;
  // Migration 20261021142000 (Tier 1 by documents). On a database without it the reply has no `route`, and the old route (three gates) applies.
  route: 'documents' | 'full';
  safeguardingDone: boolean;
  conductAccepted: boolean;
  subjectVerified: boolean;
  minPct: number;
}

export interface Tier1TestItem {
  id: string;
  title: string;
  gradeBand: string | null;
  stem: string;
  q1: string[];
  q2: string[];
}

export interface Tier1Test {
  attemptId: string;
  subject: string;
  deadlineAt: string;
  items: Tier1TestItem[];
}

export interface Tier1Result {
  status: 'submitted' | 'expired';
  diagnosisScore: number;
  correctionScore: number;
  totalScore: number;
  passed: boolean;
  passTotal: number;
  passDiagnosis: number;
  late: boolean;
}

export async function fetchTier1Subjects(): Promise<Tier1Subject[]> {
  const { data, error } = await supabase.from('tier1_subjects').select('subject_name, status').order('subject_name');
  if (error) throw error;
  return (data ?? []).map((r) => ({ subjectName: r.subject_name, status: r.status }));
}

export async function fetchTier1Modules(): Promise<Tier1Module[]> {
  const { data, error } = await supabase
    .from('tier1_modules')
    .select('module, title, kind, needs_check, summary, content')
    .order('module');
  if (error) throw error;
  return (data ?? []).map((r) => ({
    module: r.module, title: r.title, kind: r.kind, needsCheck: r.needs_check, summary: r.summary, content: r.content,
  }));
}

export async function fetchMyTier1Training(tutorId: string): Promise<Tier1TrainingRow[]> {
  const { data, error } = await supabase
    .from('tier1_training')
    .select('module, result, method, trainer_name, missing_items')
    .eq('tutor_id', tutorId);
  if (error) throw error;
  return (data ?? []).map((r) => ({
    module: r.module, result: r.result, method: r.method, trainerName: r.trainer_name, missingItems: r.missing_items,
  }));
}

export async function fetchTier1Status(subject: string): Promise<Tier1Status> {
  const { data, error } = await supabase.rpc('tier1_status', { p_subject: subject });
  if (error) throw error;
  const d = data as Record<string, any>;
  return {
    subject: d.subject,
    subjectStatus: d.subject_status,
    rules: {
      items: d.rules.items, marks: d.rules.marks, passTotal: d.rules.pass_total, passDiagnosis: d.rules.pass_diagnosis,
      minutes: d.rules.minutes, retakeWaitDays: d.rules.retake_wait_days,
    },
    academic: d.academic
      ? { status: d.academic.status, markPct: Number(d.academic.mark_pct), checkNote: d.academic.check_note }
      : null,
    academicOk: d.academic_ok,
    trainingComplete: d.training_complete,
    attempts: (d.attempts ?? []).map((a: Record<string, any>) => ({
      id: a.id, status: a.status, totalScore: a.total_score, diagnosisScore: a.diagnosis_score, passed: a.passed, startedAt: a.started_at,
    })),
    passed: d.passed,
    canStart: d.can_start,
    reason: d.reason,
    nextRetakeAt: d.next_retake_at,
    openAttempt: d.open_attempt,
    route: d.route === 'documents' ? 'documents' : 'full',
    safeguardingDone: d.safeguarding_done === true,
    conductAccepted: d.conduct_accepted === true,
    subjectVerified: d.subject_verified === true,
    minPct: Number(d.min_pct ?? 70),
  };
}

// The results file goes into the tutor's own folder in the private 'tutor-documents' bucket.
export async function submitAcademicRecord(tutorId: string, subject: string, markPct: number,
                                           source: 'matric' | 'university' | 'other', file: File): Promise<void> {
  if (!['application/pdf', 'image/jpeg', 'image/png'].includes(file.type)) throw new Error('Upload a PDF, JPG or PNG file.');
  if (file.size > 5 * 1024 * 1024) throw new Error('That file is over 5 MB. Try a smaller scan or photo.');
  const extension = file.type === 'application/pdf' ? 'pdf' : file.type === 'image/png' ? 'png' : 'jpg';
  const path = `${tutorId}/tier1-${crypto.randomUUID()}.${extension}`;
  const { error: uploadError } = await supabase.storage.from('tutor-documents').upload(path, file, { contentType: file.type, upsert: false });
  if (uploadError) throw uploadError;
  const { error } = await supabase.rpc('tier1_submit_academic_record', {
    p_subject: subject, p_mark_pct: markPct, p_source: source, p_document_path: path,
  });
  if (error) {
    await supabase.storage.from('tutor-documents').remove([path]);
    throw error;
  }
}

export async function completeTier1Module(module: number): Promise<void> {
  const { error } = await supabase.rpc('tier1_complete_module', { p_module: module });
  if (error) throw error;
}

export interface ScenarioQuestion { id: number; prompt: string; options: string[] }

export async function fetchModuleCheck(): Promise<ScenarioQuestion[]> {
  const { data, error } = await supabase.rpc('tier1_module_check_questions');
  if (error) throw error;
  return (data ?? []) as ScenarioQuestion[];
}

// `agreeConduct` is sent as "conduct": true inside the answers (migration 20261021142000 stores it on the Module 7 row; an older
// database ignores the extra key).
export async function submitModuleCheck(answers: Record<number, number>, agreeConduct = false): Promise<{ passed: boolean; right: number; total: number; conductAccepted: boolean }> {
  const { data, error } = await supabase.rpc('tier1_submit_module_check', {
    p_answers: agreeConduct ? { ...answers, conduct: true } : answers,
  });
  if (error) throw error;
  const d = data as Record<string, any>;
  return { passed: d.passed, right: d.right, total: d.total, conductAccepted: d.conduct_accepted === true };
}

export async function startTier1Test(subject: string): Promise<Tier1Test> {
  const { data, error } = await supabase.rpc('tier1_start_test', { p_subject: subject });
  if (error) throw error;
  const d = data as Record<string, any>;
  return {
    attemptId: d.attempt_id,
    subject: d.subject,
    deadlineAt: d.deadline_at,
    items: (d.items ?? []).map((i: Record<string, any>) => ({
      id: i.id, title: i.title, gradeBand: i.grade_band, stem: i.stem, q1: i.q1, q2: i.q2,
    })),
  };
}

// answers: item id → the shown positions chosen for question 1 and question 2.
export async function submitTier1Test(attemptId: string, answers: Record<string, { q1?: number; q2?: number }>): Promise<Tier1Result> {
  const { data, error } = await supabase.rpc('tier1_submit_test', { p_attempt: attemptId, p_answers: answers });
  if (error) throw error;
  const d = data as Record<string, any>;
  return {
    status: d.status, diagnosisScore: d.diagnosis_score, correctionScore: d.correction_score, totalScore: d.total_score,
    passed: d.passed, passTotal: d.pass_total, passDiagnosis: d.pass_diagnosis, late: d.late,
  };
}
