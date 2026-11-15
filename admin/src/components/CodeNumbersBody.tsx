import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, BarChart3 } from 'lucide-react';
import {
  FUNNEL_LIMITS, FUNNEL_NOT_AVAILABLE, KIND_WORDS, PRESET_WORDS, count, dayByDay, fetchCodeFunnel, hasActivity, linkState, percentOf, presetRange, rangeLabel, rangeProblem, sastToday,
  type FunnelData, type FunnelResult, type Kinds, type RangePreset,
} from '../lib/codeFunnel';
import type { PromoAdminClient } from '../lib/promoCodes';
import { rand0 } from '../lib/walletAdmin';

const inputClass = 'bg-slate-100 text-[#0F172A] text-sm font-semibold px-3 py-2 rounded-xl border border-transparent focus:outline-none focus:border-[#15803D] focus:bg-white';
const chip = (on: boolean): string => `px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer ${on ? 'bg-[#15803D] text-white' : 'bg-slate-100 text-[#0F172A] hover:bg-slate-200'}`;
const th = 'px-2 py-2 text-[10px] font-bold text-slate-500 text-right whitespace-nowrap';
const td = 'px-2 py-2 text-xs font-semibold text-[#0F172A] text-right whitespace-nowrap';

interface Props { client: PromoAdminClient }

// "Numbers" on the Codes page (R12, 11 Nov 2026): for a range of South African days, per code and in total, how far people get: link opens, sign-ups, money in the
// wallet, the 1st to 4th booking, the first lesson done, what the discount has cost, the tutor bonus, requests that expired, and a baseline of sign-ups without any code.
// Counts only: no family is named. Before the migration it says so in one line and the rest of the page works as before.
export const CodeNumbersBody: React.FC<Props> = ({ client }) => {
  const [preset, setPreset] = useState<RangePreset | 'custom'>('30');
  const initial = presetRange('30', sastToday());
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [result, setResult] = useState<FunnelResult | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [dayCode, setDayCode] = useState('');

  const load = useCallback(async (f: string, t: string) => {
    const bad = rangeProblem(f, t);
    setProblem(bad);
    if (bad) return;
    setResult(null);
    setResult(await fetchCodeFunnel(client, f, t));
  }, [client]);
  useEffect(() => {
    void load(initial.from, initial.to);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client]);

  const pick = (p: RangePreset) => {
    const r = presetRange(p, sastToday());
    setPreset(p);
    setFrom(r.from);
    setTo(r.to);
    void load(r.from, r.to);
  };

  const data: FunnelData | null = result?.status === 'ready' ? result.data : null;
  return (
    <section className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4" data-codes-numbers>
      <div>
        <h2 className="text-sm font-extrabold text-[#0F172A] mb-1 flex items-center gap-2"><BarChart3 className="w-4 h-4 text-[#15803D]" /> Numbers</h2>
        <p className="text-xs text-slate-500 max-w-3xl">
          How far the families that came with each code get, for the days you pick: they opened the link, signed up, put money in, booked a 1st, 2nd and 3rd lesson, stayed for a 4th, and had a first lesson done.
          Counts only: no family is named.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-2" data-numbers-range>
        {(Object.keys(PRESET_WORDS) as RangePreset[]).map((p) => (
          <button key={p} type="button" className={chip(preset === p)} onClick={() => pick(p)}>{PRESET_WORDS[p]}</button>
        ))}
        <label className="text-[11px] font-bold text-slate-500">From
          <input type="date" className={`${inputClass} block`} value={from} onChange={(e) => { setPreset('custom'); setFrom(e.target.value); }} />
        </label>
        <label className="text-[11px] font-bold text-slate-500">To
          <input type="date" className={`${inputClass} block`} value={to} onChange={(e) => { setPreset('custom'); setTo(e.target.value); }} />
        </label>
        <button type="button" className={chip(false)} onClick={() => void load(from, to)}>Show</button>
      </div>
      {problem && <p role="alert" className="text-xs font-semibold text-rose-700">{problem}</p>}

      {result === null && !problem && <div className="flex items-center text-slate-400 text-sm"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading the numbers…</div>}
      {result?.status === 'not_available' && <p role="status" data-numbers-not-available className="text-sm font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">{FUNNEL_NOT_AVAILABLE}</p>}
      {result?.status === 'forbidden' && <p role="alert" className="text-sm font-semibold text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-4 py-3">The database says this account may not see these numbers.</p>}
      {result?.status === 'error' && (
        <p role="alert" className="text-sm font-semibold text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-4 py-3">
          Could not load the numbers: {result.message}{' '}
          <button type="button" onClick={() => void load(from, to)} className="underline font-bold cursor-pointer">Try again</button>
        </p>
      )}

      {data && <Funnel data={data} dayCode={dayCode} onDayCode={setDayCode} />}
    </section>
  );
};

const bookings = (k: Kinds): number => count(k, 'book_1') + count(k, 'book_2') + count(k, 'book_3');

