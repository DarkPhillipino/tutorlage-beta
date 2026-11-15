import React, { useState } from 'react';
import {
  ALL_TIME, DECLINE_LABELS, FIELD_LABELS, NO_STEP_FILTER, RULE_HELP, STAGE_LABELS, STAGE_ORDER, days, filterSteps, lastNDays, pct, sayState, shortDate, waveName, waveOptions,
  type Abandons, type Answers, type AnswerRange, type CallResult, type LightState, type Pipeline, type StepFilter, type StepRow, type Suggestion, type Triggers, type WaveBlock, type WavesResult,
} from '../lib/foundingWaves';

// Founding waves (CEO, 11 Nov 2026): the numbers behind each release. Nothing on this page sends anything; the CEO presses Release himself and sends each WhatsApp message himself.

const card = 'bg-white rounded-xl border border-slate-200 p-4 mb-5';
const h2 = 'text-base font-extrabold text-[#0F172A]';
const help = 'text-xs text-slate-500 mt-0.5 mb-3 max-w-3xl';
const th = 'text-left font-bold text-slate-500 text-[11px] uppercase tracking-wide px-2 py-1.5 whitespace-nowrap';
const td = 'px-2 py-1.5 text-xs text-slate-700 whitespace-nowrap';
const btn = 'inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-bold border cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed';
const btnPlain = `${btn} bg-white border-slate-200 text-slate-600 hover:bg-slate-50`;
const btnGreen = `${btn} bg-[#15803D] border-[#15803D] text-white hover:bg-[#166534]`;
const input = 'border border-slate-300 rounded-lg px-2 py-1 text-xs bg-white';

const LIGHT_COLOURS: Record<LightState, string> = { met: 'bg-green-600', not_met: 'bg-red-500', default: 'bg-amber-400', unknown: 'bg-slate-300' };
const LIGHT_WORDS: Record<LightState, string> = { met: 'Met', not_met: 'Not met', default: 'Using the default', unknown: 'Not enough to say' };

const Light: React.FC<{ state: LightState; title: string; line: string; children?: React.ReactNode }> = ({ state, title, line, children }) => (
  <div className="rounded-lg border border-slate-200 p-3 flex gap-3">
    <span className={`mt-1 inline-block w-3.5 h-3.5 rounded-full shrink-0 ${LIGHT_COLOURS[state]}`} aria-hidden="true" />
    <div className="min-w-0">
      <div className="text-sm font-bold text-[#0F172A]">{title} <span className="text-xs font-semibold text-slate-500">({LIGHT_WORDS[state]})</span></div>
      <div className="text-xs text-slate-600 mt-0.5">{line}</div>
      {children}
    </div>
  </div>
);

