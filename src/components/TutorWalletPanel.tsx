import React, { useEffect, useState } from 'react';
import { Loader2, AlertTriangle, AlertCircle, CheckCircle2 } from 'lucide-react';
import {
  OTHER_BANK,
  SA_BANKS,
  WALLET_COPY,
  checkBankForm,
  comingLine,
  fetchBalance,
  fetchBankDetails,
  fetchComing,
  fetchLedger,
  fetchPayouts,
  fetchSubjectNames,
  payoutStatusLine,
  rand0,
  requestPayout,
  saveBankDetails,
  type Balance,
  type BankDetails,
  type ComingMoney,
  type LedgerLine,
  type Payout,
} from '../lib/wallet';
import { walletDb } from '../lib/walletHooks';
import { getErrorMessage } from '../lib/errors';
import { formatSaDate, formatSaDateTime } from '../lib/saTime';
import { WalletHistory } from './WalletHistory';

interface TutorData {
  balance: Balance;
  // null when it could not be read: the screen then says so instead of claiming "nothing coming".
  coming: ComingMoney | null;
  // `undefined` = could not be read; null = none saved yet.
  bank: BankDetails | null | undefined;
  payouts: Payout[];
  ledger: LedgerLine[];
  sessionSubjects: Map<string, string>;
}

const EMPTY_FORM = { bank: '', otherBank: '', accountNumber: '', branchCode: '', holder: '' };

