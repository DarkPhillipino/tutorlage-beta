import React, { useRef, useState } from 'react';
import { RefreshCw, Search, ShieldCheck } from 'lucide-react';
import {
  BalanceCheck, ClosedWallets, TotalsResult, WalletDetail, WalletList, WalletListRow, adjustConfirmText, balanceCheckSentence, checkAdjustment, closedToListRow, formatSast, ledgerAmountText,
  ledgerKindLabel, newAdjustKey, rand0,
} from '../lib/walletAdmin';
import { ConfirmBox, Empty, ErrorLine, FieldLabel, Loading, NotAvailable, Pill, inputClass } from './WalletParts';
import { ClosedAccountsSection, EdgeHandlers, HandTopupForm, ReturnMoneyForm, WalletSessionsSection } from './WalletEdgeForms';

// Tab 3, "Wallets": the figure the CEO must always find in the bank for other people ("held for others"), the daily balance check on demand, a search for
// one person, and, for a SUPER ADMIN ONLY, "Adjust wallet" (a new ledger line with a written reason, never below zero; a one-time key stops a double click
// posting twice). A finance manager sees everything but the Adjust form.

export type CheckState = { state: 'idle' } | { state: 'running' } | { state: 'done'; result: BalanceCheck } | { state: 'error'; message: string };

interface Props {
  totals: TotalsResult;
  list: WalletList;
  term: string;
  onTerm: (term: string) => void;
  onSearch: () => void;
  selected: { row: WalletListRow; detail: WalletDetail | null } | null;
  onSelect: (row: WalletListRow | null) => void;
  check: CheckState;
  onRunCheck: () => void;
  canAdjust: boolean;
  onAdjust: (row: WalletListRow, amount: number, reason: string, key: string) => Promise<string | null>;
  onRetry: () => void;
  // Wallet phase 6, all optional (a page that does not hand them in simply does not draw them): closed accounts that still have money, and the
  // refund / return-by-hand / hand top-up forms inside a person's card.
  closed?: ClosedWallets | null;
  edge?: EdgeHandlers;
}

const Figure: React.FC<{ label: string; value: string; note?: string }> = ({ label, value, note }) => (
  <div className="bg-white rounded-2xl p-4 border border-slate-200">
    <div className="text-2xl font-extrabold text-[#0F172A]">{value}</div>
    <div className="text-xs font-bold text-slate-500 mt-1">{label}</div>
    {note && <div className="text-[11px] text-slate-400 mt-0.5">{note}</div>}
  </div>
);

const AdjustForm: React.FC<{ row: WalletListRow; onAdjust: Props['onAdjust'] }> = ({ row, onAdjust }) => {
  const [direction, setDirection] = useState<'add' | 'remove'>('add');
  const [amountText, setAmountText] = useState('');
  const [reason, setReason] = useState('');
  const [confirm, setConfirm] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  // One key per attempt: a retry or a double click repeats the same key, so the database posts the adjustment once.
  const key = useRef<string>(newAdjustKey());

  const ask = () => {
    const c = checkAdjustment(direction, amountText, reason);
    if (c.ok === false) return setError(c.error);
    setError(null);
    setConfirm(c.amount);
  };
  const run = async () => {
    const c = checkAdjustment(direction, amountText, reason);
    if (c.ok === false) return setError(c.error);
    setBusy(true);
    const problem = await onAdjust(row, c.amount, c.reason, key.current);
    setBusy(false);
    setConfirm(null);
    if (problem) return setError(problem);
    key.current = newAdjustKey();
    setDone(true);
    setAmountText('');
    setReason('');
  };

  return (
    <div data-adjust-form className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
      <h4 className="text-xs font-extrabold text-[#0F172A] mb-2">Adjust wallet (super admin only)</h4>
      <p className="text-[11px] text-slate-500 mb-2">For a correction by hand, for example a refund you decided on. It is a new line in the ledger, never an edit, and the person is told. A wallet never goes below zero.</p>
      <div className="grid sm:grid-cols-[9rem_9rem_1fr] gap-3">
        <div>
          <FieldLabel htmlFor="adjust-direction">What to do</FieldLabel>
          <select id="adjust-direction" value={direction} onChange={(e) => { setDirection(e.target.value as 'add' | 'remove'); setConfirm(null); }} disabled={busy} className={inputClass}>
            <option value="add">Add money</option>
            <option value="remove">Take money out</option>
          </select>
        </div>
        <div>
          <FieldLabel htmlFor="adjust-amount">Amount (R)</FieldLabel>
          <input id="adjust-amount" inputMode="numeric" value={amountText} onChange={(e) => { setAmountText(e.target.value); setConfirm(null); setDone(false); }} disabled={busy} className={inputClass} />
        </div>
        <div>
          <FieldLabel htmlFor="adjust-reason">Reason (required, kept with the adjustment)</FieldLabel>
          <input id="adjust-reason" value={reason} onChange={(e) => { setReason(e.target.value); setConfirm(null); setDone(false); }} disabled={busy} className={inputClass} />
        </div>
      </div>
      <button type="button" onClick={ask} disabled={busy} className="mt-3 text-xs font-bold text-white bg-[#0F172A] hover:bg-slate-800 px-4 py-2 rounded-lg disabled:opacity-60 cursor-pointer">Adjust wallet</button>
      {confirm !== null && <ConfirmBox text={adjustConfirmText(row.name, confirm)} yes="Yes, adjust it" busy={busy} danger={confirm < 0} onYes={run} onNo={() => setConfirm(null)} />}
      {done && <p role="status" className="mt-2 text-xs font-bold text-[#15803D]">Done. The adjustment is in the ledger below.</p>}
      <ErrorLine text={error} />
    </div>
  );
};

