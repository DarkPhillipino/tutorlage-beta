import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { SubjectApprovalsBody } from '../components/SubjectApprovalsBody';
import { fetchCriteria, fetchSubjectApprovals, reviewSubject } from '../lib/curriculumQueries';
import { getErrorMessage } from '../lib/errors';
import type { CriterionRow, SubjectApprovalRow } from '../types';

// CEO, 19 Oct 2026: a tutor declares the curriculum and subject; an admin approves it here against the checklist. This page loads the
// subjects and the checklist and hands them to SubjectApprovalsBody (components/SubjectApprovalsBody.tsx), which has the screen.
const ACTIONS = { review: reviewSubject };

export const SubjectApprovals: React.FC = () => {
  const [rows, setRows] = useState<SubjectApprovalRow[] | null>(null);
  const [criteria, setCriteria] = useState<CriterionRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = () => {
    Promise.all([fetchSubjectApprovals(), fetchCriteria()])
      .then(([subjects, checklist]) => {
        setRows(subjects);
        setCriteria(checklist);
        setLoadError(null);
      })
      .catch((e) => setLoadError(getErrorMessage(e, 'Could not load the subjects.')));
  };
  useEffect(load, []);

  if (loadError) {
    return (
      <div className="bg-white rounded-2xl p-8 border border-slate-200 max-w-2xl">
        <p className="text-sm font-bold text-rose-600">{loadError}</p>
      </div>
    );
  }
  if (!rows) {
    return (
      <div className="flex items-center justify-center py-16 text-slate-400">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        <span className="text-sm font-semibold">Loading subjects…</span>
      </div>
    );
  }
  return (
    <SubjectApprovalsBody
      rows={rows}
      criteria={criteria ?? []}
      notSwitchedOn={criteria === null}
      actions={ACTIONS}
      onChanged={load}
      tutorLink={(tutorId, name) => (
        <Link to={`/verification/${tutorId}`} className="font-semibold text-[#15803D] hover:underline">
          {name}
        </Link>
      )}
    />
  );
};
