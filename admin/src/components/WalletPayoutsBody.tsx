import React, { useState } from 'react';
import { EyeOff, Lock } from 'lucide-react';
import {
  BankDetails, PayoutQueue, PayoutRow, checkCannotPay, checkPaid, formatSast, isOverdue, paidConfirmText, rand0, todayIsoSast, waitingFor,
} from '../lib/walletAdmin';
import { ConfirmBox, CopyButton, Empty, ErrorLine, FieldLabel, NotAvailable, Pill, inputClass } from './WalletParts';

// Tab 2, "Payout requests": a tutor asked for their whole available balance. The bank details stay hidden until "Open bank details" (the database
// writes one audit line each time), the CEO pays by hand from the company account, then clicks Mark paid (or Cannot pay, with a comment the tutor
// reads and the money returns to their wallet). Red after 24 hours: that is the promise the tutor was given.

interface Props {
  queue: PayoutQueue;
  now?: Date;
  today?: string;
  // Throws with the reason when the details cannot be opened.
  onOpenBank: (row: PayoutRow) => Promise<BankDetails>;
  onPaid: (row: PayoutRow, reference: string | null, paidOn: string | null) => Promise<string | null>;
  onCannotPay: (row: PayoutRow, comment: string) => Promise<string | null>;
  onRetry: () => void;
}

