import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { verifyPayment } from '../lib/payments';
import { getErrorMessage } from '../lib/errors';

// Where Paystack sends the browser back after the card check (see callbackUrl
// in src/lib/payments.ts). Never trust the redirect's own query params as
// proof — verifyPayment() asks server/index.ts, which re-checks the real
// status and amount with Paystack, has the database save the card and make
// the request visible to tutors, and refunds the R1 check (backlog 7a).
export default function PaymentCallback() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [state, setState] = useState<'checking' | 'success' | 'paid' | 'failed'>('checking');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
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

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#FAF7F2] px-4">
      <div className="max-w-sm w-full bg-white rounded-2xl p-8 shadow-sm border border-slate-200/80 text-center">
        {state === 'checking' && (
          <>
            <Loader2 className="w-10 h-10 text-slate-400 animate-spin mx-auto mb-4" />
            <h1 className="text-lg font-extrabold text-[#0F172A] mb-1">Checking your card…</h1>
            <p className="text-xs text-slate-500">Hang on while we check with Paystack.</p>
          </>
        )}
        {(state === 'success' || state === 'paid') && (
          <>
            <div className="w-14 h-14 bg-emerald-100 rounded-full flex items-center justify-center text-[#15803D] mx-auto mb-4">
              <CheckCircle2 className="w-8 h-8" />
            </div>
            <h1 className="text-lg font-extrabold text-[#0F172A] mb-1">Request sent</h1>
            <p className="text-xs text-slate-500 mb-5">
              {state === 'success'
                ? "Your request is now visible to qualifying tutors. Your card is charged only when one accepts — we'll let you know. The R1 card check is being refunded."
                : "Your payment is confirmed and your request is visible to qualifying tutors — we'll match you as soon as one accepts."}
            </p>
            <button
              onClick={() => navigate('/')}
              className="px-5 py-2.5 bg-[#15803D] text-white font-bold rounded-xl text-sm hover:bg-[#166534] transition-all cursor-pointer"
            >
              Back to Tutorlage
            </button>
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
