import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { fetchCriteria, fetchSubjectApprovals, reviewSubject } from '../lib/curriculumQueries';
import { checklistFor, curriculumLabel, isWaiting, statusLabel } from '../lib/subjectApprovals';
import { ReviewForm } from './SubjectApprovalsBody';
import { getErrorMessage } from '../lib/errors';
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

  const load = () => {
    Promise.all([fetchSubjectApprovals(), fetchCriteria()])
      .then(([all, checklist]) => {
        setRows(all.filter((r) => r.tutorId === tutorId));
        setCriteria(checklist);
        setLoadError(null);
        setOpenId(null);
      })
      .catch((e) => setLoadError(getErrorMessage(e, 'Could not load the subjects.')));
  };
  useEffect(load, [tutorId]);

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
      )}
    </div>
  );
};
