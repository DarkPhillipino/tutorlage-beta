import React, { useState } from 'react';
import { Eye } from 'lucide-react';
import {
  TopupQueue, TopupRow, checkSuccessful, checkUnsuccessful, formatSast, isOverdue, rand0, successConfirmText, unsuccessConfirmText, waitingFor,
} from '../lib/walletAdmin';
import { ConfirmBox, CopyButton, Empty, ErrorLine, FieldLabel, NotAvailable, Pill, inputClass } from './WalletParts';

// Tab 1, "Top-ups to check": the learners' bank transfers whose proof has been sent, oldest first. The CEO looks at the proof (inside the app, never a
// link), finds the money in his banking app, types what he actually received (prefilled with the claim) and clicks Successful or Unsuccessful.
// The screen holds no money rules: the database decides (once only, comment rules, amounts); the checks here only save a round trip.

interface Props {
  queue: TopupQueue;
  now?: Date;
  onView: (row: TopupRow) => void;
  // Each returns the error text to show, or null when it worked (the page then reads the list again).
  onSuccessful: (row: TopupRow, received: number, comment: string | null) => Promise<string | null>;
  onUnsuccessful: (row: TopupRow, comment: string) => Promise<string | null>;
  onRetry: () => void;
}

const Payer: React.FC<{ row: TopupRow }> = ({ row }) => (
  <>
    <span className="text-sm font-extrabold text-[#0F172A]">{row.payerName}</span>
    {row.payerIsParent && <span className="ml-1.5"><Pill tone="slate">parent</Pill></span>}
  </>
);

