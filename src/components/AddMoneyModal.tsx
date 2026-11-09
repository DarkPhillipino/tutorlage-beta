import React, { useEffect, useRef, useState } from 'react';
import { X, Loader2, Copy, Check, CheckCircle2, Upload, AlertCircle } from 'lucide-react';
import {
  WALLET_COPY,
  cancelTopup,
  checkProofFile,
  createTopup,
  fetchPaymentDetails,
  parseTopupAmount,
  rand0,
  sendProof,
  suggestedTopup,
  type PaymentDetails,
} from '../lib/wallet';
import { walletDb } from '../lib/walletHooks';
import { getErrorMessage } from '../lib/errors';
import { waitingLine } from '../lib/topupNotice';
import { PilotNotice } from './PilotNotice';

interface AddMoneyModalProps {
  isOpen: boolean;
  onClose: () => void;
  // The signed-in payer (a parent pays for their children): the proof is stored in their own folder.
  payerId: string;
  // Arriving from the booking page: the amount that is missing, put in the box (never below the minimum).
  suggestedRand?: number | null;
  // A top-up that is already waiting for its proof (from the wallet page): opens straight at the bank details and the upload.
  resume?: { topupId: string; reference: string; amountRand: number } | null;
  // Called whenever the person's top-ups changed (created, proof sent, cancelled), so the screen behind can read again.
  onChanged?: () => void;
}

type Step = 'amount' | 'pay' | 'sent';
interface Topup { topupId: string; reference: string; amountRand: number }

