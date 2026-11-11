// The family page's counter for a ?code= link (the PM's ruling, 11 Nov 2026: the Codes page counts opens with THE SAME counter as the founding tutors page, not a second one).
// Called once from src/main.tsx when the address carries ?code=XYZ. It sends one 'code_open' event (the code, lower case, in src) against the same anonymous random visitor id,
// unless this browser was switched off (?nocount=1 on /teach) or looks like a robot. Fire and forget; any failure is ignored. Everything but the address check is loaded on
// demand, so the first download of the start page does not grow. Nothing here is personal: a random id, the code, the time.
import { promoCodeFromSearch } from './promoCode';
import type { FoundingClient } from './foundingList';

let sent = false;

export function countCodeOpenFromUrl(): void {
  if (sent || typeof window === 'undefined') return;
  const code = promoCodeFromSearch(window.location.search);
  if (!code) return;
  sent = true;
  void Promise.all([import('./supabaseClient'), import('./foundingList')])
    .then(([{ supabase }, f]) => {
      let store: Storage | null = null;
      try {
        store = window.localStorage;
      } catch {
        store = null;
      }
      if (f.countingSwitchedOff(window.location.search, store) || f.looksLikeBot(navigator)) return undefined;
      return f.logCodeOpen(supabase as unknown as FoundingClient, f.getVisitorId(store), code.toLowerCase());
    })
    .catch(() => undefined);
}
