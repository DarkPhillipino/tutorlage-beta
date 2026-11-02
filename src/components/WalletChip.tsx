import React, { useEffect, useState } from 'react';
import { Wallet } from 'lucide-react';
import { useAuth } from '../lib/AuthContext';
import { fetchBalance, rand0 } from '../lib/wallet';
import { useWalletVisible, walletDb } from '../lib/walletHooks';
import { useAccountStatus } from './AccountGate';

interface WalletChipProps {
  onOpen?: () => void;
}

// "Wallet R350" beside the bell (CEO, 2 Nov 2026). Shown only while the wallet is open, or while something of the person's is already in
// flight (money in it, a top-up or a payout waiting); with the switch off and nothing in flight it draws nothing and asks nothing more.
// A learner under 18 has no wallet (the parent's pays), so nothing shows for them either.
export const WalletChip: React.FC<WalletChipProps> = ({ onOpen }) => {
  const { user } = useAuth();
  const { isViewOnlyLearner } = useAccountStatus();
  const { visible } = useWalletVisible(user?.id, isViewOnlyLearner);
  const [available, setAvailable] = useState<number | null>(null);

  // The balance, read when the chip appears, every minute while the tab is open, and when the person comes back to it.
  useEffect(() => {
    if (!visible || !user) {
      setAvailable(null);
      return;
    }
    let cancelled = false;
    const load = () => {
      fetchBalance(walletDb, user.id)
        .then((b) => {
          if (!cancelled) setAvailable(b.available);
        })
        .catch((err) => console.error('wallet chip balance failed:', err));
    };
    load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') load();
    }, 60_000);
    const onBack = () => {
      if (document.visibilityState === 'visible') load();
    };
    window.addEventListener('focus', onBack);
    document.addEventListener('visibilitychange', onBack);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener('focus', onBack);
      document.removeEventListener('visibilitychange', onBack);
    };
  }, [visible, user]);

  if (!visible || !onOpen) return null;
  return (
    <button
      type="button"
      onClick={onOpen}
      data-wallet-chip
      aria-label={available === null ? 'Wallet' : `Wallet, ${rand0(available)} available`}
      className="px-3 py-1.5 rounded-full text-sm font-semibold text-[#0F172A] hover:bg-slate-100 flex items-center space-x-1.5 transition-colors shrink-0 cursor-pointer"
    >
      <Wallet className="w-4 h-4 text-[#15803D]" />
      <span>{available === null ? 'Wallet' : rand0(available)}</span>
    </button>
  );
};
