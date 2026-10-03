import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, Loader2, CheckCircle2, XCircle, ExternalLink, ShieldCheck, AlertCircle } from 'lucide-react';
import { fetchTutorVerificationDetail, reviewDocument, approveTutor, rejectTutor, recordDateOfBirth } from '../lib/queries';
import { useAdminAuth } from '../lib/AuthContext';
import { TutorVerificationDetail as TutorDetail, DocumentType } from '../types';
import { supabase } from '../lib/supabaseClient';
import { getErrorMessage } from '../lib/errors';

// Whole years from a yyyy-mm-dd date to today.
function ageFrom(isoDate: string): number {
  const [y, m, d] = isoDate.split('-').map(Number);
  const today = new Date();
  let age = today.getFullYear() - y;
  if (today.getMonth() + 1 < m || (today.getMonth() + 1 === m && today.getDate() < d)) age -= 1;
  return age;
}

const DOC_LABELS: Record<DocumentType, string> = {
  identity_doc: 'Identity Document',
  matric_certificate: 'Matric Certificate',
  university_transcript: 'University Transcript',
  police_clearance: 'Police Clearance',
  proof_of_address: 'Proof of Address',
  nrso_clearance: 'Sex Offenders Register Clearance (NRSO)',
  child_protection_register_clearance: 'Child Protection Register Clearance',
  teaching_qualification: 'Teaching Qualification',
  sace_certificate: 'SACE Registration',
  practicum_letter: 'Teaching Practicum Letter',
  marking_appointment_letter: 'Exam Marking / Moderation Appointment',
  subject_results: 'Subject Results',
};

// Tutor documents live in the private 'tutor-documents' bucket; document_url
// is the storage path. Open each through a short-lived signed link rather than
// a public URL. (Older rows holding a full URL still open directly.)
async function openDocument(path: string) {
  if (/^https?:\/\//.test(path)) {
    window.open(path, '_blank', 'noopener,noreferrer');
    return;
  }
  const { data, error } = await supabase.storage.from('tutor-documents').createSignedUrl(path, 300);
  if (error || !data) {
    alert('Could not open this document — check your admin access.');
    return;
  }
  window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
}

