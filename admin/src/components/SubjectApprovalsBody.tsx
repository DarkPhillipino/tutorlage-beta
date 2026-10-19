import React, { useState } from 'react';
import { BookCheck, CheckCircle2, XCircle, Clock } from 'lucide-react';
import type { CriterionRow, SubjectApprovalRow } from '../types';
import {
  approvalProblem,
  checklistFor,
  curriculumLabel,
  isWaiting,
  orderApprovals,
  rejectionProblem,
  statusLabel,
  tickedForSending,
} from '../lib/subjectApprovals';
import { getErrorMessage } from '../lib/errors';

// The Subject approvals screen (CEO, 19 Oct 2026): every subject a tutor has declared, the ones waiting first. An admin reads the
// tutor's documents on their page (the name is a link), ticks the checklist for the subject's curriculum, writes a note and
// approves or does not approve. The tutor gets no notice (CEO, 19 Oct 2026); the database function writes the audit row and the private review.

export interface SubjectApprovalActions {
  review: (competencyId: string, decision: 'approve' | 'reject', reason: string, criteria: string[]) => Promise<void>;
}

interface Props {
  rows: SubjectApprovalRow[];
  criteria: CriterionRow[];
  actions: SubjectApprovalActions;
  onChanged: () => void;
  // The tutor's name as a link to their page (the page passes a router Link; a test passes a plain anchor).
  tutorLink: (tutorId: string, name: string) => React.ReactNode;
  // The database update (migration 20261019090000) is not applied yet: the checklist cannot be read, nothing can be decided.
  notSwitchedOn?: boolean;
}

const STATUS_STYLE: Record<string, string> = {
  pending: 'bg-amber-50 text-amber-700 border-amber-200',
  under_review: 'bg-amber-50 text-amber-700 border-amber-200',
  verified: 'bg-emerald-50 text-[#15803D] border-emerald-200',
  rejected: 'bg-rose-50 text-rose-700 border-rose-200',
};

export const ReviewForm: React.FC<{
  row: SubjectApprovalRow;
  checklist: CriterionRow[];
  actions: SubjectApprovalActions;
  onChanged: () => void;
}> = ({ row, checklist, actions, onChanged }) => {
  const [ticked, setTicked] = useState<string[]>(row.criteriaMet);
  const [note, setNote] = useState(row.reviewNote ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (id: string) => setTicked((t) => (t.includes(id) ? t.filter((x) => x !== id) : [...t, id]));

  const decide = async (decision: 'approve' | 'reject') => {
    const problem = decision === 'approve' ? approvalProblem({ checklist, ticked, note }) : rejectionProblem(note);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await actions.review(row.id, decision, note.trim(), decision === 'approve' ? tickedForSending(checklist, ticked) : []);
      onChanged();
    } catch (e) {
      setError(getErrorMessage(e, 'Could not save the decision.'));
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 pt-3 border-t border-slate-100 space-y-3">
      {checklist.length === 0 ? (
        <p className="text-xs text-slate-500">
          There is no checklist for {curriculumLabel(row.curriculum)} yet (add one under Curricula). Write a note saying what you checked.
        </p>
      ) : (
        <div className="space-y-1.5">
          {checklist.map((c) => (
            <label key={c.id} className="flex items-start gap-2 text-xs text-[#0F172A] cursor-pointer">
              <input type="checkbox" checked={ticked.includes(c.id)} onChange={() => toggle(c.id)} className="mt-0.5" />
              <span>
                {c.text}
                {!c.required && <span className="text-slate-400"> (optional)</span>}
              </span>
            </label>
          ))}
        </div>
      )}
      <div>
        <label className="text-xs font-bold text-[#0F172A] block mb-1">Note (needed to not approve; shown to the tutor)</label>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          className="w-full bg-slate-100 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-[#15803D]/20"
        />
      </div>
      {error && <p className="text-xs font-semibold text-rose-600">{error}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => decide('approve')}
          className="px-4 py-2 bg-[#15803D] hover:bg-[#166534] disabled:opacity-60 text-white text-xs font-bold rounded-xl cursor-pointer"
        >
          Approve
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => decide('reject')}
          className="px-4 py-2 bg-white border border-rose-300 text-rose-700 hover:bg-rose-50 disabled:opacity-60 text-xs font-bold rounded-xl cursor-pointer"
        >
          Do not approve
        </button>
      </div>
    </div>
  );
};

