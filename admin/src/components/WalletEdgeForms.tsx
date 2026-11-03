import React, { useRef, useState } from 'react';
import {
  BankDetails, ClosedWalletRow, WalletListRow, WalletSession, canRefundSession, checkHandTopup, checkRefund, checkReturn, closedWalletSentence, formatSast, handTopupConfirmText,
  newAdjustKey, rand0, refundConfirmText, refundSessionLine, refundableRand, returnConfirmText,
} from '../lib/walletAdmin';
import { ConfirmBox, ErrorLine, FieldLabel, Pill, inputClass } from './WalletParts';

// The edge-case money actions of the Wallets tab (wallet phase 6): refund a finished session into a wallet, record money returned by hand, credit a transfer that
// came with no proof, and the list of closed accounts that still have money. Each form keeps ONE one-time key per attempt (a ref) and only makes a new one after
// success, so a double click or a retry posts once (the database answers "already" for a repeated key). Only drawn when the page hands in the handler.

export type ActionResult = { ok: true; message: string } | { ok: false; error: string };
export type TutorBank = Pick<BankDetails, 'bankName' | 'accountHolder' | 'branchCode' | 'accountNumber'>;
export interface EdgeHandlers {
  onRefund?: (session: WalletSession, amount: number, reason: string, takeBack: boolean, key: string) => Promise<ActionResult>;
  onReturn?: (row: WalletListRow, amount: number, reason: string, reference: string | null, key: string) => Promise<ActionResult>;
  onHandTopup?: (row: WalletListRow, amount: number, reason: string, reference: string | null, key: string) => Promise<ActionResult>;
  // Throws with the reason when the details cannot be opened. Every opening is an audit line in the database.
  onOpenTutorBank?: (row: WalletListRow) => Promise<TutorBank>;
}

const Done: React.FC<{ text: string | null }> = ({ text }) => (text ? <p role="status" data-edge-done className="mt-2 text-xs font-bold text-[#15803D]">{text}</p> : null);

const RefundForm: React.FC<{ learner: WalletListRow; session: WalletSession; onRefund: NonNullable<EdgeHandlers['onRefund']> }> = ({ learner, session, onRefund }) => {
  const max = refundableRand(session);
  const [amountText, setAmountText] = useState(String(max));
  const [reason, setReason] = useState('');
  const [takeBack, setTakeBack] = useState(true);
  const [confirm, setConfirm] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const key = useRef<string>(newAdjustKey());
  const id = `refund-${session.sessionId}`;

  const ask = () => {
    const c = checkRefund(max, amountText, reason);
    if (c.ok === false) return setError(c.error);
    setError(null);
    setConfirm(c.amount);
  };
  const run = async () => {
    const c = checkRefund(max, amountText, reason);
    if (c.ok === false) return setError(c.error);
    setBusy(true);
    const result = await onRefund(session, c.amount, c.reason, takeBack, key.current);
    setBusy(false);
    setConfirm(null);
    if (result.ok === false) return setError(result.error);
    key.current = newAdjustKey();
    setError(null);
    setDone(result.message);
  };

  return (
    <div data-refund-form className="mt-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
      <div className="grid sm:grid-cols-[9rem_1fr] gap-3">
        <div>
          <FieldLabel htmlFor={`${id}-amount`}>Amount to refund (R, up to {max})</FieldLabel>
          <input id={`${id}-amount`} inputMode="numeric" value={amountText} onChange={(e) => { setAmountText(e.target.value); setConfirm(null); setDone(null); }} disabled={busy} className={inputClass} />
        </div>
        <div>
          <FieldLabel htmlFor={`${id}-reason`}>Reason (required; the learner reads it)</FieldLabel>
          <input id={`${id}-reason`} value={reason} onChange={(e) => { setReason(e.target.value); setConfirm(null); setDone(null); }} disabled={busy} className={inputClass} />
        </div>
      </div>
      <label className="mt-2 flex items-start gap-2 text-xs text-slate-600">
        <input type="checkbox" checked={takeBack} onChange={(e) => { setTakeBack(e.target.checked); setConfirm(null); }} disabled={busy} className="mt-0.5" />
        <span>Take the tutor's share back too. This only happens if the tutor's wallet still covers it (it never goes below zero). If it does not, you settle with the tutor by hand. The tutor is not shown your reason.</span>
      </label>
      <button type="button" onClick={ask} disabled={busy} className="mt-3 text-xs font-bold text-white bg-[#0F172A] hover:bg-slate-800 px-4 py-2 rounded-lg disabled:opacity-60 cursor-pointer">Refund into the wallet</button>
      {confirm !== null && <ConfirmBox text={refundConfirmText(learner.name, confirm, session.tutorName, takeBack)} yes="Yes, refund it" busy={busy} onYes={run} onNo={() => setConfirm(null)} />}
      <Done text={done} />
      <ErrorLine text={error} />
    </div>
  );
};

