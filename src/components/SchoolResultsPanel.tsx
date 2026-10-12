import React, { useCallback, useEffect, useState } from 'react';
import { AlertCircle, FileText, GraduationCap, Loader2, Plus, Trash2, TrendingUp } from 'lucide-react';
import {
  KIND_LABELS,
  ResultKind,
  SchoolResult,
  SubjectOverview,
  SubjectProgress,
  addDays,
  addSchoolResult,
  deleteSchoolResult,
  fetchSchoolProgress,
  fetchSchoolResults,
  fetchSchoolResultsConsent,
  fetchSchoolResultsOverview,
  formatDay,
  giveSchoolResultsConsent,
  openSchoolResultDocument,
  schoolResultsConsentText,
  todayIso,
  withdrawSchoolResultsConsent,
} from '../lib/schoolResults';
import { getErrorMessage } from '../lib/errors';

// Phase 2 (CEO, 9 Oct): "we need to add the ability for parents to add their students report cards and we
// should prompt them to do if they do have one to give, if not prompt them to add every assesment conducted
// during the period they were with their selected tutor." For each subject the learner has had sessions in,
// the panel asks for a report card covering the tutoring period; if there isn't one, it asks for every test,
// assignment and exam from that period. It also asks for the last report card from before tutoring, which is
// what progress is measured against. Results count towards a tutor's level only after Tutorlage checks them.

const inputClass = 'w-full bg-slate-100 text-[#0F172A] placeholder-slate-400 text-sm font-semibold px-3 py-2.5 rounded-xl border border-transparent focus:outline-none focus:border-[#15803D] focus:bg-white focus:ring-2 focus:ring-[#15803D]/20 transition-all';
const labelClass = 'block text-xs font-bold text-slate-500 mb-1';

const STATUS_TEXT: Record<SchoolResult['status'], string> = {
  pending: 'Waiting for Tutorlage to check',
  verified: 'Checked',
  rejected: 'Not accepted',
};

type Period = 'before' | 'during';
interface FormSpec {
  subjectName: string;
  period: Period | null;
  reportCard: boolean;
  startOn: string | null;
}

interface SchoolResultsPanelProps {
  learnerId: string;
  learnerName: string;
  isSelf?: boolean;
}