const Row: React.FC<{
  row: SubjectApprovalRow;
  criteria: CriterionRow[];
  actions: SubjectApprovalActions;
  onChanged: () => void;
  tutorLink: Props['tutorLink'];
}> = ({ row, criteria, actions, onChanged, tutorLink }) => {
  const [open, setOpen] = useState(false);
  const checklist = checklistFor(criteria, row.curriculum);
  return (
    <div className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-bold text-[#0F172A]">
            {row.subjectName}{' '}
            <span className="font-semibold text-slate-500">
              · {curriculumLabel(row.curriculum)} · {row.minGradeLevel} to {row.maxGradeLevel}
            </span>
          </div>
          <div className="text-xs text-slate-500 mt-0.5">
            {tutorLink(row.tutorId, row.tutorName)} (documents are on their page)
          </div>
          {row.status !== 'pending' && row.status !== 'under_review' && row.reviewNote && (
            <div className="text-xs text-slate-600 mt-1">Note: {row.reviewNote}</div>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={`inline-block text-[10px] font-bold px-2 py-0.5 rounded-full border ${STATUS_STYLE[row.status]}`}>
            {statusLabel(row.status)}
          </span>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="text-xs font-bold text-[#0F172A] hover:underline cursor-pointer"
          >
            {open ? 'Close' : isWaiting(row.status) ? 'Review' : 'Review again'}
          </button>
        </div>
      </div>
      {open && <ReviewForm row={row} checklist={checklist} actions={actions} onChanged={onChanged} />}
    </div>
  );
};

export const SubjectApprovalsBody: React.FC<Props> = ({ rows, criteria, actions, onChanged, tutorLink, notSwitchedOn = false }) => {
  const ordered = orderApprovals(rows);
  const waiting = ordered.filter((r) => isWaiting(r.status));
  const rejected = ordered.filter((r) => r.status === 'rejected');
  const approved = ordered.filter((r) => r.status === 'verified');

  const section = (title: string, icon: React.ReactNode, list: SubjectApprovalRow[], empty: string) => (
    <section className="mb-8" aria-label={title}>
      <h2 className="text-sm font-extrabold text-[#0F172A] mb-2 flex items-center gap-1.5">
        {icon}
        {title} <span className="text-slate-400 font-semibold">({list.length})</span>
      </h2>
      {list.length === 0 ? (
        <div className="bg-white rounded-2xl p-6 border border-slate-200 text-xs text-slate-500">{empty}</div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-100 overflow-hidden">
          {list.map((r) => (
            <Row key={r.id} row={r} criteria={criteria} actions={actions} onChanged={onChanged} tutorLink={tutorLink} />
          ))}
        </div>
      )}
    </section>
  );

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-extrabold text-[#0F172A] mb-1 flex items-center gap-2">
        <BookCheck className="w-6 h-6" />
        Subject approvals
      </h1>
      <p className="text-sm text-slate-500 mb-6">
        A tutor only matches learners for a subject once you approve it. Check their documents, tick the checklist for the curriculum, then approve or say why not.
      </p>
      {notSwitchedOn && (
        <div className="mb-6 bg-amber-50 border border-amber-200 rounded-2xl p-4 text-xs font-semibold text-amber-800">
          The database update for subject approvals has not been applied yet, so subjects cannot be decided here. Subjects listed are the approved ones.
        </div>
      )}
      {section('Waiting for approval', <Clock className="w-4 h-4 text-amber-600" />, waiting, 'Nothing is waiting.')}
      {section('Not approved', <XCircle className="w-4 h-4 text-rose-600" />, rejected, 'No subject has been turned down.')}
      {section('Approved', <CheckCircle2 className="w-4 h-4 text-[#15803D]" />, approved, 'No subject has been approved yet.')}
    </div>
  );
};