const TopupCard: React.FC<{ row: TopupRow; now: Date } & Pick<Props, 'onView' | 'onSuccessful' | 'onUnsuccessful'>> = ({ row, now, onView, onSuccessful, onUnsuccessful }) => {
  const [receivedText, setReceivedText] = useState(String(row.claimedRand));
  const [comment, setComment] = useState('');
  const [confirm, setConfirm] = useState<null | { kind: 'success'; received: number; note: string | null } | { kind: 'fail'; note: string }>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const since = row.proofSentAt ?? row.createdAt;
  const late = isOverdue(since, now);
  const id = `topup-${row.id}`;

  const askSuccessful = () => {
    const c = checkSuccessful(row.claimedRand, receivedText, comment);
    if (c.ok === false) return setError(c.error);
    setError(null);
    setConfirm({ kind: 'success', received: c.received, note: c.comment });
  };
  const askUnsuccessful = () => {
    const c = checkUnsuccessful(comment);
    if (c.ok === false) return setError(c.error);
    setError(null);
    setConfirm({ kind: 'fail', note: c.comment });
  };
  const run = async () => {
    if (!confirm) return;
    setBusy(true);
    const problem = confirm.kind === 'success' ? await onSuccessful(row, confirm.received, confirm.note) : await onUnsuccessful(row, confirm.note);
    setBusy(false);
    if (problem) {
      setConfirm(null);
      setError(problem);
    }
  };

  return (
    <div data-topup-card className={`p-4 ${late ? 'bg-rose-50/60' : ''}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Payer row={row} />
          <div className="text-xs text-slate-500 mt-0.5">
            Reference <span className="font-mono font-bold text-[#0F172A]">{row.reference}</span> <CopyButton text={row.reference} label={`Copy reference ${row.reference}`} />
          </div>
          <div className={`text-[11px] mt-0.5 ${late ? 'font-bold text-rose-700' : 'text-slate-400'}`}>
            Proof sent {formatSast(since)} · waiting {waitingFor(since, now)}{late ? ' · over 24 hours' : ''}
          </div>
        </div>
        <div className="text-right">
          <div className="text-xl font-extrabold text-[#0F172A]">{rand0(row.claimedRand)}</div>
          <div className="text-[10px] font-bold text-slate-400">claimed</div>
        </div>
      </div>

      <div className="mt-3">
        <button type="button" onClick={() => onView(row)} disabled={!row.proofPath} className="inline-flex items-center gap-1.5 text-xs font-bold px-3 py-2 rounded-lg bg-white border border-slate-300 text-[#0F172A] hover:bg-slate-50 disabled:opacity-50 cursor-pointer">
          <Eye className="w-3.5 h-3.5" /> View proof
        </button>
        <span className="ml-2 text-[11px] text-slate-400">Opens here, in this app. Each opening is recorded.</span>
      </div>

      <div className="grid sm:grid-cols-[10rem_1fr] gap-3 mt-3">
        <div>
          <FieldLabel htmlFor={`${id}-received`}>Amount received (R)</FieldLabel>
          <input id={`${id}-received`} inputMode="numeric" value={receivedText} onChange={(e) => { setReceivedText(e.target.value); setConfirm(null); }} disabled={busy} className={inputClass} />
        </div>
        <div>
          <FieldLabel htmlFor={`${id}-comment`}>Comment (needed if the amount differs, and for Unsuccessful; the learner reads it)</FieldLabel>
          <textarea id={`${id}-comment`} rows={2} value={comment} onChange={(e) => { setComment(e.target.value); setConfirm(null); }} disabled={busy} className={inputClass} />
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mt-3">
        <button type="button" onClick={askSuccessful} disabled={busy} className="text-xs font-bold text-white bg-[#15803D] hover:bg-[#166534] px-4 py-2 rounded-lg disabled:opacity-60 cursor-pointer">Successful transfer</button>
        <button type="button" onClick={askUnsuccessful} disabled={busy} className="text-xs font-bold text-rose-700 bg-white border border-rose-300 hover:bg-rose-50 px-4 py-2 rounded-lg disabled:opacity-60 cursor-pointer">Unsuccessful transfer</button>
      </div>

      {confirm && (
        <ConfirmBox
          text={confirm.kind === 'success' ? successConfirmText(row.payerName, confirm.received, row.claimedRand) : unsuccessConfirmText(row.payerName)}
          yes={confirm.kind === 'success' ? 'Yes, add it' : 'Yes, not received'}
          danger={confirm.kind === 'fail'}
          busy={busy}
          onYes={run}
          onNo={() => setConfirm(null)}
        />
      )}
      <ErrorLine text={error} />
    </div>
  );
};

export const WalletTopupsBody: React.FC<Props> = ({ queue, now = new Date(), onView, onSuccessful, onUnsuccessful, onRetry }) => {
  if (queue.state === 'not_available') return <NotAvailable message={queue.note} />;
  if (queue.state === 'error') return <NotAvailable message={queue.message} failed onRetry={onRetry} />;
  return (
    <div className="space-y-6">
      <section>
        <h2 className="text-sm font-extrabold text-[#0F172A] mb-1">Proof sent: check these ({queue.proofSent.length})</h2>
        <p className="text-xs text-slate-500 mb-3">Oldest first. Look at the proof, then find the money in your banking app (search for the reference) before you click.</p>
        {queue.proofSent.length === 0 ? (
          <Empty text="Nothing to check. When a learner sends proof of a transfer it appears here." />
        ) : (
          <div className="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-100 overflow-hidden">
            {queue.proofSent.map((r) => <TopupCard key={r.id} row={r} now={now} onView={onView} onSuccessful={onSuccessful} onUnsuccessful={onUnsuccessful} />)}
          </div>
        )}
      </section>

      <section>
        <h2 className="text-sm font-extrabold text-[#0F172A] mb-1">Waiting for the learner's proof ({queue.awaiting.length})</h2>
        <p className="text-xs text-slate-500 mb-3">They asked to add money but have not sent proof yet. Nothing to check. A top-up with no proof is cancelled automatically after a few days.</p>
        {queue.awaiting.length === 0 ? (
          <Empty text="No top-up is waiting for proof." />
        ) : (
          <div className="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-100 overflow-hidden">
            {queue.awaiting.map((r) => (
              <div key={r.id} data-awaiting-row className="p-3 flex flex-wrap items-center justify-between gap-2 text-sm">
                <div><Payer row={r} /> <span className="text-xs text-slate-500">· {r.reference} · started {formatSast(r.createdAt)}</span></div>
                <span className="font-extrabold text-[#0F172A]">{rand0(r.claimedRand)}</span>
              </div>
            ))}
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
                  <div><Payer row={r} /> <span className="text-xs text-slate-500">· {r.reference} · {formatSast(r.decidedAt)}</span></div>
                  <span>
                    <Pill tone={r.status === 'successful' ? 'green' : 'red'}>{r.status === 'successful' ? 'Successful' : 'Unsuccessful'}</Pill>{' '}
                    <span className="font-extrabold text-[#0F172A]">{r.status === 'successful' && r.receivedRand != null ? rand0(r.receivedRand) : rand0(r.claimedRand)}</span>
                  </span>
                </div>
                {r.comment && <div className="text-xs text-slate-500 mt-0.5">“{r.comment}”</div>}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};
