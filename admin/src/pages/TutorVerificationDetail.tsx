import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, Loader2, CheckCircle2, XCircle, ShieldCheck, AlertCircle } from 'lucide-react';
import { fetchTutorVerificationDetail, reviewDocument, approveTutor, rejectTutor, recordDateOfBirth } from '../lib/queries';
import { useAdminAuth } from '../lib/AuthContext';
import { TutorVerificationDetail as TutorDetail, DocumentType } from '../types';
import { supabase } from '../lib/supabaseClient';
import { getErrorMessage } from '../lib/errors';
import { openStoredDocument } from '../lib/documentAccess';
import { fileKindLabel, sortDocumentsOldestFirst, viewStoredDocument } from '../lib/documentViewing';
import { AccessLogNote } from '../components/AccessLogNote';
import { DocumentViewer, type ViewerDocument } from '../components/DocumentViewer';
import { TutorDocumentList } from '../components/TutorDocumentList';
import { DOC_LABELS } from '../lib/documentLabels';
import { DocumentAccessCard } from '../components/DocumentAccessCard';
import { HandOverPanel } from '../components/HandOverPanel';
import { approvalGapsSentence, describeApprovalError } from '../lib/approvalErrors';
import { TutorLevelCard } from '../components/TutorLevelCard';
import { POLICE_MAX_AGE_MONTHS, TRACK_COPY, formatIsoLong, policeExpiresOn, requirementStatuses, todayIsoSAST } from '../lib/tutorOnboarding';

