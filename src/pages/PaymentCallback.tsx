import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { verifyPayment } from '../lib/payments';
import { getErrorMessage } from '../lib/errors';
import { FREE_FOR_NOW_NOTICE } from '../lib/freeSessions';
import { useAuth } from '../lib/AuthContext';
import { fetchRequestIdByReference, isRequestId, type WatchMode } from '../lib/requestWatch';
import { useRequestWatch, watchDb } from '../lib/requestWatchHooks';
import { RequestWatchCard } from '../components/RequestWatchCard';

// Where Paystack sends the browser back after the card check (see callbackUrl
// in src/lib/payments.ts). Never trust the redirect's own query params as
// proof — verifyPayment() asks server/index.ts, which re-checks the real
// status and amount with Paystack, has the database save the card and make
// the request visible to tutors, and refunds the R1 check (backlog 7a).
//
// THE WAITING SCREEN (the CEO, 9 Nov 2026): once a request has been sent (wallet, free, or a verified card) this page no longer ends at "Back to Tutorlage".
// It READS the payer's own request (src/lib/requestWatch.ts: the id is `&request=<id>` in the address for wallet and free, found by the card reference for a
// card) and becomes a waiting screen, then the booked session, then (if nobody accepts) a plain "ended" screen. The address is never taken as proof of anything:
// it only says WHICH of the payer's own requests to look at, and the database decides whether it is theirs. If the id is missing, wrong, or not theirs, or the
// person is not signed in, the page is exactly what it was before.
export default function PaymentCallback() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const userId = user?.id ?? null;
  const [state, setState] = useState<'checking' | 'success' | 'paid' | 'free' | 'wallet' | 'failed'>('checking');
  const [error, setError] = useState<string | null>(null);
  // Card path only: the request that this card reference belongs to, once found.
  const [cardRequestId, setCardRequestId] = useState<string | null>(null);
  const [cardLookupDone, setCardLookupDone] = useState(false);

  const urlRequest = searchParams.get('request');
  const watchId = state === 'wallet' || state === 'free' ? (isRequestId(urlRequest) ? urlRequest : null) : state === 'success' ? cardRequestId : null;
  const mode: WatchMode = state === 'free' ? 'free' : state === 'wallet' ? 'wallet' : 'card';
  const watch = useRequestWatch(watchId, userId);

  useEffect(() => {
    if (state !== 'success' || !userId) return;
    const reference = searchParams.get('reference') || searchParams.get('trxref');
    if (!reference) {
      setCardLookupDone(true);
      return;
    }
    let cancelled = false;
    void fetchRequestIdByReference(watchDb, userId, reference).then((id) => {
      if (cancelled) return;
      setCardRequestId(id);
      setCardLookupDone(true);
    });
    return () => {
      cancelled = true;
    };
  }, [state, userId, searchParams]);

  useEffect(() => {
    // WALLET (CEO, 2 Nov 2026): the booking page has already put the price on hold in the wallet and sent the request; there is nothing to verify.
    if (searchParams.get('wallet') === '1') {
      setState('wallet');
      return;
    }
    // FREE SESSIONS (CEO, 2 Nov 2026): the booking page has already sent the request with no card check; there is nothing to verify.
    if (searchParams.get('free') === '1') {
      setState('free');
      return;
    }
    const reference = searchParams.get('reference') || searchParams.get('trxref');
    if (!reference) {
      setState('failed');
      setError('No payment reference was returned.');
      return;
    }

    verifyPayment(reference)
      .then(({ status, reason }) => {
        if (status === 'pending') {
          setError("Paystack hasn't confirmed your card yet. Refresh this page in a minute — you won't be charged twice.");
        } else if (status === 'failed' && reason) {
          setError(reason);
        }
        setState(status === 'card_verified' ? 'success' : status === 'paid' ? 'paid' : 'failed');
      })
      .catch((e) => {
        setError(getErrorMessage(e, 'Could not check your card.'));
        setState('failed');
      });
  }, [searchParams]);

  // The request has been read and is the payer's own: show the waiting / booked / ended screen. Otherwise (no id, not theirs, not signed in, or the first look
  // failed) the page below is exactly what it was. While the first look is on its way the sent page shows without its button, so there is no flash of
  // "Back to Tutorlage" that is about to change.
  const seen = watch.view;
  const showWatch = !!watchId && !!userId && seen.kind !== 'reading' && seen.kind !== 'fallback';
  const sentState = state === 'success' || state === 'paid' || state === 'free' || state === 'wallet';
  const mightWatch = state === 'wallet' || state === 'free' ? !!watchId : state === 'success';
  const firstLookPending =
    mightWatch && (authLoading || (!!userId && (watchId ? seen.kind === 'reading' : state === 'success' && !cardLookupDone)));

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#FAF7F2] px-4">
      <div className="max-w-sm w-full bg-white rounded-2xl p-8 shadow-sm border border-slate-200/80 text-center">
        {showWatch && (
          <RequestWatchCard
            view={seen as Parameters<typeof RequestWatchCard>[0]['view']}
            mode={mode}
            stopped={watch.stopped}
            lookFailed={watch.lookFailed}
            busy={watch.busy}
            onRefresh={() => void watch.refresh()}
            onCancelled={watch.refresh}
            onSessions={() => navigate('/?view=sessions')}
            onNewRequest={() => navigate('/')}
          />
        )}
        {state === 'checking' && (
          <>
            <Loader2 className="w-10 h-10 text-slate-400 animate-spin mx-auto mb-4" />
            <h1 className="text-lg font-extrabold text-[#0F172A] mb-1">Checking your card…</h1>
            <p className="text-xs text-slate-500">Hang on while we check with Paystack.</p>
          </>
        )}
        {sentState && !showWatch && (
          <>
            <div className="w-14 h-14 bg-emerald-100 rounded-full flex items-center justify-center text-[#15803D] mx-auto mb-4">
              <CheckCircle2 className="w-8 h-8" />
            </div>
            <h1 className="text-lg font-extrabold text-[#0F172A] mb-1">Request sent</h1>
            <p className="text-xs text-slate-500 mb-5">
              {state === 'free'
                ? `${FREE_FOR_NOW_NOTICE} Your request is now visible to qualifying tutors, and we'll let you know when one accepts.`
                : state === 'wallet'
                ? "Your request is sent. The price is on hold in your wallet. If nobody accepts in time, it goes straight back. We'll let you know when a tutor accepts."
                : state === 'success'
                ? "Your request is now visible to qualifying tutors. We'll let you know when one accepts."
                : "Your payment is confirmed and your request is visible to qualifying tutors — we'll match you as soon as one accepts."}
            </p>
            {!firstLookPending && (
              <button
                onClick={() => navigate('/')}
                className="px-5 py-2.5 bg-[#15803D] text-white font-bold rounded-xl text-sm hover:bg-[#166534] transition-all cursor-pointer"
              >
                Back to Tutorlage
              </button>
            )}
          </>
        )}
        {state === 'failed' && (
          <>
            <div className="w-14 h-14 bg-rose-100 rounded-full flex items-center justify-center text-rose-600 mx-auto mb-4">
              <XCircle className="w-8 h-8" />
            </div>
            <h1 className="text-lg font-extrabold text-[#0F172A] mb-1">Your request wasn't sent</h1>
            <p className="text-xs text-slate-500 mb-5">{error ?? 'Your card check didn\'t go through. You can try sending the request again.'}</p>
            <button
              onClick={() => navigate('/')}
              className="px-5 py-2.5 bg-[#0F172A] text-white font-bold rounded-xl text-sm hover:bg-slate-800 transition-all cursor-pointer"
            >
              Back to Tutorlage
            </button>
          </>
        )}
      </div>
    </div>
  );
}
