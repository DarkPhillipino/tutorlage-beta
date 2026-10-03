import React, { useEffect, useState } from 'react';
import { Landmark, Loader2, AlertCircle, CheckCircle2, ShieldCheck } from 'lucide-react';
import { PayoutAccount } from '../types';
import { fetchMyPayoutAccount } from '../lib/queries';
import { Bank, fetchBanks, savePayoutAccount } from '../lib/payments';
import { getErrorMessage } from '../lib/errors';

interface PayoutAccountPanelProps {
  tutorId: string;
  // Called after the account is saved, e.g. so the request queue can stop
  // asking for it.
  onSaved?: (account: PayoutAccount) => void;
}

const STATUS_NOTE: Record<string, string> = {
  validated: 'Confirmed by your bank as yours.',
  bank_not_supported: "Your bank can't be checked automatically — make sure the details are exactly right.",
  recorded_test_mode: 'Saved in test mode (not checked with your bank).',
};

// Where a tutor's share of each session is paid (backlog 7a). When a tutor
// accepts a request, Paystack splits the learner's payment and settles the
// tutor's share straight into this account — Tutorlage never holds it.
export const PayoutAccountPanel: React.FC<PayoutAccountPanelProps> = ({ tutorId, onSaved }) => {
  const [account, setAccount] = useState<PayoutAccount | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [banks, setBanks] = useState<Bank[]>([]);
  const [bankCode, setBankCode] = useState('');
  const [holder, setHolder] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [documentType, setDocumentType] = useState<'identityNumber' | 'passportNumber'>('identityNumber');
  const [documentNumber, setDocumentNumber] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchMyPayoutAccount(tutorId)
      .then((a) => {
        setAccount(a);
        setIsEditing(!a);
      })
      .catch((err) => {
        console.error('fetchMyPayoutAccount failed:', err);
        setIsEditing(true);
      })
      .finally(() => setIsLoading(false));
  }, [tutorId]);

  useEffect(() => {
    if (!isEditing || banks.length > 0) return;
    fetchBanks()
      .then(setBanks)
      .catch((e) => setError(getErrorMessage(e, 'Could not load the list of banks.')));
  }, [isEditing, banks.length]);

  const handleSave = async () => {
    setError(null);
    setIsSaving(true);
    try {
      const saved = await savePayoutAccount({
        bankCode,
        accountNumber,
        accountHolderName: holder,
        documentType,
        documentNumber,
      });
      const next: PayoutAccount = {
        bankName: saved.bankName,
        accountHolderName: holder.trim(),
        last4: saved.last4,
        validationStatus: saved.validationStatus as PayoutAccount['validationStatus'],
        canReceivePayments: true,
      };
      setAccount(next);
      setIsEditing(false);
      setAccountNumber('');
      setDocumentNumber('');
      onSaved?.(next);
    } catch (e) {
      setError(getErrorMessage(e, 'Could not save your bank details.'));
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center text-slate-400 text-xs py-2">
        <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading your payout details…
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl p-4 border border-slate-200 space-y-3">
      <div className="flex items-center gap-1.5">
        <Landmark className="w-3.5 h-3.5 text-[#15803D]" />
        <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Where you get paid</span>
      </div>

      {account && !isEditing ? (
        <div className="space-y-1">
          <p className="text-sm font-bold text-[#0F172A]">
            {account.bankName} ••{account.last4}
          </p>
          {account.validationStatus && STATUS_NOTE[account.validationStatus] && (
            <p className="text-[11px] text-slate-500 flex items-center gap-1">
              {account.validationStatus === 'validated' && <CheckCircle2 className="w-3.5 h-3.5 text-[#15803D]" />}
              {STATUS_NOTE[account.validationStatus]}
            </p>
          )}
          <p className="text-[11px] text-slate-500">
            When you accept a request, Paystack pays your share into this account directly, usually within two working days.
          </p>
          <button onClick={() => setIsEditing(true)} className="text-[11px] font-bold text-[#15803D] hover:underline cursor-pointer">
            Change bank details
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-[11px] text-slate-600">
            Add the bank account your share of each session is paid into. You need this before you can accept a paid request.
          </p>
          <select
            value={bankCode}
            onChange={(e) => setBankCode(e.target.value)}
            aria-label="Bank"
            className="w-full bg-slate-100 rounded-lg px-2.5 py-2 text-xs font-semibold text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[#15803D]/20"
          >
            <option value="">{banks.length ? 'Choose your bank' : 'Loading banks…'}</option>
            {banks.map((b) => (
              <option key={b.code} value={b.code}>
                {b.name}
              </option>
            ))}
          </select>
          <input
            value={holder}
            onChange={(e) => setHolder(e.target.value)}
            placeholder="Account holder's name, as the bank has it"
            autoComplete="name"
            className="w-full bg-slate-100 rounded-lg px-2.5 py-2 text-xs font-semibold text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[#15803D]/20"
          />
          <input
            value={accountNumber}
            onChange={(e) => setAccountNumber(e.target.value.replace(/[^\d\s]/g, ''))}
            placeholder="Account number"
            inputMode="numeric"
            autoComplete="off"
            className="w-full bg-slate-100 rounded-lg px-2.5 py-2 text-xs font-semibold text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[#15803D]/20"
          />
          <div className="flex gap-3 text-[11px] font-semibold text-slate-600">
            <label className="flex items-center gap-1 cursor-pointer">
              <input
                type="radio"
                checked={documentType === 'identityNumber'}
                onChange={() => setDocumentType('identityNumber')}
              />
              South African ID
            </label>
            <label className="flex items-center gap-1 cursor-pointer">
              <input
                type="radio"
                checked={documentType === 'passportNumber'}
                onChange={() => setDocumentType('passportNumber')}
              />
              Passport
            </label>
          </div>
          <input
            value={documentNumber}
            onChange={(e) => setDocumentNumber(e.target.value)}
            placeholder={documentType === 'identityNumber' ? 'ID number' : 'Passport number'}
            autoComplete="off"
            className="w-full bg-slate-100 rounded-lg px-2.5 py-2 text-xs font-semibold text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[#15803D]/20"
          />
          <p className="text-[10px] text-slate-500 flex items-start gap-1">
            <ShieldCheck className="w-3.5 h-3.5 text-[#15803D] shrink-0" />
            Your ID number goes to Paystack, our payment provider, only so your bank can confirm the account is yours.
            Tutorlage doesn't keep it, or your full account number.
          </p>
          {error && (
            <div className="flex items-start gap-1.5 text-[11px] text-rose-600 font-semibold">
              <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}
          <div className="flex items-center gap-2">
            <button
              onClick={handleSave}
              disabled={isSaving || !bankCode || !holder.trim() || !accountNumber.trim() || !documentNumber.trim()}
              className="bg-[#0F172A] hover:bg-slate-800 disabled:opacity-50 text-white text-xs font-bold px-3 py-2 rounded-lg cursor-pointer"
            >
              {isSaving ? 'Checking with your bank…' : 'Save bank details'}
            </button>
            {account && (
              <button
                onClick={() => {
                  setIsEditing(false);
                  setError(null);
                }}
                disabled={isSaving}
                className="text-[11px] font-bold text-slate-600 px-2 py-1 cursor-pointer"
              >
                Cancel
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
