import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, UserCheck } from 'lucide-react';
import { ACTIVATION_NOT_AVAILABLE, approvalWords, fetchTutorActivation, stageWords, type ActivationData, type ActivationResult, type ActivationTutor } from '../lib/codeFunnel';
import type { PromoAdminClient } from '../lib/promoCodes';
import { rand0 } from '../lib/walletAdmin';

const chip = (on: boolean): string => `px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer ${on ? 'bg-[#15803D] text-white' : 'bg-slate-100 text-[#0F172A] hover:bg-slate-200'}`;
const QUIET_CHOICES = [3, 7, 14] as const;

interface Props { client: PromoAdminClient }

// "Tutors" on the Codes page (R13, 11 Nov 2026): every verified tutor, how far they have got (a subject, hours, a first request seen, a first lesson accepted, a first lesson
// completed), their personal code with the families that came through it, and who has been quiet since approval. "Requests received" is not shown because nothing records an
// offer (tutors pull the list); the nearest honest numbers are "first request seen" and "lessons accepted". Counts, names of tutors and dates only.
export const TutorActivationBody: React.FC<Props> = ({ client }) => {
  const [days, setDays] = useState<number>(7);
  const [result, setResult] = useState<ActivationResult | null>(null);
  const [showAll, setShowAll] = useState(false);
  const load = useCallback(async (d: number) => {
    setResult(null);
    setResult(await fetchTutorActivation(client, d));
  }, [client]);
  useEffect(() => {
    void load(7);
  }, [load]);

  const data: ActivationData | null = result?.status === 'ready' ? result.data : null;
  return (
    <section className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4" data-codes-activation>
      <div>
        <h2 className="text-sm font-extrabold text-[#0F172A] mb-1 flex items-center gap-2"><UserCheck className="w-4 h-4 text-[#15803D]" /> Tutors: who has got going</h2>
        <p className="text-xs text-slate-500 max-w-3xl">
          Every verified tutor and the next thing they have not done yet. "Quiet" means approved {days} or more days ago (or approval date not recorded) and either no hours saved or no lesson accepted since approval.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2" data-activation-days>
        <span className="text-[11px] font-bold text-slate-500">Quiet after</span>
        {QUIET_CHOICES.map((d) => (
          <button key={d} type="button" className={chip(days === d)} onClick={() => { setDays(d); void load(d); }}>{d} days</button>
        ))}
      </div>

      {result === null && <div className="flex items-center text-slate-400 text-sm"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading the tutors…</div>}
      {result?.status === 'not_available' && <p role="status" data-activation-not-available className="text-sm font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">{ACTIVATION_NOT_AVAILABLE}</p>}
      {result?.status === 'forbidden' && <p role="alert" className="text-sm font-semibold text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-4 py-3">The database says this account may not see the tutor list.</p>}
      {result?.status === 'error' && (
        <p role="alert" className="text-sm font-semibold text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-4 py-3">
          Could not load the tutors: {result.message}{' '}
          <button type="button" onClick={() => void load(days)} className="underline font-bold cursor-pointer">Try again</button>
        </p>
      )}

      {data && <List data={data} showAll={showAll} onShowAll={setShowAll} />}
    </section>
  );
};

const List: React.FC<{ data: ActivationData; showAll: boolean; onShowAll: (v: boolean) => void }> = ({ data, showAll, onShowAll }) => {
  const t = data.totals;
  const shown = showAll ? data.tutors : data.tutors.filter((x) => x.quiet);
  const live = data.opensCounter === 'live';
  return (
    <div className="space-y-3">
      <div data-activation-totals className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
        {[
          ['Verified tutors', t.verified],
          ['With a subject', t.withSubjects],
          ['With hours saved', t.withHours],
          ['Have seen a request', t.sawARequest],
          ['Accepted a lesson', t.acceptedOne],
          ['Completed a lesson', t.completedOne],
          [`Quiet ${data.quietDays}+ days`, t.quiet],
        ].map(([label, value]) => (
          <div key={String(label)} className="bg-slate-50 rounded-xl px-3 py-2">
            <div className="text-[10px] font-bold text-slate-500">{label}</div>
            <div className="text-sm font-extrabold text-[#0F172A]">{value}</div>
          </div>
        ))}
      </div>
      {t.approvalUnknown > 0 && (
        <p className="text-[11px] text-slate-500">{t.approvalUnknown} tutor{t.approvalUnknown === 1 ? '' : 's'} {t.approvalUnknown === 1 ? 'has' : 'have'} no approval date on record (approved before approvals were logged, or by another route); they are listed as quiet until they take a lesson, and the date is never guessed.</p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={chip(!showAll)} onClick={() => onShowAll(false)}>Quiet only ({t.quiet})</button>
        <button type="button" className={chip(showAll)} onClick={() => onShowAll(true)}>Every verified tutor ({t.verified})</button>
      </div>
      {shown.length === 0 ? (
        <p className="text-sm text-slate-500">{showAll ? 'No verified tutor yet.' : 'No tutor is quiet.'}</p>
      ) : (
        <div className="space-y-2">
          {shown.map((x) => <TutorRow key={x.tutorId} x={x} quietDays={data.quietDays} live={live} />)}
        </div>
      )}
      <p className="text-[11px] text-slate-500">
        Requests are pulled by tutors from a list, not sent to them, so "requests received" cannot be counted. "Has seen a request" is the first time their list showed one; "accepted" and "completed" are lessons they took.
      </p>
    </div>
  );
};

const TutorRow: React.FC<{ x: ActivationTutor; quietDays: number; live: boolean }> = ({ x, quietDays, live }) => (
  <div data-activation-row={x.tutorId} data-quiet={x.quiet ? 'true' : 'false'} className="border border-slate-200 rounded-xl px-4 py-3 space-y-2">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div>
        <div className="text-sm font-extrabold text-[#0F172A]">{x.name ?? 'Name not set'}{x.level && <span className="ml-2 text-xs font-bold text-slate-500">Level {x.level}</span>}</div>
        <div className="text-xs text-slate-600">{approvalWords(x)}</div>
        <div data-activation-stage className="text-xs font-bold text-[#0F172A]">{stageWords(x)}</div>
      </div>
      {x.quiet && <span data-activation-quiet className="text-[11px] font-bold text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1">Quiet for {quietDays}+ days</span>}
    </div>
    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2 text-xs">
      <Mini label="Subject" value={x.hasSubjects ? 'Added' : 'No'} />
      <Mini label="Hours" value={x.hasHours ? 'Saved' : 'No'} />
      <Mini label="Saw a request" value={x.firstRequestSeenAt ? 'Yes' : 'No'} />
      <Mini label="Lessons accepted" value={String(x.accepted)} />
      <Mini label="Lessons completed" value={String(x.completed)} />
      <Mini label="Code" value={x.code ?? 'None yet'} />
      <Mini label="Families through the code" value={`${x.signups} signed up`} extra={live ? `${x.opens} opens, ${x.visitors} people` : 'opens not counted yet'} />
    </div>
    {x.bonusRand > 0 && <div className="text-[11px] text-slate-600">Bonus paid to this tutor so far: {rand0(x.bonusRand)}</div>}
  </div>
);

const Mini: React.FC<{ label: string; value: string; extra?: string }> = ({ label, value, extra }) => (
  <div className="bg-slate-50 rounded-lg px-2 py-1.5">
    <div className="text-[10px] font-bold text-slate-500">{label}</div>
    <div className="text-xs font-extrabold text-[#0F172A] break-all">{value}</div>
    {extra && <div className="text-[10px] text-slate-500">{extra}</div>}
  </div>
);
