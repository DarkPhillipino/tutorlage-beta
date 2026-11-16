import React, { useState } from 'react';
import { rand0 } from '../lib/wallet';
import type { BalanceState } from '../lib/walletHooks';
import { ONLINE_COPY, onlineTestNote } from '../lib/walletOnline';
import { WalletPayBox } from './WalletPayBox';

interface BankMainCheckoutProps {
  // What the request costs in whole rands (after a promo code, as the wallet box says).
  price: number;
  promoLine: string | null;
  state: BalanceState;
  walletEnough: boolean;
  isSending: boolean;
  // From the Worker, never typed here: true only when the payment system is the provider's TEST system, and the provider's plain name for the note.
  test: boolean;
  provider: string;
  onAddMoney: () => void;
  onRetry: () => void;
  onPayFromWallet: () => void;
  // The card way (its test note, the "not open" notice and its button), folded under "Pay with a card instead". Built by the booking page.
  cardSection: React.ReactNode;
  // The booking page's "you changed the subject" line, which belongs above whichever way is shown.
  children?: React.ReactNode;
}

// The booking page's payment part when the BANK is the main way to pay (Option A, CEO 12 Nov 2026; the rule is decideMainWay in src/lib/walletOnline.ts).
// The wallet box is open: enough money -> "Pay R... from your wallet"; not enough -> what is missing and "Add money by bank" (Add money then goes straight to
// the bank). The card stays, folded under "Pay with a card instead". The "Test mode" note shows only when the Worker said `test`.
export const BankMainCheckout: React.FC<BankMainCheckoutProps> = ({
  price, promoLine, state, walletEnough, isSending, test, provider, onAddMoney, onRetry, onPayFromWallet, cardSection, children,
}) => {
  const [showCard, setShowCard] = useState(false);
  return (
    <div data-bank-main className="w-full flex flex-col items-center">
      {test && (
        <p data-test-mode-bank role="note" className="text-[11px] font-bold text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-4 max-w-sm">
          {onlineTestNote(provider)}
        </p>
      )}
      {children}
      <WalletPayBox price={price} promoLine={promoLine} state={state} onAddMoney={onAddMoney} onRetry={onRetry} addLabel={ONLINE_COPY.addByBank} />
      {walletEnough && (
        <button
          type="button"
          onClick={onPayFromWallet}
          disabled={isSending}
          className="px-6 py-3 bg-[#15803D] hover:bg-[#166534] disabled:opacity-60 text-white text-sm font-bold rounded-xl transition-all shadow-xs cursor-pointer"
        >
          {isSending ? 'Sending your request…' : `Pay ${rand0(price)} from your wallet`}
        </button>
      )}
      <div className="mt-4 max-w-sm w-full flex flex-col items-center">
        <button
          type="button"
          data-card-toggle
          aria-expanded={showCard}
          onClick={() => setShowCard((v) => !v)}
          className="text-xs font-bold text-slate-600 hover:text-[#0F172A] cursor-pointer inline-flex items-center gap-1"
        >
          {ONLINE_COPY.cardInstead}
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" className={showCard ? 'rotate-180 transition-transform' : 'transition-transform'}>
            <path d="M2 4l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        {showCard && <div className="mt-3 flex flex-col items-center">{cardSection}</div>}
      </div>
    </div>
  );
};
