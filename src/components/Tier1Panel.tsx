import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, BookOpen, CheckCircle2, Circle, ClipboardCheck, GraduationCap, Loader2, Timer, Upload, Users } from 'lucide-react';
import {
  ScenarioQuestion,
  Tier1Module,
  Tier1Result,
  Tier1Status,
  Tier1Subject,
  Tier1Test,
  Tier1TrainingRow,
  completeTier1Module,
  fetchModuleCheck,
  fetchMyTier1Training,
  fetchTier1Modules,
  fetchTier1Status,
  fetchTier1Subjects,
  startTier1Test,
  submitAcademicRecord,
  submitModuleCheck,
  submitTier1Test,
} from '../lib/tier1';
import { getErrorMessage } from '../lib/errors';

// The Tier 1 route for tutors without a teaching qualification (master backlog item 7; the CEO, 9 Oct: "build
// the tier 1 tutor pipeline"). Three gates per subject, all decided by the database: a checked record of 70%+
// in the subject, the seven training modules, and the diagnostic test. The test is honest about its status:
// it's designed by Tutorlage's educators and still being trialled, so nothing here calls it validated.

const card = 'bg-white rounded-2xl p-4 border border-slate-200';
const inputClass = 'w-full bg-slate-100 text-[#0F172A] text-sm font-semibold px-3 py-2.5 rounded-xl border border-transparent focus:outline-none focus:border-[#15803D] focus:bg-white';

// The items use **bold** for their labels; show that without rendering any HTML from the database.
const Rich: React.FC<{ text: string }> = ({ text }) => (
  <>
    {text.split('\n').map((line, i) => (
      <p key={i} className="mb-1">
        {line.split(/(\*\*[^*]+\*\*)/g).map((part, j) =>
          part.startsWith('**') && part.endsWith('**') ? <strong key={j}>{part.slice(2, -2)}</strong> : <React.Fragment key={j}>{part}</React.Fragment>
        )}
      </p>
    ))}
  </>
);

export const Tier1Panel: React.FC<{ tutorId: string }> = ({ tutorId }) => {
  const [subjects, setSubjects] = useState<Tier1Subject[]>([]);
  const [modules, setModules] = useState<Tier1Module[]>([]);
  const [training, setTraining] = useState<Tier1TrainingRow[]>([]);
  const [subject, setSubject] = useState<string>('');
  const [status, setStatus] = useState<Tier1Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [test, setTest] = useState<Tier1Test | null>(null);
  const [result, setResult] = useState<Tier1Result | null>(null);

  useEffect(() => {
    Promise.all([fetchTier1Subjects(), fetchTier1Modules(), fetchMyTier1Training(tutorId)])
      .then(([s, m, t]) => {
        setSubjects(s.filter((x) => x.status !== 'closed'));
        setModules(m);
        setTraining(t);
      })
      .catch((e) => setError(getErrorMessage(e, 'Could not load the Tier 1 route.')));
  }, [tutorId]);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      setTraining(await fetchMyTier1Training(tutorId));
      if (subject) setStatus(await fetchTier1Status(subject));
    } catch (e) {
      setError(getErrorMessage(e, 'Could not refresh.'));
    }
  }, [tutorId, subject]);

  useEffect(() => {
    setStatus(null);
    setResult(null);
    if (subject) fetchTier1Status(subject).then(setStatus).catch((e) => setError(getErrorMessage(e, 'Could not load this subject.')));
  }, [subject]);

  if (test) {
    return (
      <TestScreen
        test={test}
        onDone={async (r) => {
          setTest(null);
          setResult(r);
          await refresh();
        }}
      />
    );
  }

  return (
    <div>
      <h4 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
        <GraduationCap className="w-3.5 h-3.5" /> Tier 1 route: tutor a subject you got 70%+ in
      </h4>
      <div className={`${card} space-y-4`}>
        <p className="text-xs text-slate-600">
          No teaching qualification yet? You can tutor a school subject once you've shown at least 70% in it, finished
          Tutorlage's training, and passed the subject's test on finding and fixing the misunderstandings behind wrong
          answers. The test is written by our educators and is still being trialled with real teachers.
        </p>
        {error && <p className="flex items-center gap-1.5 text-xs font-semibold text-rose-600"><AlertCircle className="w-4 h-4" /> {error}</p>}

        <div>
          <label className="block text-xs font-bold text-slate-500 mb-1" htmlFor="t1Subject">Subject</label>
          <select id="t1Subject" value={subject} onChange={(e) => setSubject(e.target.value)} className={inputClass}>
            <option value="">Choose a subject…</option>
            {subjects.map((s) => <option key={s.subjectName} value={s.subjectName}>{s.subjectName}</option>)}
          </select>
        </div>

        {subject && !status && <p className="flex items-center text-xs text-slate-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</p>}

        {status && (
          <>
            <AcademicStep tutorId={tutorId} status={status} onSaved={refresh} />
            <TrainingStep modules={modules} training={training} onChanged={refresh} />
            <TestStep status={status} result={result} onStart={async () => {
              setError(null);
              try {
                setTest(await startTier1Test(subject));
              } catch (e) {
                setError(getErrorMessage(e, 'Could not start the test.'));
              }
            }} />
          </>
        )}
      </div>
    </div>
  );
};

