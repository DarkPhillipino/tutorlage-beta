import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CheckCircle2, Clock, Loader2, XCircle } from 'lucide-react';
import { useAuth } from '../lib/AuthContext';
import { walletDb } from '../lib/walletHooks';
import { onlineRequest } from '../lib/walletOnlineHooks';
import {
  ONLINE_COPY,
  checkOnlineTopup,
  decideReturn,
  fetchTopupById,
  isTopupId,
  paidBody,
  paidTitle,
  pollReturn,
  type ReturnView,
} from '../lib/walletOnline';

// Where the bank's page sends the payer back (/wallet/topup-return?topup=<id>), after Pay by bank, instant. THIS PAGE CAN NEVER CREDIT ANYTHING: it only
// READS the payer's own top-up row (the database's policies decide who may), every 3 seconds for up to 60 seconds, and says what that row says. Money
// reaches the wallet only when the Worker tells the database (the bank's message, or its own check); then the row becomes "successful" and this page,
// the wallet page and the bell all show it. "Check now" only asks the Worker to look again. The address's own words are never taken as proof of anything.
export default function TopupReturn() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const topupId = searchParams.get('topup') ?? '';
  const [view, setView] = useState<ReturnView>({ kind: 'checking' });
  // "Check now": busy while asking, then a short note (what was found, or why it was refused).
  const [checkBusy, setCheckBusy] = useState(false);
  const [checkNote, setCheckNote] = useState<string | null>(null);
  const checkBusyRef = useRef(false);
  const userId = user?.id ?? null;

  // (The tab title comes from the page table, src/lib/pageMeta.ts.)
  // Read at once, then every 3 seconds, until it is settled or a minute has passed.
  useEffect(() => {
    if (!userId) return;
    if (!isTopupId(topupId)) {
      setView({ kind: 'not_found' });
      return;
    }
    let cancelled = false;
    setView({ kind: 'checking' });
    void pollReturn({
      read: () => fetchTopupById(walletDb, userId, topupId),
      sleep: (ms) => new Promise((resolve) => window.setTimeout(resolve, ms)),
      now: () => Date.now(),
      isCancelled: () => cancelled,
      onView: (next) => {
        if (!cancelled) setView(next);
      },
    });
    return () => {
      cancelled = true;
    };
  }, [userId, topupId]);

  const checkNow = useCallback(async () => {
    if (!userId || checkBusyRef.current || !isTopupId(topupId)) return;
    checkBusyRef.current = true;
    setCheckBusy(true);
    setCheckNote(null);
    try {
      const asked = await checkOnlineTopup(onlineRequest, topupId);
      if ('message' in asked) {
        setCheckNote(asked.message);
        return;
      }
      // Whatever the Worker found went through the database; read the row again to see it.
      let row;
      try {
        row = await fetchTopupById(walletDb, userId, topupId);
      } catch {
        row = undefined;
      }
      const next = decideReturn(row, Number.MAX_SAFE_INTEGER);
      setView(next);
      if (next.kind === 'waiting') setCheckNote(ONLINE_COPY.checkedNothing);
    } finally {
      checkBusyRef.current = false;
      setCheckBusy(false);
    }
  }, [userId, topupId]);

  const toWallet = () => navigate('/?view=wallet');

  let icon = <Loader2 className="w-10 h-10 text-slate-400 animate-spin mx-auto mb-4" aria-hidden="true" />;
  let title: string = ONLINE_COPY.checkingTitle;
  let body: string = ONLINE_COPY.checkingBody;
  let tone: 'wait' | 'good' | 'bad' = 'wait';
  if (!loading && !userId) {
    icon = <Clock className="w-10 h-10 text-slate-400 mx-auto mb-4" aria-hidden="true" />;
    title = ONLINE_COPY.signInTitle;
    body = ONLINE_COPY.signInBody;
  } else if (view.kind === 'paid') {
    tone = 'good';
    title = paidTitle;
    body = paidBody(view.amountRand);
  } else if (view.kind === 'waiting') {
    icon = <Clock className="w-10 h-10 text-slate-400 mx-auto mb-4" aria-hidden="true" />;
    title = ONLINE_COPY.waitingTitle;
    body = ONLINE_COPY.waitingBody;
  } else if (view.kind === 'not_completed') {
    tone = 'bad';
    title = ONLINE_COPY.notCompletedTitle;
    body = ONLINE_COPY.notCompleted;
  } else if (view.kind === 'cancelled') {
    tone = 'bad';
    title = ONLINE_COPY.cancelledTitle;
    body = ONLINE_COPY.cancelledOnline;
  } else if (view.kind === 'not_found') {
    tone = 'bad';
    title = ONLINE_COPY.notFoundTitle;
    body = ONLINE_COPY.notFoundBody;
  } else if (view.kind === 'other') {
    title = ONLINE_COPY.otherTitle;
    body = ONLINE_COPY.otherBody;
    icon = <Clock className="w-10 h-10 text-slate-400 mx-auto mb-4" aria-hidden="true" />;
  }
  if (tone === 'good') {
    icon = (
      <div className="w-14 h-14 bg-emerald-100 rounded-full flex items-center justify-center text-[#15803D] mx-auto mb-4">
        <CheckCircle2 className="w-8 h-8" aria-hidden="true" />
      </div>
    );
  } else if (tone === 'bad') {
    icon = (
      <div className="w-14 h-14 bg-rose-100 rounded-full flex items-center justify-center text-rose-600 mx-auto mb-4">
        <XCircle className="w-8 h-8" aria-hidden="true" />
      </div>
    );
  }

  const signedOut = !loading && !userId;
  return (
    <main className="min-h-screen flex items-center justify-center bg-[#FAF7F2] px-4">
      <div className="max-w-sm w-full bg-white rounded-2xl p-8 shadow-sm border border-slate-200/80 text-center" data-topup-return={signedOut ? 'signin' : view.kind}>
        {loading ? (
          <>
            <Loader2 className="w-10 h-10 text-slate-400 animate-spin mx-auto mb-4" aria-hidden="true" />
            <h1 className="text-lg font-extrabold text-[#0F172A] mb-1">{ONLINE_COPY.checkingTitle}</h1>
          </>
        ) : (
          <>
            {icon}
            <h1 className="text-lg font-extrabold text-[#0F172A] mb-1">{title}</h1>
            <p role="status" className="text-xs text-slate-600 mb-5">{body}</p>
            {!signedOut && view.kind === 'waiting' && view.readFailed && <p className="text-xs text-slate-600 mb-3">{ONLINE_COPY.waitingNoRead}</p>}
            {checkNote && <p role="status" className="text-xs font-semibold text-slate-700 mb-3" data-check-note>{checkNote}</p>}
            {signedOut ? (
              <button onClick={() => navigate('/login')} className="px-5 py-2.5 bg-[#15803D] text-white font-bold rounded-xl text-sm hover:bg-[#166534] transition-all cursor-pointer">
                {ONLINE_COPY.signIn}
              </button>
            ) : (
              <div className="flex flex-col sm:flex-row gap-2 justify-center">
                {view.kind === 'waiting' && (
                  <button
                    onClick={() => void checkNow()}
                    disabled={checkBusy}
                    className="px-5 py-2.5 bg-[#0F172A] disabled:opacity-60 text-white font-bold rounded-xl text-sm hover:bg-slate-800 transition-all cursor-pointer"
                  >
                    {checkBusy ? 'Checking…' : ONLINE_COPY.checkNow}
                  </button>
                )}
                {view.kind !== 'checking' && (
                  <button
                    onClick={toWallet}
                    className={`px-5 py-2.5 font-bold rounded-xl text-sm transition-all cursor-pointer ${view.kind === 'waiting' ? 'bg-slate-100 text-[#0F172A] hover:bg-slate-200' : 'bg-[#15803D] text-white hover:bg-[#166534]'}`}
                  >
                    {ONLINE_COPY.goToWallet}
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}