export const WalletSessionsSection: React.FC<{ row: WalletListRow; sessions: WalletSession[]; onRefund?: EdgeHandlers['onRefund'] }> = ({ row, sessions, onRefund }) => {
  const [open, setOpen] = useState<string | null>(null);
  if (!onRefund) return null;
  return (
    <div data-wallet-sessions className="mt-4 rounded-xl border border-slate-200 p-3">
      <h4 className="text-xs font-extrabold text-[#0F172A] mb-1">Sessions this wallet paid for (refund after the session)</h4>
      <p className="text-[11px] text-slate-500 mb-2">For a problem reported after the session. The money goes back into the wallet as credit; a booked session that has not happened is cancelled instead, and then the refund is automatic.</p>
      {sessions.length === 0 ? <p className="text-xs text-slate-500">No session has been paid from this wallet.</p> : (
        <ul className="divide-y divide-slate-100">
          {sessions.map((s) => (
            <li key={s.sessionId} data-wallet-session className="py-2 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span><span className="font-bold text-[#0F172A]">Tutor {s.tutorName}</span> <span className="text-slate-500">{refundSessionLine(s)}</span></span>
                {canRefundSession(s) ? (
                  <button type="button" onClick={() => setOpen(open === s.sessionId ? null : s.sessionId)} className="font-bold px-3 py-1.5 rounded-lg bg-white border border-slate-300 text-[#0F172A] hover:bg-slate-50 cursor-pointer">
                    {open === s.sessionId ? 'Close' : 'Refund…'}
                  </button>
                ) : <Pill tone="slate">{s.status === 'completed' ? 'Fully refunded' : 'Not finished'}</Pill>}
              </div>
              {open === s.sessionId && canRefundSession(s) && <RefundForm learner={row} session={s} onRefund={onRefund} />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

// Money returned BY HAND: the finance admin sends it from the bank app first, then records it here. A tutor's bank details can be shown (and are audited) so the
// transfer can be made; a learner's are in the finance admin's own bank records (the reference of the top-up they paid with is in the list above).
export const ReturnMoneyForm: React.FC<{ row: WalletListRow; onReturn: NonNullable<EdgeHandlers['onReturn']>; onOpenTutorBank?: EdgeHandlers['onOpenTutorBank'] }> = ({ row, onReturn, onOpenTutorBank }) => {
  const [amountText, setAmountText] = useState('');
  const [reason, setReason] = useState('');
  const [reference, setReference] = useState('');
  const [confirm, setConfirm] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [bank, setBank] = useState<TutorBank | null>(null);
  const [bankError, setBankError] = useState<string | null>(null);
  const key = useRef<string>(newAdjustKey());

  const ask = () => {
    const c = checkReturn(row.availableRand, amountText, reason, reference);
    if (c.ok === false) return setError(c.error);
    setError(null);
    setConfirm(c.amount);
  };
  const run = async () => {
    const c = checkReturn(row.availableRand, amountText, reason, reference);
    if (c.ok === false) return setError(c.error);
    setBusy(true);
    const result = await onReturn(row, c.amount, c.reason, c.reference, key.current);
    setBusy(false);
    setConfirm(null);
    if (result.ok === false) return setError(result.error);
    key.current = newAdjustKey();
    setError(null);
    setDone(result.message);
    setAmountText('');
    setReason('');
    setReference('');
  };
  const showBank = async () => {
    if (!onOpenTutorBank) return;
    setBankError(null);
    try {
      setBank(await onOpenTutorBank(row));
    } catch (e) {
      setBank(null);
      setBankError(e instanceof Error ? e.message : 'The bank details could not be opened.');
    }
  };

  return (
    <div data-return-form className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
      <h4 className="text-xs font-extrabold text-[#0F172A] mb-1">Return money by hand</h4>
      <p className="text-[11px] text-slate-500 mb-2">There is no button for learners to take money out: they write to support. Send the money from the bank app, then record it here. It comes out of their wallet and the ledger keeps your reason. Only available money can be returned (now {rand0(row.availableRand)}).</p>
      {row.role === 'tutor' && onOpenTutorBank && (
        <div className="mb-2">
          <button type="button" onClick={showBank} className="text-xs font-bold px-3 py-1.5 rounded-lg bg-white border border-slate-300 text-[#0F172A] hover:bg-slate-50 cursor-pointer">Show their bank details</button>
          <span className="ml-2 text-[11px] text-slate-400">Each opening is recorded.</span>
          {bank && (
            <p data-tutor-bank className="mt-1 text-xs text-slate-700">{bank.bankName} · {bank.accountHolder} · branch {bank.branchCode} · account <span className="font-mono font-bold">{bank.accountNumber}</span></p>
          )}
          <ErrorLine text={bankError} />
        </div>
      )}
      <div className="grid sm:grid-cols-[8rem_1fr_11rem] gap-3">
        <div>
          <FieldLabel htmlFor="return-amount">Amount (R)</FieldLabel>
          <input id="return-amount" inputMode="numeric" value={amountText} onChange={(e) => { setAmountText(e.target.value); setConfirm(null); setDone(null); }} disabled={busy} className={inputClass} />
        </div>
        <div>
          <FieldLabel htmlFor="return-reason">Reason (required: who asked, how you checked it was them)</FieldLabel>
          <input id="return-reason" value={reason} onChange={(e) => { setReason(e.target.value); setConfirm(null); setDone(null); }} disabled={busy} className={inputClass} />
        </div>
        <div>
          <FieldLabel htmlFor="return-ref">Bank reference (optional)</FieldLabel>
          <input id="return-ref" value={reference} onChange={(e) => { setReference(e.target.value); setConfirm(null); }} disabled={busy} className={inputClass} />
        </div>
      </div>
      <button type="button" onClick={ask} disabled={busy || row.availableRand < 1} className="mt-3 text-xs font-bold text-white bg-[#0F172A] hover:bg-slate-800 px-4 py-2 rounded-lg disabled:opacity-60 cursor-pointer">Record the money as returned</button>
      {confirm !== null && <ConfirmBox text={returnConfirmText(row.name, confirm)} yes="Yes, it was sent" busy={busy} danger onYes={run} onNo={() => setConfirm(null)} />}
      <Done text={done} />
      <ErrorLine text={error} />
    </div>
  );
};

// A transfer found in the bank with no proof (or the wrong reference): credited as a real top-up record with your reason.
export const HandTopupForm: React.FC<{ row: WalletListRow; onHandTopup: NonNullable<EdgeHandlers['onHandTopup']> }> = ({ row, onHandTopup }) => {
  const [amountText, setAmountText] = useState('');
  const [reason, setReason] = useState('');
  const [reference, setReference] = useState('');
  const [confirm, setConfirm] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const key = useRef<string>(newAdjustKey());

  const ask = () => {
    const c = checkHandTopup(amountText, reason, reference);
    if (c.ok === false) return setError(c.error);
    setError(null);
    setConfirm(c.amount);
  };
  const run = async () => {
    const c = checkHandTopup(amountText, reason, reference);
    if (c.ok === false) return setError(c.error);
    setBusy(true);
    const result = await onHandTopup(row, c.amount, c.reason, c.reference, key.current);
    setBusy(false);
    setConfirm(null);
    if (result.ok === false) return setError(result.error);
    key.current = newAdjustKey();
    setError(null);
    setDone(result.message);
    setAmountText('');
    setReason('');
    setReference('');
  };

  return (
    <div data-hand-topup-form className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
      <h4 className="text-xs font-extrabold text-[#0F172A] mb-1">Add a top-up by hand</h4>
      <p className="text-[11px] text-slate-500 mb-2">For a transfer that reached the bank with no proof, or with the wrong reference. It is recorded as a normal top-up (with a reference and your reason), and the person is told. The wallet limit does not apply: the money is already in the account.</p>
      <div className="grid sm:grid-cols-[8rem_1fr_11rem] gap-3">
        <div>
          <FieldLabel htmlFor="hand-amount">Amount received (R)</FieldLabel>
          <input id="hand-amount" inputMode="numeric" value={amountText} onChange={(e) => { setAmountText(e.target.value); setConfirm(null); setDone(null); }} disabled={busy} className={inputClass} />
        </div>
        <div>
          <FieldLabel htmlFor="hand-reason">Reason (required: why no proof, or what reference they used)</FieldLabel>
          <input id="hand-reason" value={reason} onChange={(e) => { setReason(e.target.value); setConfirm(null); setDone(null); }} disabled={busy} className={inputClass} />
        </div>
        <div>
          <FieldLabel htmlFor="hand-ref">Reference in the bank (optional)</FieldLabel>
          <input id="hand-ref" value={reference} onChange={(e) => { setReference(e.target.value); setConfirm(null); }} disabled={busy} className={inputClass} />
        </div>
      </div>
      <button type="button" onClick={ask} disabled={busy} className="mt-3 text-xs font-bold text-white bg-[#15803D] hover:bg-[#166534] px-4 py-2 rounded-lg disabled:opacity-60 cursor-pointer">Add the top-up</button>
      {confirm !== null && <ConfirmBox text={handTopupConfirmText(row.name, confirm)} yes="Yes, add it" busy={busy} onYes={run} onNo={() => setConfirm(null)} />}
      <Done text={done} />
      <ErrorLine text={error} />
    </div>
  );
};

// Closed accounts that still have money: the finance admin works through this list (open the person, send the money, record it).
export const ClosedAccountsSection: React.FC<{ rows: ClosedWalletRow[]; onOpen: (row: ClosedWalletRow) => void }> = ({ rows, onOpen }) => (
  <section data-closed-wallets>
    <h2 className="text-sm font-extrabold text-[#0F172A] mb-1">Closed accounts with money ({rows.length})</h2>
    <p className="text-xs text-slate-500 mb-2">Closing never deletes money. These people closed their account and money is still owed to them. Send it by hand, then open the person and record it. When nothing is owed, their bank details and proof files are deleted by the daily job.</p>
    {rows.length === 0 ? (
      <div className="bg-white rounded-2xl p-4 border border-slate-200 text-sm text-slate-500">No closed account has money left.</div>
    ) : (
      <div className="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-100 overflow-hidden">
        {rows.map((r) => (
          <div key={r.profileId} data-closed-wallet-row className="p-3 flex flex-wrap items-center justify-between gap-2 text-sm">
            <div>
              <span className="font-extrabold text-[#0F172A]">{r.name}</span> <Pill tone="slate">{r.role}</Pill> <span className="text-xs text-slate-500">closed {formatSast(r.closedAt)}</span>
              <div className="text-xs text-slate-600">{closedWalletSentence(r)}</div>
              {r.topupReferences.length > 0 && <div className="text-[11px] text-slate-400">Paid in with reference{r.topupReferences.length === 1 ? '' : 's'} {r.topupReferences.join(', ')}</div>}
              {r.role === 'tutor' && <div className="text-[11px] text-slate-400">{r.hasBankDetails ? 'Bank details are kept.' : 'No bank details are kept: ask the tutor for them.'}</div>}
            </div>
            <button type="button" onClick={() => onOpen(r)} className="text-xs font-bold px-3 py-1.5 rounded-lg bg-white border border-slate-300 text-[#0F172A] hover:bg-slate-50 cursor-pointer">Open</button>
          </div>
        ))}
      </div>
    )}
  </section>
);