const PayoutCard: React.FC<{ row: PayoutRow; now: Date; today: string } & Pick<Props, 'onOpenBank' | 'onPaid' | 'onCannotPay'>> = ({ row, now, today, onOpenBank, onPaid, onCannotPay }) => {
  const [bank, setBank] = useState<BankDetails | null>(null);
  const [opening, setOpening] = useState(false);
  const [mode, setMode] = useState<null | 'paid' | 'cannot'>(null);
  const [reference, setReference] = useState('');
  const [paidOn, setPaidOn] = useState(today);
  const [comment, setComment] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const late = isOverdue(row.requestedAt, now);
  const id = `payout-${row.id}`;

  const open = async () => {
    setOpening(true);
    setError(null);
    try {
      setBank(await onOpenBank(row));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not open the bank details.');
    } finally {
      setOpening(false);
    }
  };
  const ask = () => {
    const c = mode === 'paid' ? checkPaid(reference, paidOn, today) : checkCannotPay(comment);
    if (c.ok === false) return setError(c.error);
    setError(null);
    setConfirm(true);
  };
  const run = async () => {
    setBusy(true);
    let problem: string | null;
    if (mode === 'paid') {
      const c = checkPaid(reference, paidOn, today);
      problem = c.ok === true ? await onPaid(row, c.reference, c.paidOn) : c.error;
    } else {
      const c = checkCannotPay(comment);
      problem = c.ok === true ? await onCannotPay(row, c.comment) : c.error;
    }
    setBusy(false);
    if (problem) {
      setConfirm(false);
      setError(problem);
    }
  };

  return (
    <div data-payout-card className={`p-4 ${late ? 'bg-rose-50/60' : ''}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <span className="text-sm font-extrabold text-[#0F172A]">{row.tutorName}</span>
          <div className={`text-[11px] mt-0.5 ${late ? 'font-bold text-rose-700' : 'text-slate-400'}`}>
            Asked {formatSast(row.requestedAt)} · waiting {waitingFor(row.requestedAt, now)}{late ? ' · over 24 hours' : ''}
          </div>
          <div className="text-[11px] text-slate-400">{row.sessionCount} session{row.sessionCount === 1 ? '' : 's'} included</div>
          {row.bankChangedRecently && (
            <p data-bank-changed role="alert" className="mt-1 text-[11px] font-bold text-rose-700">This tutor changed their bank details in the 48 hours before asking. Check it is really them before you pay.</p>
          )}
        </div>
        <div className="text-right">
          <div className="text-xl font-extrabold text-[#0F172A]">{rand0(row.amountRand)}</div>
          <div className="text-[10px] font-bold text-slate-400">to pay</div>
        </div>
      </div>

      <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
        {bank ? (
          <div data-bank-open>
            <dl className="grid grid-cols-[8rem_1fr] gap-y-1 text-sm">
              <dt className="text-xs font-bold text-slate-500">Bank</dt><dd className="font-semibold">{bank.bankName}</dd>
              <dt className="text-xs font-bold text-slate-500">Account holder</dt><dd className="font-semibold">{bank.accountHolder}</dd>
              <dt className="text-xs font-bold text-slate-500">Branch code</dt><dd className="font-mono font-semibold">{bank.branchCode}</dd>
              <dt className="text-xs font-bold text-slate-500">Account number</dt><dd className="font-mono font-semibold">{bank.accountNumber} <CopyButton text={bank.accountNumber} label="Copy account number" /></dd>
            </dl>
            <button type="button" onClick={() => setBank(null)} className="mt-2 inline-flex items-center gap-1 text-[11px] font-bold text-slate-500 cursor-pointer"><EyeOff className="w-3 h-3" /> Hide again</button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-1 text-xs text-slate-500"><Lock className="w-3.5 h-3.5" /> Bank details are hidden. Opening them is recorded in the audit log.</span>
            <button type="button" onClick={open} disabled={opening} className="text-xs font-bold px-3 py-2 rounded-lg bg-white border border-slate-300 text-[#0F172A] hover:bg-slate-50 disabled:opacity-60 cursor-pointer">
              {opening ? 'Opening…' : 'Open bank details'}
            </button>
          </div>
        )}
      </div>

      {mode === null ? (
        <div className="flex flex-wrap gap-2 mt-3">
          <button type="button" onClick={() => { setMode('paid'); setError(null); }} className="text-xs font-bold text-white bg-[#15803D] hover:bg-[#166534] px-4 py-2 rounded-lg cursor-pointer">Mark paid</button>
          <button type="button" onClick={() => { setMode('cannot'); setError(null); }} className="text-xs font-bold text-rose-700 bg-white border border-rose-300 hover:bg-rose-50 px-4 py-2 rounded-lg cursor-pointer">Cannot pay</button>
        </div>
      ) : (
        <div className="mt-3">
          {mode === 'paid' ? (
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <FieldLabel htmlFor={`${id}-ref`}>Bank reference (optional)</FieldLabel>
                <input id={`${id}-ref`} value={reference} onChange={(e) => { setReference(e.target.value); setConfirm(false); }} disabled={busy} className={inputClass} />
              </div>
              <div>
                <FieldLabel htmlFor={`${id}-date`}>Date the money was sent</FieldLabel>
                <input id={`${id}-date`} type="date" value={paidOn} max={today} onChange={(e) => { setPaidOn(e.target.value); setConfirm(false); }} disabled={busy} className={inputClass} />
              </div>
            </div>
          ) : (
            <div>
              <FieldLabel htmlFor={`${id}-comment`}>Why you cannot pay (the tutor reads this; the money goes back to their wallet)</FieldLabel>
              <textarea id={`${id}-comment`} rows={2} value={comment} onChange={(e) => { setComment(e.target.value); setConfirm(false); }} disabled={busy} className={inputClass} />
            </div>
          )}
          <div className="flex flex-wrap gap-2 mt-3">
            <button type="button" onClick={ask} disabled={busy} className={`text-xs font-bold px-4 py-2 rounded-lg disabled:opacity-60 cursor-pointer ${mode === 'paid' ? 'text-white bg-[#15803D] hover:bg-[#166534]' : 'text-white bg-rose-600 hover:bg-rose-700'}`}>
              {mode === 'paid' ? 'Mark as paid' : 'Send to the tutor: cannot pay'}
            </button>
            <button type="button" onClick={() => { setMode(null); setConfirm(false); setError(null); }} disabled={busy} className="text-xs font-bold text-slate-600 px-3 py-2 cursor-pointer">Cancel</button>
          </div>
          {confirm && (
            <ConfirmBox
              text={mode === 'paid' ? paidConfirmText(row.tutorName, row.amountRand) : `Tell ${row.tutorName} the payout could not be paid, and return ${rand0(row.amountRand)} to their wallet?`}
              yes={mode === 'paid' ? 'Yes, it is paid' : 'Yes, return the money'}
              danger={mode === 'cannot'}
              busy={busy}
              onYes={run}
              onNo={() => setConfirm(false)}
            />
          )}
        </div>
      )}
      <ErrorLine text={error} />
    </div>
  );
};

export const WalletPayoutsBody: React.FC<Props> = ({ queue, now = new Date(), today = todayIsoSast(), onOpenBank, onPaid, onCannotPay, onRetry }) => {
  if (queue.state === 'not_available') return <NotAvailable message={queue.note} />;
  if (queue.state === 'error') return <NotAvailable message={queue.message} failed onRetry={onRetry} />;
  return (
    <div className="space-y-6">
      <section>
        <h2 className="text-sm font-extrabold text-[#0F172A] mb-1">Waiting to be paid ({queue.requested.length})</h2>
        <p className="text-xs text-slate-500 mb-3">Each tutor asks for their whole available balance. Pay it from the company account by hand, then click Mark paid.</p>
        {queue.requested.length === 0 ? (
          <Empty text="No payout is waiting. When a tutor asks to be paid it appears here." />
        ) : (
          <div className="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-100 overflow-hidden">
            {queue.requested.map((r) => <PayoutCard key={r.id} row={r} now={now} today={today} onOpenBank={onOpenBank} onPaid={onPaid} onCannotPay={onCannotPay} />)}
          </div>
        )}
      </section>

      <section>
        <h2 className="text-sm font-extrabold text-[#0F172A] mb-3">Recently decided</h2>
        {queue.recent.length === 0 ? (
          <Empty text="Nothing decided yet." />
        ) : (
          <div className="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-100 overflow-hidden">
            {queue.recent.map((r) => (
              <div key={r.id} data-recent-row className="p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div><span className="font-extrabold text-[#0F172A]">{r.tutorName}</span> <span className="text-xs text-slate-500">· asked {formatSast(r.requestedAt)}</span></div>
                  <span>
                    <Pill tone={r.status === 'paid' ? 'green' : 'red'}>{r.status === 'paid' ? `Paid${r.paidOn ? ` ${r.paidOn}` : ''}` : 'Could not pay'}</Pill>{' '}
                    <span className="font-extrabold text-[#0F172A]">{rand0(r.amountRand)}</span>
                  </span>
                </div>
                {r.bankReference && <div className="text-xs text-slate-500 mt-0.5">Bank reference {r.bankReference}</div>}
                {r.comment && <div className="text-xs text-slate-500 mt-0.5">“{r.comment}”</div>}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};
