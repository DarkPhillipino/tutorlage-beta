import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { useAdminAuth } from '../lib/AuthContext';
import {
  NO_FILTER, addEntry, dailyCsv, deleteEntry, fetchFounding, fetchFunnel, lastDays, linkEntry, markMessaged, releaseEntries, releaseMessage, saveTags, setEntryStatus, setGate, waLink,
  type DayRange, type EntryFilter, type FoundingAdminClient, type FoundingEntry, type FoundingResult, type FoundingStatus, type NewEntry,
} from '../lib/founding';
import { FoundingBody } from '../components/FoundingBody';

const db = supabase as unknown as FoundingAdminClient;

// Founding tutors (CEO, 10 Nov 2026): the list of people who joined the public page, who to release next (the coverage view), the ready-made WhatsApp messages
// (the CEO sends them; this page sends nothing), the page's visitor counts, and the switch for the Teach gate. Opens cleanly before the database change is
// applied (a plain "not switched on yet").
export const FoundingTutors: React.FC = () => {
  const { adminProfile } = useAdminAuth();
  const [result, setResult] = useState<FoundingResult | null>(null);
  const [filter, setFilter] = useState<EntryFilter>(NO_FILTER);
  const [selected, setSelected] = useState<string[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [busyGate, setBusyGate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [range, setRange] = useState<DayRange>(() => lastDays(30));
  const [funnelLoading, setFunnelLoading] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  // The subjects opened this week, typed by the CEO for the "Still waiting" update (drafts 5b).
  const [waitingSubjects, setWaitingSubjects] = useState('');

  const load = useCallback(async (r: DayRange) => {
    setIsLoading(true);
    setResult(await fetchFounding(db, r));
    setIsLoading(false);
  }, []);

  useEffect(() => {
    void load(lastDays(30));
  }, [load]);

  const refresh = () => void load(range);

  const onRange = async (next: DayRange) => {
    setRange(next);
    setFunnelLoading(true);
    const funnel = await fetchFunnel(db, next);
    setResult((r) => (r && r.state === 'ok' ? { state: 'ok', data: { ...r.data, funnel: funnel ?? r.data.funnel } } : r));
    setFunnelLoading(false);
  };

  // R14: the daily counts as a CSV file (counts only: no names, emails or numbers).
  const onCsv = () => {
    const funnel = result && result.state === 'ok' ? result.data.funnel : null;
    const url = URL.createObjectURL(new Blob([dailyCsv(funnel)], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `founding-page-counts-${range.from}-to-${range.to}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const onSaveTags = async (tags: string[]): Promise<boolean> => {
    setError(null);
    setNotice(null);
    const problem = await saveTags(db, tags);
    if (problem) {
      setError(problem);
      return false;
    }
    setNotice('The tag list was saved.');
    await load(range);
    return true;
  };

  // "Remove and delete": really deletes the entry (our STOP messages promise it), after a confirm.
  const onDelete = (id: string) => {
    if (!window.confirm('Remove this person and delete their details for good? This cannot be undone.')) return;
    void run(id, () => deleteEntry(db, id));
  };

  const onToggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const onRelease = async (ids: string[], message?: FoundingEntry) => {
    setBusyId(message?.id ?? null);
    setError(null);
    setNotice(null);
    const r = await releaseEntries(db, ids);
    if (r.error) setError(r.error);
    else {
      setSelected([]);
      setNotice(`Released ${r.released}${r.skipped ? ` (${r.skipped} were not waiting, so left as they are)` : ''}. Open each person's message and send it from WhatsApp yourself.`);
      await load(range);
      // A single release also opens that person's ready-made message (the browser may block this; the row then offers the same link as a button).
      const link = message && r.released > 0 ? waLink(message.whatsapp, releaseMessage(message)) : null;
      if (link) window.open(link, '_blank', 'noopener,noreferrer');
    }
    setBusyId(null);
  };

  const run = async (id: string, action: () => Promise<string | null>) => {
    setBusyId(id);
    setError(null);
    setNotice(null);
    const problem = await action();
    if (problem) setError(problem);
    else await load(range);
    setBusyId(null);
  };

  const onMark = (id: string, kind: 'released' | 'verified' | 'waiting') => void run(id, () => markMessaged(db, id, kind));
  const onLink = async (id: string, email: string): Promise<boolean> => {
    setError(null);
    setNotice(null);
    const problem = await linkEntry(db, id, email);
    if (problem) {
      setError(problem);
      return false;
    }
    setNotice('The account was linked to that entry.');
    await load(range);
    return true;
  };
  const onStatus = (id: string, status: FoundingStatus) => void run(id, () => setEntryStatus(db, id, status));

  const onAdd = async (entry: NewEntry): Promise<boolean> => {
    setError(null);
    setNotice(null);
    const problem = await addEntry(db, entry);
    if (problem) {
      setError(problem);
      return false;
    }
    setNotice(`${entry.fullName.trim()} was added to the list.`);
    await load(range);
    return true;
  };

  const onGate = async (on: boolean) => {
    const sure = window.confirm(
      on
        ? 'Switch the Teach gate ON? From now on only people whose place has been released, and verified tutors, can use the tutor side. Everyone else sees the "join the list" or "wait to be verified" message.'
        : 'Switch the Teach gate OFF? Everybody goes back to behaving exactly as before.',
    );
    if (!sure) return;
    setBusyGate(true);
    setError(null);
    setNotice(null);
    const problem = await setGate(db, on);
    if (problem) setError(problem);
    else {
      setNotice(on ? 'The Teach gate is ON.' : 'The Teach gate is OFF.');
      await load(range);
    }
    setBusyGate(false);
  };

  return (
    <div className="max-w-6xl">
      <div className="flex items-start justify-between gap-3 mb-1">
        <h1 className="text-2xl font-extrabold text-[#0F172A]">Founding tutors</h1>
        <button
          type="button"
          onClick={refresh}
          disabled={isLoading}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50 cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>
      <p className="text-sm text-slate-500 mb-6 max-w-3xl">
        Everyone who joined the founding tutors page, newest first. Release a group, then open each person&apos;s ready-made WhatsApp message and send it yourself: this page
        never sends anything. Their details are deleted automatically on the date shown in each row.
      </p>
      <FoundingBody
        result={result}
        isSuperAdmin={adminProfile?.adminRole === 'super_admin'}
        filter={filter}
        onFilter={setFilter}
        selected={selected}
        onToggle={onToggle}
        onSelectMany={setSelected}
        busyId={busyId}
        busyGate={busyGate}
        error={error}
        notice={notice}
        range={range}
        funnelLoading={funnelLoading}
        onRange={(r) => void onRange(r)}
        onCsv={onCsv}
        onSaveTags={onSaveTags}
        onDelete={onDelete}
        onLink={onLink}
        waitingSubjects={waitingSubjects}
        onWaitingSubjects={setWaitingSubjects}
        onRelease={(ids, message) => void onRelease(ids, message)}
        onMark={onMark}
        onStatus={onStatus}
        onAdd={onAdd}
        onGate={(on) => void onGate(on)}
        onRetry={refresh}
      />
    </div>
  );
};