const CopyButton: React.FC<{ value: string; label: string }> = ({ value, label }) => {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Copying is a convenience: the value is on the screen to read and type.
    }
  };
  return (
    <button type="button" onClick={copy} aria-label={`Copy ${label}`} className="shrink-0 p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 cursor-pointer">
      {copied ? <Check className="w-3.5 h-3.5 text-[#15803D]" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
};

const DetailRow: React.FC<{ label: string; value: string; strong?: boolean }> = ({ label, value, strong }) => (
  <div className="flex items-center justify-between gap-2 py-1.5 border-b border-slate-100 last:border-0">
    <div className="min-w-0">
      <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{label}</div>
      <div className={`text-sm text-[#0F172A] break-words ${strong ? 'font-extrabold' : 'font-semibold'}`}>{value}</div>
    </div>
    <CopyButton value={value} label={label} />
  </div>
);

// "Add money" to the wallet by bank transfer: choose an amount, get Tutorlage's bank details and the reference to type in the bank app, then
// upload the proof of payment (private storage, then the database is told). The CEO checks his bank and credits the wallet by hand.
export const AddMoneyModal: React.FC<AddMoneyModalProps> = ({ isOpen, onClose, payerId, suggestedRand = null, resume = null, onChanged }) => {
  const [details, setDetails] = useState<PaymentDetails | null>(null);
  const [detailsLoaded, setDetailsLoaded] = useState(false);
  const [step, setStep] = useState<Step>('amount');
  const [amountText, setAmountText] = useState('');
  const [topup, setTopup] = useState<Topup | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // When the proof was sent in this window ("Sent 14:05 SAST, waiting for a person to check it" on the last step).
  const [sentAt, setSentAt] = useState<string | null>(null);
  const busyRef = useRef(false);

  // Each time the window opens: start again (at the upload when a waiting top-up was chosen) and read the bank details and limits.
  useEffect(() => {
    if (!isOpen) return;
    setError(null);
    setSentAt(null);
    setFile(null);
    setFileError(null);
    setBusy(false);
    busyRef.current = false;
    setTopup(resume);
    setStep(resume ? 'pay' : 'amount');
    setAmountText('');
    setDetailsLoaded(false);
    let cancelled = false;
    fetchPaymentDetails(walletDb).then((d) => {
      if (cancelled) return;
      setDetails(d);
      setDetailsLoaded(true);
      if (d && !resume) {
        const prefill = suggestedTopup(suggestedRand, d.minRand, d.maxRand);
        if (prefill) setAmountText(String(prefill));
      }
    });
    return () => {
      cancelled = true;
    };
    // `resume` and `suggestedRand` are read when the window opens, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  if (!isOpen) return null;

  const run = async (work: () => Promise<void>, fallback: string) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (e) {
      setError(getErrorMessage(e, fallback));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const handleContinue = () => {
    if (!details) return;
    const parsed = parseTopupAmount(amountText, details.minRand, details.maxRand);
    if ('message' in parsed) {
      setError(parsed.message);
      return;
    }
    void run(async () => {
      const created = await createTopup(walletDb, parsed.rand);
      setTopup(created);
      setStep('pay');
      onChanged?.();
    }, 'Could not start the top-up.');
  };

  const handlePickFile = async (picked: File | null) => {
    setFile(null);
    setFileError(null);
    if (!picked) return;
    const checked = await checkProofFile(picked);
    if ('message' in checked) setFileError(checked.message);
    else setFile(picked);
  };

  const handleSendProof = () => {
    if (!topup || !file) return;
    void run(async () => {
      await sendProof(walletDb, payerId, topup.topupId, file);
      setSentAt(new Date().toISOString());
      setStep('sent');
      onChanged?.();
    }, 'Could not send your proof of payment.');
  };

  const handleCancelTopup = () => {
    if (!topup) return;
    void run(async () => {
      await cancelTopup(walletDb, topup.topupId);
      onChanged?.();
      onClose();
    }, 'Could not cancel this top-up.');
  };

  const bankRows: [string, string][] = details
    ? ([['Bank', details.bankName], ['Account holder', details.accountHolder], ['Account number', details.accountNumber], ['Branch code', details.branchCode], ['Account type', details.accountType]] as [string, string][]).filter(([, v]) => v)
    : [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60" onClick={onClose}>
      <div
        className="bg-white rounded-3xl max-w-md w-full max-h-[90vh] overflow-y-auto shadow-2xl border border-slate-200"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Add money to your wallet"
        data-add-money
      >
        <div className="p-5 bg-[#0A192F] text-white flex items-center justify-between sticky top-0">
          <h3 className="text-lg font-extrabold tracking-tight">Add money</h3>
          <button onClick={onClose} aria-label="Close" className="p-2 rounded-full hover:bg-slate-800 text-slate-400 hover:text-white cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4 bg-[#FAF7F2]">
          {!detailsLoaded ? (
            <div className="flex items-center justify-center py-8 text-slate-400">
              <Loader2 className="w-5 h-5 animate-spin mr-2" />
              <span className="text-sm font-semibold">Loading…</span>
            </div>
          ) : step === 'amount' ? (
            !details ? (
              <p role="status" className="text-sm text-slate-600">Adding money is not available right now. Please try again later.</p>
            ) : (
              <>
                <PilotNotice />
                <p className="text-xs text-slate-600">
                  You add money by bank transfer. Choose how much, from {rand0(details.minRand)} to {rand0(details.maxRand)}. We then show you where to pay and the reference to use.
                </p>
                <label className="block">
                  <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Amount (rand)</span>
                  <div className="mt-1 flex items-center bg-white rounded-xl px-3 border border-slate-200 focus-within:ring-2 focus-within:ring-[#15803D]/20">
                    <span className="text-sm font-bold text-slate-500 mr-1">R</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={amountText}
                      onChange={(e) => setAmountText(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') handleContinue(); }}
                      aria-label="Amount to add, in rand"
                      className="w-full py-3 text-sm font-semibold text-[#0F172A] bg-transparent focus:outline-none"
                    />
                  </div>
                </label>
              </>
            )
          ) : step === 'pay' && topup ? (
            <>
              <PilotNotice />
              <p className="text-xs text-slate-600">{WALLET_COPY.bankIntro}</p>
              <div className="bg-white rounded-2xl border border-slate-200 px-4 py-1">
                <DetailRow label="Amount" value={rand0(topup.amountRand)} strong />
                <DetailRow label="Your reference" value={topup.reference} strong />
                {bankRows.map(([label, value]) => <DetailRow key={label} label={label} value={value} />)}
              </div>
              <p className="text-[11px] text-slate-500">{WALLET_COPY.uploadHelp}</p>
              <label className="block">
                <span className="sr-only">Proof of payment</span>
                <input
                  type="file"
                  accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png"
                  onChange={(e) => void handlePickFile(e.target.files?.[0] ?? null)}
                  aria-label="Proof of payment"
                  className="block w-full text-xs text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-xs file:font-bold file:text-[#0F172A]"
                />
              </label>
              {fileError && <p className="text-xs font-semibold text-rose-600">{fileError}</p>}
              {file && !fileError && <p className="text-[11px] font-semibold text-[#15803D]">Ready to send: {file.name}</p>}
            </>
          ) : (
            <div className="text-center space-y-2 py-2" role="status" data-proof-sent>
              <div className="w-14 h-14 bg-emerald-100 rounded-full flex items-center justify-center text-[#15803D] mx-auto">
                <CheckCircle2 className="w-8 h-8" />
              </div>
              <h4 className="text-base font-extrabold text-[#0F172A]">Proof of payment sent</h4>
              <p data-waiting-line className="text-xs font-bold text-[#0F172A]">{waitingLine(sentAt)}</p>
              {/* The one place the waiting time is written (9 Nov 2026): the older "within one business day" sentence is retired. */}
              <div className="text-left"><PilotNotice /></div>
              <p className="text-xs text-slate-600">{WALLET_COPY.proofSentLine}</p>
            </div>
          )}
          {error && (
            <div className="flex items-start gap-1.5 text-xs font-semibold text-rose-600" role="alert">
              <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}
        </div>

        <div className="p-4 bg-white border-t border-slate-200 flex items-center justify-between gap-2">
          {step === 'amount' && (
            <>
              <button onClick={onClose} disabled={busy} className="px-4 py-2 text-xs font-bold text-slate-500 hover:text-[#0F172A] cursor-pointer">Cancel</button>
              <button
                onClick={handleContinue}
                disabled={busy || !details}
                className="px-5 py-2.5 bg-[#15803D] hover:bg-[#166534] disabled:opacity-60 text-white text-xs font-bold rounded-xl cursor-pointer"
              >
                {busy ? 'One moment…' : 'Continue'}
              </button>
            </>
          )}
          {step === 'pay' && (
            <>
              <div className="flex flex-col items-start">
                <button onClick={onClose} disabled={busy} className="text-xs font-bold text-slate-500 hover:text-[#0F172A] cursor-pointer">I will send the proof later</button>
                <button onClick={handleCancelTopup} disabled={busy || !topup} className="text-[11px] font-bold text-rose-600 hover:underline cursor-pointer">Cancel this top-up</button>
              </div>
              <button
                onClick={handleSendProof}
                disabled={busy || !file}
                className="inline-flex items-center gap-1.5 px-5 py-2.5 bg-[#15803D] hover:bg-[#166534] disabled:opacity-60 text-white text-xs font-bold rounded-xl cursor-pointer"
              >
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                {busy ? 'Sending…' : 'Send proof of payment'}
              </button>
            </>
          )}
          {step === 'sent' && (
            <button onClick={onClose} className="ml-auto px-5 py-2.5 bg-[#0F172A] hover:bg-slate-800 text-white text-xs font-bold rounded-xl cursor-pointer">Done</button>
          )}
        </div>
      </div>
    </div>
  );
};