// Whole years from a yyyy-mm-dd date to today.
function ageFrom(isoDate: string): number {
  const [y, m, d] = isoDate.split('-').map(Number);
  const today = new Date();
  let age = today.getFullYear() - y;
  if (today.getMonth() + 1 < m || (today.getMonth() + 1 === m && today.getDate() < d)) age -= 1;
  return age;
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
  // Shown to the tutor next to a document that is not accepted, so they know what to fix (master 7cx).
  const [docReason, setDocReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  // True after a document was opened on a database with no access log yet (see documentAccess.ts).
  const [logNotActive, setLogNotActive] = useState(false);
  // Goes up each time a document is opened, so the access log below shows the new line at once.
  const [accessRefresh, setAccessRefresh] = useState(0);
  // The stored file being looked at in the viewer window (the document row's id); null when it is closed.
  const [viewerKey, setViewerKey] = useState<string | null>(null);

  const load = () => {
    if (!tutorId) return;
    setIsLoading(true);
    fetchTutorVerificationDetail(tutorId).then(setTutor).catch(() => setTutor(null)).finally(() => setIsLoading(false));
  };

  useEffect(load, [tutorId]);

  // Tutor documents live in the private 'tutor-documents' bucket; document_url is the storage path. A stored file is looked at inside
  // the admin app (components/DocumentViewer.tsx, lib/documentViewing.ts): the opening is recorded first (Privacy §7: "we record each
  // time one is opened"), then the five-minute signed link is used once to read the file. Only a row holding a web address (the
  // tutor's own page) still opens in the normal browser, recorded too; that is this function.
  const handleOpenDocument = async (path: string) => {
    setError(null);
    try {
      const opened = await openStoredDocument(supabase, 'tutor-documents', path, { subject: tutorId });
      setLogNotActive(!opened.logged);
      window.open(opened.url, '_blank', 'noopener,noreferrer');
      setAccessRefresh((n) => n + 1);
    } catch (e) {
      setError(getErrorMessage(e, 'Could not open this document.'));
    }
  };

  const handleDocReview = async (docId: string, decision: 'verified' | 'rejected') => {
    if (!tutorId || !adminProfile) return;
    setError(null);
    if (decision === 'rejected' && !docReason.trim()) {
      setError('Say why in the box above the documents before you reject one: the tutor sees it and needs to know what to fix.');
      return;
    }
    setBusyDocId(docId);
    try {
      const reason = decision === 'rejected' ? docReason.trim() : undefined;
      await reviewDocument(docId, tutorId, decision, adminProfile.id, reason, reason);
      if (decision === 'rejected') setDocReason('');
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
      // The database refuses an approval without an ID document and a current police clearance certificate (migration 20261020180000).
      setError(describeApprovalError(e, 'Could not approve this tutor.'));
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

  // Master 7cx: a tutor who went through the "beginner or experienced?" and documents pages cannot be approved until
  // they chose a kind, agreed to Tutorlage keeping their documents and every REQUIRED document is in (a document that
  // was rejected, or a police certificate more than 6 months old, does not count). Test-phase tutors (grandfathered) and
  // tutors with no onboarding record are not held to this.
  const onboarding = tutor.onboarding;
  const newFlow = !!onboarding && !onboarding.grandfathered;
  const docStatuses =
    newFlow && onboarding?.track
      ? requirementStatuses(onboarding.track, tutor.documents.map((d) => ({ documentType: d.documentType, issuedOn: d.issuedOn, status: d.status })))
      : [];
  const missingRequired = docStatuses.filter((s) => s.requirement.required && !s.done);
  const shortProblem = (problem: string | null) =>
    !problem ? '' : /more than \d+ months/.test(problem) ? ' (more than 6 months old)' : /not accepted/.test(problem) ? ' (rejected: needs a new one)' : ` (${problem.replace(/\.$/, '')})`;
  const notReady: string[] = [];
  if (newFlow && !onboarding?.track) notReady.push('This tutor has not chosen beginner or experienced yet.');
  if (newFlow && onboarding?.track && !onboarding.consentedAt) notReady.push('This tutor has not agreed to Tutorlage keeping their documents.');
  if (missingRequired.length > 0) {
    notReady.push(`Still missing: ${missingRequired.map((s) => `${s.requirement.title.toLowerCase()}${shortProblem(s.problem)}`).join('; ')}.`);
  }
  // A tutor with NO onboarding record is held to the same two documents (CEO, 21 Oct 2026): the database now refuses them too, so say so here.
  // (A tutor with a record that is not grandfathered is already covered by "Still missing" above.)
  if (!onboarding) {
    const gaps = approvalGapsSentence(tutor.documents.map((d) => ({ documentType: d.documentType, status: d.status, issuedOn: d.issuedOn })));
    if (gaps) notReady.push(gaps);
  }
  const blockApprove = notReady.length > 0;

  // Oldest first, so two files of one kind are told apart by "1 of 2" and "2 of 2" and the viewer's Next goes in the order they were sent.
  const sortedDocs = sortDocumentsOldestFirst(tutor.documents);
  const storedDocs = sortedDocs.filter((d) => !/^https?:\/\//i.test(d.documentUrl));
  const viewerDocs: ViewerDocument[] = storedDocs.map((d) => ({
    key: d.id,
    title: DOC_LABELS[d.documentType] ?? d.documentType,
    subtitle: `${fileKindLabel(d.documentUrl)}${d.uploadedAt ? ` · uploaded ${new Date(d.uploadedAt).toLocaleString('en-ZA')}` : ''} · ${d.status ?? 'pending'}`,
    open: () => viewStoredDocument(supabase, 'tutor-documents', d.documentUrl, { subject: tutorId }),
  }));

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
        <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Sign-up Documents</h2>
        {!onboarding ? (
          <p className="text-xs text-slate-500">
            No document steps recorded for this tutor. They still need an ID document and a police clearance certificate issued in the last 6 months before
            you can approve them.
          </p>
        ) : onboarding.grandfathered ? (
          <p className="text-xs text-slate-500">
            Test-phase tutor: joined before the document steps, so no documents are required to approve them. They do need a police clearance certificate
            issued in the last 6 months before they can accept requests.
          </p>
        ) : (
          <div className="space-y-3">
            <div className="text-sm">
              <span className="text-slate-500">Kind of tutor: </span>
              <span className="font-bold text-[#0F172A]">{onboarding.track ? TRACK_COPY[onboarding.track].title : 'Has not chosen yet'}</span>
            </div>
            <div className="text-sm">
              <span className="text-slate-500">Agreed to Tutorlage keeping their documents (including ID and police clearance): </span>
              {onboarding.consentedAt ? (
                <span className="font-bold text-[#0F172A]">
                  {new Date(onboarding.consentedAt).toLocaleString('en-ZA')}
                  <span className="font-normal text-slate-400"> · wording {onboarding.consentVersion}</span>
                </span>
              ) : (
                <span className="font-bold text-rose-600">Not yet</span>
              )}
            </div>
            {docStatuses.length > 0 && (
              <ul className="space-y-1.5 pt-1">
                {docStatuses.map(({ requirement, done, problem }) => {
                  const police = tutor.documents
                    .filter((d) => d.documentType === requirement.documentType && d.issuedOn && d.status !== 'rejected')
                    .sort((a, b) => (b.issuedOn ?? '').localeCompare(a.issuedOn ?? ''))[0];
                  return (
                    <li key={requirement.key} className="flex items-start gap-2 text-xs">
                      {done ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                      ) : requirement.required ? (
                        <XCircle className="w-4 h-4 text-rose-500 shrink-0" />
                      ) : (
                        <span className="w-4 h-4 shrink-0 text-center text-slate-300">–</span>
                      )}
                      <span className="min-w-0">
                        <span className={`font-semibold ${done ? 'text-[#0F172A]' : requirement.required ? 'text-rose-700' : 'text-slate-500'}`}>{requirement.title}</span>
                        {!done && requirement.required && <span className="text-rose-600"> — missing</span>}
                        {!done && !requirement.required && <span className="text-slate-400"> — not given</span>}
                        {requirement.needsIssueDate && police?.issuedOn && (
                          <span className="block text-slate-500">
                            Issued {formatIsoLong(police.issuedOn)} · {(policeExpiresOn(police.issuedOn) ?? '') < todayIsoSAST() ? 'expired' : 'counts until'}{' '}
                            {formatIsoLong(policeExpiresOn(police.issuedOn) ?? '')} ({POLICE_MAX_AGE_MONTHS} months)
                          </span>
                        )}
                        {problem && <span className="block text-rose-600">{problem}</span>}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </div>

      <TutorLevelCard tutorId={tutor.id} documents={tutor.documents} />

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
        <AccessLogNote show={logNotActive} />
        {tutor.documents.length > 0 && (
          <input
            type="text"
            value={docReason}
            onChange={(e) => setDocReason(e.target.value)}
            placeholder="Reason shown to the tutor if you reject a document"
            aria-label="Reason for rejecting a document"
            className="w-full bg-slate-100 text-xs font-semibold text-[#0F172A] rounded-lg px-3 py-2.5 mb-3 focus:outline-none focus:ring-2 focus:ring-[#15803D]/20"
          />
        )}
        <TutorDocumentList
          documents={tutor.documents}
          busyDocId={busyDocId}
          onView={(id) => setViewerKey(id)}
          onOpenLink={handleOpenDocument}
          onReview={handleDocReview}
        />
      </div>

      {viewerKey !== null && viewerDocs.length > 0 && (
        <DocumentViewer
          documents={viewerDocs}
          startIndex={Math.max(0, storedDocs.findIndex((d) => d.id === viewerKey))}
          onClose={() => setViewerKey(null)}
          onOpened={(viewed) => {
            setLogNotActive(!viewed.logged);
            setAccessRefresh((n) => n + 1);
          }}
        />
      )}

      {tutorId && <DocumentAccessCard profileId={tutorId} refreshKey={accessRefresh} />}

      {tutorId && (
        <HandOverPanel
          tutor={{ id: tutorId, name: tutor.name, email: tutor.email, phone: tutor.phoneNumber, createdAt: tutor.createdAt }}
          onDone={() => setAccessRefresh((n) => n + 1)}
        />
      )}

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
          {blockApprove && (
            <div className="text-[11px] text-rose-600 font-semibold mb-3">
              Not ready to approve. {notReady.join(' ')}
            </div>
          )}
          {!allDocsVerified && !blockApprove && (
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
              disabled={isFinalizing || !canApprove || blockApprove}
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
