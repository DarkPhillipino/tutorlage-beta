import React, { useState } from 'react';
import { AlertCircle, UserX } from 'lucide-react';
import {
  ActionResult,
  ClosureList,
  ClosureRow,
  ClosuresClient,
  DeferForm,
  ROLE_LABELS,
  STARTED_LABELS,
  STATUS_LABELS,
  UndoForm,
  canDefer,
  canUndo,
  clearDeferral,
  deferClosure,
  emptyDeferForm,
  emptyUndoForm,
  undoClosure,
} from '../lib/accountClosures';
import { formatWhen } from '../lib/safetyHold';

// The list on the "Account closures" screen (loaded by pages/AccountClosures.tsx): who, role, requested, day-30 date, status, held or not,
// deferred. Kept apart from the page so it can be drawn in a test. Each open closure carries its own undo and defer forms.

const inputClass = 'w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[#15803D]/20';
const labelClass = 'block text-[11px] font-bold text-slate-500 mb-1';
const buttonClass = 'px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer disabled:opacity-50';

export const AccountClosuresBody: React.FC<{
  list: ClosureList;
  client: ClosuresClient;
  onChanged: () => void;
  now?: Date;
}> = ({ list, client, onChanged, now }) => {
  if (list.state === 'not_active') {
    return (
      <div role="status" className="flex items-start gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
        <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
        {list.note}
      </div>
    );
  }
  if (list.rows.length === 0) {
    return (
      <div className="bg-white rounded-2xl p-12 border border-slate-200 text-center">
        <UserX className="w-8 h-8 text-slate-300 mx-auto mb-2" />
        <p className="text-sm font-bold text-[#0F172A]">No account is waiting to be deleted</p>
        <p className="text-xs text-slate-500 mt-1">A closed account stays here until its details are deleted, 30 days after it was closed.</p>
      </div>
    );
  }
  return (
    <div className="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-100 overflow-hidden">
      {list.rows.map((r) => (
        <ClosureRowCard key={r.closureId} row={r} client={client} onChanged={onChanged} now={now} />
      ))}
    </div>
  );
};

const Pill: React.FC<{ tone: 'rose' | 'amber' | 'slate'; children: React.ReactNode }> = ({ tone, children }) => {
  const tones = { rose: 'bg-rose-50 text-rose-800 border-rose-200', amber: 'bg-amber-50 text-amber-800 border-amber-200', slate: 'bg-slate-50 text-slate-600 border-slate-200' };
  return <span className={`inline-block text-[11px] font-bold px-2 py-0.5 rounded-full border ${tones[tone]}`}>{children}</span>;
};

const ClosureRowCard: React.FC<{ row: ClosureRow; client: ClosuresClient; onChanged: () => void; now?: Date }> = ({ row, client, onChanged, now }) => (
  <div className="p-4" data-closure={row.closureId}>
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="text-sm font-bold text-[#0F172A] break-words">{row.name || row.email || 'Unnamed person'}</div>
        {row.name && row.email && <div className="text-xs text-slate-500 break-words">{row.email}</div>}
        <div className="text-[11px] text-slate-500 mt-0.5">
          {ROLE_LABELS[row.role] ?? row.role} · started by {STARTED_LABELS[row.startedHow] ?? row.startedHow}
          {row.householdOf && ' · closed with their guardian'}
        </div>
      </div>
      <div className="text-right shrink-0">
        <div className="text-xs font-bold text-[#0F172A]">{STATUS_LABELS[row.status] ?? row.status}</div>
        <div className="text-[11px] text-slate-500">Closed {formatWhen(row.closedAt)}</div>
      </div>
    </div>

    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      <Pill tone="slate">Day 30: {formatWhen(row.dueAt)}</Pill>
      <Pill tone="slate">Latest: {formatWhen(row.outerLimitAt)}</Pill>
      {row.status === 'closed' && <Pill tone="slate">Can be undone until {formatWhen(row.undoUntil)}</Pill>}
      {row.onHold && <Pill tone="rose">On a safety hold: nothing about them is deleted</Pill>}
      {row.openDispute && <Pill tone="amber">Open dispute</Pill>}
      {row.deferredUntil && <Pill tone="amber">Deletion waits until {formatWhen(row.deferredUntil)}{row.deferredReason ? `: ${row.deferredReason}` : ''}</Pill>}
      {row.overdue && <Pill tone="rose">Past the 90-day limit</Pill>}
      {row.cardsKept && <Pill tone="slate">Card kept for a refund</Pill>}
      {row.payoutKept && <Pill tone="slate">Payout details kept</Pill>}
      {row.openTasks > 0 && <Pill tone="slate">{row.openTasks} outside step{row.openTasks === 1 ? '' : 's'} waiting</Pill>}
      <Pill tone="slate">{row.sessionsCancelled} session{row.sessionsCancelled === 1 ? '' : 's'} cancelled</Pill>
    </div>

    {(row.askedBy || row.reference) && (
      <p className="mt-2 text-[11px] text-slate-500">
        Asked by {row.askedBy || '—'} · checked: {row.howVerified || '—'} · reference {row.reference || '—'}
        {row.note ? ` · ${row.note}` : ''}
      </p>
    )}
    {row.lastError && <p className="mt-2 text-xs text-rose-800 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">Last error: {row.lastError}</p>}

    {(canUndo(row, now) || canDefer(row)) && <ClosureActions row={row} client={client} onChanged={onChanged} now={now} />}
  </div>
);

