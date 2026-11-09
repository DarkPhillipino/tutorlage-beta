import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from './supabaseClient';
import { lookAtRequest, nextLookDelayMs, shouldKeepLooking, type WatchClient, type WatchView } from './requestWatch';

// The request watcher (requestWatch.ts) bound to the app's own database client. The real client's query builder is far richer than WatchClient describes,
// so it is passed through one cast here (the same way walletHooks.ts does it).
export const watchDb = supabase as unknown as WatchClient;

export interface RequestWatch {
  view: WatchView;
  // 30 minutes passed with the request still waiting: the page stopped looking by itself and offers "Check now".
  stopped: boolean;
  // Three looks in a row failed (a bad connection): the page says it will keep trying. It never turns into an error screen.
  lookFailed: boolean;
  busy: boolean;
  // Look once more, now (after a cancel, or when the person presses "Check now").
  refresh: () => Promise<void>;
}

// Looks at the payer's own request straight away, then every few seconds (slower after two minutes, once a minute while the tab is hidden), and stops when the
// answer can no longer change by itself, or after 30 minutes. Never writes anything. With no request id or nobody signed in it does nothing ('reading').
export function useRequestWatch(requestId: string | null, userId: string | null): RequestWatch {
  const [view, setView] = useState<WatchView>({ kind: 'reading' });
  const [stopped, setStopped] = useState(false);
  const [lookFailed, setLookFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const lookNow = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    setView({ kind: 'reading' });
    setStopped(false);
    setLookFailed(false);
    if (!requestId || !userId) {
      lookNow.current = async () => {};
      return;
    }
    let cancelled = false;
    let timer: number | undefined;
    let inFlight = false;
    let failures = 0;
    let lastLookAt = 0;
    let current: WatchView = { kind: 'reading' };
    const startedAt = Date.now();

    const schedule = () => {
      window.clearTimeout(timer);
      if (cancelled || !shouldKeepLooking(current)) return;
      const delay = nextLookDelayMs(Date.now() - startedAt, document.hidden);
      if (delay === null) {
        setStopped(true);
        return;
      }
      timer = window.setTimeout(() => void look(), delay);
    };

    const look = async (): Promise<void> => {
      if (inFlight || cancelled) return;
      inFlight = true;
      lastLookAt = Date.now();
      try {
        const next = await lookAtRequest(watchDb, userId, requestId);
        if (cancelled) return;
        failures = 0;
        setLookFailed(false);
        current = next;
        setView(next);
      } catch {
        if (cancelled) return;
        failures += 1;
        if (failures >= 3) setLookFailed(true);
        // The first look failed: today's page, unchanged, and keep trying quietly.
        if (current.kind === 'reading') {
          current = { kind: 'fallback', retry: true };
          setView(current);
        }
      } finally {
        inFlight = false;
      }
      schedule();
    };

    lookNow.current = async () => {
      window.clearTimeout(timer);
      await look();
    };

    // Back to this tab after a while away: look now rather than wait out the long gap.
    const onVisible = () => {
      if (document.hidden || cancelled || !shouldKeepLooking(current) || inFlight) return;
      if (Date.now() - lastLookAt < 3_000) return;
      window.clearTimeout(timer);
      void look();
    };
    document.addEventListener('visibilitychange', onVisible);

    void look();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [requestId, userId]);

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      await lookNow.current();
    } finally {
      setBusy(false);
    }
  }, []);

  return { view, stopped, lookFailed, busy, refresh };
}
