import React, { useState } from 'react';
import { ListChecks, Loader2 } from 'lucide-react';
import {
  AVAILABILITY_LABELS, COUNT_AGAIN_LINK, EFFECTIVE_STATUSES, FOUNDING_NOT_ON_YET, FOUNDING_NO_ACCESS, HEARD_LABELS, NOCOUNT_LINK, PHASES, POLICE_LABELS, PRACTICUM_LABELS, REACH_LABELS, STATUS_LABELS,
  countsByStatus, describeAgo, filterEntries, lastDays, parseTags, rate, releaseMessage, subjectOptions, verifiedMessage, waLink, waDigits, waitingMessage,
  type CoverageRow, type DayRange, type EffectiveStatus, type EntryFilter, type FoundingEntry, type FoundingResult, type FoundingStatus, type Funnel, type FunnelRow, type GateCheck, type NewEntry,
} from '../lib/founding';

// The Founding tutors page, drawn (pure: the data and the actions come in as props, so a test can render every state). Everything a person typed on the
// public form is printed as plain text (React escapes it): nothing here is ever put on the page as HTML.

export type StatusFilter = EffectiveStatus | 'all';

export interface FoundingBodyProps {
  result: FoundingResult | null;
  isSuperAdmin: boolean;
  filter: EntryFilter;
  onFilter: (f: EntryFilter) => void;
  selected: string[];
  onToggle: (id: string) => void;
  onSelectMany: (ids: string[]) => void;
  busyId: string | null;
  busyGate: boolean;
  error: string | null;
  notice: string | null;
  range: DayRange;
  funnelLoading: boolean;
  onRange: (range: DayRange) => void;
  // R14: download the daily counts as a CSV (counts only).
  onCsv: () => void;
  // R3: save the registered tags; resolves true when saved.
  onSaveTags: (tags: string[]) => Promise<boolean>;
  // "Remove and delete": the person asked to be removed; the page confirms and really deletes the entry.
  onDelete: (id: string) => void;
  // Release these people; with `message` the page also opens that person's WhatsApp message afterwards (one person at a time).
  onRelease: (ids: string[], message?: FoundingEntry) => void;
  onMark: (id: string, kind: 'released' | 'verified' | 'waiting') => void;
  // "Link this account": link an entry to the tutor account that signed up with this email.
  onLink: (id: string, email: string) => Promise<boolean>;
  // The subjects opened this week (typed by the CEO): the "Still waiting" update's text needs them.
  waitingSubjects: string;
  onWaitingSubjects: (subjects: string) => void;
  onStatus: (id: string, status: FoundingStatus) => void;
  onAdd: (entry: NewEntry) => Promise<boolean>;
  onGate: (on: boolean) => void;
  onRetry: () => void;
}

const STATUS_TONE: Record<EffectiveStatus, string> = {
  joined: 'bg-amber-100 text-amber-800',
  lapsed: 'bg-rose-100 text-rose-800',
  released: 'bg-sky-100 text-sky-800',
  signed_up: 'bg-violet-100 text-violet-800',
  verified: 'bg-emerald-100 text-emerald-800',
};
const card = 'bg-white rounded-2xl border border-slate-200';
const btn = 'px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50 cursor-pointer';
const btnDark = 'px-3 py-1.5 rounded-lg bg-[#0F172A] text-white text-xs font-bold hover:bg-slate-800 disabled:opacity-50 cursor-pointer';
const btnGreen = 'inline-block px-3 py-1.5 rounded-lg bg-[#15803D] text-white text-xs font-bold hover:bg-[#166534] cursor-pointer';
const th = 'text-left text-[11px] font-bold text-slate-500 uppercase tracking-wider px-3 py-2';
const td = 'px-3 py-2 text-xs text-slate-700';

const when = (iso: string | null): string => (iso ? new Date(iso).toLocaleString() : '–');
const gradeRange = (s: { minGrade: string; maxGrade: string }): string => (s.minGrade === s.maxGrade ? s.minGrade : `${s.minGrade} to ${s.maxGrade}`);

