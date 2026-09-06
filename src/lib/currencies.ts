import { supabase } from './supabaseClient';

// A tiny in-memory symbol cache, populated once at app startup (see
// loadCurrencySymbols(), called from main.tsx) — avoids threading an async
// currency lookup through every rate-formatting call site for what's really
// just a symbol lookup keyed by a code every relevant row already stores
// (tutor_profiles.currency_code, tier_definitions.currency_code, etc).
// Seeded with ZAR synchronously so nothing renders wrong before the real
// fetch resolves — this app's pilot market is South Africa-only today, so
// that's a safe default, not a hardcoded assumption baked into the logic.
let currencySymbols: Record<string, string> = { ZAR: 'R' };

export async function loadCurrencySymbols(): Promise<void> {
  const { data, error } = await supabase.from('currencies').select('code, symbol');
  if (error) {
    console.error('loadCurrencySymbols failed:', error);
    return;
  }
  // currencies.code is a fixed-length bpchar column — Postgres space-pads
  // it to the column width, so it must be trimmed before use as a map key.
  currencySymbols = Object.fromEntries((data ?? []).map((c) => [c.code.trim(), c.symbol]));
}

// Falls back to the raw code (e.g. "XYZ") rather than throwing or showing
// nothing, if a currency_code somehow isn't in the loaded map.
export function getCurrencySymbol(currencyCode: string): string {
  return currencySymbols[currencyCode.trim()] ?? currencyCode;
}