const StepHeading: React.FC<{ n: number; title: string; done: boolean }> = ({ n, title, done }) => (
  <p className="flex items-center gap-2 text-sm font-extrabold text-[#0F172A]">
    {done ? <CheckCircle2 className="w-4 h-4 text-[#15803D]" /> : <Circle className="w-4 h-4 text-slate-300" />}
    Step {n}: {title}
  </p>
);

const AcademicStep: React.FC<{ tutorId: string; status: Tier1Status; onSaved: () => void }> = ({ tutorId, status, onSaved }) => {
  const [mark, setMark] = useState('');
  const [source, setSource] = useState<'matric' | 'university' | 'other'>('matric');
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const a = status.academic;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const pct = Number(mark);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) return setError('Enter your mark as a percentage.');
    if (!file) return setError('Add a photo or scan of your results.');
    setSaving(true);
    try {
      await submitAcademicRecord(tutorId, status.subject, pct, source, file);
      onSaved();
    } catch (err) {
      setError(getErrorMessage(err, 'Could not send your results.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-2">
      <StepHeading n={1} title={`Show at least 70% in ${status.subject}`} done={status.academicOk} />
      {a && (
        <p className="text-xs text-slate-600">
          Your record: {a.markPct}% ·{' '}
          {a.status === 'pending' ? 'waiting for Tutorlage to check' : a.status === 'verified' ? 'checked' : `not accepted${a.checkNote ? `: ${a.checkNote}` : ''}`}
          {a.status === 'verified' && a.markPct < 70 ? ' (below 70%, so this route isn\'t open for this subject)' : ''}
        </p>
      )}
      {!status.academicOk && (!a || a.status === 'rejected') && (
        <form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-3 gap-2 items-end">
          <div>
            <label className="block text-[11px] font-bold text-slate-500 mb-1" htmlFor="t1Mark">Your mark (%)</label>
            <input id="t1Mark" inputMode="decimal" value={mark} onChange={(e) => setMark(e.target.value)} placeholder="75" className={inputClass} />
          </div>
          <div>
            <label className="block text-[11px] font-bold text-slate-500 mb-1" htmlFor="t1Source">From</label>
            <select id="t1Source" value={source} onChange={(e) => setSource(e.target.value as typeof source)} className={inputClass}>
              <option value="matric">Matric results</option>
              <option value="university">University record</option>
              <option value="other">Other official record</option>
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-bold text-slate-500 mb-1" htmlFor="t1File">Photo or scan</label>
            <input id="t1File" type="file" accept="application/pdf,image/jpeg,image/png" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="block w-full text-xs" />
          </div>
          {error && <p className="sm:col-span-3 text-xs font-semibold text-rose-600">{error}</p>}
          <button type="submit" disabled={saving} className="sm:col-span-3 inline-flex items-center justify-center gap-1.5 text-xs font-bold px-3 py-2 rounded-lg bg-[#15803D] text-white disabled:opacity-50 cursor-pointer">
            <Upload className="w-3.5 h-3.5" /> {saving ? 'Sending…' : 'Send for checking'}
          </button>
        </form>
      )}
    </div>
  );
};

const TrainingStep: React.FC<{ modules: Tier1Module[]; training: Tier1TrainingRow[]; onChanged: () => void }> = ({ modules, training, onChanged }) => {
  const [open, setOpen] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const byModule = useMemo(() => new Map(training.map((t) => [t.module, t])), [training]);
  const done = modules.length > 0 && modules.every((m) => ['complete', 'pass'].includes(byModule.get(m.module)?.result ?? ''));

  return (
    <div className="space-y-2">
      <StepHeading n={2} title="Training (all seven modules)" done={done} />
      {error && <p className="text-xs font-semibold text-rose-600">{error}</p>}
      <ul className="space-y-1.5">
        {modules.map((m) => {
          const row = byModule.get(m.module);
          const isDone = row?.result === 'complete' || row?.result === 'pass';
          return (
            <li key={m.module} className="rounded-lg border border-slate-200 px-3 py-2">
              <button onClick={() => setOpen(open === m.module ? null : m.module)} className="w-full flex items-center justify-between gap-2 text-left cursor-pointer">
                <span className="flex items-center gap-2 text-xs font-bold text-[#0F172A]">
                  {isDone ? <CheckCircle2 className="w-4 h-4 text-[#15803D]" /> : m.kind === 'live' ? <Users className="w-4 h-4 text-slate-400" /> : <BookOpen className="w-4 h-4 text-slate-400" />}
                  Module {m.module}: {m.title}
                </span>
                <span className="text-[11px] text-slate-500 shrink-0">
                  {isDone ? 'Done' : m.kind === 'live' ? (row?.result === 'not_yet' ? 'Not yet' : 'With a trainer') : m.needsCheck ? 'Read, then check' : 'Read'}
                </span>
              </button>
              {open === m.module && (
                <div className="mt-2 text-xs text-slate-700 space-y-2">
                  <p className="font-semibold">{m.summary}</p>
                  <div className="whitespace-pre-line">{m.content}</div>
                  {m.kind === 'live' && row?.result === 'not_yet' && row.missingItems && (
                    <p className="text-amber-700">Your trainer noted: {row.missingItems}</p>
                  )}
                  {m.kind === 'self_paced' && !m.needsCheck && !isDone && (
                    <button
                      onClick={async () => {
                        setError(null);
                        try {
                          await completeTier1Module(m.module);
                          onChanged();
                        } catch (e) {
                          setError(getErrorMessage(e, 'Could not save.'));
                        }
                      }}
                      className="text-xs font-bold px-3 py-1.5 rounded-lg bg-[#15803D] text-white cursor-pointer"
                    >
                      I've read and understood this
                    </button>
                  )}
                  {m.needsCheck && !isDone && <ModuleCheck onPassed={onChanged} />}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
};

const ModuleCheck: React.FC<{ onPassed: () => void }> = ({ onPassed }) => {
  const [questions, setQuestions] = useState<ScenarioQuestion[] | null>(null);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    fetchModuleCheck().then(setQuestions).catch((e) => setMessage(getErrorMessage(e, 'Could not load the check.')));
  }, []);

  if (!questions) return <p className="text-slate-400">Loading the check…</p>;
  return (
    <div className="rounded-lg bg-slate-50 p-3 space-y-3">
      <p className="font-bold text-[#0F172A]">The check: what do you do first? Every answer must be right.</p>
      {questions.map((q) => (
        <fieldset key={q.id} className="space-y-1">
          <legend className="font-semibold text-[#0F172A] mb-1">{q.id}. {q.prompt}</legend>
          {q.options.map((o, i) => (
            <label key={i} className="flex items-start gap-2">
              <input type="radio" name={`mc${q.id}`} checked={answers[q.id] === i} onChange={() => setAnswers((a) => ({ ...a, [q.id]: i }))} className="mt-0.5" />
              <span>{o}</span>
            </label>
          ))}
        </fieldset>
      ))}
      {message && <p className="font-semibold text-amber-700">{message}</p>}
      <button
        disabled={Object.keys(answers).length < questions.length}
        onClick={async () => {
          setMessage(null);
          try {
            const r = await submitModuleCheck(answers);
            if (r.passed) onPassed();
            else setMessage(`${r.right} of ${r.total} right. Read the module again and try once more.`);
          } catch (e) {
            setMessage(getErrorMessage(e, 'Could not check your answers.'));
          }
        }}
        className="text-xs font-bold px-3 py-1.5 rounded-lg bg-[#15803D] text-white disabled:opacity-50 cursor-pointer"
      >
        Check my answers
      </button>
    </div>
  );
};

const TestStep: React.FC<{ status: Tier1Status; result: Tier1Result | null; onStart: () => void }> = ({ status, result, onStart }) => {
  const r = status.rules;
  return (
    <div className="space-y-2">
      <StepHeading n={3} title={`The ${status.subject} test`} done={status.passed} />
      <p className="text-xs text-slate-600">
        {r.items} short cases. In each, a learner has made a mistake: choose what they've misunderstood, then the
        response that would best fix it. {r.minutes} minutes. You pass with at least {r.passTotal} of {r.marks} marks,
        including at least {r.passDiagnosis} of the {r.items} "what has the learner misunderstood?" questions. If you
        don't pass, you can retake it once, {r.retakeWaitDays} days later.
      </p>
      {result && (
        <p className={`text-xs font-bold ${result.passed ? 'text-[#15803D]' : 'text-rose-600'}`}>
          {result.late
            ? 'That test was handed in after the time ran out, so it didn\'t count.'
            : `You scored ${result.totalScore} of 16 (${result.diagnosisScore} of 8 diagnoses). ${result.passed ? `You passed: ${status.subject} is now verified on your profile.` : 'Not a pass this time.'}`}
        </p>
      )}
      {status.passed ? (
        <p className="text-xs font-bold text-[#15803D]">Passed. {status.subject} is verified on your profile.</p>
      ) : status.canStart ? (
        <button onClick={onStart} className="inline-flex items-center gap-1.5 text-xs font-bold px-3 py-2 rounded-lg bg-[#0F172A] text-white cursor-pointer">
          <ClipboardCheck className="w-3.5 h-3.5" /> {status.openAttempt ? 'Continue the test' : 'Start the test'}
        </button>
      ) : (
        <p className="text-xs text-slate-500">
          {status.reason}
          {status.nextRetakeAt ? ` ${new Date(status.nextRetakeAt).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })}.` : ''}
        </p>
      )}
    </div>
  );
};

const TestScreen: React.FC<{ test: Tier1Test; onDone: (r: Tier1Result) => void }> = ({ test, onDone }) => {
  const [answers, setAnswers] = useState<Record<string, { q1?: number; q2?: number }>>({});
  const [now, setNow] = useState(Date.now());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const deadline = new Date(test.deadlineAt).getTime();
  const secondsLeft = Math.max(0, Math.round((deadline - now) / 1000));
  const answered = test.items.filter((i) => answers[i.id]?.q1 !== undefined && answers[i.id]?.q2 !== undefined).length;

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  const handIn = useCallback(async () => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      onDone(await submitTier1Test(test.attemptId, answers));
    } catch (e) {
      setError(getErrorMessage(e, 'Could not hand in the test. Try again straight away.'));
      setSubmitting(false);
    }
  }, [answers, onDone, submitting, test.attemptId]);

  // Hand in automatically when the time runs out.
  useEffect(() => {
    if (secondsLeft === 0 && !submitting) handIn();
  }, [secondsLeft, submitting, handIn]);

  const choose = (itemId: string, q: 'q1' | 'q2', i: number) =>
    setAnswers((a) => ({ ...a, [itemId]: { ...a[itemId], [q]: i } }));

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-5">
      <div className="sticky top-0 bg-white z-10 flex items-center justify-between gap-2 border-b border-slate-100 pb-2">
        <p className="text-sm font-extrabold text-[#0F172A]">{test.subject} test</p>
        <p className={`flex items-center gap-1 text-sm font-bold ${secondsLeft < 300 ? 'text-rose-600' : 'text-slate-600'}`}>
          <Timer className="w-4 h-4" /> {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, '0')}
        </p>
      </div>
      {test.items.map((item, n) => (
        <div key={item.id} className="space-y-2 text-sm text-slate-800">
          <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Case {n + 1} of {test.items.length}{item.gradeBand ? ` · ${item.gradeBand}` : ''}</p>
          <div className="rounded-lg bg-slate-50 p-3"><Rich text={item.stem} /></div>
          {(['q1', 'q2'] as const).map((q) => (
            <fieldset key={q} className="space-y-1">
              <legend className="font-bold text-[#0F172A] mb-1">
                {q === 'q1' ? '1. What has the learner misunderstood?' : '2. Which response would best fix that misunderstanding?'}
              </legend>
              {item[q].map((option, i) => (
                <label key={i} className="flex items-start gap-2 text-sm">
                  <input type="radio" name={`${item.id}-${q}`} checked={answers[item.id]?.[q] === i} onChange={() => choose(item.id, q, i)} className="mt-1" />
                  <span>{option}</span>
                </label>
              ))}
            </fieldset>
          ))}
        </div>
      ))}
      {error && <p className="text-xs font-semibold text-rose-600">{error}</p>}
      <div className="flex items-center justify-between gap-2 border-t border-slate-100 pt-3">
        <p className="text-xs text-slate-500">{answered} of {test.items.length} cases fully answered</p>
        <button onClick={handIn} disabled={submitting} className="text-sm font-bold px-4 py-2 rounded-lg bg-[#15803D] text-white disabled:opacity-50 cursor-pointer">
          {submitting ? 'Handing in…' : 'Hand in'}
        </button>
      </div>
    </div>
  );
};
