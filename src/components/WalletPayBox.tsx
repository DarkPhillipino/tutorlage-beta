import React from 'react';
import { Loader2, AlertTriangle, Wallet } from 'lucide-react';
import { WALLET_COPY, rand0, shortfallSentence } from '../lib/wallet';
import type { BalanceState } from '../lib/walletHooks';

interface WalletPayBoxProps {
  // The price of this request in whole rands (what the database will put on hold).
  price: number;
  state: BalanceState;
  onAddMoney: () => void;
  onRetry: () => void;
}

// The wallet's part of the booking page (CEO, 2 Nov 2026): enough money -> what will happen to it (the button under it says "Pay R180 from
// your wallet"); not enough, or empty -> the balance, how much is missing and the "Add money" button. The request is not created while short.
export const WalletPayBox: React.FC<WalletPayBoxProps> = ({ price, state, onAddMoney, onRetry }) => {
  if (state.status === 'loading' || state.status === 'closed') {
    return (
      <div role="status" data-wallet-pay className="flex items-center justify-center mb-5 text-slate-400">
        <Loader2 className="w-4 h-4 animate-spin mr-2" />
        <span className="text-xs font-semibold">Checking your wallet…</span>
      </div>
    );
  }
  if (state.status === 'error') {
    return (
      <div role="alert" data-wallet-pay className="mb-5 max-w-sm text-center">
        <AlertTriangle className="w-6 h-6 text-rose-400 mx-auto mb-1" />
        <p className="text-xs font-bold text-[#0F172A]">Couldn't check your wallet</p>
        <p className="text-[11px] text-slate-500">Check your connection and try again.</p>
        <button type="button" onClick={onRetry} className="mt-2 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-[#0F172A] font-bold text-[11px] rounded-lg cursor-pointer">
          Try again
        </button>
      </div>
    );
  }
  const enough = state.available >= price;
  return (
    <div role="status" data-wallet-pay data-wallet-enough={enough ? 'yes' : 'no'} className="mb-5 max-w-sm space-y-2">
      <div className="inline-flex items-center gap-1.5 text-sm font-extrabold text-[#0F172A]">
        <Wallet className="w-4 h-4 text-[#15803D]" />
        Your wallet: {rand0(state.available)}
      </div>
      {state.held > 0 && <p className="text-[11px] text-slate-500">{rand0(state.held)} is on hold for your other requests.</p>}
      {enough ? (
        <>
          <p className="text-xs text-slate-600">
            This session is <span className="font-bold text-[#0F172A]">{rand0(price)}</span>. After this request you will have {rand0(state.available - price)} available.
          </p>
          <p className="text-[11px] text-slate-500">{WALLET_COPY.heldOnRequest}</p>
        </>
      ) : (
        <>
          <p className="text-xs font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">{shortfallSentence(price, state.available)}</p>
          <button
            type="button"
            onClick={onAddMoney}
            className="px-6 py-3 bg-[#0F172A] hover:bg-slate-800 text-white text-sm font-bold rounded-xl transition-all shadow-xs cursor-pointer"
          >
            Add money
          </button>
        </>
      )}
    </div>
  );
};