// ---- R9 + R8 ---------------------------------------------------------------------------------------------------------------------------------------------------
const TriggerPanel: React.FC<{ t: Triggers | null; busy: boolean; onStopRule: (rule: number, open: boolean, note: string) => void }> = ({ t, busy, onStopRule }) => {
  const [note, setNote] = useState<Record<number, string>>({});
  if (!t) return <section className={card}><h2 className={h2}>Release trigger</h2><p className={help}>This part could not be loaded.</p></section>;
  return (
    <section className={card} aria-labelledby="trig-h">
      <h2 id="trig-h" className={h2}>Is it time to release the next wave?</h2>
      <p className={help}>
        The five conditions from the measurement plan. {t.currentWave ? `The current wave is ${t.currentWave}.` : 'No wave has been released yet.'} {t.allClear ? 'All four that block a release are met.' : 'At least one that blocks a release is not met yet.'} {RULE_HELP}
      </p>
      <div className="grid gap-3 md:grid-cols-2">
        <Light state={t.b1.state} title="1. There is demand" line={t.b1.demandRows > 0 ? `${t.b1.demandRows} subject and grade band${t.b1.demandRows === 1 ? '' : 's'} with requests nobody served, or with requests and fewer than 3 ready tutors.` : 'No subject and grade band has requests that went unserved.'}>
          {t.b1.rows.length > 0 && <ul className="mt-1 text-xs text-slate-500 list-disc pl-4">{t.b1.rows.slice(0, 4).map((r) => <li key={`${r.subject}${r.phase}`}>{r.subject}, {r.phase}: {r.requests} request(s), {r.unserved} unserved, {r.readyTutors} ready tutor(s)</li>)}</ul>}
        </Light>
        <Light state={t.b2.state} title="2. The current wave is getting work" line={t.b2.approved > 0 ? `${t.b2.working} of ${t.b2.approved} approved tutors have seen a request or have a lesson (${t.b2.sharePct === null ? '–' : pct(t.b2.sharePct)}; the line is ${t.b2.linePct}%).` : 'Nobody in the current wave is approved yet.'} />
        <Light state={t.b3.state} title="3. The queue is clear" line={t.b3.waiting === 0 ? `Every complete document set in the current wave has been approved or declined.${t.b3.notUploaded > 0 ? ` ${t.b3.notUploaded} person(s) have not uploaded anything yet.` : ''}` : `${t.b3.waiting} complete set(s) still wait for a decision; the oldest has waited ${days(t.b3.oldestDays)}.`} />
        <Light state={t.b4.state} title="4. We know the rate" line={t.b4.measured ? `Measured from wave ${t.b4.waves.join(', ')}: ${pct(t.b4.rate * 100)} of those released were approved.` : `Not measured yet: the default ${pct(t.b4.rate * 100)} is used. It does not block a release.`} />
        <Light state={t.b5.state} title="5. No stop rule is open" line={t.b5.open === 0 ? 'No stop rule is open.' : `${t.b5.open} stop rule(s) open (below).`} />
      </div>
      <h3 className="text-sm font-bold text-[#0F172A] mt-4 mb-1">Stop rules</h3>
      <p className="text-xs text-slate-500 mb-2">Rules 4, 5 and 6 are worked out from the numbers. The others no number can show, so you or the PM mark them open or closed by hand.</p>
      <ul className="space-y-2">
        {t.stopRules.map((r) => (
          <li key={r.rule} className={`rounded-lg border px-3 py-2 ${r.open ? 'border-red-300 bg-red-50' : 'border-slate-200'}`}>
            <div className="flex flex-wrap items-center gap-2">
              <span className={`inline-block w-2.5 h-2.5 rounded-full ${r.open ? 'bg-red-500' : 'bg-green-600'}`} aria-hidden="true" />
              <span className="text-xs font-bold text-[#0F172A]">Rule {r.rule}: {r.label}</span>
              <span className="text-[11px] text-slate-500">{r.kind === 'auto' ? 'worked out' : 'marked by hand'}{r.open && r.since ? `, open since ${shortDate(r.since)}` : ''}</span>
            </div>
            {r.note && <div className="text-xs text-slate-600 mt-0.5">{r.note}</div>}
            {r.kind === 'manual' && (
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                {!r.open && <input className={`${input} w-64`} placeholder="What happened (optional)" value={note[r.rule] ?? ''} onChange={(e) => setNote({ ...note, [r.rule]: e.target.value })} maxLength={200} />}
                <button type="button" disabled={busy} className={r.open ? btnPlain : btnGreen} onClick={() => onStopRule(r.rule, !r.open, note[r.rule] ?? '')}>{r.open ? 'Mark closed' : 'Mark open'}</button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
};

const SuggestionPanel: React.FC<{ s: Suggestion | null; busy: boolean; onSkip: (id: string, skip: boolean) => void; onCap: (cap: number) => void; onRelease: (ids: string[], wave: number) => void }> = ({ s, busy, onSkip, onCap, onRelease }) => {
  const [capText, setCapText] = useState('');
  const [wave, setWave] = useState('');
  if (!s) return <section className={card}><h2 className={h2}>Suggested release list</h2><p className={help}>This part could not be loaded.</p></section>;
  const suggested = s.people.filter((p) => p.suggested);
  const waveNo = Number(wave) || s.nextWave;
  return (
    <section className={card} aria-labelledby="sug-h">
      <h2 id="sug-h" className={h2}>Who to release next</h2>
      <p className={help}>
        People who cover a subject and grade band with demand come first, then the order they joined. Size = the gap ({s.gap}) divided by the release-to-approved rate ({pct(s.rate * 100)}{s.rateMeasured ? `, measured from wave ${s.rateWaves.join(', ')}` : ', the default until a wave measures it'}), at most {s.cap}. You press Release; nothing is sent.
      </p>
      {s.demand.length > 0 ? (
        <div className="overflow-x-auto mb-3">
          <table className="min-w-full"><thead><tr><th className={th}>Subject</th><th className={th}>Band</th><th className={th}>Requests</th><th className={th}>Unserved</th><th className={th}>Ready tutors</th><th className={th}>Still needed</th><th className={th}>People waiting who cover it</th></tr></thead>
            <tbody>{s.demand.map((d) => <tr key={`${d.subject}${d.phase}`} className="border-t border-slate-100"><td className={td}>{d.subject}</td><td className={td}>{d.phase}</td><td className={td}>{d.requests}</td><td className={td}>{d.unserved}</td><td className={td}>{d.readyTutors}</td><td className={td}>{d.shortfall}</td><td className={td}>{d.peopleWaiting}</td></tr>)}</tbody></table>
        </div>
      ) : <p className="text-xs text-slate-600 mb-3">No subject and band has demand that goes unserved, so nothing is suggested. You can still release by hand on the Founding tutors page.</p>}
      <div className="flex flex-wrap items-end gap-3 mb-3">
        <div><div className="text-[11px] font-bold text-slate-500 mb-0.5">Suggested size</div><div className="text-lg font-extrabold text-[#0F172A]">{s.suggestedN}</div></div>
        <label className="text-[11px] font-bold text-slate-500">Most per release
          <div className="flex gap-1 mt-0.5"><input className={`${input} w-16`} inputMode="numeric" placeholder={String(s.cap)} value={capText} onChange={(e) => setCapText(e.target.value.replace(/\D/g, ''))} />
            <button type="button" disabled={busy || capText === ''} className={btnPlain} onClick={() => { onCap(Number(capText)); setCapText(''); }}>Change</button></div>
        </label>
        <label className="text-[11px] font-bold text-slate-500">Wave number
          <input className={`${input} w-16 block mt-0.5`} inputMode="numeric" placeholder={String(s.nextWave)} value={wave} onChange={(e) => setWave(e.target.value.replace(/\D/g, ''))} />
        </label>
        <button type="button" disabled={busy || suggested.length === 0} className={btnGreen}
          onClick={() => { if (window.confirm(`Release these ${suggested.length} people as wave ${waveNo}? Then open each person's message from the Founding tutors page and send it yourself.`)) onRelease(suggested.map((p) => p.id), waveNo); }}>
          Release the {suggested.length} suggested as wave {waveNo}
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full"><thead><tr><th className={th}>#</th><th className={th}>Name</th><th className={th}>Joined</th><th className={th}>Covers demand</th><th className={th}>Suggested</th><th className={th} /></tr></thead>
          <tbody>
            {s.people.length === 0 && <tr><td className={td} colSpan={6}>Nobody is waiting on the list.</td></tr>}
            {s.people.map((p, i) => (
              <tr key={p.id} className={`border-t border-slate-100 ${p.skipped ? 'opacity-60' : ''}`}>
                <td className={td}>{i + 1}</td><td className={td}>{p.fullName}{p.lapsed ? ' (lapsed)' : ''}</td><td className={td}>{shortDate(p.joinedAt)}</td>
                <td className={td}>{p.coversN > 0 ? p.covers.map((c) => `${c.subject} (${c.phase})`).join('; ') : 'No'}</td>
                <td className={td}>{p.skipped ? 'Taken off' : p.suggested ? 'Yes' : 'No'}</td>
                <td className={td}><button type="button" disabled={busy} className={btnPlain} onClick={() => onSkip(p.id, !p.skipped)}>{p.skipped ? 'Put back' : 'Take off'}</button></td>
              </tr>
            ))}
          </tbody></table>
      </div>
    </section>
  );
};

// ---- R6 ----------------------------------------------------------------------------------------------------------------------------------------------------------------
const WaveFunnel: React.FC<{ waves: WaveBlock[]; onCsv: () => void }> = ({ waves, onCsv }) => (
  <section className={card} aria-labelledby="wf-h">
    <div className="flex items-start justify-between gap-3">
      <div><h2 id="wf-h" className={h2}>Funnel by wave</h2>
        <p className={help}>For each wave: how many reached each step, the share of those released, the average and median days from the step before, and the oldest person waiting at that step. Wave 1 is the warm tutors. Test entries and tutors who were already here are not counted.</p></div>
      <button type="button" className={btnPlain} onClick={onCsv} disabled={waves.length === 0}>Download CSV</button>
    </div>
    {waves.length === 0 && <p className="text-xs text-slate-600">Nobody has been released into a wave yet.</p>}
    {waves.map((w) => (
      <div key={w.wave} className="mb-4">
        <h3 className="text-sm font-bold text-[#0F172A]">{waveName(w.wave)}</h3>
        <p className="text-xs text-slate-500 mb-1">{w.released} released, {w.messaged} messaged, {w.lapsed} lapsed, {w.declined} declined</p>
        <div className="overflow-x-auto"><table className="min-w-full"><thead><tr><th className={th}>Step</th><th className={th}>Reached</th><th className={th}>Of released</th><th className={th}>Average</th><th className={th}>Median</th><th className={th}>Oldest waiting</th></tr></thead>
          <tbody>{w.steps.map((s) => <tr key={s.key} className="border-t border-slate-100"><td className={td}>{s.label}</td><td className={td}>{s.n}</td><td className={td}>{pct(s.pct)}</td><td className={td}>{days(s.avgDays)}</td><td className={td}>{days(s.medianDays)}</td><td className={td}>{days(s.oldestDays)}</td></tr>)}</tbody></table></div>
      </div>
    ))}
  </section>
);

// ---- R10 --------------------------------------------------------------------------------------------------------------------------------------------------------------
const PipelinePanel: React.FC<{ p: Pipeline | null }> = ({ p }) => {
  if (!p) return <section className={card}><h2 className={h2}>Verification pipeline</h2><p className={help}>This part could not be loaded.</p></section>;
  return (
    <section className={card} aria-labelledby="pl-h">
      <h2 id="pl-h" className={h2}>Verification pipeline</h2>
      <p className={help}>All tutors, not only people from the list. A document set counts as complete from the moment the last required item went in. The promise on the page is a week.</p>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-3 text-center">
        {[['Waiting for a decision', String(p.waiting)], ['Oldest waiting', days(p.oldestDays)], ['Waiting over 7 days', String(p.over7)], ['Average to approval', days(p.avgDaysToApproval)], ['Longest decided wait', days(p.longestDecidedDays)]].map(([k, v]) => (
          <div key={k} className="rounded-lg border border-slate-200 p-2"><div className="text-lg font-extrabold text-[#0F172A]">{v}</div><div className="text-[11px] text-slate-500">{k}</div></div>
        ))}
      </div>
      <div className="overflow-x-auto"><table className="min-w-full"><thead><tr><th className={th}>Week from</th><th className={th}>Sets complete</th><th className={th}>Approved</th><th className={th}>Declined</th><th className={th}>Declines by reason</th><th className={th}>Average to approval</th><th className={th}>Longest</th></tr></thead>
        <tbody>{p.byWeek.map((w) => (
          <tr key={w.weekStart} className="border-t border-slate-100"><td className={td}>{shortDate(`${w.weekStart}T12:00:00+02:00`)}</td><td className={td}>{w.completed}</td><td className={td}>{w.approved}</td><td className={td}>{w.declined}</td>
            <td className={td}>{Object.keys(w.declines).length === 0 ? '–' : Object.entries(w.declines).map(([k, n]) => `${DECLINE_LABELS[k] ?? k} ${n}`).join(', ')}</td><td className={td}>{days(w.avgDays)}</td><td className={td}>{days(w.longestDays)}</td></tr>
        ))}</tbody></table></div>
      {Object.keys(p.declinesByReason).length > 0 && <p className="text-xs text-slate-600 mt-2">All declines so far: {Object.entries(p.declinesByReason).map(([k, n]) => `${DECLINE_LABELS[k] ?? k} ${n}`).join(', ')}.</p>}
    </section>
  );
};

// ---- R11 and R4 --------------------------------------------------------------------------------------------------------------------------------------------------
const RangeBar: React.FC<{ range: AnswerRange; onRange: (r: AnswerRange) => void }> = ({ range, onRange }) => {
  const [tag, setTag] = useState(range.src);
  return (
    <div className="flex flex-wrap items-center gap-2 mb-3">
      <button type="button" className={btnPlain} onClick={() => onRange({ ...ALL_TIME, src: tag })}>All time</button>
      <button type="button" className={btnPlain} onClick={() => onRange({ ...lastNDays(7), src: tag })}>Last 7 days</button>
      <button type="button" className={btnPlain} onClick={() => onRange({ ...lastNDays(30), src: tag })}>Last 30 days</button>
      <label className="text-[11px] font-bold text-slate-500">Tag <input className={`${input} w-24 ml-1`} value={tag} onChange={(e) => setTag(e.target.value)} onBlur={() => onRange({ ...range, src: tag })} placeholder="all" /></label>
      <span className="text-xs text-slate-500">{range.from ? `${range.from} to ${range.to}` : 'All time'}{range.src ? `, tag ${range.src}` : ''}</span>
    </div>
  );
};
const countLine = (m: Record<string, number>, labels?: Record<string, string>): string => (Object.keys(m).length === 0 ? '–' : Object.entries(m).map(([k, n]) => `${labels?.[k] ?? k}: ${n}`).join(', '));

const AnswersPanel: React.FC<{ answers: CallResult<Answers> | null; range: AnswerRange; onRange: (r: AnswerRange) => void }> = ({ answers, range, onRange }) => {
  const a = answers && answers.state === 'ok' ? answers.data : null;
  return (
    <section className={card} aria-labelledby="an-h">
      <h2 id="an-h" className={h2}>What the list looks like</h2>
      <p className={help}>Counts of the answers people gave on the form (people who joined from the page; test entries left out). Counts only: no names, emails or numbers.</p>
      <RangeBar range={range} onRange={onRange} />
      {!a ? <p className="text-xs text-slate-600">{answers ? sayState(answers) : 'Loading…'}</p> : (
        <dl className="text-xs text-slate-700 space-y-1.5">
          <div><dt className="inline font-bold">People: </dt><dd className="inline">{a.total}</dd></div>
          <div><dt className="inline font-bold">Police clearance: </dt><dd className="inline">{countLine(a.police, { have: 'has one', applied: 'applied', not_yet: 'not yet' })}</dd></div>
          <div><dt className="inline font-bold">Teaching practice: </dt><dd className="inline">{countLine(a.practicum, { none: 'none', one: 'one block', two: 'two blocks', three_plus: 'three or more' })}</dd></div>
          <div><dt className="inline font-bold">Parents they could tell: </dt><dd className="inline">{countLine(a.parentReach, { none: 'none', up_to_10: 'up to 10', '10_to_30': '10 to 30', over_30: 'more than 30' })}; would tell them: yes {a.willing.yes}, no {a.willing.no}</dd></div>
          <div><dt className="inline font-bold">Hours: </dt><dd className="inline">{countLine(a.availability, { evenings: 'evenings', weekends: 'weekends', holidays: 'holidays and December' })}</dd></div>
          <div><dt className="inline font-bold">Grade bands covered: </dt><dd className="inline">{countLine(a.bands)}</dd></div>
          <div><dt className="inline font-bold">Top subjects: </dt><dd className="inline">{a.topSubjects.length === 0 ? '–' : a.topSubjects.map((s) => `${s.subject} ${s.n}`).join(', ')}</dd></div>
          <div><dt className="inline font-bold">How they heard (of those, how many came with a registered tag): </dt><dd className="inline">{Object.keys(a.heard).length === 0 ? '–' : Object.entries(a.heard).map(([k, v]) => `${k === 'message' ? 'a message or group chat' : k}: ${v.n} (${v.withRegisteredTag})`).join(', ')}</dd></div>
          <div><dt className="inline font-bold">News and offers (box 2): </dt><dd className="inline">yes {a.consentNews.yes}, no {a.consentNews.no}</dd></div>
          <div><dt className="inline font-bold">They have: </dt><dd className="inline">{countLine(a.have, { device: 'a laptop or phone', connection: 'a connection', bank: 'a bank account' })}</dd></div>
        </dl>
      )}
    </section>
  );
};

const AbandonsPanel: React.FC<{ abandons: CallResult<Abandons> | null; range: AnswerRange; onRange: (r: AnswerRange) => void }> = ({ abandons, range, onRange }) => {
  const a = abandons && abandons.state === 'ok' ? abandons.data : null;
  return (
    <section className={card} aria-labelledby="ab-h">
      <h2 id="ab-h" className={h2}>Where people leave the form</h2>
      <p className={help}>Of the people who started typing and did not join: the last field each touched. Only the name of the field is kept, never what was typed. It starts counting once the page code that records it is published; until then everything reads &quot;No field recorded&quot;.</p>
      <RangeBar range={range} onRange={onRange} />
      {!a ? <p className="text-xs text-slate-600">{abandons ? sayState(abandons) : 'Loading…'}</p> : (
        <>
          <p className="text-xs text-slate-700 mb-2">{a.started} started, {a.joined} joined, {a.abandoned} left.</p>
          {a.byField.length === 0 ? <p className="text-xs text-slate-600">Nobody left yet.</p> : (
            <table className="min-w-full max-w-md"><thead><tr><th className={th}>Last field touched</th><th className={th}>People</th></tr></thead>
              <tbody>{a.byField.map((f) => <tr key={f.field} className="border-t border-slate-100"><td className={td}>{FIELD_LABELS[f.field] ?? f.field}</td><td className={td}>{f.n}</td></tr>)}</tbody></table>
          )}
        </>
      )}
    </section>
  );
};

// ---- R5 ----------------------------------------------------------------------------------------------------------------------------------------------------------------
const STEP_COLUMNS: { label: string; get: (r: StepRow) => string }[] = [
  { label: 'Joined', get: (r) => shortDate(r.joinedAt) }, { label: 'Released', get: (r) => shortDate(r.releasedAt) }, { label: 'Message sent', get: (r) => shortDate(r.releasedMessagedAt) },
  { label: 'Account', get: (r) => shortDate(r.accountAt) }, { label: 'Sign-up finished', get: (r) => shortDate(r.signupFinishedAt) }, { label: 'Documents started', get: (r) => shortDate(r.firstDocumentAt) },
  { label: 'Documents complete', get: (r) => shortDate(r.documentsCompleteAt) },
  { label: 'Approved / declined', get: (r) => (r.isVerified ? `Approved ${shortDate(r.approvedAt) || '(date not kept)'}` : r.isDeclined ? `Declined ${shortDate(r.declinedAt) || '(date not kept)'}${r.declineReason ? `: ${DECLINE_LABELS[r.declineReason] ?? r.declineReason}` : ''}` : '') },
  { label: 'Hours saved', get: (r) => (r.hoursSavedAt ? shortDate(r.hoursSavedAt) : r.hasHours ? 'Yes (date not kept)' : '') },
  { label: 'First request seen', get: (r) => shortDate(r.firstRequestSeenAt) }, { label: 'First lesson accepted', get: (r) => shortDate(r.firstAcceptedAt) },
  { label: 'First lesson done', get: (r) => shortDate(r.firstCompletedAt) }, { label: 'Second lesson done', get: (r) => shortDate(r.secondCompletedAt) },
  { label: 'Lapsed', get: (r) => shortDate(r.lapsedAt) }, { label: 'Last contacted', get: (r) => shortDate(r.lastContactedAt) },
];

const StepsTable: React.FC<{ rows: StepRow[]; filter: StepFilter; onFilter: (f: StepFilter) => void }> = ({ rows, filter, onFilter }) => {
  const shown = filterSteps(rows, filter);
  return (
    <section className={card} aria-labelledby="st-h">
      <h2 id="st-h" className={h2}>Every person, step by step</h2>
      <p className={help}>A date for each step each person has reached, worked out from their account, documents, requests and lessons. A blank means not reached yet. &quot;Date not kept&quot; is for things that happened before the dates were recorded. Test entries are shown with their tag.</p>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <label className="text-[11px] font-bold text-slate-500">Wave <select className={`${input} ml-1`} value={filter.wave} onChange={(e) => onFilter({ ...filter, wave: e.target.value })}>
          <option value="all">All</option><option value="none">Not in a wave</option>{waveOptions(rows).map((w) => <option key={w} value={String(w)}>{waveName(w)}</option>)}</select></label>
        <label className="text-[11px] font-bold text-slate-500">Furthest step <select className={`${input} ml-1`} value={filter.stage} onChange={(e) => onFilter({ ...filter, stage: e.target.value })}>
          <option value="all">Any</option>{STAGE_ORDER.map((s) => <option key={s} value={s}>{STAGE_LABELS[s]}</option>)}</select></label>
        <input className={`${input} w-48`} placeholder="Search by name" value={filter.search} onChange={(e) => onFilter({ ...filter, search: e.target.value })} />
        <button type="button" className={btnPlain} onClick={() => onFilter(NO_STEP_FILTER)}>Clear</button>
        <span className="text-xs text-slate-500">{shown.length} of {rows.length}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full">
          <thead><tr><th className={th}>Name</th><th className={th}>Wave</th><th className={th}>Furthest step</th>{STEP_COLUMNS.map((c) => <th key={c.label} className={th}>{c.label}</th>)}</tr></thead>
          <tbody>
            {shown.length === 0 && <tr><td className={td} colSpan={STEP_COLUMNS.length + 3}>Nobody matches.</td></tr>}
            {shown.map((r) => (
              <tr key={r.id} className="border-t border-slate-100">
                <td className={`${td} font-semibold`}>{r.fullName}{r.isTest ? ` (test: ${r.src})` : ''}</td><td className={td}>{r.wave ?? ''}</td><td className={td}>{STAGE_LABELS[r.stage] ?? r.stage}</td>
                {STEP_COLUMNS.map((c) => <td key={c.label} className={td}>{c.get(r)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
};

// ---- the whole page --------------------------------------------------------------------------------------------------------------------------------------------
export interface FoundingWavesBodyProps {
  result: WavesResult | null; error: string | null; notice: string | null; busy: boolean;
  filter: StepFilter; onFilter: (f: StepFilter) => void;
  answers: CallResult<Answers> | null; abandons: CallResult<Abandons> | null; range: AnswerRange; onRange: (r: AnswerRange) => void;
  onCsv: () => void; onSkip: (id: string, skip: boolean) => void; onCap: (cap: number) => void; onRelease: (ids: string[], wave: number) => void;
  onStopRule: (rule: number, open: boolean, note: string) => void; onRetry: () => void;
}

export const FoundingWavesBody: React.FC<FoundingWavesBodyProps> = (p) => {
  if (p.result === null) return <p className="text-sm text-slate-500">Loading…</p>;
  if (p.result.state !== 'ok') {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-700" role="status">
        {sayState(p.result)}
        {p.result.state === 'failed' && <button type="button" className={`${btnPlain} ml-3`} onClick={p.onRetry}>Try again</button>}
      </div>
    );
  }
  const d = p.result.data;
  return (
    <div>
      {p.error && <div className="mb-4 rounded-lg border border-red-300 bg-red-50 text-red-800 text-sm px-3 py-2" role="alert">{p.error}</div>}
      {p.notice && <div className="mb-4 rounded-lg border border-green-300 bg-green-50 text-green-900 text-sm px-3 py-2" role="status">{p.notice}</div>}
      <TriggerPanel t={d.triggers} busy={p.busy} onStopRule={p.onStopRule} />
      <SuggestionPanel s={d.suggestion} busy={p.busy} onSkip={p.onSkip} onCap={p.onCap} onRelease={p.onRelease} />
      <WaveFunnel waves={d.waves} onCsv={p.onCsv} />
      <PipelinePanel p={d.pipeline} />
      <AnswersPanel answers={p.answers} range={p.range} onRange={p.onRange} />
      <AbandonsPanel abandons={p.abandons} range={p.range} onRange={p.onRange} />
      <StepsTable rows={d.steps} filter={p.filter} onFilter={p.onFilter} />
    </div>
  );
};
