import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { fetchCriteria, fetchSubjectApprovals, reviewSubject } from '../lib/curriculumQueries';
import { checklistFor, curriculumLabel, isWaiting, statusLabel } from '../lib/subjectApprovals';
import { ReviewForm } from './SubjectApprovalsBody';
import { getErrorMessage } from '../lib/errors';
import { approveSubjectsOnCredential, fetchTeachingCredentialInfo, type TeachingCredentialInfo } from '../lib/teachingCredential';
import type { CriterionRow, SubjectApprovalRow } from '../types';

// The subjects this tutor declared, with the approval checklist right here (burst-readiness, 4 Nov 2026). Before, an admin read the documents
// on this page, then went to the Subject approvals page, found the tutor among everyone's subjects, came back to check a document, and decided
// there. The same checklist and the same database function (admin_review_tutor_subject) are used; only the place changed. The Subject
// approvals page still works as before.
const ACTIONS = { review: reviewSubject };

const STATUS_COLOR: Record<string, string> = {
  pending: 'text-amber-600',
  under_review: 'text-amber-600',
  verified: 'text-emerald-600',
  rejected: 'text-rose-600',
};

export const TutorSubjectsReviewCard: React.FC<{ tutorId: string }> = ({ tutorId }) => {
  const [rows, setRows] = useState<SubjectApprovalRow[] | null>(null);
  const [criteria, setCriteria] = useState<CriterionRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [cred, setCred] = useState<TeachingCredentialInfo | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [credError, setCredError] = useState<string | null>(null);

  const load = () => {
    Promise.all([fetchSubjectApprovals(), fetchCriteria()])
      .then(([all, checklist]) => {
        setRows(all.filter((r) => r.tutorId === tutorId));
        setCriteria(checklist);
        setLoadError(null);
        setOpenId(null);
      })
      .catch((e) => setLoadError(getErrorMessage(e, 'Could not load the subjects.')));
    // The teaching-credential path; shows nothing new if the database update is not applied yet or the question fails.
    fetchTeachingCredentialInfo(tutorId).then(setCred).catch(() => setCred(null));
  };
  useEffect(load, [tutorId]);

  const waiting = rows ? rows.filter((r) => isWaiting(r.status)) : [];
  const approveAll = async () => {
    if (!cred || cred.path.kind !== 'ready') return;
    setBusy(true);
    setCredError(null);
    try {
      const out = await approveSubjectsOnCredential(tutorId, cred.path.credential.id);
      setDone(`${out.approved} subject${out.approved === 1 ? '' : 's'} approved on the strength of: ${out.credential}.`);
      setConfirming(false);
      load();
    } catch (e) {
      setCredError(getErrorMessage(e, 'Could not approve the subjects.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl p-6 border border-slate-200 mb-4" data-section="subjects-review">
      <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Subjects: approve here</h2>
      {loadError ? (
        <p className="text-xs text-rose-600 font-semibold">{loadError}</p>
      ) : !rows ? (
        <div className="flex items-center text-slate-400">
          <Loader2 className="w-4 h-4 animate-spin mr-2" />
          <span className="text-xs font-semibold">Loading subjects…</span>
        </div>
      ) : criteria === null ? (
        <p className="text-xs text-amber-700 font-semibold">The database update for subject approvals has not been applied yet, so subjects cannot be decided here.</p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-slate-500">No subjects declared yet.</p>
      ) : (
        <>
        {cred && cred.available && (
          <div className="mb-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs" data-section="teaching-credential">
            {cred.path.kind === 'ready' ? (
              <>
                <div className="font-bold text-[#0F172A]">Teaching credential on file: {cred.path.credential.label}</div>
                <div className="text-slate-600 mt-0.5">Its document ({cred.path.documentType.replace(/_/g, ' ')}) is verified. A qualified teacher or a student teacher does not need the checklist for each subject.</div>
                {waiting.length > 0 ? (
                  confirming ? (
                    <div className="mt-2 flex items-center gap-2">
                      <span className="text-slate-700">Approve {waiting.length} claimed subject{waiting.length === 1 ? '' : 's'} (rejected ones are left alone)?</span>
                      <button type="button" disabled={busy} onClick={approveAll} className="px-3 py-1.5 rounded-xl bg-emerald-600 text-white font-bold disabled:opacity-50 cursor-pointer">{busy ? 'Approving…' : 'Yes, approve'}</button>
                      <button type="button" disabled={busy} onClick={() => setConfirming(false)} className="font-bold text-slate-600 hover:underline cursor-pointer">Cancel</button>
                    </div>
                  ) : (
                    <button type="button" onClick={() => { setDone(null); setConfirming(true); }} className="mt-2 px-3 py-1.5 rounded-xl bg-[#0F172A] text-white font-bold cursor-pointer">Approve all claimed subjects on the strength of this credential</button>
                  )
                ) : (
                  <div className="mt-1 text-slate-500">No claimed subject is waiting.</div>
                )}
              </>
            ) : cred.path.kind === 'document_not_verified' ? (
              <div className="text-amber-700 font-semibold">A teaching credential ({cred.path.credential.label}) is recorded, but its document is not marked verified yet. Check the document above first; then the one-button approval appears here. Until then, use the checklist for each subject.</div>
            ) : (
              <div className="text-slate-600">No teaching credential recorded. For a qualified teacher or a student teacher: verify their qualification or proof of enrolment above, record it as a credential on the Level card, and the one-button approval appears here. Anyone else: use the checklist for each subject.</div>
            )}
            {done && <div className="mt-2 text-emerald-700 font-semibold">{done}</div>}
            {credError && <div className="mt-2 text-rose-600 font-semibold">{credError}</div>}
          </div>
        )}
        <div className="divide-y divide-slate-100">
          {rows.map((r) => (
            <div key={r.id} className="py-3 first:pt-0 last:pb-0">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 text-xs">
                  <span className="font-bold text-[#0F172A]">{r.subjectName}</span>{' '}
                  <span className="text-slate-500">· {curriculumLabel(r.curriculum)} · {r.minGradeLevel} to {r.maxGradeLevel}</span>
                  {r.status !== 'pending' && r.status !== 'under_review' && r.reviewNote && <div className="text-slate-600 mt-0.5">Note: {r.reviewNote}</div>}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={`text-[10px] font-bold ${STATUS_COLOR[r.status] ?? 'text-slate-500'}`}>{statusLabel(r.status)}</span>
                  <button type="button" onClick={() => setOpenId(openId === r.id ? null : r.id)} className="text-xs font-bold text-[#0F172A] hover:underline cursor-pointer">
                    {openId === r.id ? 'Close' : isWaiting(r.status) ? 'Review' : 'Review again'}
                  </button>
                </div>
              </div>
              {openId === r.id && <ReviewForm row={r} checklist={checklistFor(criteria, r.curriculum)} actions={ACTIONS} onChanged={load} />}
            </div>
          ))}
        </div>
        </>
      )}
    </div>
  );
};
