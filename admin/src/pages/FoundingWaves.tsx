import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { releaseEntries, type FoundingAdminClient } from '../lib/founding';
import {
  ALL_TIME, NO_STEP_FILTER, fetchAbandons, fetchAnswers, fetchWaves, setSuggestSkip, setStopRule, setWaveCap, wavesCsv,
  type Abandons, type Answers, type AnswerRange, type CallResult, type StepFilter, type WavesResult,
} from '../lib/foundingWaves';
import { FoundingWavesBody } from '../components/FoundingWavesBody';

const db = supabase as unknown as FoundingAdminClient;

// Founding waves (CEO, 11 Nov 2026): when to release the next wave, who, and how the last waves are doing. Reads the database's admin functions; sends nothing.
// Opens cleanly before the database change is applied (a plain "not switched on yet").
export const FoundingWaves: React.FC = () => {
  const [result, setResult] = useState<WavesResult | null>(null);
  const [filter, setFilter] = useState<StepFilter>(NO_STEP_FILTER);
  const [range, setRange] = useState<AnswerRange>(ALL_TIME);
  const [answers, setAnswers] = useState<CallResult<Answers> | null>(null);
  const [abandons, setAbandons] = useState<CallResult<Abandons> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const loadRange = useCallback(async (r: AnswerRange) => {
    const [a, b] = await Promise.all([fetchAnswers(db, r), fetchAbandons(db, r)]);
    setAnswers(a);
    setAbandons(b);
  }, []);

  const load = useCallback(async (r: AnswerRange) => {
    setIsLoading(true);
    const [w] = await Promise.all([fetchWaves(db), loadRange(r)]);
    setResult(w);
    setIsLoading(false);
  }, [loadRange]);

  useEffect(() => {
    void load(ALL_TIME);
  }, [load]);

  const onRange = (r: AnswerRange) => {
    setRange(r);
    void loadRange(r);
  };

  const act = async (action: () => Promise<string | null>, done: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    const problem = await action();
    if (problem) setError(problem);
    else {
      setNotice(done);
      await load(range);
    }
    setBusy(false);
  };

  const onRelease = async (ids: string[], wave: number) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    const r = await releaseEntries(db, ids, wave);
    if (r.error) setError(r.error);
    else {
      setNotice(`Released ${r.released} as wave ${r.wave ?? wave}${r.skipped ? ` (${r.skipped} were no longer waiting)` : ''}. Now open each person's message on the Founding tutors page and send it yourself.`);
      await load(range);
    }
    setBusy(false);
  };

  const onCsv = () => {
    const waves = result && result.state === 'ok' ? result.data.waves : [];
    const url = URL.createObjectURL(new Blob([wavesCsv(waves)], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'founding-waves-numbers.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="max-w-6xl">
      <div className="flex items-start justify-between gap-3 mb-1">
        <h1 className="text-2xl font-extrabold text-[#0F172A]">Founding waves</h1>
        <button
          type="button"
          onClick={() => void load(range)}
          disabled={isLoading}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50 cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>
      <p className="text-sm text-slate-500 mb-6 max-w-3xl">
        When to release the next wave, who to release, and how each wave is doing, step by step. The people themselves, their messages and the Release buttons are on the Founding tutors page. This page never sends anything.
      </p>
      <FoundingWavesBody
        result={result}
        error={error}
        notice={notice}
        busy={busy}
        filter={filter}
        onFilter={setFilter}
        answers={answers}
        abandons={abandons}
        range={range}
        onRange={onRange}
        onCsv={onCsv}
        onSkip={(id, skip) => void act(() => setSuggestSkip(db, id, skip), skip ? 'Taken off the suggestion.' : 'Put back on the suggestion.')}
        onCap={(cap) => void act(() => setWaveCap(db, cap), `The most per release is now ${cap}.`)}
        onRelease={(ids, wave) => void onRelease(ids, wave)}
        onStopRule={(rule, open, note) => void act(() => setStopRule(db, rule, open, note), open ? `Rule ${rule} is marked open.` : `Rule ${rule} is marked closed.`)}
        onRetry={() => void load(range)}
      />
    </div>
  );
};
