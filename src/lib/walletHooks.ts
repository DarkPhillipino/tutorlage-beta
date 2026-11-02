import { useCallback, useEffect, useState } from 'react';
import { supabase } from './supabaseClient';
import {
  fetchBalance,
  fetchInFlight,
  fetchWalletOpen,
  fetchWalletRequestIds,
  fetchWalletSessionIds,
  sendRequestWallet,
  type Balance,
  type WalletClient,
} from './wallet';

// The wallet questions (wallet.ts) bound to the app's own database client, as hooks for the screens.
// The real client's query builder is far richer than WalletClient describes, so it is passed through one cast here.
export const walletDb = supabase as unknown as WalletClient;

// Sends the signed-in person's OWN new request from their wallet (the price goes on hold).
export const sendMyRequestWallet = (requestId: string) => sendRequestWallet(requestId, walletDb);

// Is the wallet open? false until the answer arrives, and whenever it cannot be asked (a database without the wallet migrations).
export function useWalletOpen(): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetchWalletOpen(walletDb).then((answer) => {
      if (!cancelled) setOpen(answer);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return open;
}

export type BalanceState = { status: 'closed' } | { status: 'loading' } | { status: 'error' } | ({ status: 'ready' } & Balance);

// The signed-in person's balance, read only while `enabled`. `reload` asks again (after adding money, or when "try again" is pressed).
export function useWalletBalance(userId: string | undefined, enabled: boolean): { state: BalanceState; reload: () => void } {
  const [state, setState] = useState<BalanceState>({ status: 'closed' });
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!enabled || !userId) {
      setState({ status: 'closed' });
      return;
    }
    let cancelled = false;
    setState((prev) => (prev.status === 'ready' ? prev : { status: 'loading' }));
    fetchBalance(walletDb, userId)
      .then((b) => {
        if (!cancelled) setState({ status: 'ready', ...b });
      })
      .catch((err) => {
        console.error('fetchBalance failed:', err);
        if (!cancelled) setState({ status: 'error' });
      });
    return () => {
      cancelled = true;
    };
  }, [userId, enabled, version]);
  const reload = useCallback(() => setVersion((v) => v + 1), []);
  return { state, reload };
}

// For lists: the ids (of requests or of sessions) that were paid from a wallet. Looks again when the list of ids changes.
export function useWalletIds(kind: 'request' | 'session', ids: string[]): Set<string> {
  const [found, setFound] = useState<Set<string>>(new Set());
  const key = ids.join(',');
  useEffect(() => {
    let cancelled = false;
    (kind === 'request' ? fetchWalletRequestIds(ids, walletDb) : fetchWalletSessionIds(ids, walletDb)).then((result) => {
      if (!cancelled) setFound(result);
    });
    return () => {
      cancelled = true;
    };
    // `key` stands for `ids`: a new array with the same ids must not ask again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, key]);
  return found;
}

// Should the person see a wallet at all? Yes when it is open, or when something of theirs is already in flight (money in it, a top-up or a
// payout waiting). While the wallet is closed and nothing is in flight the answer is false and nothing new is shown anywhere.
export function useWalletVisible(userId: string | undefined, hidden: boolean): { visible: boolean; open: boolean } {
  const open = useWalletOpen();
  const [inFlight, setInFlight] = useState(false);
  useEffect(() => {
    if (open || !userId || hidden) {
      setInFlight(false);
      return;
    }
    let cancelled = false;
    fetchInFlight(walletDb, userId).then((answer) => {
      if (!cancelled) setInFlight(answer);
    });
    return () => {
      cancelled = true;
    };
  }, [open, userId, hidden]);
  return { visible: !hidden && (open || inFlight), open };
}