const Funnel: React.FC<{ data: FunnelData; dayCode: string; onDayCode: (c: string) => void }> = ({ data, dayCode, onDayCode }) => {
  const live = data.opensCounter === 'live';
  const rows = data.codes.filter((c) => c.active || hasActivity(c.k));
  const dash = (n: number): string => (live ? String(n) : '—');
  const cells = (k: Kinds): React.ReactNode => (
    <>
      <td className={td}>{dash(count(k, 'open'))}</td>
      <td className={td}>{dash(count(k, 'visitor'))}</td>
      <td className={td}>{count(k, 'signup')}</td>
      <td className={td}>{count(k, 'funded')}</td>
      <td className={td}>{count(k, 'book_1')}</td>
      <td className={td}>{count(k, 'book_2')}</td>
      <td className={td}>{count(k, 'book_3')}</td>
      <td className={td}>{count(k, 'book_4')}</td>
      <td className={td}>{count(k, 'first_done')}</td>
      <td className={td}>{rand0(count(k, 'rand_given'))}</td>
      <td className={td}>{rand0(count(k, 'rand_booked'))}</td>
      <td className={td}>{data.bonusOn || count(k, 'bonus_paid') > 0 ? rand0(count(k, 'bonus_paid')) : 'off'}</td>
      <td className={td}>{count(k, 'expired')}</td>
    </>
  );
  const days = dayByDay(data, dayCode || null);
  const baseTotal = data.baseline.withCode + data.baseline.withoutCode;
  return (
    <div className="space-y-4">
      <p data-numbers-range-label className="text-xs font-bold text-slate-600">{rangeLabel(data.from, data.to)} (South African days)</p>
      {!live && (
        <p data-numbers-not-live className="text-xs font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
          Link opens are not counted yet: the counter starts with the first code link that is opened. Until then the opens columns show a dash, not a zero.
        </p>
      )}
      {rows.length === 0 ? (
        <p className="text-sm text-slate-500">No code has anything in these days.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left" data-numbers-table>
            <thead>
              <tr className="border-b border-slate-200">
                <th className="px-2 py-2 text-[10px] font-bold text-slate-500">Code</th>
                <th className={th}>Link opens</th><th className={th}>People</th><th className={th}>Signed up</th><th className={th}>Wallet funded</th>
                <th className={th}>1st booking</th><th className={th}>2nd</th><th className={th}>3rd</th><th className={th}>4th (full price)</th>
                <th className={th}>First lesson done</th><th className={th}>Rand given</th><th className={th}>Rand booked</th><th className={th}>Tutor bonus</th><th className={th}>Expired</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.codeId} data-numbers-row={c.code} className="border-b border-slate-100">
                  <td className="px-2 py-2 text-xs font-extrabold text-[#0F172A] whitespace-nowrap">
                    {c.code}
                    {c.label && <span className="ml-2 text-[10px] font-bold text-slate-500">{c.label}</span>}
                    {linkState(c, data.opensCounter) === 'not_opened' && <div data-numbers-not-shared className="text-[10px] font-bold text-amber-700">Link not opened yet</div>}
                    {!c.active && <div className="text-[10px] font-bold text-slate-500">Paused</div>}
                  </td>
                  {cells(c.k)}
                </tr>
              ))}
              <tr data-numbers-total className="bg-slate-50">
                <td className="px-2 py-2 text-xs font-extrabold text-[#0F172A]">All codes</td>
                {cells(data.totals)}
              </tr>
            </tbody>
          </table>
        </div>
      )}

      <p data-numbers-baseline className="text-xs text-slate-600">
        <span className="font-bold">Same days, for comparison:</span> {baseTotal} parents and learners signed up themselves; {data.baseline.withCode} with a code ({percentOf(data.baseline.withCode, baseTotal)}),{' '}
        {data.baseline.withoutCode} without one. Wallet funded and bookings above are counted on the day they happened, so they can include families that signed up earlier.
      </p>

      <details data-numbers-days className="bg-slate-50 rounded-xl px-3 py-2">
        <summary className="text-xs font-bold text-[#0F172A] cursor-pointer">Day by day</summary>
        <div className="mt-2 space-y-2">
          <label className="text-[11px] font-bold text-slate-500">Code{' '}
            <select className={inputClass} value={dayCode} onChange={(e) => onDayCode(e.target.value)}>
              <option value="">All codes</option>
              {data.codes.map((c) => <option key={c.codeId} value={c.codeId}>{c.code}</option>)}
            </select>
          </label>
          {days.length === 0 ? <p className="text-xs text-slate-500">Nothing happened on any of these days.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-slate-200">
                    <th className="px-2 py-2 text-[10px] font-bold text-slate-500">Day</th>
                    <th className={th}>Link opens</th><th className={th}>Signed up</th><th className={th}>Wallet funded</th><th className={th}>Bookings 1 to 3</th><th className={th}>4th</th>
                    <th className={th}>First lesson done</th><th className={th}>Rand given</th>{!dayCode && <th className={th}>Sign-ups with no code</th>}
                  </tr>
                </thead>
                <tbody>
                  {days.map((d) => (
                    <tr key={d.day} data-numbers-day={d.day} className="border-b border-slate-100">
                      <td className="px-2 py-2 text-xs font-bold text-[#0F172A] whitespace-nowrap">{d.day}</td>
                      <td className={td}>{dash(count(d.k, 'open'))}</td>
                      <td className={td}>{count(d.k, 'signup')}</td>
                      <td className={td}>{count(d.k, 'funded')}</td>
                      <td className={td}>{bookings(d.k)}</td>
                      <td className={td}>{count(d.k, 'book_4')}</td>
                      <td className={td}>{count(d.k, 'first_done')}</td>
                      <td className={td}>{rand0(count(d.k, 'rand_given'))}</td>
                      {!dayCode && <td className={td}>{d.withoutCode}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </details>

      <details data-numbers-legend className="bg-slate-50 rounded-xl px-3 py-2">
        <summary className="text-xs font-bold text-[#0F172A] cursor-pointer">What each number means, and what it cannot tell you</summary>
        <ul className="mt-2 space-y-1 text-[11px] text-slate-600 list-disc pl-4">
          {Object.entries(KIND_WORDS).map(([kind, words]) => <li key={kind}>{words}</li>)}
        </ul>
        <ul className="mt-2 space-y-1 text-[11px] text-slate-600 list-disc pl-4">
          {FUNNEL_LIMITS.map((l) => <li key={l}>{l}</li>)}
        </ul>
      </details>
    </div>
  );
};