export const TutorVerificationDetail: React.FC = () => {
  const { tutorId } = useParams<{ tutorId: string }>();
  const navigate = useNavigate();
  const { adminProfile } = useAdminAuth();
  const [tutor, setTutor] = useState<TutorDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [busyDocId, setBusyDocId] = useState<string | null>(null);
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [dobInput, setDobInput] = useState('');
  const [isSavingDob, setIsSavingDob] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    if (!tutorId) return;
    setIsLoading(true);
    fetchTutorVerificationDetail(tutorId).then(setTutor).catch(() => setTutor(null)).finally(() => setIsLoading(false));
  };

  useEffect(load, [tutorId]);

  const handleDocReview = async (docId: string, decision: 'verified' | 'rejected') => {
    if (!tutorId || !adminProfile) return;
    setError(null);
    setBusyDocId(docId);
    try {
      await reviewDocument(docId, tutorId, decision, adminProfile.id);
      load();
    } catch (e) {
      setError(getErrorMessage(e, 'Could not update that document.'));
    } finally {
      setBusyDocId(null);
    }
  };

  const handleRecordDob = async () => {
    if (!tutorId) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dobInput)) {
      setError('Enter the date of birth exactly as it appears on the ID document.');
      return;
    }
    setError(null);
    setIsSavingDob(true);
    try {
      await recordDateOfBirth(tutorId, dobInput);
      setDobInput('');
      load();
    } catch (e) {
      setError(getErrorMessage(e, 'Could not record the date of birth.'));
    } finally {
      setIsSavingDob(false);
    }
  };

  const handleApprove = async () => {
    if (!tutorId || !adminProfile) return;
    setError(null);
    setIsFinalizing(true);
    try {
      await approveTutor(tutorId, adminProfile.id);
      navigate('/verification');
    } catch (e) {
      setError(getErrorMessage(e, 'Could not approve this tutor.'));
    } finally {
      setIsFinalizing(false);
    }
  };

  const handleReject = async () => {
    if (!tutorId || !adminProfile) return;
    if (!rejectReason.trim()) {
      setError('Add a reason before rejecting.');
      return;
    }
    setError(null);
    setIsFinalizing(true);
    try {
      await rejectTutor(tutorId, adminProfile.id, rejectReason);
      navigate('/verification');
    } catch (e) {
      setError(getErrorMessage(e, 'Could not reject this tutor.'));
    } finally {
      setIsFinalizing(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-slate-400">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        <span className="text-sm font-semibold">Loading…</span>
      </div>
    );
  }

  if (!tutor) {
    return (
      <div className="bg-white rounded-2xl p-12 border border-slate-200 text-center">
        <p className="text-sm font-bold text-[#0F172A]">Tutor not found</p>
        <Link to="/verification" className="text-xs font-bold text-[#15803D] hover:underline mt-2 inline-block">Back to queue</Link>
      </div>
    );
  }

  const allDocsVerified = tutor.documents.length > 0 && tutor.documents.every((d) => d.status === 'verified');
  const tutorAge = tutor.dateOfBirth ? ageFrom(tutor.dateOfBirth) : null;
  // 7l: the database refuses verification without a recorded 18+ date of birth.
  const canApprove = tutorAge !== null && tutorAge >= 18;

  return (
    <div className="max-w-2xl">
      <Link to="/verification" className="inline-flex items-center gap-1.5 text-sm font-bold text-slate-600 hover:text-[#0F172A] mb-4">
        <ArrowLeft className="w-4 h-4" />
        Back to queue
      </Link>

      <div className="bg-white rounded-2xl p-6 border border-slate-200 mb-4">
        <div className="flex items-center gap-2 flex-wrap mb-1">
          <h1 className="text-xl font-extrabold text-[#0F172A]">{tutor.name}</h1>
          {tutor.isVerified && (
            <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full">
              <ShieldCheck className="w-3 h-3" /> Verified
            </span>
          )}
        </div>
        <p className="text-sm text-slate-500">{tutor.email} {tutor.phoneNumber ? `· ${tutor.phoneNumber}` : ''}</p>
        {tutor.headline && <p className="text-sm text-slate-600 mt-2">{tutor.headline}</p>}
        <p className="text-xs text-slate-400 mt-2">R{tutor.hourlyRate}/hr · Applied {new Date(tutor.createdAt).toLocaleDateString()}</p>
      </div>

      <div className="bg-white rounded-2xl p-6 border border-slate-200 mb-4">
        <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Date of Birth</h2>
        {tutor.dateOfBirth ? (
          <p className={`text-sm font-semibold ${canApprove ? 'text-[#0F172A]' : 'text-rose-600'}`}>
            {tutor.dateOfBirth} · {tutorAge} years old{!canApprove && ' — tutors must be 18 or older'}
          </p>
        ) : (
          <p className="text-xs text-amber-600 font-semibold mb-2">
            Not recorded. Check it against the tutor's ID document and record it here — a tutor can't be verified without it.
          </p>
        )}
        <div className="flex items-center gap-2 mt-2">
          <input
            type="date"
            value={dobInput}
            onChange={(e) => setDobInput(e.target.value)}
            className="flex-1 bg-slate-100 text-xs font-semibold text-[#0F172A] rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-[#15803D]/20"
            aria-label="Date of birth from ID document"
          />
          <button
            onClick={handleRecordDob}
            disabled={isSavingDob || !dobInput}
            className="bg-[#0F172A] hover:bg-slate-800 disabled:opacity-50 text-white font-bold text-xs px-4 py-2.5 rounded-lg cursor-pointer"
          >
            {tutor.dateOfBirth ? 'Correct it' : 'Record from ID'}
          </button>
        </div>
      </div>

      <div className="bg-white rounded-2xl p-6 border border-slate-200 mb-4">
        <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Subjects Claimed</h2>
        {tutor.subjects.length === 0 ? (
          <p className="text-xs text-slate-500">None added yet.</p>
        ) : (
          <div className="space-y-2">
            {tutor.subjects.map((s, idx) => (
              <div key={idx} className="flex items-center justify-between text-xs">
                <span className="font-semibold text-[#0F172A]">{s.subjectName} ({s.minGradeLevel}–{s.maxGradeLevel})</span>
                <span className="text-slate-400 capitalize">{s.verificationStatus ?? 'pending'}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-white rounded-2xl p-6 border border-slate-200 mb-4">
        <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Documents</h2>
        {tutor.documents.length === 0 ? (
          <p className="text-xs text-slate-500">No documents uploaded yet.</p>
        ) : (
          <div className="space-y-2">
            {tutor.documents.map((doc) => (
              <div key={doc.id} className="p-3 rounded-xl border border-slate-200 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <button
                    type="button"
                    onClick={() => openDocument(doc.documentUrl)}
                    className="text-xs font-bold text-[#0F172A] hover:text-[#15803D] flex items-center gap-1 cursor-pointer"
                  >
                    {DOC_LABELS[doc.documentType] ?? doc.documentType}
                    <ExternalLink className="w-3 h-3" />
                  </button>
                  <span className={`text-[10px] font-bold capitalize ${doc.status === 'verified' ? 'text-emerald-600' : doc.status === 'rejected' ? 'text-rose-600' : 'text-amber-600'}`}>
                    {doc.status ?? 'pending'}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    onClick={() => handleDocReview(doc.id, 'verified')}
                    disabled={busyDocId === doc.id || doc.status === 'verified'}
                    className="p-1.5 rounded-full hover:bg-emerald-50 text-slate-400 hover:text-emerald-600 disabled:opacity-40 cursor-pointer"
                    aria-label="Mark document verified"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleDocReview(doc.id, 'rejected')}
                    disabled={busyDocId === doc.id || doc.status === 'rejected'}
                    className="p-1.5 rounded-full hover:bg-rose-50 text-slate-400 hover:text-rose-600 disabled:opacity-40 cursor-pointer"
                    aria-label="Mark document rejected"
                  >
                    <XCircle className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {error && (
        <div className="flex items-center gap-1.5 mb-3 text-xs text-rose-600 font-semibold">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          {error}
        </div>
      )}

      {tutor.onboardingStatus !== 'verified' && tutor.onboardingStatus !== 'rejected' && (
        <div className="bg-white rounded-2xl p-6 border border-slate-200">
          <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Decision</h2>
          {!canApprove && (
            <p className="text-[11px] text-rose-600 font-semibold mb-3">Record an 18+ date of birth from the tutor's ID before approving.</p>
          )}
          {!allDocsVerified && (
            <p className="text-[11px] text-amber-600 font-semibold mb-3">Not every document is marked verified yet — you can still approve, but double-check.</p>
          )}
          <div className="flex items-center gap-2 mb-3">
            <input
              type="text"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Reason (required to reject)"
              className="flex-1 bg-slate-100 text-xs font-semibold text-[#0F172A] rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-[#15803D]/20"
            />
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleApprove}
              disabled={isFinalizing || !canApprove}
              className="flex-1 bg-[#15803D] hover:bg-[#166534] disabled:opacity-60 text-white font-bold py-2.5 rounded-xl text-sm cursor-pointer"
            >
              Approve Tutor
            </button>
            <button
              onClick={handleReject}
              disabled={isFinalizing}
              className="flex-1 bg-rose-600 hover:bg-rose-700 disabled:opacity-60 text-white font-bold py-2.5 rounded-xl text-sm cursor-pointer"
            >
              Reject
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
