import { useEffect, useState } from 'react';
import { supabase } from './supabaseClient';
import { checkPromoCode, fetchPromoQuote, type PromoCheck, type PromoClient, type PromoQuote } from './promoCode';

// The promo-code questions (promoCode.ts) bound to the app's own database client, as hooks for the screens.
export const promoDb = supabase as unknown as PromoClient;

// What the signed-in person would pay for `listRand`, asked only while `enabled` (the wallet is the payment method). null until the answer arrives, and
// whenever no discount applies or the question cannot be asked.
export function usePromoQuote(enabled: boolean, listRand: number): PromoQuote | null {
  const [quote, setQuote] = useState<PromoQuote | null>(null);
  useEffect(() => {
    if (!enabled || !(listRand >= 1)) {
      setQuote(null);
      return;
    }
    let cancelled = false;
    fetchPromoQuote(promoDb, listRand).then((q) => {
      if (!cancelled) setQuote(q);
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, listRand]);
  return quote;
}

// The sign-up box: asks about the typed code a moment after typing stops. 'empty' until something is typed.
export function usePromoCodeCheck(typed: string): PromoCheck {
  const [check, setCheck] = useState<PromoCheck>({ state: 'empty' });
  useEffect(() => {
    if (typed.trim() === '') {
      setCheck({ state: 'empty' });
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      checkPromoCode(promoDb, typed).then((c) => {
        if (!cancelled) setCheck(c);
      });
    }, 500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [typed]);
  return check;
}
