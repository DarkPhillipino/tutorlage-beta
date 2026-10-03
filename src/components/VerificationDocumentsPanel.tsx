import React, { useEffect, useRef, useState } from 'react';
import { FileCheck2, Upload, Loader2, AlertCircle } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { getErrorMessage } from '../lib/errors';

// Backlog 7h: tutors upload the documents Tutorlage checks before verifying
// them — identity, screening clearances (the CEO's 2026-09-30 decision:
// testers' existing school-screening documents), and results or teaching
// credentials. Files go to the private 'tutor-documents' bucket under the
// tutor's own folder; only the tutor and active admins can read them. Status
// is set by Tutorlage's review, never by the tutor (guard trigger).
const DOCUMENT_TYPES: { value: string; label: string }[] = [
  { value: 'identity_doc', label: 'ID document or passport' },
  { value: 'nrso_clearance', label: 'Sex offenders register clearance (NRSO)' },
  { value: 'child_protection_register_clearance', label: 'Child Protection Register clearance' },
  { value: 'police_clearance', label: 'Police clearance' },
  { value: 'subject_results', label: 'Subject results (matric or university)' },
  { value: 'matric_certificate', label: 'Matric certificate' },
  { value: 'university_transcript', label: 'University transcript' },
  { value: 'practicum_letter', label: 'Teaching practicum letter' },
  { value: 'teaching_qualification', label: 'Teaching qualification' },
  { value: 'sace_certificate', label: 'SACE registration' },
  { value: 'marking_appointment_letter', label: 'Exam marking or moderation appointment' },
  { value: 'proof_of_address', label: 'Proof of address' },
];
const TYPE_LABELS = Object.fromEntries(DOCUMENT_TYPES.map((d) => [d.value, d.label]));
const STATUS_LABELS: Record<string, string> = {
  pending: 'Waiting for review',
  under_review: 'Being reviewed',
  verified: 'Approved',
  rejected: 'Not accepted',
};
const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];

interface UploadedDocument {
  id: string;
  documentType: string;
  status: string | null;
  adminNotes: string | null;
  uploadedAt: string;
}

export const VerificationDocumentsPanel: React.FC<{ tutorId: string }> = ({ tutorId }) => {
  const [documents, setDocuments] = useState<UploadedDocument[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [documentType, setDocumentType] = useState(DOCUMENT_TYPES[0].value);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadCount, setReloadCount] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setIsLoading(true);
    supabase
      .from('tutor_verification_documents')
      .select('id, document_type, status, admin_notes, uploaded_at')
      .eq('tutor_id', tutorId)
      .order('uploaded_at', { ascending: false })
      .then(({ data, error: loadError }) => {
        if (loadError) {
          setError(getErrorMessage(loadError, 'Could not load your documents.'));
        } else {
          setDocuments(
            (data ?? []).map((d) => ({
              id: d.id,
              documentType: d.document_type,
              status: d.status,
              adminNotes: d.admin_notes,
              uploadedAt: d.uploaded_at,
            }))
          );
        }
        setIsLoading(false);
      });
  }, [tutorId, reloadCount]);

  const handleUpload = async (file: File) => {
    setError(null);
    if (!ALLOWED_TYPES.includes(file.type)) {
      setError('Upload a PDF, JPG or PNG file.');
      return;
    }
    if (file.size > MAX_BYTES) {
      setError('That file is over 5 MB — try a smaller scan or photo.');
      return;
    }
    setIsUploading(true);
    try {
      const extension = file.type === 'application/pdf' ? 'pdf' : file.type === 'image/png' ? 'png' : 'jpg';
      const path = `${tutorId}/${crypto.randomUUID()}.${extension}`;
      const { error: uploadError } = await supabase.storage
        .from('tutor-documents')
        .upload(path, file, { contentType: file.type, upsert: false });
      if (uploadError) throw uploadError;

      // document_url holds the private storage path, not a public URL.
      const { error: insertError } = await supabase
        .from('tutor_verification_documents')
        .insert({ tutor_id: tutorId, document_type: documentType, document_url: path });
      if (insertError) {
        await supabase.storage.from('tutor-documents').remove([path]);
        throw insertError;
      }
      setReloadCount((c) => c + 1);
    } catch (e) {
      setError(getErrorMessage(e, 'Upload failed — try again.'));
    } finally {
      setIsUploading(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  return (
    <div>
      <h4 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
        <FileCheck2 className="w-3.5 h-3.5" />
        Verification Documents
      </h4>
      <div className="bg-white rounded-2xl p-4 border border-slate-200 space-y-3">
        <p className="text-[11px] text-slate-500">
          Tutorlage checks these before you can accept requests. Only you and Tutorlage's review team can see them.
        </p>

        {isLoading ? (
          <div className="flex items-center text-slate-400 text-xs">
            <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…
          </div>
        ) : documents.length > 0 ? (
          <ul className="space-y-1.5">
            {documents.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-2 text-xs">
                <span className="font-semibold text-[#0F172A] truncate">{TYPE_LABELS[d.documentType] ?? d.documentType}</span>
                <span className={`shrink-0 font-bold ${d.status === 'verified' ? 'text-[#15803D]' : d.status === 'rejected' ? 'text-rose-600' : 'text-slate-500'}`}>
                  {STATUS_LABELS[d.status ?? 'pending'] ?? d.status}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-slate-500">No documents uploaded yet.</p>
        )}

        <div className="flex flex-col sm:flex-row gap-2">
          <select
            value={documentType}
            onChange={(e) => setDocumentType(e.target.value)}
            aria-label="Document type"
            className="flex-1 bg-slate-100 text-xs font-semibold text-[#0F172A] rounded-lg px-2.5 py-2 focus:outline-none cursor-pointer"
          >
            {DOCUMENT_TYPES.map((d) => (
              <option key={d.value} value={d.value}>{d.label}</option>
            ))}
          </select>
          <input
            ref={fileInput}
            type="file"
            accept="application/pdf,image/jpeg,image/png"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleUpload(file);
            }}
          />
          <button
            onClick={() => fileInput.current?.click()}
            disabled={isUploading}
            className="flex items-center justify-center gap-1.5 bg-[#0F172A] hover:bg-slate-800 disabled:opacity-60 text-white text-xs font-bold px-3 py-2 rounded-lg cursor-pointer shrink-0"
          >
            {isUploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
            Upload
          </button>
        </div>
        <p className="text-[10px] text-slate-400">PDF, JPG or PNG, up to 5 MB.</p>

        {error && (
          <div className="flex items-center gap-1.5 text-[11px] text-rose-600 font-semibold">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </div>
    </div>
  );
};
