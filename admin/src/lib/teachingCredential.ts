// A qualified teacher, or someone studying to be one, does not prove subject competence one subject at a time: their teaching credential already is that proof (CEO, 18 Nov 2026).
// An admin records the credential against a verified document (the Level card on the tutor's page); then ONE button approves every claimed subject
// (database function admin_approve_subjects_on_credential, which re-checks everything itself: this file only decides what to SHOW). The checklist stays for everybody else.

export interface CredentialLine {
  id: string;
  code: string;
  label: string;
  status: string;
  obtainedOn: string | null;
  documentId: string | null;
  provesCompetence: boolean;
  recencyYears: number | null;
}
export interface DocumentLine { id: string; status: string; type: string }

export const PROOF_DOCUMENT_TYPES = ['teaching_qualification', 'sace_certificate', 'practicum_letter', 'university_transcript', 'proof_of_experience'];

export type CredentialPath =
  | { kind: 'ready'; credential: CredentialLine; documentType: string }          // the button may be offered
  | { kind: 'document_not_verified'; credential: CredentialLine }                 // recorded, but its document has not been marked verified
  | { kind: 'none' };                                                              // no teaching credential: the checklist is the way

const days = (iso: string): number => Math.floor(Date.parse(iso) / 86_400_000);

export function credentialPath(creds: CredentialLine[], docs: DocumentLine[], today: string): CredentialPath {
  const docById = new Map(docs.map((d) => [d.id, d]));
  const candidates = creds.filter((c) => c.status === 'verified' && c.provesCompetence
    && (c.recencyYears === null || c.obtainedOn === null || days(today) - days(c.obtainedOn) <= c.recencyYears * 366));
  for (const c of candidates) {
    const d = c.documentId ? docById.get(c.documentId) : undefined;
    if (d && d.status === 'verified' && PROOF_DOCUMENT_TYPES.includes(d.type)) return { kind: 'ready', credential: c, documentType: d.type };
  }
  const first = candidates[0];
  return first ? { kind: 'document_not_verified', credential: first } : { kind: 'none' };
}

export interface TeachingCredentialInfo { available: boolean; path: CredentialPath }

// available = false when the database update is not applied yet (the column is missing): the card then shows nothing new.
export async function fetchTeachingCredentialInfo(tutorId: string): Promise<TeachingCredentialInfo> {
  const { supabase } = await import('./supabaseClient');
  const defsRes = await supabase.from('credential_definitions').select('code, label, recency_years, proves_subject_competence');
  if (defsRes.error) return { available: false, path: { kind: 'none' } };
  const [credsRes, docsRes] = await Promise.all([
    supabase.from('tutor_credentials').select('id, credential_code, status, obtained_on, document_id').eq('tutor_id', tutorId),
    supabase.from('tutor_verification_documents').select('id, status, document_type').eq('tutor_id', tutorId),
  ]);
  if (credsRes.error) throw credsRes.error;
  if (docsRes.error) throw docsRes.error;
  const defs = new Map((defsRes.data ?? []).map((d) => [d.code as string, d as { label: string; recency_years: number | null; proves_subject_competence: boolean }]));
  const creds: CredentialLine[] = (credsRes.data ?? []).map((c) => {
    const d = defs.get(c.credential_code as string);
    return {
      id: String(c.id), code: String(c.credential_code), label: d?.label ?? String(c.credential_code), status: String(c.status),
      obtainedOn: (c.obtained_on as string | null) ?? null, documentId: (c.document_id as string | null) ?? null,
      provesCompetence: d?.proves_subject_competence === true, recencyYears: d?.recency_years ?? null,
    };
  });
  const docs: DocumentLine[] = (docsRes.data ?? []).map((d) => ({ id: String(d.id), status: String(d.status), type: String(d.document_type) }));
  return { available: true, path: credentialPath(creds, docs, new Date().toISOString().slice(0, 10)) };
}

export async function approveSubjectsOnCredential(tutorId: string, credentialId: string | null): Promise<{ approved: number; credential: string }> {
  const { supabase } = await import('./supabaseClient');
  const { data, error } = await supabase.rpc('admin_approve_subjects_on_credential', { p_tutor: tutorId, p_credential: credentialId });
  if (error) throw error;
  const row = (data ?? {}) as { approved?: unknown; credential?: unknown };
  return { approved: Number(row.approved) || 0, credential: String(row.credential ?? '') };
}