const DetailCard: React.FC<{ row: WalletListRow; detail: WalletDetail | null; canAdjust: boolean; onClose: () => void; onAdjust: Props['onAdjust']; edge?: EdgeHandlers }> = ({ row, detail, canAdjust, onClose, onAdjust, edge }) => (
  <div data-wallet-detail className="bg-white rounded-2xl border border-slate-300 p-4">
    <div className="flex items-start justify-between gap-3">
      <div>
        <h3 className="text-sm font-extrabold text-[#0F172A]">{row.name}{row.role ? <span className="ml-1.5"><Pill tone="slate">{row.role}</Pill></span> : null}</h3>
        <p className="text-xs text-slate-500">Available {rand0(row.availableRand)} · on hold {rand0(row.heldRand)}</p>
      </div>
      <button type="button" onClick={onClose} className="text-xs font-bold text-slate-500 cursor-pointer">Close</button>
    </div>
    {detail === null ? (
      <Loading text="Loading this wallet…" />
    ) : (
      <div className="grid md:grid-cols-3 gap-4 mt-3 text-xs">
        <div className="md:col-span-2">
          <h4 className="font-extrabold text-[#0F172A] mb-1">Last ledger lines</h4>
          {detail.ledger.length === 0 ? <p className="text-slate-500">No lines yet.</p> : (
            <ul className="divide-y divide-slate-100">
              {detail.ledger.map((l) => (
                <li key={l.id} className="py-1.5 flex justify-between gap-2">
                  <span>
                    <span className="font-bold text-[#0F172A]">{ledgerKindLabel(l.kind)}</span> <span className="text-slate-500">{ledgerAmountText(l)}</span>
                    {l.note && <span className="block text-slate-400">{l.note}</span>}
                  </span>
                  <span className="text-slate-400 text-right shrink-0">{formatSast(l.createdAt)}<br />then {rand0(l.availableAfter)} + {rand0(l.heldAfter)} held</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="space-y-3">
          <div>
            <h4 className="font-extrabold text-[#0F172A] mb-1">Top-ups</h4>
            {detail.topups.length === 0 ? <p className="text-slate-500">None.</p> : detail.topups.map((t) => (
              <p key={t.id} className="text-slate-600"><span className="font-mono">{t.reference}</span> {rand0(t.claimedRand)} · {t.status.replace('_', ' ')}{t.proofDeletedAt ? ' · proof file deleted' : ''}</p>
            ))}
          </div>
          <div>
            <h4 className="font-extrabold text-[#0F172A] mb-1">Payout requests</h4>
            {detail.payouts.length === 0 ? <p className="text-slate-500">None.</p> : detail.payouts.map((p) => (
              <p key={p.id} className="text-slate-600">{rand0(p.amountRand)} · {p.status.replace(/_/g, ' ')} · {formatSast(p.requestedAt)}</p>
            ))}
          </div>
        </div>
      </div>
    )}
    {detail && edge?.onRefund && <WalletSessionsSection row={row} sessions={detail.sessions} onRefund={edge.onRefund} />}
    {edge?.onHandTopup && <HandTopupForm row={row} onHandTopup={edge.onHandTopup} />}
    {edge?.onReturn && <ReturnMoneyForm row={row} onReturn={edge.onReturn} onOpenTutorBank={edge.onOpenTutorBank} />}
    {canAdjust && <AdjustForm row={row} onAdjust={onAdjust} />}
  </div>
);

export const WalletBalancesBody: React.FC<Props> = ({ totals, list, term, onTerm, onSearch, selected, onSelect, check, onRunCheck, canAdjust, onAdjust, onRetry, closed, edge }) => (
  <div className="space-y-6">
    <section>
      <h2 className="text-sm font-extrabold text-[#0F172A] mb-2">Money held for other people</h2>
      {totals.state === 'not_available' ? <NotAvailable message={totals.note} /> : totals.state === 'error' ? <NotAvailable message={totals.message} failed onRetry={onRetry} /> : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Figure label="Held for others" value={rand0(totals.totals.heldForOthersRand)} note="Always find at least this in the bank" />
            <Figure label="In wallets now" value={rand0(totals.totals.inWalletsRand)} note={`${rand0(totals.totals.availableRand)} available, ${rand0(totals.totals.heldRand)} on hold`} />
            <Figure label="Tutors' wallets" value={rand0(totals.totals.tutorWalletsRand)} note={`${totals.totals.walletCount} wallets in all`} />
            <Figure label="Owed for booked sessions" value={rand0(totals.totals.bookedTutorShareRand)} note={`${totals.totals.bookedSessions} paid session${totals.totals.bookedSessions === 1 ? '' : 's'} not finished`} />
          </div>
          <p className="text-[11px] text-slate-500 mt-2">Held for others = money in all wallets + the tutors' share of booked sessions that are not finished yet. Top-ups waiting to be checked: {totals.totals.topupsWaiting}. Payouts waiting: {totals.totals.payoutsRequested} ({rand0(totals.totals.payoutsRequestedRand)}).</p>
        </>
      )}
    </section>

    <section>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={onRunCheck} disabled={check.state === 'running'} className="inline-flex items-center gap-1.5 text-xs font-bold px-3 py-2 rounded-lg bg-white border border-slate-300 text-[#0F172A] hover:bg-slate-50 disabled:opacity-60 cursor-pointer">
          <ShieldCheck className="w-3.5 h-3.5" /> {check.state === 'running' ? 'Checking…' : 'Run the balance check'}
        </button>
        <span className="text-[11px] text-slate-500">The check also runs by itself every night. It compares every wallet with its ledger.</span>
      </div>
      {check.state === 'done' && (
        <div data-check-result className={`mt-2 rounded-xl border p-3 text-sm font-semibold ${check.result.mismatchCount === 0 ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-rose-50 border-rose-200 text-rose-700'}`}>
          {balanceCheckSentence(check.result)}
          {check.result.mismatches.map((m) => (
            <p key={m.profileId} className="text-xs font-mono mt-1">{m.profileId}: stored {rand0(m.storedAvailable)} + {rand0(m.storedHeld)} held, ledger says {rand0(m.ledgerAvailable)} + {rand0(m.ledgerHeld)} held{m.brokenLinks ? `, ${m.brokenLinks} broken link(s)` : ''}</p>
          ))}
        </div>
      )}
      {check.state === 'error' && <NotAvailable message={check.message} failed />}
    </section>

    {closed?.state === 'ok' && <ClosedAccountsSection rows={closed.rows} onOpen={(r) => onSelect(closedToListRow(r))} />}
    {closed?.state === 'error' && <NotAvailable message={closed.message} failed onRetry={onRetry} />}

    <section>
      <h2 className="text-sm font-extrabold text-[#0F172A] mb-2">Wallets</h2>
      <form onSubmit={(e) => { e.preventDefault(); onSearch(); }} className="flex gap-2 mb-3">
        <label htmlFor="wallet-search" className="sr-only">Search for a person</label>
        <input id="wallet-search" value={term} onChange={(e) => onTerm(e.target.value)} placeholder="Search a name or email (empty shows the biggest wallets)" className={`${inputClass} max-w-md`} />
        <button type="submit" className="inline-flex items-center gap-1.5 text-xs font-bold px-3 py-2 rounded-lg bg-[#0F172A] text-white cursor-pointer"><Search className="w-3.5 h-3.5" /> Search</button>
        <button type="button" onClick={onRetry} aria-label="Refresh" className="p-2 rounded-lg bg-white border border-slate-200 text-slate-500 cursor-pointer"><RefreshCw className="w-3.5 h-3.5" /></button>
      </form>
      {list.state === 'not_available' ? <NotAvailable message={list.note} /> : list.state === 'error' ? <NotAvailable message={list.message} failed onRetry={onRetry} /> : list.wallets.length === 0 ? (
        <Empty text={term.trim() ? 'Nobody found.' : 'No wallet has been opened yet. A wallet is created the first time someone adds money.'} />
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-100 overflow-hidden">
          {list.wallets.map((w) => (
            <div key={w.profileId} data-wallet-row className="p-3 flex flex-wrap items-center justify-between gap-2 text-sm">
              <div><span className="font-extrabold text-[#0F172A]">{w.name}</span> {w.role && <Pill tone="slate">{w.role}</Pill>}</div>
              <div className="flex items-center gap-3">
                {w.hasWallet ? <span className="text-xs text-slate-600">Available <b>{rand0(w.availableRand)}</b> · on hold <b>{rand0(w.heldRand)}</b></span> : <span className="text-xs text-slate-400">No wallet yet</span>}
                <button type="button" onClick={() => onSelect(w)} disabled={!w.hasWallet && !canAdjust} className="text-xs font-bold px-3 py-1.5 rounded-lg bg-white border border-slate-300 text-[#0F172A] hover:bg-slate-50 disabled:opacity-40 cursor-pointer">Open</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>

    {selected && <DetailCard key={selected.row.profileId} row={selected.row} detail={selected.detail} canAdjust={canAdjust} onClose={() => onSelect(null)} onAdjust={onAdjust} edge={edge} />}
  </div>
);