// ---- the gate (P-4) ---------------------------------------------------------------------------------------------------------------------------------
const GateCard: React.FC<{ gate: GateCheck | null; isSuperAdmin: boolean; busy: boolean; onGate: (on: boolean) => void }> = ({ gate, isSuperAdmin, busy, onGate }) => {
  if (!gate) {
    return (
      <div data-gate-unknown className={`${card} p-4 mb-5`}>
        <h2 className="text-sm font-extrabold text-[#0F172A]">Teach gate</h2>
        <p className="text-xs text-slate-500 mt-1">The gate check could not be read just now. Refresh to try again.</p>
      </div>
    );
  }
  const blocked = gate.notListed > 0;
  return (
    <div data-gate={gate.gateOn ? 'on' : 'off'} className={`${card} p-4 mb-5`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-extrabold text-[#0F172A]">Teach gate</h2>
          <p className="text-xs text-slate-500 mt-0.5 max-w-xl">
            {gate.gateOn
              ? 'ON. Someone who is not on the list sees "join the list"; someone on the list but not released sees "wait to be verified"; a released tutor can upload documents; a verified tutor has the full tutor side.'
              : 'OFF. Everybody behaves exactly as before. Switch it on only after the read-back below is clean. Switch it off again at Phase 4 (Open).'}
          </p>
        </div>
        <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full shrink-0 ${gate.gateOn ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'}`}>{gate.gateOn ? 'ON' : 'OFF'}</span>
      </div>
      <div data-gate-readback className="grid grid-cols-2 sm:grid-cols-5 gap-2 mt-3">
        {[
          ['Tutor accounts', gate.tutorAccounts], ['Verified', gate.verified], ['Released', gate.released], ['Waiting', gate.waiting], ['Not on the list', gate.notListed],
        ].map(([label, n]) => (
          <div key={label as string} className={`rounded-xl border px-3 py-2 ${label === 'Not on the list' && blocked ? 'border-rose-200 bg-rose-50' : 'border-slate-200 bg-slate-50'}`}>
            <div className="text-lg font-extrabold text-[#0F172A]">{n as number}</div>
            <div className="text-[11px] font-semibold text-slate-500">{label as string}</div>
          </div>
        ))}
      </div>
      {blocked && (
        <div data-gate-blocked className="mt-3 text-xs text-rose-700">
          <p className="font-bold">These tutor accounts are not on the list. Add or release them (Add a person, below) before the gate can be switched on:</p>
          <p className="mt-1">{gate.notListedAccounts.map((a) => a.name).join(', ')}{gate.notListed > gate.notListedAccounts.length ? ` and ${gate.notListed - gate.notListedAccounts.length} more` : ''}</p>
        </div>
      )}
      <div className="mt-3 flex items-center gap-2">
        {gate.gateOn ? (
          <button type="button" disabled={!isSuperAdmin || busy} onClick={() => onGate(false)} className={btn}>Switch the gate OFF</button>
        ) : (
          <button type="button" disabled={!isSuperAdmin || busy || blocked} onClick={() => onGate(true)} className={btnDark}>Switch the gate ON</button>
        )}
        {!isSuperAdmin && <span className="text-[11px] text-slate-500">Only a super admin can switch it.</span>}
        {busy && <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-400" />}
      </div>
    </div>
  );
};

// ---- the page counts (R1, R2, R3, R14) -----------------------------------------------------------------------------------------------------------------
const CountsTable: React.FC<{ rows: FunnelRow[]; first: 'day' | 'hour' | 'src'; dataAttr: string; limit?: number }> = ({ rows, first, dataAttr, limit = 200 }) => (
  <div className="overflow-x-auto max-h-80 overflow-y-auto">
    <table className="w-full" {...{ [dataAttr]: '' }}>
      <thead className="sticky top-0 bg-white">
        <tr>
          {first === 'src' ? <th className={th}>Tag (?src=)</th> : <><th className={th}>{first === 'day' ? 'Day' : 'Hour'}</th><th className={th}>Tag</th></>}
          <th className={th}>Opens</th><th className={th}>New visitors</th><th className={th}>See more (first)</th><th className={th}>Form started (first)</th><th className={th}>Joined</th>
        </tr>
      </thead>
      <tbody>
        {rows.slice(0, limit).map((r) => (
          <tr key={`${r.day ?? r.hour ?? ''}:${r.src}`} className="border-t border-slate-100">
            {first !== 'src' && <td className={td}>{first === 'day' ? r.day : r.hour}</td>}
            <td className={`${td} ${first === 'src' ? 'font-bold' : ''}`}>{r.src}{r.registered === false ? <span className="ml-1.5 text-[10px] font-bold text-amber-700 bg-amber-100 rounded px-1">not in registry</span> : null}</td>
            <td className={td}>{r.opens}</td><td className={td}>{r.visitors}</td><td className={td}>{r.seeMore}</td><td className={td}>{r.formStart}</td><td className={td}>{r.joins}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

const TagsEditor: React.FC<{ tags: string[]; onSave: (tags: string[]) => Promise<boolean> }> = ({ tags, onSave }) => {
  const [value, setValue] = useState(tags.join(', '));
  const [saving, setSaving] = useState(false);
  return (
    <details data-tags className="mt-3">
      <summary className="text-xs font-bold text-slate-600 cursor-pointer">Registered tags ({tags.length})</summary>
      <p className="text-[11px] text-slate-500 mt-1 max-w-2xl">
        Marketing registers every tag before a link is used. A tag seen on the page that is not here still counts, and is listed under &quot;not in the registry&quot; so a typo shows the same day.
        Tags that start with <strong>test</strong> are never counted. A * at the end registers every tag that starts that way (for example ref-*).
      </p>
      <form className="mt-2 flex flex-wrap items-center gap-2" onSubmit={async (ev) => { ev.preventDefault(); setSaving(true); await onSave(parseTags(value)); setSaving(false); }}>
        <input aria-label="Registered tags" className="flex-1 min-w-64 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs text-[#0F172A]" value={value} onChange={(e) => setValue(e.target.value)} placeholder="f1, f1-n1, f1-n2, ceo, app, ref-*" />
        <button type="submit" disabled={saving} className={btnDark}>{saving ? 'Saving…' : 'Save tags'}</button>
      </form>
    </details>
  );
};

const FunnelCard: React.FC<{
  funnel: Funnel | null; hourly: FunnelRow[]; tags: string[]; range: DayRange; loading: boolean; onRange: (r: DayRange) => void; onCsv: () => void; onSaveTags: (tags: string[]) => Promise<boolean>;
}> = ({ funnel, hourly, tags, range, loading, onRange, onCsv, onSaveTags }) => {
  if (!funnel) {
    return (
      <div data-funnel-unknown className={`${card} p-4 mb-5`}>
        <h2 className="text-sm font-extrabold text-[#0F172A]">Page counts</h2>
        <p className="text-xs text-slate-500 mt-1">The page counts could not be read just now.</p>
      </div>
    );
  }
  const t = funnel.totals;
  const cells: [string, string | number][] = [
    ['Opens', t.opens], ['New visitors', t.visitors], ['See more (first)', t.seeMore], ['Form started (first)', t.formStart], ['Joined', t.joins], ['Joined per visitor', rate(t.joins, t.visitors)],
  ];
  const dateInput = 'bg-white border border-slate-200 rounded-lg px-2 py-1 text-[11px] text-slate-700';
  return (
    <div data-funnel className={`${card} p-4 mb-5`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-extrabold text-[#0F172A]">Page counts (the founding tutors page)</h2>
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Period">
          {[7, 14, 30].map((d) => {
            const r = lastDays(d);
            return (
              <button key={d} type="button" aria-pressed={range.from === r.from && range.to === r.to} onClick={() => onRange(r)} className={`px-2.5 py-1 rounded-full text-[11px] font-bold cursor-pointer ${range.from === r.from && range.to === r.to ? 'bg-[#0F172A] text-white' : 'bg-white border border-slate-200 text-slate-600'}`}>
                {d} days
              </button>
            );
          })}
          <input aria-label="From day" type="date" className={dateInput} value={range.from} onChange={(e) => e.target.value && onRange({ ...range, from: e.target.value })} />
          <input aria-label="To day" type="date" className={dateInput} value={range.to} onChange={(e) => e.target.value && onRange({ ...range, to: e.target.value })} />
          {loading && <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-400" />}
        </div>
      </div>
      <p className="text-[11px] text-slate-500 mt-0.5 max-w-3xl">
        South African days. <strong>Opens</strong> count every page load under the tag the link carried. <strong>New visitors</strong>, <strong>See more</strong> and <strong>Form started</strong> count each
        visitor once, the first time, under their first tag, so the days add up to the total. Counted only after the page ran in a browser; tags starting &quot;test&quot; and browsers switched off
        are not counted. Visitors are a random number in the browser, so one person on two browsers counts twice (about 10 to 20 percent too many); ad blockers and cleared browsers count too few.
      </p>
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mt-3">
        {cells.map(([label, n]) => (
          <div key={label} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
            <div className="text-lg font-extrabold text-[#0F172A]">{n}</div>
            <div className="text-[11px] font-semibold text-slate-500">{label}</div>
          </div>
        ))}
      </div>
      {funnel.unregistered.length > 0 && (
        <p data-unregistered className="mt-3 text-xs font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          Tags not in the registry: {funnel.unregistered.join(', ')}
        </p>
      )}
      {funnel.bySrc.length === 0 ? (
        <p className="text-xs text-slate-500 mt-3">Nobody has opened the page in this period yet.</p>
      ) : (
        <div className="mt-3"><CountsTable rows={funnel.bySrc} first="src" dataAttr="data-funnel-src" /></div>
      )}
      <div className="mt-4 flex items-center justify-between gap-3">
        <h3 className="text-xs font-extrabold text-[#0F172A]">By day</h3>
        <button type="button" onClick={onCsv} className={btn} data-csv>Download CSV (counts only)</button>
      </div>
      {funnel.byDay.length === 0 ? <p className="text-xs text-slate-500 mt-1">No days to show.</p> : <div className="mt-1"><CountsTable rows={funnel.byDay} first="day" dataAttr="data-funnel-day" limit={400} /></div>}
      <details className="mt-3" data-hourly>
        <summary className="text-xs font-bold text-slate-600 cursor-pointer">By hour, last 72 hours (send day)</summary>
        {hourly.length === 0 ? <p className="text-xs text-slate-500 mt-1">Nothing in the last 72 hours.</p> : <div className="mt-1"><CountsTable rows={hourly} first="hour" dataAttr="data-funnel-hour" limit={400} /></div>}
      </details>
      <TagsEditor key={tags.join('|')} tags={tags} onSave={onSaveTags} />
      <p className="mt-3 text-[11px] text-slate-500 max-w-3xl">
        Do not count your own browser: open <a className="underline font-semibold" href={NOCOUNT_LINK} target="_blank" rel="noopener noreferrer">{NOCOUNT_LINK}</a> once in it. To count it again, open{' '}
        <a className="underline font-semibold" href={COUNT_AGAIN_LINK} target="_blank" rel="noopener noreferrer">{COUNT_AGAIN_LINK}</a>.
      </p>
    </div>
  );
};

// ---- the coverage view (R7) ---------------------------------------------------------------------------------------------------------------------------
const STATUS_BADGE: Record<CoverageRow['status'], string> = { OPEN: 'bg-emerald-100 text-emerald-800', THIN: 'bg-amber-100 text-amber-800', EMPTY: 'bg-slate-100 text-slate-600' };
const CoverageCard: React.FC<{ rows: CoverageRow[] }> = ({ rows }) => (
  <div data-coverage className={`${card} p-4 mb-5`}>
    <h2 className="text-sm font-extrabold text-[#0F172A]">Coverage: where to release next</h2>
    <p className="text-[11px] text-slate-500 mt-0.5 max-w-3xl">
      Per subject and grade band. <strong>Ready tutors</strong> are verified, have an approved subject for that band and have saved hours; OPEN is 3 or more, THIN 1 or 2, EMPTY none. Requests, accepted, unserved
      (still pending after 24 hours) and expired are the last 30 days. A band is counted when a person&apos;s grades touch it. &quot;Demand, no supply&quot; means requests exist but fewer than 3 ready tutors.
    </p>
    {rows.length === 0 ? (
      <p className="text-xs text-slate-500 mt-3">Nothing to show yet.</p>
    ) : (
      <div className="overflow-x-auto mt-2 max-h-96 overflow-y-auto">
        <table className="w-full">
          <thead className="sticky top-0 bg-white">
            <tr>
              <th className={th}>Subject</th><th className={th}>Band</th><th className={th}>On the list</th><th className={th}>Released</th><th className={th}>Verified</th><th className={th}>Ready tutors</th><th className={th}>Weekly hours</th>
              <th className={th}>Requests</th><th className={th}>Accepted</th><th className={th}>Unserved</th><th className={th}>Expired</th><th className={th}>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.subject}:${r.phase}`} className="border-t border-slate-100">
                <td className={`${td} font-bold`}>{r.subject}</td><td className={td}>{r.phase}</td><td className={td}>{r.onList}</td><td className={td}>{r.released}</td><td className={td}>{r.verified}</td>
                <td className={td}>{r.readyTutors}</td><td className={td}>{r.weeklyHours}</td><td className={td}>{r.requests}</td><td className={td}>{r.accepted}</td>
                <td className={`${td} ${r.demandNoSupply && r.unservedRequests > 0 ? 'text-rose-700 font-bold' : ''}`}>{r.unservedRequests}</td><td className={td}>{r.expired}</td>
                <td className={td}>
                  <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${STATUS_BADGE[r.status]}`}>{r.status}</span>
                  {r.demandNoSupply && <span className="ml-1.5 text-[10px] font-bold text-rose-700">demand, no supply</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )}
  </div>
);

// ---- add a person -------------------------------------------------------------------------------------------------------------------------------------
const AddCard: React.FC<{ onAdd: (e: NewEntry) => Promise<boolean> }> = ({ onAdd }) => {
  const empty: NewEntry = { fullName: '', codeName: '', whatsapp: '', email: '', status: 'released' };
  const [e, setE] = useState<NewEntry>(empty);
  const [saving, setSaving] = useState(false);
  const input = 'w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[#15803D]/20';
  return (
    <details data-add className={`${card} p-4 mb-5`}>
      <summary className="text-sm font-extrabold text-[#0F172A] cursor-pointer">Add a person (a warm tutor you already know)</summary>
      <p className="text-[11px] text-slate-500 mt-2 max-w-2xl">
        They are put on the list by hand, with no form consent recorded. Use the same email they will sign up with: that is how the app knows which account is theirs.
        &quot;Released&quot; lets them upload their documents as soon as they sign up.
      </p>
      <form
        className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-3"
        onSubmit={async (ev) => {
          ev.preventDefault();
          setSaving(true);
          const ok = await onAdd(e);
          setSaving(false);
          if (ok) setE(empty);
        }}
      >
        <label className="text-[11px] font-bold text-slate-500">Full name<input className={input} value={e.fullName} onChange={(x) => setE({ ...e, fullName: x.target.value })} required maxLength={100} /></label>
        <label className="text-[11px] font-bold text-slate-500">Name for the link<input className={input} value={e.codeName} onChange={(x) => setE({ ...e, codeName: x.target.value })} required maxLength={30} /></label>
        <label className="text-[11px] font-bold text-slate-500">WhatsApp number<input className={input} value={e.whatsapp} onChange={(x) => setE({ ...e, whatsapp: x.target.value })} required inputMode="tel" placeholder="082 123 4567" /></label>
        <label className="text-[11px] font-bold text-slate-500">Sign-up email<input className={input} type="email" value={e.email} onChange={(x) => setE({ ...e, email: x.target.value })} required /></label>
        <label className="text-[11px] font-bold text-slate-500">Start as
          <select className={input} value={e.status} onChange={(x) => setE({ ...e, status: x.target.value as NewEntry['status'] })}>
            <option value="released">Released</option><option value="joined">On the list</option><option value="verified">Verified</option>
          </select>
        </label>
        <div className="flex items-end"><button type="submit" disabled={saving} className={btnDark}>{saving ? 'Adding…' : 'Add to the list'}</button></div>
      </form>
    </details>
  );
};

// "Link this account": the person signed up with a different email from the one they gave the list. Type the email they signed up with; the entry is linked to that tutor account.
const LinkAccount: React.FC<{ id: string; onLink: FoundingBodyProps['onLink'] }> = ({ id, onLink }) => {
  const [email, setEmail] = useState('');
  const [saving, setSaving] = useState(false);
  return (
    <details data-link-account className="mt-2">
      <summary className="text-[11px] font-bold text-slate-500 cursor-pointer">No account found? Link an account</summary>
      <form
        className="mt-1.5 flex flex-wrap items-center gap-2"
        onSubmit={async (ev) => {
          ev.preventDefault();
          setSaving(true);
          const ok = await onLink(id, email);
          setSaving(false);
          if (ok) setEmail('');
        }}
      >
        <input aria-label="The email they signed up with" type="email" required className="flex-1 min-w-56 bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-xs text-[#0F172A]" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="the email they signed up with" />
        <button type="submit" disabled={saving} className={btn}>{saving ? 'Linking…' : 'Link'}</button>
      </form>
    </details>
  );
};
// ---- one person ----------------------------------------------------------------------------------------------------------------------------------------
const EntryRow: React.FC<{
  row: FoundingEntry; busy: boolean; checked: boolean; onToggle: (id: string) => void;
  onRelease: FoundingBodyProps['onRelease']; onMark: FoundingBodyProps['onMark']; onStatus: FoundingBodyProps['onStatus']; onDelete: FoundingBodyProps['onDelete'];
  onLink: FoundingBodyProps['onLink']; waitingSubjects: string;
}> = ({ row, busy, checked, onToggle, onRelease, onMark, onStatus, onDelete, onLink, waitingSubjects }) => {
  const status = row.effectiveStatus;
  const name = row.fullName || row.codeName || '(existing tutor)';
  const releaseLink = waLink(row.whatsapp, releaseMessage(row));
  const verifiedLink = waLink(row.whatsapp, verifiedMessage(row));
  // The "Still waiting" update (drafts 5b) for everyone who is not released: built only once the CEO has typed the subjects opened this week.
  const waitingLink = waitingSubjects.trim() ? waLink(row.whatsapp, waitingMessage(row, waitingSubjects)) : null;
  const hasNumber = waDigits(row.whatsapp) !== null;
  return (
    <div data-entry={status} className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          {row.status === 'joined' && (
            <input type="checkbox" aria-label={`Select ${name}`} checked={checked} onChange={() => onToggle(row.id)} className="mt-1 h-4 w-4 accent-[#15803D]" />
          )}
          <div className="min-w-0">
            <div className="text-sm font-bold text-[#0F172A]">
              {name}{row.codeName && row.codeName !== name ? <span className="font-semibold text-slate-500"> ({row.codeName})</span> : null}
              {row.source === 'backfill' && <span className="ml-2 text-[11px] font-semibold text-slate-400">existing tutor account</span>}
              {row.source === 'admin' && <span className="ml-2 text-[11px] font-semibold text-slate-400">added by hand</span>}
            </div>
            <div className="text-[11px] text-slate-500 break-words">
              {row.whatsapp ?? 'no number'} · {row.email ?? 'no email'}{row.createdAt ? ` · joined ${new Date(row.createdAt).toLocaleDateString()} (${describeAgo(row.createdAt)})` : ''}{row.src ? ` · tag ${row.src}` : ''}
            </div>
            {row.subjects.length > 0 && (
              <div className="text-xs text-slate-700 mt-1 break-words">{row.subjects.map((s) => `${s.subject} (${gradeRange(s)})`).join('; ')}</div>
            )}
            {row.phases.length > 0 && <div className="text-[11px] text-slate-400">{row.phases.join(' · ')}</div>}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${STATUS_TONE[status]}`}>{STATUS_LABELS[status]}</span>
          {row.hasAccount && status !== 'verified' && <span className="text-[11px] text-slate-400">has an account</span>}
          {row.weeklyHours > 0 && <span className="text-[11px] text-slate-400">{row.weeklyHours} h a week set</span>}
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {(status === 'joined' || status === 'lapsed') && (
          <button type="button" disabled={busy} onClick={() => onRelease([row.id], row)} className={btnDark}>{status === 'lapsed' ? 'Release again' : 'Release'}</button>
        )}
        {status === 'lapsed' && row.lapsedAt && <span className="text-[11px] text-rose-700">Lapsed {describeAgo(row.lapsedAt)}: no account within the time</span>}
        {(status === 'joined' || status === 'lapsed') && (
          <>
            {waitingLink ? (
              <a href={waitingLink} target="_blank" rel="noopener noreferrer" data-waiting-link className={btnGreen}>Still waiting: message ready</a>
            ) : (
              <span data-waiting-needs-subjects className="text-[11px] text-slate-400">{hasNumber ? 'Type the subjects opened this week (above the list) to build the Still waiting message' : 'no WhatsApp number'}</span>
            )}
            {row.waitingMessagedAt ? (
              <span className="text-[11px] text-slate-500">Still-waiting message sent {describeAgo(row.waitingMessagedAt)}</span>
            ) : (
              waitingLink && <button type="button" disabled={busy} onClick={() => onMark(row.id, 'waiting')} className={btn}>Mark as messaged</button>
            )}
          </>
        )}
        {(status === 'released' || status === 'signed_up') && (
          <>
            {releaseLink ? <a href={releaseLink} target="_blank" rel="noopener noreferrer" data-release-link className={btnGreen}>Open the &quot;place open&quot; message</a> : <span className="text-[11px] text-slate-400">no WhatsApp number</span>}
            {row.releasedMessagedAt ? (
              <span className="text-[11px] text-slate-500">Messaged {describeAgo(row.releasedMessagedAt)}</span>
            ) : (
              hasNumber && <button type="button" disabled={busy} onClick={() => onMark(row.id, 'released')} className={btn}>Mark as messaged</button>
            )}
          </>
        )}
        {status === 'verified' && (
          <>
            {verifiedLink && row.ready ? (
              <a href={verifiedLink} target="_blank" rel="noopener noreferrer" data-verified-link className={btnGreen}>Verified: message ready</a>
            ) : verifiedLink ? (
              // Not ready: the message would promise requests that this tutor cannot get yet, so the button waits and says what is missing.
              <span data-not-ready className="inline-flex flex-wrap items-center gap-1.5">
                <button type="button" disabled className="px-3 py-1.5 rounded-lg bg-slate-200 text-slate-500 text-xs font-bold cursor-not-allowed">Verified: message not ready</button>
                <span className="text-[11px] font-semibold text-amber-700">Missing: {row.missing.length > 0 ? row.missing.join(', ') : 'checking failed; refresh'}</span>
              </span>
            ) : <span className="text-[11px] text-slate-400">no WhatsApp number</span>}
            {row.verifiedMessagedAt ? (
              <span className="text-[11px] text-slate-500">Messaged {describeAgo(row.verifiedMessagedAt)}</span>
            ) : (
              hasNumber && <button type="button" disabled={busy} onClick={() => onMark(row.id, 'verified')} className={btn}>Mark as messaged</button>
            )}
          </>
        )}
        {row.status !== 'joined' && row.source !== 'backfill' && (
          <button type="button" disabled={busy} onClick={() => onStatus(row.id, 'joined')} className="text-[11px] font-bold text-slate-400 hover:text-slate-600 underline cursor-pointer">Back to the list</button>
        )}
        {row.source !== 'backfill' && (
          <button type="button" disabled={busy} onClick={() => onDelete(row.id)} data-delete className="text-[11px] font-bold text-rose-600 hover:text-rose-800 underline cursor-pointer">Remove and delete</button>
        )}
        {busy && <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-400" />}
      </div>

      {!row.hasAccount && row.source !== 'backfill' && <LinkAccount id={row.id} onLink={onLink} />}
      <details className="mt-2">
        <summary className="text-[11px] font-bold text-slate-500 cursor-pointer">Details</summary>
        <dl className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-xs text-slate-700">
          <div><dt className="inline font-bold">Teaching practice: </dt><dd className="inline">{PRACTICUM_LABELS[row.practicum] ?? '–'}</dd></div>
          <div><dt className="inline font-bold">Police clearance: </dt><dd className="inline">{POLICE_LABELS[row.policeClearance] ?? '–'}</dd></div>
          <div><dt className="inline font-bold">Parents they could tell: </dt><dd className="inline">{REACH_LABELS[row.parentReach] ?? '–'}{row.parentReachWilling === null ? '' : row.parentReachWilling ? ', would tell them' : ', would not'}</dd></div>
          <div><dt className="inline font-bold">Could teach: </dt><dd className="inline">{row.availability.map((a) => AVAILABILITY_LABELS[a] ?? a).join(', ') || '–'}</dd></div>
          <div><dt className="inline font-bold">Unavailable: </dt><dd className="inline">{row.unavailableWeeks || '–'}</dd></div>
          <div><dt className="inline font-bold">Heard about it: </dt><dd className="inline">{HEARD_LABELS[row.heardFrom] ?? '–'}</dd></div>
          <div><dt className="inline font-bold">Has: </dt><dd className="inline">{[row.hasDevice && 'device with a camera', row.hasConnection && 'reliable connection', row.hasBank && 'own bank account'].filter(Boolean).join(', ') || 'none ticked'}</dd></div>
          <div><dt className="inline font-bold">Tutored before: </dt><dd className="inline break-words">{row.priorTutoring || '–'}</dd></div>
          <div><dt className="inline font-bold">Consent to contact: </dt><dd className="inline">{when(row.consentContactAt)}</dd></div>
          <div><dt className="inline font-bold">Consent to news and offers: </dt><dd className="inline">{row.consentMarketingAt ? when(row.consentMarketingAt) : 'not given'}</dd></div>
          <div><dt className="inline font-bold">Wording version: </dt><dd className="inline">{row.consentVersion || '–'}</dd></div>
          <div><dt className="inline font-bold">Released: </dt><dd className="inline">{when(row.releasedAt)}</dd></div>
          <div><dt className="inline font-bold">Details deleted on: </dt><dd className="inline">{row.deleteAfter ? new Date(row.deleteAfter).toLocaleDateString() : 'kept (a tutor)'}</dd></div>
        </dl>
      </details>
    </div>
  );
};

// ---- the whole page ----------------------------------------------------------------------------------------------------------------------------------------
export const FoundingBody: React.FC<FoundingBodyProps> = (p) => {
  const { result } = p;
  if (result === null) {
    return (
      <div className="flex items-center justify-center py-16 text-slate-400">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        <span className="text-sm font-semibold">Loading the founding tutors list…</span>
      </div>
    );
  }
  if (result.state === 'not_set_up') {
    return (
      <div data-founding-not-set-up className={`${card} p-8 text-center`}>
        <ListChecks className="w-8 h-8 text-slate-300 mx-auto mb-2" />
        <p className="text-sm font-bold text-[#0F172A]">Nobody on the list yet</p>
        <p className="text-xs text-slate-500 mt-1">{FOUNDING_NOT_ON_YET}</p>
      </div>
    );
  }
  if (result.state === 'no_access') {
    return <div role="alert" className="bg-amber-50 border border-amber-200 text-amber-800 rounded-2xl p-4 text-sm">{FOUNDING_NO_ACCESS}</div>;
  }
  if (result.state === 'failed') {
    return (
      <div role="alert" className="bg-red-50 border border-red-200 text-red-700 rounded-2xl p-4 text-sm">
        The founding tutors list could not be loaded: {result.message}{' '}
        <button type="button" onClick={p.onRetry} className="font-bold underline cursor-pointer">Try again</button>
      </div>
    );
  }

  const { entries, coverage, funnel, hourly, tags, gate } = result.data;
  const counts = countsByStatus(entries);
  const shown = filterEntries(entries, p.filter);
  const releasable = shown.filter((r) => r.status === 'joined').map((r) => r.id);   // 'joined' includes the lapsed (they go back to the list)
  const subjects = subjectOptions(entries);
  const tabs: { key: StatusFilter; label: string }[] = [{ key: 'all', label: 'All' }, ...EFFECTIVE_STATUSES.map((s) => ({ key: s as StatusFilter, label: STATUS_LABELS[s] }))];
  const select = 'bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-700';

  return (
    <>
      <GateCard gate={gate} isSuperAdmin={p.isSuperAdmin} busy={p.busyGate} onGate={p.onGate} />
      <FunnelCard funnel={funnel} hourly={hourly} tags={tags} range={p.range} loading={p.funnelLoading} onRange={p.onRange} onCsv={p.onCsv} onSaveTags={p.onSaveTags} />
      <CoverageCard rows={coverage} />
      <AddCard onAdd={p.onAdd} />

      <div role="tablist" aria-label="Filter by status" className="flex flex-wrap gap-2 mb-3">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={p.filter.status === t.key}
            onClick={() => p.onFilter({ ...p.filter, status: t.key })}
            className={`px-3 py-1.5 rounded-full text-xs font-bold cursor-pointer ${p.filter.status === t.key ? 'bg-[#0F172A] text-white' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'}`}
          >
            {t.label} ({counts[t.key]})
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <select aria-label="Filter by subject" className={select} value={p.filter.subject} onChange={(e) => p.onFilter({ ...p.filter, subject: e.target.value })}>
          <option value="">All subjects</option>
          {subjects.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select aria-label="Filter by phase" className={select} value={p.filter.phase} onChange={(e) => p.onFilter({ ...p.filter, phase: e.target.value })}>
          <option value="">All phases</option>
          {PHASES.map((ph) => <option key={ph} value={ph}>{ph}</option>)}
        </select>
        <input aria-label="Search the list" placeholder="Search name, email or number" className={`${select} w-64`} value={p.filter.search} onChange={(e) => p.onFilter({ ...p.filter, search: e.target.value })} />
        <span className="text-[11px] text-slate-500">{shown.length} shown</span>
      </div>

      {(p.error || p.notice) && (
        <p role={p.error ? 'alert' : 'status'} className={`text-xs font-semibold mb-3 ${p.error ? 'text-rose-600' : 'text-emerald-700'}`}>{p.error ?? p.notice}</p>
      )}

      <div data-waiting-subjects className="flex flex-wrap items-center gap-2 mb-3">
        <label className="text-[11px] font-bold text-slate-500" htmlFor="waiting-subjects">Subjects opened this week (for the Still waiting update)</label>
        <input id="waiting-subjects" className="flex-1 min-w-64 bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-xs text-[#0F172A]" value={p.waitingSubjects} onChange={(e) => p.onWaitingSubjects(e.target.value)} placeholder="for example Mathematics and Physical Sciences" maxLength={200} />
        <span className="text-[11px] text-slate-500">Then each person on the list gets a ready-made message link; you send it yourself.</span>
      </div>

      {releasable.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <button type="button" onClick={() => p.onSelectMany(releasable)} className={btn}>Select everyone shown who is waiting ({releasable.length})</button>
          <button type="button" disabled={p.selected.length === 0} onClick={() => p.onRelease(p.selected)} className={btnDark}>Release selected ({p.selected.length})</button>
          <span className="text-[11px] text-slate-500">Releasing sets the status only; then open each person&apos;s message below and send it yourself.</span>
        </div>
      )}

      {shown.length === 0 ? (
        <div className={`${card} p-12 text-center`}>
          <ListChecks className="w-8 h-8 text-slate-300 mx-auto mb-2" />
          <p className="text-sm font-bold text-[#0F172A]">{entries.length === 0 ? 'Nobody on the list yet' : 'Nobody matches those filters'}</p>
          <p className="text-xs text-slate-500 mt-1">{entries.length === 0 ? 'People who fill in the founding tutors page appear here, newest first.' : 'Change a filter above.'}</p>
        </div>
      ) : (
        <div className={`${card} divide-y divide-slate-100 overflow-hidden`}>
          {shown.map((row) => (
            <EntryRow
              key={`${row.id}:${row.status}:${row.releasedMessagedAt ?? ''}:${row.verifiedMessagedAt ?? ''}:${row.waitingMessagedAt ?? ''}:${row.hasAccount}`}
              row={row}
              busy={p.busyId === row.id}
              checked={p.selected.includes(row.id)}
              onToggle={p.onToggle}
              onRelease={p.onRelease}
              onMark={p.onMark}
              onStatus={p.onStatus}
              onDelete={p.onDelete}
              onLink={p.onLink}
              waitingSubjects={p.waitingSubjects}
            />
          ))}
        </div>
      )}
    </>
  );
};