export const SchoolResultsPanel: React.FC<SchoolResultsPanelProps> = ({ learnerId, learnerName, isSelf = false }) => {
  const name = isSelf ? 'you' : learnerName;
  const possessive = isSelf ? 'your' : `${learnerName}'s`;
  const [consent, setConsent] = useState<boolean | null>(null);
  const [results, setResults] = useState<SchoolResult[]>([]);
  const [overview, setOverview] = useState<SubjectOverview[]>([]);
  const [progress, setProgress] = useState<SubjectProgress[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [form, setForm] = useState<FormSpec | null>(null);
  // Subjects where the parent said there's no report card: show the "every assessment" prompt instead.
  const [noReportCard, setNoReportCard] = useState<Record<string, boolean>>({});
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const hasConsent = await fetchSchoolResultsConsent(learnerId);
      setConsent(hasConsent);
      const [r, o, p] = await Promise.all([
        hasConsent ? fetchSchoolResults(learnerId) : Promise.resolve([]),
        fetchSchoolResultsOverview(learnerId),
        fetchSchoolProgress(learnerId),
      ]);
      setResults(r);
      setOverview(o);
      setProgress(p);
    } catch (e) {
      setLoadError(getErrorMessage(e, 'Could not load school results.'));
    }
  }, [learnerId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleConsent = async () => {
    setBusy(true);
    setActionError(null);
    try {
      await giveSchoolResultsConsent(learnerId);
      await load();
    } catch (e) {
      setActionError(getErrorMessage(e, 'Could not save your consent.'));
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (id: string) => {
    setActionError(null);
    try {
      await deleteSchoolResult(id);
      await load();
    } catch (e) {
      setActionError(getErrorMessage(e, 'Could not delete that result.'));
    }
  };

  const handleWithdraw = async () => {
    setActionError(null);
    try {
      await withdrawSchoolResultsConsent(learnerId);
      setConfirmWithdraw(false);
      await load();
    } catch (e) {
      setActionError(getErrorMessage(e, 'Could not withdraw consent.'));
    }
  };

  const handleOpen = async (path: string) => {
    try {
      window.open(await openSchoolResultDocument(path), '_blank', 'noopener');
    } catch (e) {
      setActionError(getErrorMessage(e, 'Could not open the document.'));
    }
  };

  const subjects = overview.map((o) => o.subjectName);

  return (
    <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50/60 px-4 py-3">
      <div className="flex items-center gap-2 mb-2">
        <GraduationCap className="w-4 h-4 text-[#15803D]" />
        <h3 className="text-sm font-extrabold text-[#0F172A]">School results (optional)</h3>
      </div>

      {loadError && (
        <p className="flex items-center gap-1.5 text-xs font-semibold text-rose-600 mb-2">
          <AlertCircle className="w-4 h-4" /> {loadError}
          <button onClick={load} className="underline cursor-pointer">Try again</button>
        </p>
      )}
      {actionError && (
        <p className="flex items-center gap-1.5 text-xs font-semibold text-rose-600 mb-2">
          <AlertCircle className="w-4 h-4" /> {actionError}
        </p>
      )}

      {consent === null && !loadError ? (
        <p className="flex items-center text-slate-400 text-xs"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</p>
      ) : consent === false ? (
        <div className="space-y-2">
          <p className="text-xs text-slate-600">
            If {name} {isSelf ? 'have' : 'has'} a report card or marked tests, you can add them here. They show {possessive}{' '}
            progress, and help Tutorlage reward tutors who make a real difference. It's optional: sessions work the
            same without it.
          </p>
          <label className="flex items-start gap-2 text-[11px] text-slate-600">
            <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-0.5" />
            <span>{schoolResultsConsentText(learnerName, isSelf)}</span>
          </label>
          <button
            onClick={handleConsent}
            disabled={!agreed || busy}
            className="text-xs font-bold px-3 py-2 rounded-lg bg-[#15803D] text-white disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
          >
            {busy ? 'Saving…' : 'Add school results'}
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {/* Prompts, one subject at a time */}
          {overview.length === 0 && (
            <p className="text-xs text-slate-500">
              Once {name} {isSelf ? 'have' : 'has'} had a session, we'll ask here for the report cards and marks that
              show progress in that subject.
            </p>
          )}
          {overview.map((o) => (
            <SubjectPrompts
              key={o.subjectName}
              overview={o}
              learnerName={learnerName}
              isSelf={isSelf}
              saidNoReportCard={!!noReportCard[o.subjectName]}
              onNoReportCard={() => setNoReportCard((m) => ({ ...m, [o.subjectName]: true }))}
              onAdd={(spec) => setForm(spec)}
            />
          ))}

          {form ? (
            <ResultForm
              learnerId={learnerId}
              spec={form}
              subjects={subjects}
              possessive={possessive}
              onCancel={() => setForm(null)}
              onSaved={async () => {
                setForm(null);
                await load();
              }}
            />
          ) : (
            subjects.length > 0 && (
              <button
                onClick={() => setForm({ subjectName: subjects[0], period: null, reportCard: false, startOn: null })}
                className="inline-flex items-center gap-1 text-xs font-bold text-[#15803D] hover:underline cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" /> Add another result
              </button>
            )
          )}

          {progress.length > 0 && (
            <div className="space-y-1">
              {progress.map((p) => (
                <p key={p.subjectName} className="flex items-center gap-1.5 text-xs text-slate-700">
                  <TrendingUp className="w-3.5 h-3.5 text-[#15803D]" />
                  <span>
                    <span className="font-bold">{p.subjectName}</span>: {p.upliftPoints >= 0 ? '+' : ''}
                    {p.upliftPoints} percentage points since tutoring started (from checked results)
                  </span>
                </p>
              ))}
            </div>
          )}

          {results.length > 0 && (
            <ul className="divide-y divide-slate-200 border-y border-slate-200">
              {results.map((r) => (
                <li key={r.id} className="py-2 flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div className="min-w-0">
                    <p className="font-bold text-[#0F172A] truncate">
                      {r.subjectName} · {r.title}
                    </p>
                    <p className="text-slate-500">
                      {KIND_LABELS[r.kind]} · {formatDay(r.assessedOn)} · {r.mark} / {r.outOf} ({r.percent}%)
                    </p>
                    <p className={r.status === 'verified' ? 'text-[#15803D] font-semibold' : r.status === 'rejected' ? 'text-rose-600 font-semibold' : 'text-slate-500'}>
                      {STATUS_TEXT[r.status]}
                      {r.status === 'rejected' && r.checkNote ? `: ${r.checkNote}` : ''}
                      {r.status === 'pending' && !r.documentPath ? ' (add a photo or scan so it can count)' : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {r.documentPath && (
                      <button onClick={() => handleOpen(r.documentPath!)} className="inline-flex items-center gap-1 font-bold text-slate-500 hover:text-[#0F172A] cursor-pointer">
                        <FileText className="w-3.5 h-3.5" /> View
                      </button>
                    )}
                    <button onClick={() => handleDelete(r.id)} className="inline-flex items-center gap-1 font-bold text-slate-400 hover:text-rose-600 cursor-pointer">
                      <Trash2 className="w-3.5 h-3.5" /> Delete
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {!confirmWithdraw ? (
            <button onClick={() => setConfirmWithdraw(true)} className="text-[11px] font-bold text-slate-400 hover:text-rose-600 cursor-pointer">
              Withdraw consent and delete all school results
            </button>
          ) : (
            <p className="flex flex-wrap items-center gap-2 text-[11px]">
              <span className="text-slate-600">This deletes every result and document for {name}.</span>
              <button onClick={handleWithdraw} className="font-bold text-rose-600 hover:underline cursor-pointer">Delete all</button>
              <button onClick={() => setConfirmWithdraw(false)} className="font-bold text-slate-500 hover:underline cursor-pointer">Keep</button>
            </p>
          )}
        </div>
      )}
    </div>
  );
};

// The questions for one subject: first the report card covering the tutoring period (or, without one, every
// assessment from it), then the last report card from before tutoring started.
const SubjectPrompts: React.FC<{
  overview: SubjectOverview;
  learnerName: string;
  isSelf: boolean;
  saidNoReportCard: boolean;
  onNoReportCard: () => void;
  onAdd: (spec: FormSpec) => void;
}> = ({ overview: o, learnerName, isSelf, saidNoReportCard, onNoReportCard, onAdd }) => {
  const [skippedBefore, setSkippedBefore] = useState(false);
  const who = isSelf ? 'you' : learnerName;
  const whose = isSelf ? 'your' : `${learnerName}'s`;
  const since = formatDay(o.firstSessionOn);
  const showDuring = !o.hasDuring;
  const showBefore = !o.hasBefore && !skippedBefore;
  if (!showDuring && !showBefore) return null;

  return (
    <div className="rounded-lg bg-white border border-slate-200 px-3 py-2.5 space-y-2 text-xs text-slate-700">
      <p className="font-bold text-[#0F172A]">
        {o.subjectName}: {o.completedSessions} session{o.completedSessions === 1 ? '' : 's'} since {since}
      </p>
      {showDuring && (
        !saidNoReportCard ? (
          <div className="space-y-1.5">
            <p>Do{isSelf ? '' : 'es'} {who} have a report card that covers the time since {since}?</p>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => onAdd({ subjectName: o.subjectName, period: 'during', reportCard: true, startOn: o.firstSessionOn })}
                className="font-bold px-2.5 py-1.5 rounded-lg bg-[#15803D] text-white cursor-pointer"
              >
                Yes, add the report card
              </button>
              <button onClick={onNoReportCard} className="font-bold px-2.5 py-1.5 rounded-lg bg-slate-100 cursor-pointer">
                No report card yet
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-1.5">
            <p>
              Then please add <span className="font-bold">every</span> {o.subjectName} test, assignment or exam {who}{' '}
              {isSelf ? 'have' : 'has'} had since {since}, one at a time, with a photo of the marked work if you have it.
            </p>
            <button
              onClick={() => onAdd({ subjectName: o.subjectName, period: 'during', reportCard: false, startOn: o.firstSessionOn })}
              className="font-bold px-2.5 py-1.5 rounded-lg bg-[#15803D] text-white cursor-pointer"
            >
              Add an assessment
            </button>
          </div>
        )
      )}
      {showBefore && (
        <div className="space-y-1.5">
          <p>
            To measure progress we also need a mark from before tutoring started. Do you have {whose} last report card
            from before {since}, or {o.subjectName} test marks from the 3 months before?
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => onAdd({ subjectName: o.subjectName, period: 'before', reportCard: true, startOn: o.firstSessionOn })}
              className="font-bold px-2.5 py-1.5 rounded-lg bg-slate-100 cursor-pointer"
            >
              Add that report card
            </button>
            <button
              onClick={() => onAdd({ subjectName: o.subjectName, period: 'before', reportCard: false, startOn: o.firstSessionOn })}
              className="font-bold px-2.5 py-1.5 rounded-lg bg-slate-100 cursor-pointer"
            >
              Add an earlier test
            </button>
            <button onClick={() => setSkippedBefore(true)} className="font-bold px-2.5 py-1.5 rounded-lg text-slate-500 cursor-pointer">
              I don't have one
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

const ResultForm: React.FC<{
  learnerId: string;
  spec: FormSpec;
  subjects: string[];
  possessive: string;
  onCancel: () => void;
  onSaved: () => void;
}> = ({ learnerId, spec, subjects, possessive, onCancel, onSaved }) => {
  const [subjectName, setSubjectName] = useState(spec.subjectName);
  const [kind, setKind] = useState<ResultKind>(spec.reportCard ? 'report_card' : 'test');
  const [title, setTitle] = useState('');
  const [assessedOn, setAssessedOn] = useState('');
  const [term, setTerm] = useState('');
  const [mark, setMark] = useState('');
  const [outOf, setOutOf] = useState(spec.reportCard ? '100' : '');
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const today = todayIso();
  const hint = spec.startOn
    ? spec.period === 'before'
      ? `Dated on or before ${formatDay(spec.startOn)}.`
      : `Dated after ${formatDay(spec.startOn)}.`
    : null;
  const maxDate = spec.period === 'before' && spec.startOn ? spec.startOn : today;
  const minDate = spec.period === 'during' && spec.startOn ? addDays(spec.startOn, 1) : addDays(today, -730);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const markNum = Number(mark);
    const outOfNum = Number(outOf);
    if (!title.trim()) return setError('Give it a short name, like "Term 2 report" or "Algebra test".');
    if (!assessedOn) return setError('Enter the date.');
    if (!Number.isFinite(markNum) || !Number.isFinite(outOfNum) || outOfNum <= 0 || markNum < 0 || markNum > outOfNum) {
      return setError('Enter the mark and what it was out of (the mark can\'t be more than the total).');
    }
    if (kind === 'report_card' && !file) {
      return setError('Add a photo or scan of the report card: Tutorlage checks the mark against it.');
    }
    setSaving(true);
    try {
      await addSchoolResult({
        learnerId,
        subjectName,
        kind,
        title: title.trim(),
        assessedOn,
        term: term ? Number(term) : null,
        mark: markNum,
        outOf: outOfNum,
        file,
      });
      onSaved();
    } catch (err) {
      setError(getErrorMessage(err, 'Could not save that result.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="rounded-lg bg-white border border-[#15803D]/40 px-3 py-3 space-y-2.5">
      <p className="text-xs font-bold text-[#0F172A]">
        {kind === 'report_card' ? `Add ${possessive} report card` : 'Add an assessment'}
        {hint ? <span className="font-normal text-slate-500"> · {hint}</span> : null}
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        <div>
          <label className={labelClass} htmlFor="srSubject">Subject</label>
          <select id="srSubject" value={subjectName} onChange={(e) => setSubjectName(e.target.value)} className={inputClass}>
            {subjects.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor="srKind">What is it?</label>
          <select id="srKind" value={kind} onChange={(e) => setKind(e.target.value as ResultKind)} className={inputClass}>
            {(Object.keys(KIND_LABELS) as ResultKind[]).map((k) => <option key={k} value={k}>{KIND_LABELS[k]}</option>)}
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor="srTitle">Name</label>
          <input
            id="srTitle"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={kind === 'report_card' ? 'Term 3 report' : 'Algebra test'}
            maxLength={120}
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass} htmlFor="srDate">Date</label>
          <input id="srDate" type="date" value={assessedOn} min={minDate} max={maxDate} onChange={(e) => setAssessedOn(e.target.value)} className={inputClass} />
        </div>
        {kind === 'report_card' && (
          <div>
            <label className={labelClass} htmlFor="srTerm">Term</label>
            <select id="srTerm" value={term} onChange={(e) => setTerm(e.target.value)} className={inputClass}>
              <option value="">Not sure</option>
              {[1, 2, 3, 4].map((t) => <option key={t} value={t}>Term {t}</option>)}
            </select>
          </div>
        )}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className={labelClass} htmlFor="srMark">{kind === 'report_card' ? `${subjectName} mark` : 'Mark'}</label>
            <input id="srMark" inputMode="decimal" value={mark} onChange={(e) => setMark(e.target.value)} placeholder="65" className={inputClass} />
          </div>
          <div>
            <label className={labelClass} htmlFor="srOutOf">Out of</label>
            <input id="srOutOf" inputMode="decimal" value={outOf} onChange={(e) => setOutOf(e.target.value)} placeholder="100" className={inputClass} />
          </div>
        </div>
      </div>
      <div>
        <label className={labelClass} htmlFor="srFile">
          Photo or scan {kind === 'report_card' ? '(needed)' : '(needed for it to count towards progress)'}
        </label>
        <input
          id="srFile"
          type="file"
          accept="application/pdf,image/jpeg,image/png"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="block w-full text-xs text-slate-600"
        />
        <p className="text-[11px] text-slate-500 mt-1">
          PDF, JPG or PNG, up to 5 MB. Only you and Tutorlage's checkers can see it. Cover other learners' names if
          they're on the page.
        </p>
      </div>
      {error && (
        <p className="flex items-center gap-1.5 text-xs font-semibold text-rose-600">
          <AlertCircle className="w-4 h-4" /> {error}
        </p>
      )}
      <div className="flex gap-2">
        <button type="submit" disabled={saving} className="text-xs font-bold px-3 py-2 rounded-lg bg-[#15803D] text-white disabled:opacity-50 cursor-pointer">
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button type="button" onClick={onCancel} className="text-xs font-bold px-3 py-2 rounded-lg bg-slate-100 cursor-pointer">
          Cancel
        </button>
      </div>
    </form>
  );
};
