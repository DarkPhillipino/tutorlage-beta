import React, { useEffect, useState } from 'react';
import { ArrowLeft, Loader2, AlertTriangle, Wallet } from 'lucide-react';
import { COPY } from '../lib/accountRules';
import { WALLET_COPY, fetchBalance, fetchLedger, fetchSubjectNames, fetchTopups, rand0, topupStatusLine, type Balance, type LedgerLine, type Topup } from '../lib/wallet';
import { useWalletOpen, walletDb } from '../lib/walletHooks';
import { formatSaDateTime } from '../lib/saTime';
import { waitingLine } from '../lib/topupNotice';
import { AddMoneyModal } from './AddMoneyModal';
import { PilotNotice } from './PilotNotice';
import { TutorWalletPanel } from './TutorWalletPanel';
import { WalletHistory } from './WalletHistory';

interface WalletPageProps {
  userId: string;
  role: string | undefined;
  // A learner under 18 has no wallet: the parent's wallet pays for them.
  isViewOnlyLearner: boolean;
  onBack: () => void;
}

interface LearnerData {
  balance: Balance;
  topups: Topup[];
  ledger: LedgerLine[];
  requestSubjects: Map<string, string>;
  sessionSubjects: Map<string, string>;
}

// A learner's or parent's wallet: the balance, what is on hold, "Add money", their top-ups with a plain status, and the history.
const LearnerWallet: React.FC<{ userId: string }> = ({ userId }) => {
  const walletOpen = useWalletOpen();
  const [data, setData] = useState<LearnerData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [version, setVersion] = useState(0);
  const [modal, setModal] = useState<{ open: boolean; resume: { topupId: string; reference: string; amountRand: number } | null }>({ open: false, resume: null });

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(false);
    (async () => {
      const [balance, topups, ledger] = await Promise.all([fetchBalance(walletDb, userId), fetchTopups(walletDb, userId), fetchLedger(walletDb, userId)]);
      // The subjects are an extra: if they cannot be read the lines are worded without them.
      const [requestSubjects, sessionSubjects] = await Promise.all([
        fetchSubjectNames(walletDb, 'request', [...new Set(ledger.map((l) => l.requestId).filter((x): x is string => !!x))]),
        fetchSubjectNames(walletDb, 'session', [...new Set(ledger.map((l) => l.sessionId).filter((x): x is string => !!x))]),
      ]);
      if (!cancelled) setData({ balance, topups, ledger, requestSubjects, sessionSubjects });
    })()
      .catch((err) => {
        console.error('wallet load failed:', err);
        if (!cancelled) setLoadError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [userId, version]);

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center py-10 text-slate-400">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        <span className="text-sm font-semibold">Loading your wallet…</span>
      </div>
    );
  }
  if (loadError || !data) {
    return (
      <div className="bg-white rounded-2xl p-6 border border-slate-200 text-center space-y-2" role="alert">
        <AlertTriangle className="w-8 h-8 text-rose-400 mx-auto" />
        <h4 className="text-sm font-bold text-[#0F172A]">Couldn't load your wallet</h4>
        <p className="text-xs text-slate-500">Check your connection and try again.</p>
        <button onClick={() => setVersion((v) => v + 1)} className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-[#0F172A] font-bold text-xs rounded-xl cursor-pointer">Try again</button>
      </div>
    );
  }

  const { balance, topups } = data;
  return (
    <div className="space-y-6">
      <div className="bg-[#0F172A] text-white rounded-2xl p-5 flex items-center justify-between gap-3" data-wallet-balance>
        <div>
          <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Available</div>
          <div className="text-3xl font-extrabold">{rand0(balance.available)}</div>
          {balance.held > 0 && <div className="text-xs text-slate-300 mt-1">{rand0(balance.held)} on hold for your requests</div>}
        </div>
        {walletOpen && (
          <button
            onClick={() => setModal({ open: true, resume: null })}
            className="px-4 py-2.5 bg-[#15803D] hover:bg-[#166534] text-white text-xs font-bold rounded-xl cursor-pointer shrink-0"
          >
            Add money
          </button>
        )}
      </div>
      <p className="text-[11px] text-slate-500 -mt-3">{WALLET_COPY.moneyIsForLessons}</p>
      {walletOpen && <PilotNotice />}

      <div className="space-y-2">
        <h4 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Top-ups</h4>
        {topups.length === 0 ? (
          <p className="text-xs text-slate-500">You have not added money yet.</p>
        ) : (
          topups.map((t) => (
            <div key={t.id} className="bg-white rounded-xl p-3 border border-slate-200 space-y-1" data-topup={t.status}>
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-bold text-[#0F172A]">{rand0(t.amountRand)}</div>
                <div className="text-[10px] text-slate-500">{formatSaDateTime(t.createdAt)} · {t.reference}</div>
              </div>
              {t.status === 'proof_sent' ? (
                <p data-waiting-line className="text-xs font-bold text-[#0F172A]">{waitingLine(t.proofSentAt)}</p>
              ) : (
                <p className={`text-xs ${t.status === 'unsuccessful' ? 'text-rose-700 font-semibold' : 'text-slate-600'}`}>{topupStatusLine(t)}</p>
              )}
              {t.status === 'awaiting_proof' && (
                <button
                  onClick={() => setModal({ open: true, resume: { topupId: t.id, reference: t.reference, amountRand: t.amountRand } })}
                  className="text-[11px] font-bold text-[#15803D] hover:underline cursor-pointer"
                >
                  Send proof of payment
                </button>
              )}
              {t.status === 'proof_sent' && <p className="text-[11px] text-slate-500">{WALLET_COPY.proofSentLine}</p>}
            </div>
          ))
        )}
      </div>

      <div className="space-y-2">
        <h4 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">History</h4>
        <WalletHistory lines={data.ledger} requestSubjects={data.requestSubjects} sessionSubjects={data.sessionSubjects} tutorView={false} />
      </div>

      <AddMoneyModal
        isOpen={modal.open}
        onClose={() => {
          setModal({ open: false, resume: null });
          setVersion((v) => v + 1);
        }}
        payerId={userId}
        resume={modal.resume}
        onChanged={() => setVersion((v) => v + 1)}
      />
    </div>
  );
};

// The "Wallet" page (CEO, 2 Nov 2026). Reached from the header chip and from a wallet notification in the bell. A tutor sees their earnings
// and the payout request instead (TutorWalletPanel); a learner under 18 sees that a parent's wallet pays for them.
export const WalletPage: React.FC<WalletPageProps> = ({ userId, role, isViewOnlyLearner, onBack }) => {
  const isTutor = role === 'tutor';
  return (
    <div className="max-w-2xl mx-auto w-full">
      <div className="bg-white rounded-2xl p-6 sm:p-8 shadow-sm border border-slate-200/80">
        <button onClick={onBack} className="inline-flex items-center space-x-1.5 text-sm font-bold text-slate-600 hover:text-[#0F172A] mb-6 cursor-pointer">
          <ArrowLeft className="w-4 h-4" />
          <span>Back</span>
        </button>
        <h1 className="text-2xl sm:text-3xl font-extrabold text-[#0F172A] tracking-tight mb-1 inline-flex items-center gap-2">
          <Wallet className="w-6 h-6 text-[#15803D]" /> {isTutor ? 'Your earnings' : 'Your wallet'}
        </h1>
        <p className="text-sm text-slate-500 mb-6">
          {isTutor
            ? "Your share of a session arrives here once the session is complete. Ask for it to be paid to your bank account whenever you like."
            : 'Money you add here pays for your lesson requests. The price is put on hold when you send a request and goes straight back if nobody accepts.'}
        </p>
        <div className="bg-[#FAF7F2] rounded-2xl p-4 sm:p-5">
          {isViewOnlyLearner ? (
            <p className="text-xs text-slate-600 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3">{COPY.viewOnlyLearner}</p>
          ) : isTutor ? (
            <TutorWalletPanel tutorId={userId} />
          ) : (
            <LearnerWallet userId={userId} />
          )}
        </div>
      </div>
    </div>
  );
};
