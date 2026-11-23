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

// A bare-bones stand-in for supabase.rpc for the one public question above (no sign-in needed, so the public key is enough).
function plainRpc(): { rpc(fn: string): PromiseLike<{ data: unknown; error: unknown }> } {
  const url = String(import.meta.env.VITE_SUPABASE_URL ?? '').replace(/\/+$/, '');
  const key = String(import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '');
  return {
    rpc: async (fn: string) => {
      if (!url || !key) return { data: null, error: new Error('not configured') };
      const response = await fetch(`${url}/rest/v1/rpc/${fn}`, {
        method: 'POST',
        headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: '{}',
      });
      if (!response.ok) return { data: null, error: new Error(`status ${response.status}`) };
      return { data: await response.json(), error: null };
    },
  };
}

export function loadFoundingGateOn(): Promise<boolean> {
  if (answer && Date.now() - answer.at < ANSWER_LIFETIME_MS) return answer.promise;
  // START-PAGE CODE SPLIT (24 Nov 2026): this one question is open to everybody, so it is asked with a plain request to the database's own web address (the same call the database library
  // would make: POST /rest/v1/rpc/founding_gate_public with the public key), and the start page no longer downloads the database library just to read one switch. Any doubt is false.
  const promise = fetchFoundingGatePublic(plainRpc()).catch(() => false);
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