// Undo (while the 30 days have not passed) and defer (while the deletion has not finished). Both write down who asked and why.
const ClosureActions: React.FC<{ row: ClosureRow; client: ClosuresClient; onChanged: () => void; now?: Date }> = ({ row, client, onChanged, now }) => {
  const [open, setOpen] = useState<'undo' | 'defer' | null>(null);
  const [undo, setUndo] = useState<UndoForm>(emptyUndoForm);
  const [defer, setDefer] = useState<DeferForm>(emptyDeferForm);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ActionResult | null>(null);

  const run = async (action: () => Promise<ActionResult>) => {
    setBusy(true);
    const r = await action();
    setBusy(false);
    setResult(r);
    if (r.ok) { setOpen(null); onChanged(); }
  };

  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-center gap-2">
        {canUndo(row, now) && (
          <button type="button" data-action="undo" onClick={() => { setResult(null); setOpen(open === 'undo' ? null : 'undo'); }} className={`${buttonClass} bg-slate-100 hover:bg-slate-200 text-slate-700`}>
            Undo this closure
          </button>
        )}
        {canDefer(row) && (
          <button type="button" data-action="defer" onClick={() => { setResult(null); setOpen(open === 'defer' ? null : 'defer'); }} className={`${buttonClass} bg-slate-100 hover:bg-slate-200 text-slate-700`}>
            {row.deferredUntil ? 'Change the waiting date' : 'Wait before deleting'}
          </button>
        )}
        {canDefer(row) && row.deferredUntil && (
          <button type="button" data-action="clear-defer" disabled={busy} onClick={() => run(() => clearDeferral(client, row.closureId))} className={`${buttonClass} text-slate-500 hover:underline`}>
            Stop waiting
          </button>
        )}
      </div>

      {open === 'undo' && (
        <form
          className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2 bg-slate-50 border border-slate-200 rounded-xl p-3"
          onSubmit={(e) => { e.preventDefault(); void run(() => undoClosure(client, row.closureId, undo)); }}
        >
          <div>
            <label className={labelClass} htmlFor={`undo-asked-${row.closureId}`}>Who asked</label>
            <input id={`undo-asked-${row.closureId}`} required value={undo.askedBy} onChange={(e) => setUndo({ ...undo, askedBy: e.target.value })} className={inputClass} />
          </div>
          <div>
            <label className={labelClass} htmlFor={`undo-how-${row.closureId}`}>How you checked it was them</label>
            <input id={`undo-how-${row.closureId}`} required value={undo.howVerified} onChange={(e) => setUndo({ ...undo, howVerified: e.target.value })} className={inputClass} />
          </div>
          <div>
            <label className={labelClass} htmlFor={`undo-note-${row.closureId}`}>Note</label>
            <input id={`undo-note-${row.closureId}`} required value={undo.note} onChange={(e) => setUndo({ ...undo, note: e.target.value })} className={inputClass} />
          </div>
          <div className="sm:col-span-3">
            <button type="submit" disabled={busy} className={`${buttonClass} bg-[#15803D] hover:bg-[#166534] text-white`}>Reopen the account</button>
          </div>
        </form>
      )}

      {open === 'defer' && (
        <form
          className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2 bg-slate-50 border border-slate-200 rounded-xl p-3"
          onSubmit={(e) => { e.preventDefault(); void run(() => deferClosure(client, row.closureId, defer)); }}
        >
          <div>
            <label className={labelClass} htmlFor={`defer-until-${row.closureId}`}>Wait until</label>
            <input id={`defer-until-${row.closureId}`} type="date" required value={defer.until} onChange={(e) => setDefer({ ...defer, until: e.target.value })} className={inputClass} />
          </div>
          <div className="sm:col-span-2">
            <label className={labelClass} htmlFor={`defer-reason-${row.closureId}`}>Reason</label>
            <input id={`defer-reason-${row.closureId}`} required value={defer.reason} onChange={(e) => setDefer({ ...defer, reason: e.target.value })} className={inputClass} />
          </div>
          <div className="sm:col-span-3">
            <button type="submit" disabled={busy} className={`${buttonClass} bg-[#15803D] hover:bg-[#166534] text-white`}>Wait until that date</button>
          </div>
        </form>
      )}

      {result && (
        <p role={result.ok ? 'status' : 'alert'} className={`mt-2 text-xs font-semibold ${result.ok ? 'text-emerald-700' : 'text-rose-700'}`}>
          {result.message}
        </p>
      )}
    </div>
  );
};
