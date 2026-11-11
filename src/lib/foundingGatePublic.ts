import { useEffect, useState } from 'react';

// Is the founding tutors list's gate switched ON? (migration 20261110200000, founding_gate_public(), open to signed-out visitors too: the switch is not secret). The public start page and
// the sign-in page use it to send "Become a tutor" to the list page while the gate is on. Kept in its own small file so those pages do not download the page's words. One shared answer
// for 30 seconds; any doubt (no migration yet, an error, no answer) is false, so the links are exactly as they were.
const ANSWER_LIFETIME_MS = 30_000;
let answer: { at: number; promise: Promise<boolean> } | null = null;

export async function fetchFoundingGatePublic(db: { rpc(fn: string): PromiseLike<{ data: unknown; error: unknown }> }): Promise<boolean> {
  try {
    const { data, error } = await db.rpc('founding_gate_public');
    return !error && data === true;
  } catch {
    return false;
  }
}

export function loadFoundingGateOn(): Promise<boolean> {
  if (answer && Date.now() - answer.at < ANSWER_LIFETIME_MS) return answer.promise;
  // The database client is loaded on demand (this file stays tiny and can be tested without it).
  const promise = import('./supabaseClient')
    .then(({ supabase }) => fetchFoundingGatePublic(supabase as unknown as { rpc(fn: string): PromiseLike<{ data: unknown; error: unknown }> }))
    .catch(() => false);
  answer = { at: Date.now(), promise };
  return promise;
}

export function useFoundingGateOn(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let cancelled = false;
    loadFoundingGateOn().then((v) => {
      if (!cancelled) setOn(v);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return on;
}
