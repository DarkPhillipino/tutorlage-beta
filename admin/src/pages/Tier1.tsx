import React, { useCallback, useEffect, useState } from 'react';
import { BarChart3, CheckCircle2, FileText, GraduationCap, Loader2, Search, Users, XCircle } from 'lucide-react';
import {
  ItemAnalysisRow,
  Tier1RecordForCheck,
  Tier1TrainingSummary,
  checkTier1Record,
  fetchItemAnalysis,
  fetchTier1RecordsForCheck,
  fetchTier1SubjectNames,
  fetchTutorTier1Training,
  recordTier1Signoff,
  signedTutorDocumentUrl,
} from '../lib/tier1';
import { fetchUsers } from '../lib/queries';
import { AdminUserRow } from '../types';
import { getErrorMessage } from '../lib/errors';

// Phase 2: the Tier 1 route (master backlog item 7). Three jobs for admins: check the 70% records, record a
// trainer's sign-off for the live Modules 2 and 5, and watch how each test item performs (the trial's item
// analysis, validation protocol stage 2).

const input = 'w-full bg-slate-100 text-sm font-semibold text-[#0F172A] rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-[#15803D]/20';

export const Tier1: React.FC = () => {
  const [tab, setTab] = useState<'records' | 'signoff' | 'items'>('records');
  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <GraduationCap className="w-5 h-5 text-[#15803D]" />
        <h1 className="text-2xl font-extrabold text-[#0F172A]">Tier 1 route</h1>
      </div>
      <p className="text-sm text-slate-500 mb-5 max-w-2xl">
        Tutors without a teaching qualification qualify per subject: a checked record of 70%+, the training, and the
        subject's test. The test items are designed, not validated: don't describe them as a validated test.
      </p>
      <div className="flex gap-2 mb-4">
        {([['records', '70% records'], ['signoff', 'Trainer sign-offs'], ['items', 'Item analysis']] as const).map(([t, label]) => (
          <button key={t} onClick={() => setTab(t)}
            className={`text-xs font-bold px-3 py-1.5 rounded-lg cursor-pointer ${tab === t ? 'bg-[#0F172A] text-white' : 'bg-white border border-slate-200 text-slate-600'}`}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'records' && <Records />}
      {tab === 'signoff' && <Signoff />}
      {tab === 'items' && <Items />}
    </div>
  );
};

const Records: React.FC = () => {
  const [rows, setRows] = useState<Tier1RecordForCheck[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    setRows(null);
    fetchTier1RecordsForCheck().then(setRows).catch((e) => setError(getErrorMessage(e, 'Could not load records.')));
  }, []);
  useEffect(load, [load]);

  const decide = async (row: Tier1RecordForCheck, verdict: 'verified' | 'rejected') => {
    setBusy(row.id);
    setError(null);
    try {
      await checkTier1Record(row.id, verdict, notes[row.id] ?? '');
      load();
    } catch (e) {
      setError(getErrorMessage(e, 'Could not save the check.'));
    } finally {
      setBusy(null);
    }
  };

  if (rows === null && !error) return <div className="flex items-center text-slate-400 text-sm"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>;
  return (
    <div>
      {error && <p className="text-sm text-rose-600 font-semibold mb-3">{error}</p>}
      {rows && rows.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center">
          <CheckCircle2 className="w-8 h-8 text-slate-300 mx-auto mb-2" />
          <p className="font-bold text-[#0F172A]">Nothing waiting</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-100">
          {(rows ?? []).map((r) => (
            <div key={r.id} className="p-4 flex flex-wrap gap-4 justify-between">
              <div className="text-sm space-y-0.5">
                <p className="font-bold text-[#0F172A]">{r.tutorName} · {r.subjectName}</p>
                <p className="text-slate-600">Says {r.markPct}% ({r.source === 'matric' ? 'matric results' : r.source === 'university' ? 'university record' : 'other record'})</p>
                <p className="text-xs text-slate-500">Check the document shows this subject and this mark, and that the name matches the tutor's ID.</p>
                <button onClick={async () => window.open(await signedTutorDocumentUrl(r.documentPath), '_blank', 'noopener')}
                  className="inline-flex items-center gap-1 text-xs font-bold text-[#15803D] hover:underline cursor-pointer">
                  <FileText className="w-3.5 h-3.5" /> Open the document
                </button>
              </div>
              <div className="w-full sm:w-72 space-y-2">
                <input value={notes[r.id] ?? ''} onChange={(e) => setNotes((n) => ({ ...n, [r.id]: e.target.value }))}
                  placeholder="Note (needed if not accepted; the tutor sees it)" className={`${input} text-xs`} />
                <div className="flex gap-2">
                  <button onClick={() => decide(r, 'verified')} disabled={busy === r.id}
                    className="flex-1 inline-flex items-center justify-center gap-1 text-xs font-bold px-3 py-2 rounded-lg bg-[#15803D] text-white disabled:opacity-50 cursor-pointer">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Accept
                  </button>
                  <button onClick={() => decide(r, 'rejected')} disabled={busy === r.id}
                    className="flex-1 inline-flex items-center justify-center gap-1 text-xs font-bold px-3 py-2 rounded-lg bg-rose-50 text-rose-700 disabled:opacity-50 cursor-pointer">
                    <XCircle className="w-3.5 h-3.5" /> Not accepted
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const Signoff: React.FC = () => {
  const [term, setTerm] = useState('');
  const [found, setFound] = useState<AdminUserRow[] | null>(null);
  const [tutor, setTutor] = useState<AdminUserRow | null>(null);
  const [training, setTraining] = useState<Tier1TrainingSummary[]>([]);
  const [module, setModule] = useState<2 | 5>(2);
  const [trainer, setTrainer] = useState('');
  const [result, setResult] = useState<'pass' | 'not_yet'>('pass');
  const [missing, setMissing] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const search = async () => {
    setError(null);
    try {
      setFound((await fetchUsers(term)).filter((u) => u.role === 'tutor'));
    } catch (e) {
      setError(getErrorMessage(e, 'Search failed.'));
    }
  };

  const choose = async (u: AdminUserRow) => {
    setTutor(u);
    setMessage(null);
    try {
      setTraining(await fetchTutorTier1Training(u.id));
    } catch (e) {
      setError(getErrorMessage(e, 'Could not load their training.'));
    }
  };

  const save = async () => {
    if (!tutor) return;
    setError(null);
    try {
      await recordTier1Signoff(tutor.id, module, trainer, result, missing);
      setMessage(`Recorded Module ${module}: ${result === 'pass' ? 'pass' : 'not yet'}.`);
      setTraining(await fetchTutorTier1Training(tutor.id));
    } catch (e) {
      setError(getErrorMessage(e, 'Could not record the sign-off.'));
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4 max-w-2xl">
      <p className="text-sm text-slate-600">
        After a trainer runs the live Module 2 or 5 with a tutor (trainer guide), record their verdict here. "Not yet"
        needs the checklist items still missing; the tutor sees them.
      </p>
      <div className="flex gap-2">
        <input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Tutor's name or email" className={input} />
        <button onClick={search} className="inline-flex items-center gap-1 text-xs font-bold px-3 rounded-xl bg-[#0F172A] text-white cursor-pointer">
          <Search className="w-3.5 h-3.5" /> Find
        </button>
      </div>
      {found && (
        <ul className="divide-y divide-slate-100 border border-slate-200 rounded-xl">
          {found.length === 0 && <li className="p-3 text-sm text-slate-500">No tutors found.</li>}
          {found.map((u) => (
            <li key={u.id}>
              <button onClick={() => choose(u)} className={`w-full text-left p-3 text-sm cursor-pointer ${tutor?.id === u.id ? 'bg-emerald-50' : ''}`}>
                <span className="font-bold text-[#0F172A]">{u.fullName}</span> <span className="text-slate-500">{u.email}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {tutor && (
        <div className="space-y-3">
          <p className="flex items-center gap-1.5 text-sm font-bold text-[#0F172A]"><Users className="w-4 h-4" /> {tutor.fullName}</p>
          <ul className="text-xs text-slate-600 space-y-0.5">
            {training.length === 0 && <li>No training recorded yet.</li>}
            {training.map((t) => (
              <li key={t.module}>Module {t.module}: {t.result}{t.trainerName ? ` (${t.trainerName})` : ''}{t.missingItems ? `: ${t.missingItems}` : ''}</li>
            ))}
          </ul>
          <div className="grid grid-cols-2 gap-2">
            <select value={module} onChange={(e) => setModule(Number(e.target.value) as 2 | 5)} className={input}>
              <option value={2}>Module 2: diagnosing a misconception</option>
              <option value={5}>Module 5: a struggling learner</option>
            </select>
            <select value={result} onChange={(e) => setResult(e.target.value as 'pass' | 'not_yet')} className={input}>
              <option value="pass">Pass</option>
              <option value="not_yet">Not yet</option>
            </select>
          </div>
          <input value={trainer} onChange={(e) => setTrainer(e.target.value)} placeholder="Trainer's name" className={input} />
          {result === 'not_yet' && (
            <textarea value={missing} onChange={(e) => setMissing(e.target.value)} rows={2} placeholder="Checklist items still missing" className={input} />
          )}
          <button onClick={save} className="text-sm font-bold px-4 py-2 rounded-xl bg-[#15803D] text-white cursor-pointer">Record sign-off</button>
          {message && <p className="text-xs font-semibold text-[#15803D]">{message}</p>}
        </div>
      )}
      {error && <p className="text-sm text-rose-600 font-semibold">{error}</p>}
    </div>
  );
};

const Items: React.FC = () => {
  const [subjects, setSubjects] = useState<string[]>([]);
  const [subject, setSubject] = useState('Mathematics');
  const [rows, setRows] = useState<ItemAnalysisRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchTier1SubjectNames().then(setSubjects).catch((e) => setError(getErrorMessage(e, 'Could not load subjects.')));
  }, []);
  useEffect(() => {
    setRows(null);
    fetchItemAnalysis(subject).then(setRows).catch((e) => setError(getErrorMessage(e, 'Could not load the analysis.')));
  }, [subject]);

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600 max-w-2xl">
        How often each question was answered right. Read it with the validation protocol's flags: a "should pass"
        group under 50% on an item, or almost everyone right before training, means the item needs another look.
      </p>
      <select value={subject} onChange={(e) => setSubject(e.target.value)} className={`${input} max-w-xs`}>
        {subjects.map((s) => <option key={s} value={s}>{s}</option>)}
      </select>
      {error && <p className="text-sm text-rose-600 font-semibold">{error}</p>}
      {rows === null ? (
        <div className="flex items-center text-slate-400 text-sm"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
      ) : (
        <table className="w-full bg-white rounded-2xl border border-slate-200 text-sm overflow-hidden">
          <thead className="bg-slate-50 text-xs text-slate-500">
            <tr><th className="text-left p-3">Item</th><th className="p-3">Attempts</th><th className="p-3">Diagnosis right</th><th className="p-3">Correction right</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => (
              <tr key={r.itemId}>
                <td className="p-3"><span className="font-bold">{r.itemId}</span> {r.title}</td>
                <td className="p-3 text-center">{r.attempts}</td>
                <td className="p-3 text-center">{r.q1RightPct === null ? '–' : `${r.q1RightPct}%`}</td>
                <td className="p-3 text-center">{r.q2RightPct === null ? '–' : `${r.q2RightPct}%`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="flex items-center gap-1 text-xs text-slate-400"><BarChart3 className="w-3.5 h-3.5" /> Counts every handed-in attempt, including late ones.</p>
    </div>
  );
};
