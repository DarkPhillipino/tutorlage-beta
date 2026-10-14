import type { SupabaseClient } from '@supabase/supabase-js';
import { type OnboardingDocumentType, type TutorTrack, isTutorTrack } from './tutorOnboarding';

// Master 7cx: reading and writing the tutor's onboarding (kind of tutor, consent, documents). Everything takes the
// Supabase client as an argument (the app passes the real one) so scripts/dev/tutor-onboarding-test.ts can drive the
// real supabase-js against a pretend server. Every write asks for the changed row back and fails in plain words if
// none comes back (the lesson of master 7cv: a write the row-level rules filter out is "success, zero rows").

type Db = Pick<SupabaseClient, 'from' | 'storage' | 'rpc'>;

export const DOCUMENTS_BUCKET = 'tutor-documents';

export interface OnboardingRow {
  track: TutorTrack | null;
  grandfathered: boolean;
  consentedAt: string | null;
  consentVersion: string | null;
}

export interface OnboardingDocument {
  id: string;
  documentType: string;
  // A private storage path for a file, or an https link for a link (proof of experience may be either).
  documentUrl: string;
  isLink: boolean;
  status: string | null;
  adminNotes: string | null;
  issuedOn: string | null;
  uploadedAt: string;
}

export const isLinkUrl = (documentUrl: string) => /^https?:\/\//i.test(documentUrl);

function expectRow(rows: unknown[] | null | undefined, message: string): void {
  if (!rows || rows.length === 0) throw new Error(message);
}

// null: a tutor who has not chosen a kind yet (and is not a grandfathered tutor).
export async function fetchOnboarding(db: Db, tutorId: string): Promise<OnboardingRow | null> {
  const { data, error } = await db
    .from('tutor_onboarding')
    .select('track, grandfathered, consented_at, consent_version')
    .eq('tutor_id', tutorId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    track: isTutorTrack(data.track) ? data.track : null,
    grandfathered: data.grandfathered === true,
    consentedAt: data.consented_at ?? null,
    consentVersion: data.consent_version ?? null,
  };
}

export async function chooseTrack(db: Db, track: TutorTrack): Promise<void> {
  const { error } = await db.rpc('set_my_tutor_track', { p_track: track });
  if (error) throw error;
}

export async function recordConsent(db: Db, version: string): Promise<void> {
  const { error } = await db.rpc('record_my_documents_consent', { p_version: version });
  if (error) throw error;
}

export async function fetchDocuments(db: Db, tutorId: string): Promise<OnboardingDocument[]> {
  const { data, error } = await db
    .from('tutor_verification_documents')
    .select('id, document_type, document_url, status, admin_notes, issued_on, uploaded_at')
    .eq('tutor_id', tutorId)
    .order('uploaded_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((d) => ({
    id: d.id,
    documentType: d.document_type,
    documentUrl: d.document_url,
    isLink: isLinkUrl(d.document_url),
    status: d.status,
    adminNotes: d.admin_notes,
    issuedOn: d.issued_on ?? null,
    uploadedAt: d.uploaded_at,
  }));
}

const EXTENSIONS: Record<string, string> = { 'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg' };

// Uploads the file into the tutor's own folder of the private bucket, then records it. If recording fails the file is
// removed again, so no orphan is left.
export async function uploadDocument(
  db: Db,
  tutorId: string,
  documentType: OnboardingDocumentType,
  file: Blob,
  issuedOn: string | null = null,
  newId: () => string = () => crypto.randomUUID(),
): Promise<void> {
  const extension = EXTENSIONS[file.type];
  if (!extension) throw new Error('Upload a PDF, JPG or PNG file.');
  const path = `${tutorId}/${newId()}.${extension}`;
  const { error: uploadError } = await db.storage.from(DOCUMENTS_BUCKET).upload(path, file, { contentType: file.type, upsert: false });
  if (uploadError) throw uploadError;
  const { data, error } = await db
    .from('tutor_verification_documents')
    .insert({ tutor_id: tutorId, document_type: documentType, document_url: path, issued_on: issuedOn })
    .select('id');
  if (error || !data || data.length === 0) {
    await db.storage.from(DOCUMENTS_BUCKET).remove([path]);
    if (error) throw error;
    throw new Error('That document could not be saved. Please try again.');
  }
}

// Proof of experience can be a web link instead of a file; the link is stored as the document's address.
export async function addLinkDocument(db: Db, tutorId: string, link: string): Promise<void> {
  const { data, error } = await db
    .from('tutor_verification_documents')
    .insert({ tutor_id: tutorId, document_type: 'proof_of_experience', document_url: link })
    .select('id');
  if (error) throw error;
  expectRow(data, 'That link could not be saved. Please try again.');
}

// Removes a document that Tutorlage has not verified yet. A verified one cannot be removed by the tutor (the database
// refuses; this keeps the ID copy on file), so the row count tells us.
export async function removeDocument(db: Db, tutorId: string, doc: OnboardingDocument): Promise<void> {
  const { data, error } = await db
    .from('tutor_verification_documents')
    .delete()
    .eq('id', doc.id)
    .eq('tutor_id', tutorId)
    .select('id');
  if (error) throw error;
  expectRow(data, 'This document has already been checked, so it cannot be removed. Add a new one instead.');
  if (!doc.isLink) {
    // Best effort: the row is gone either way, and the database refuses to delete a file a verified document uses.
    await db.storage.from(DOCUMENTS_BUCKET).remove([doc.documentUrl]);
  }
}
