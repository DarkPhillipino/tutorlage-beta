// The card allowlist, booking-page side (16 Nov 2026, CEO rule: the Paystack TEST card is for the review accounts and the CEO's own sign-in only).
// The database answers for THIS signed-in person (card_checkout_available: setting card_checkout_mode off | staff | on, the staff list, the live review accounts).
// Every doubt (an error, an old database without the function, an odd answer) is "no": a normal person must never see the card because something failed.
// This only decides what the page SHOWS; the Worker refuses a card payment for anyone not allowed (server/cardCheckout.ts), so the screen is not the lock.
import type { WalletClient } from './wallet';

export type CardAnswer = 'loading' | 'yes' | 'no';

export async function fetchCardAllowed(db: WalletClient): Promise<boolean> {
  try {
    const { data, error } = await db.rpc('card_checkout_available');
    return !error && data === true;
  } catch {
    return false;
  }
}

// The words for a person who may not pay by card. No payment provider is named, and nothing says "test".
export const CARD_CLOSED_COPY = {
  loading: 'Loading your payment options…',
  // When the wallet is not open for this request either (another currency, or the wallet switched off): nothing can be paid yet.
  nothingOpen: 'Payments are not open yet. Booking opens soon.',
  walletHeading: 'Pay from your credit',
  walletHow: 'Add lesson credit by bank transfer. Once your top-up is confirmed, you can send your request from the credit.',
} as const;
