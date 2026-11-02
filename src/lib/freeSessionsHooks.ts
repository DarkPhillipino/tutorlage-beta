import { useEffect, useState } from 'react';
import { supabase } from './supabaseClient';
import { fetchFreeRequestIds, fetchFreeSessionIds, fetchFreeSessionsOpen, sendRequestFree } from './freeSessions';

// The free-sessions questions (freeSessions.ts) bound to the app's own database client, as hooks for the screens.

// Sends the signed-in learner's OWN new request without a card check.
export const sendMyRequestFree = (requestId: string) => sendRequestFree(requestId, supabase);

// For the booking page: is the switch on? (false until the answer arrives, and whenever it cannot be asked)
export function useFreeSessionsOpen(): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetchFreeSessionsOpen(supabase).then((answer) => {
      if (!cancelled) setOpen(answer);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return open;
}

// For lists: the ids (of requests or of sessions) that are free. Looks again when the list of ids changes.
export function useFreeIds(kind: 'request' | 'session', ids: string[]): Set<string> {
  const [free, setFree] = useState<Set<string>>(new Set());
  const key = ids.join(',');
  useEffect(() => {
    let cancelled = false;
    (kind === 'request' ? fetchFreeRequestIds(ids, supabase) : fetchFreeSessionIds(ids, supabase)).then((found) => {
      if (!cancelled) setFree(found);
    });
    return () => {
      cancelled = true;
    };
    // `key` stands for `ids`: a new array with the same ids must not ask again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, key]);
  return free;
}
