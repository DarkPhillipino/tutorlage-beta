import React, { useEffect, useState } from 'react';
import { Loader2, Banknote, AlertTriangle, Landmark, CheckCircle2 } from 'lucide-react';
import { fetchPayoutBatches, fetchPaymentsNeedingAttention, fetchTutorPayoutAccounts } from '../lib/queries';
import { PayoutBatch, PaymentAttentionItem, TutorPayoutAccountRow } from '../types';

const VALIDATION_LABEL: Record<string, string> = {
  validated: 'Confirmed by the bank',
  bank_not_supported: "Bank can't be checked",
  recorded_test_mode: 'Test mode (not checked)',
};

// Backlog 7a: tutors are paid by Paystack splitting each charge, so their share
// settles to them automatically — there are no payout runs to do. What needs a
// person is the exceptions (refunds Paystack couldn't finish, acceptances that
// couldn't be settled, R1 card checks that weren't refunded), plus a view of
// where each tutor is paid.
export const Payouts: React.FC = () => {
  const [attention, setAttention] = useState<PaymentAttentionItem[]>([]);
  const [accounts, setAccounts] = useState<TutorPayoutAccountRow[]>([]);
  const [batches, setBatches] = useState<PayoutBatch[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([fetchPaymentsNeedingAttention(), fetchTutorPayoutAccounts(), fetchPayoutBatches()])
      .then(([a, t, b]) => {
        setAttention(a);
        setAccounts(t);
        setBatches(b);
      })
      .catch((e) => {
        console.error('Payments page load failed:', e);
        setLoadError('Could not load payments — check your connection and admin access.');
      })
      .finally(() => setIsLoading(false));
  }, []);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-slate-400">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        <span className="text-sm font-semibold">Loading payments…</span>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-extrabold text-[#0F172A] mb-1">Payments</h1>
        <p className="text-sm text-slate-500">
          Tutors are paid by Paystack directly: each charge is split when a tutor accepts, and the tutor's share settles to
          their own bank account. This page shows what needs a person.
        </p>
        {loadError && <p className="text-sm font-semibold text-rose-600 mt-2">{loadError}</p>}
      </div>

      <section>
        <h2 className="text-sm font-extrabold text-[#0F172A] mb-3 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-500" /> Needs a person ({attention.length})
        </h2>
        {attention.length === 0 ? (
          <div className="bg-white rounded-2xl p-6 border border-slate-200 text-sm text-slate-500 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-[#15803D]" /> Nothing waiting.
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-100 overflow-hidden">
            {attention.map((item) => (
              <div key={item.requestId} className="p-4 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-bold text-[#0F172A]">{item.problem}</div>
                  <div className="text-sm font-extrabold text-[#0F172A]">
                    {item.currencyCode === 'ZAR' ? 'R' : `${item.currencyCode} `}
                    {item.amount.toFixed(2)}
                  </div>
                </div>
                {item.detail && <div className="text-xs text-slate-600">{item.detail}</div>}
                <div className="text-[11px] text-slate-400">
                  Paystack reference {item.reference ?? '—'} · request {item.requestId} · {new Date(item.createdAt).toLocaleString()}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="text-sm font-extrabold text-[#0F172A] mb-3 flex items-center gap-2">
          <Landmark className="w-4 h-4 text-[#15803D]" /> Where tutors are paid ({accounts.length})
        </h2>
        {accounts.length === 0 ? (
          <div className="bg-white rounded-2xl p-6 border border-slate-200 text-sm text-slate-500">
            No tutor has added bank details yet. A tutor can't accept a paid request until they have.
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-100 overflow-hidden">
            {accounts.map((a) => (
              <div key={a.tutorId} className="p-4 flex items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-bold text-[#0F172A]">{a.tutorName}</div>
                  <div className="text-xs text-slate-500">
                    {a.bankName} ••{a.last4 ?? '????'} · {a.validationStatus ? VALIDATION_LABEL[a.validationStatus] ?? a.validationStatus : 'Not checked'}
                  </div>
                </div>
                <div className="text-[11px] text-slate-400 text-right">
                  {a.subaccountCode ?? 'No Paystack subaccount'}
                  <br />
                  updated {new Date(a.updatedAt).toLocaleDateString()}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {batches.length > 0 && (
        <section>
          <h2 className="text-sm font-extrabold text-[#0F172A] mb-3 flex items-center gap-2">
            <Banknote className="w-4 h-4 text-slate-400" /> Earlier manual payout batches
          </h2>
          <div className="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-100 overflow-hidden">
            {batches.map((b) => (
              <div key={b.id} className="p-4 flex items-center justify-between">
                <div>
                  <div className="text-sm font-bold text-[#0F172A]">{b.batchReference}</div>
                  <div className="text-xs text-slate-500 mt-0.5">{b.totalTutorsPaid} tutors · {new Date(b.createdAt).toLocaleDateString()}</div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-extrabold text-[#0F172A]">R{b.totalAmountPaid.toFixed(2)}</div>
                  <div className="text-[10px] text-slate-400">Commission: R{b.platformCommissionRetained.toFixed(2)}</div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
};
