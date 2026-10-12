import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, FileText, GraduationCap, Loader2, XCircle } from 'lucide-react';
import { SchoolResultForCheck, checkSchoolResult, fetchSchoolResultsForCheck, signedSchoolResultUrl } from '../lib/schoolResults';
import { getErrorMessage } from '../lib/errors';

// Phase 2: the check that decides whether a parent's report-card or assessment mark counts towards a tutor's
// level (CEO, 9 Oct: "After Tutorlage checks"). Open the document, compare the subject, date and mark with
// what was entered, then accept or say why not (the parent sees the reason).

const KIND_LABELS: Record<string, string> = {
  report_card: 'Report card', test: 'Test', assignment: 'Assignment', exam: 'Exam', other: 'Other',
};

export const SchoolResults: React.FC = () => {
  const [tab, setTab] = useState<'pending' | 'verified' | 'rejected'>('pending');
  const [rows, setRows] = useState<SchoolResultForCheck[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(() => {
    setRows(null);
    setError(null);
    fetchSchoolResultsForCheck(tab)
      .then(setRows)
      .catch((e) => setError(getErrorMessage(e, 'Could not load school results.')));
  }, [tab]);

  useEffect(load, [load]);

  const decide = async (row: SchoolResultForCheck, verdict: 'verified' | 'rejected') => {
    setBusyId(row.id);
    setError(null);
    try {
      await checkSchoolResult(row.id, verdict, notes[row.id] ?? '');
      load();
    } catch (e) {
      setError(getErrorMessage(e, 'Could not save the check.'));
    } finally {
      setBusyId(null);
    }
  };

  const openDocument = async (path: string) => {
    try {
      window.open(await signedSchoolResultUrl(path), '_blank', 'noopener');
    } catch (e) {
      setError(getErrorMessage(e, 'Could not open the document.'));
    }
  };

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <GraduationCap className="w-5 h-5 text-[#15803D]" />
        <h1 className="text-2xl font-extrabold text-[#0F172A]">School results</h1>
      </div>
      <p className="text-sm text-slate-500 mb-5 max-w-2xl">
        Marks parents (or adult learners) added. A mark counts towards a tutor's grade uplift only once it's checked
        here. Compare the subject, date and mark with the document. A result without a document can't be accepted.
      </p>

      <div className="flex gap-2 mb-4">
        {(['pending', 'verified', 'rejected'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`text-xs font-bold px-3 py-1.5 rounded-lg cursor-pointer ${tab === t ? 'bg-[#0F172A] text-white' : 'bg-white border border-slate-200 text-slate-600'}`}
          >
            {t === 'pending' ? 'Waiting' : t === 'verified' ? 'Accepted' : 'Not accepted'}
          </button>
        ))}
      </div>

      {error && <p className="text-sm text-rose-600 font-semibold mb-3">{error}</p>}

      {rows === null && !error ? (
        <div className="flex items-center text-slate-400 text-sm"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
      ) : rows && rows.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center">
          <CheckCircle2 className="w-8 h-8 text-slate-300 mx-auto mb-2" />
          <p className="font-bold text-[#0F172A]">Nothing here</p>
          <p className="text-sm text-slate-500">{tab === 'pending' ? 'No results are waiting for a check.' : 'None yet.'}</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-100">
          {(rows ?? []).map((r) => (
            <div key={r.id} className="p-4 flex flex-wrap gap-4 items-start justify-between">
              <div className="min-w-0 space-y-0.5 text-sm">
                <p className="font-bold text-[#0F172A]">{r.learnerName} · {r.subjectName}</p>
                <p className="text-slate-600">
                  {KIND_LABELS[r.kind] ?? r.kind}: {r.title} · {r.assessedOn}{r.term ? ` · Term ${r.term}` : ''}
                </p>
                <p className="text-slate-900 font-semibold">{r.mark} / {r.outOf} = {r.percent}%</p>
                {r.checkNote && <p className="text-xs text-slate-500">Note: {r.checkNote}</p>}
                {r.documentPath ? (
                  <button onClick={() => openDocument(r.documentPath!)} className="inline-flex items-center gap-1 text-xs font-bold text-[#15803D] hover:underline cursor-pointer">
                    <FileText className="w-3.5 h-3.5" /> Open the document
                  </button>
                ) : (
                  <p className="text-xs text-amber-700 font-semibold">No document: can't be accepted.</p>
                )}
              </div>
              {tab === 'pending' && (
                <div className="w-full sm:w-72 space-y-2">
                  <input
                    value={notes[r.id] ?? ''}
                    onChange={(e) => setNotes((n) => ({ ...n, [r.id]: e.target.value }))}
                    placeholder="Note (needed if not accepted; the parent sees it)"
                    className="w-full bg-slate-100 text-xs font-semibold text-[#0F172A] rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#15803D]/20"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => decide(r, 'verified')}
                      disabled={busyId === r.id || !r.documentPath}
                      className="flex-1 inline-flex items-center justify-center gap-1 text-xs font-bold px-3 py-2 rounded-lg bg-[#15803D] text-white disabled:opacity-50 cursor-pointer"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" /> Accept
                    </button>
                    <button
                      onClick={() => decide(r, 'rejected')}
                      disabled={busyId === r.id}
                      className="flex-1 inline-flex items-center justify-center gap-1 text-xs font-bold px-3 py-2 rounded-lg bg-rose-50 text-rose-700 disabled:opacity-50 cursor-pointer"
                    >
                      <XCircle className="w-3.5 h-3.5" /> Not accepted
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