// A tutor's wallet (CEO, 2 Nov 2026): what is available to be paid out, what is coming from booked sessions, the four bank fields, and
// "Transact": one request for the whole available balance, one open request at a time. The CEO pays by hand and marks it paid.
export const TutorWalletPanel: React.FC<{ tutorId: string }> = ({ tutorId }) => {
  const [data, setData] = useState<TutorData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [version, setVersion] = useState(0);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [sent, setSent] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(false);
    (async () => {
      // The balance is what the screen is for: if it cannot be read, the whole screen says so. The rest degrades one part at a time.
      const balance = await fetchBalance(walletDb, tutorId);
      const [coming, bank, payouts, ledger] = await Promise.all([
        fetchComing(walletDb, tutorId).catch((err): ComingMoney | null => { console.error('fetchComing failed:', err); return null; }),
        fetchBankDetails(walletDb, tutorId).catch((err): undefined => { console.error('fetchBankDetails failed:', err); return undefined; }),
        fetchPayouts(walletDb, tutorId).catch((err): Payout[] => { console.error('fetchPayouts failed:', err); return []; }),
        fetchLedger(walletDb, tutorId).catch((err): LedgerLine[] => { console.error('fetchLedger failed:', err); return []; }),
      ]);
      const sessionSubjects = await fetchSubjectNames(walletDb, 'session', [...new Set(ledger.map((l) => l.sessionId).filter((x): x is string => !!x))]);
      if (!cancelled) setData({ balance, coming, bank, payouts, ledger, sessionSubjects });
    })()
      .catch((err) => {
        console.error('tutor wallet load failed:', err);
        if (!cancelled) setLoadError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tutorId, version]);

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center py-10 text-slate-400">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        <span className="text-sm font-semibold">Loading your earnings…</span>
      </div>
    );
  }
  if (loadError || !data) {
    return (
      <div className="bg-white rounded-2xl p-6 border border-slate-200 text-center space-y-2" role="alert">
        <AlertTriangle className="w-8 h-8 text-rose-400 mx-auto" />
        <h4 className="text-sm font-bold text-[#0F172A]">Couldn't load your earnings</h4>
        <p className="text-xs text-slate-500">Check your connection and try again.</p>
        <button onClick={() => setVersion((v) => v + 1)} className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-[#0F172A] font-bold text-xs rounded-xl cursor-pointer">Try again</button>
      </div>
    );
  }

  const { balance, coming, bank, payouts } = data;
  const openPayout = payouts.some((p) => p.status === 'requested');
  const showForm = bank === null || editing;
  const canTransact = balance.available > 0 && !!bank && !openPayout;

  const handleSave = async () => {
    const checked = checkBankForm(form);
    if ('message' in checked) {
      setFormError(checked.message);
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      await saveBankDetails(walletDb, checked);
      // The account number is write-only: it leaves the form at once and only the last four digits are ever shown again.
      setForm(EMPTY_FORM);
      setEditing(false);
      setVersion((v) => v + 1);
    } catch (e) {
      setFormError(getErrorMessage(e, 'Could not save your bank details.'));
    } finally {
      setSaving(false);
    }
  };

  const handleTransact = async () => {
    setRequesting(true);
    setRequestError(null);
    try {
      const result = await requestPayout(walletDb);
      setSent(result.amountRand);
      setConfirming(false);
      setVersion((v) => v + 1);
    } catch (e) {
      setRequestError(getErrorMessage(e, 'Could not send your request.'));
    } finally {
      setRequesting(false);
    }
  };

  const field = 'w-full bg-white rounded-xl px-3 py-2.5 text-sm font-semibold text-[#0F172A] border border-slate-200 focus:outline-none focus:ring-2 focus:ring-[#15803D]/20';

  return (
    <div className="space-y-6">
      <div className="bg-[#0F172A] text-white rounded-2xl p-5 space-y-1" data-wallet-balance>
        <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Available</div>
        <div className="text-3xl font-extrabold">{rand0(balance.available)}</div>
        {balance.held > 0 && <div className="text-xs text-slate-300">{rand0(balance.held)} is in a payout request that is waiting to be paid</div>}
        <div className="text-xs text-emerald-300 font-semibold" data-wallet-coming>
          {coming === null ? 'Coming money could not be read just now.' : comingLine(coming)}
        </div>
      </div>

      {sent !== null && (
        <div role="status" data-payout-sent className="flex items-start gap-2 text-xs font-semibold text-[#15803D] bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3">
          <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{WALLET_COPY.payoutSent(sent)}</span>
        </div>
      )}

      <div className="space-y-2">
        <h4 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Your bank account</h4>
        {bank === undefined ? (
          <p className="text-xs text-slate-500">Your bank details could not be read just now. Try again in a moment.</p>
        ) : showForm ? (
          <div className="bg-white rounded-2xl p-4 border border-slate-200 space-y-3" data-bank-form>
            <label className="block">
              <span className="text-[11px] font-bold text-slate-500">Bank</span>
              <select value={form.bank} onChange={(e) => setForm({ ...form, bank: e.target.value })} className={`${field} mt-1`} aria-label="Bank">
                <option value="">Choose your bank…</option>
                {SA_BANKS.map((b) => <option key={b} value={b}>{b}</option>)}
                <option value={OTHER_BANK}>{OTHER_BANK}</option>
              </select>
            </label>
            {form.bank === OTHER_BANK && (
              <input value={form.otherBank} onChange={(e) => setForm({ ...form, otherBank: e.target.value })} placeholder="Name of your bank" aria-label="Name of your bank" maxLength={80} className={field} />
            )}
            <label className="block">
              <span className="text-[11px] font-bold text-slate-500">Account number</span>
              <input value={form.accountNumber} onChange={(e) => setForm({ ...form, accountNumber: e.target.value })} inputMode="numeric" autoComplete="off" maxLength={24} aria-label="Account number" className={`${field} mt-1`} />
            </label>
            <label className="block">
              <span className="text-[11px] font-bold text-slate-500">Branch code</span>
              <input value={form.branchCode} onChange={(e) => setForm({ ...form, branchCode: e.target.value })} inputMode="numeric" autoComplete="off" maxLength={10} aria-label="Branch code" className={`${field} mt-1`} />
            </label>
            <label className="block">
              <span className="text-[11px] font-bold text-slate-500">Account holder's name</span>
              <input value={form.holder} onChange={(e) => setForm({ ...form, holder: e.target.value })} autoComplete="off" maxLength={120} aria-label="Account holder's name" className={`${field} mt-1`} />
            </label>
            <p className="text-[11px] text-slate-500">{WALLET_COPY.accountNumberNote}</p>
            {formError && (
              <div className="flex items-start gap-1.5 text-xs font-semibold text-rose-600" role="alert">
                <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>{formError}</span>
              </div>
            )}
            <div className="flex items-center gap-2">
              <button onClick={handleSave} disabled={saving} className="px-4 py-2 bg-[#0F172A] hover:bg-slate-800 disabled:opacity-60 text-white text-xs font-bold rounded-xl cursor-pointer">
                {saving ? 'Saving…' : 'Save bank details'}
              </button>
              {editing && (
                <button onClick={() => { setEditing(false); setForm(EMPTY_FORM); setFormError(null); }} disabled={saving} className="text-xs font-bold text-slate-500 cursor-pointer">Cancel</button>
              )}
            </div>
          </div>
        ) : (
          <div className="bg-white rounded-xl px-4 py-3 border border-slate-200 flex items-center justify-between gap-3" data-bank-summary>
            <div className="text-sm font-bold text-[#0F172A] min-w-0 truncate">
              {bank.bankName} · ••{bank.last4} · {bank.accountHolder}
            </div>
            {!openPayout && (
              <button onClick={() => setEditing(true)} className="text-xs font-bold text-[#15803D] hover:underline cursor-pointer shrink-0">Change</button>
            )}
          </div>
        )}
      </div>

      <div className="space-y-2">
        {openPayout && <p className="text-[11px] text-slate-600" data-payout-open>{WALLET_COPY.payoutOpenNote}</p>}
        {confirming && bank ? (
          <div className="bg-white rounded-2xl p-4 border border-slate-200 space-y-2" data-transact-confirm>
            <p className="text-sm font-bold text-[#0F172A]">Request {rand0(balance.available)} to {bank.bankName} ••{bank.last4} ({bank.accountHolder})?</p>
            {requestError && (
              <div className="flex items-start gap-1.5 text-xs font-semibold text-rose-600" role="alert">
                <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>{requestError}</span>
              </div>
            )}
            <div className="flex items-center gap-2">
              <button onClick={handleTransact} disabled={requesting} className="px-4 py-2 bg-[#15803D] hover:bg-[#166534] disabled:opacity-60 text-white text-xs font-bold rounded-xl cursor-pointer">
                {requesting ? 'Sending…' : 'Request payout'}
              </button>
              <button onClick={() => { setConfirming(false); setRequestError(null); }} disabled={requesting} className="text-xs font-bold text-slate-500 cursor-pointer">Back</button>
            </div>
          </div>
        ) : (
          <>
            <button
              onClick={() => { setSent(null); setConfirming(true); }}
              disabled={!canTransact}
              className="px-6 py-3 bg-[#15803D] hover:bg-[#166534] disabled:opacity-50 text-white text-sm font-bold rounded-xl transition-all shadow-xs cursor-pointer"
            >
              Transact
            </button>
            {!bank && bank !== undefined && <p className="text-[11px] text-slate-500">Add your bank details first.</p>}
            {bank && !openPayout && balance.available <= 0 && <p className="text-[11px] text-slate-500">There is nothing to pay out yet.</p>}
          </>
        )}
      </div>

      <div className="space-y-2">
        <h4 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Payouts</h4>
        {payouts.length === 0 ? (
          <p className="text-xs text-slate-500">You have not asked for a payout yet.</p>
        ) : (
          payouts.map((p) => (
            <div key={p.id} className="bg-white rounded-xl p-3 border border-slate-200 space-y-0.5" data-payout={p.status}>
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-bold text-[#0F172A]">{rand0(p.amountRand)} · {p.bankName} ••{p.last4}</div>
                <div className="text-[10px] text-slate-500">{formatSaDateTime(p.requestedAt)}</div>
              </div>
              <p className={`text-xs ${p.status === 'could_not_pay' ? 'text-rose-700 font-semibold' : 'text-slate-600'}`}>{payoutStatusLine(p, formatSaDate)}</p>
            </div>
          ))
        )}
      </div>

      <div className="space-y-2">
        <h4 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">History</h4>
        <WalletHistory lines={data.ledger} requestSubjects={new Map()} sessionSubjects={data.sessionSubjects} tutorView />
      </div>
    </div>
  );
};
