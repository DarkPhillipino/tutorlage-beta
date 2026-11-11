import { useEffect, useState } from 'react';
import { supabase } from './supabaseClient';
import { useAuth } from './AuthContext';
import { fetchMyFoundingGate, GATE_OPEN, type FoundingClient, type FoundingGate } from './foundingList';

// The founding tutors list's Teach gate, read for the signed-in person (migration 20261110200000, my_founding_gate()). One answer is shared by every screen
// that asks (the Teach button, the tutor sign-up pages, the documents page) for a short while, so opening the app makes one call, not three. Any doubt is "open"
// (src/lib/foundingList.ts), and the database enforces the gate on its own.
const client = supabase as unknown as FoundingClient;
const ANSWER_LIFETIME_MS = 30_000;
const answers = new Map<string, { at: number; promise: Promise<FoundingGate> }>();

export function loadFoundingGate(userId: string): Promise<FoundingGate> {
  const kept = answers.get(userId);
  if (kept && Date.now() - kept.at < ANSWER_LIFETIME_MS) return kept.promise;
  const promise = fetchMyFoundingGate(client);
  answers.set(userId, { at: Date.now(), promise });
  return promise;
}

export function useFoundingGate(): { gate: FoundingGate; loading: boolean } {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [state, setState] = useState<{ forUser: string | null; gate: FoundingGate }>({ forUser: null, gate: GATE_OPEN });

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    loadFoundingGate(userId).then((gate) => {
      if (!cancelled) setState({ forUser: userId, gate });
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  if (!userId) return { gate: GATE_OPEN, loading: false };
  return state.forUser === userId ? { gate: state.gate, loading: false } : { gate: GATE_OPEN, loading: true };
}
