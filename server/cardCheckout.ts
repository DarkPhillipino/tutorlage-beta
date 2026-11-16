// The card allowlist, Worker side (16 Nov 2026, CEO rule: the Paystack TEST card is for the review accounts and the CEO's own sign-in only).
// The booking page hides the card from everyone else, but a screen is not a lock: this is the lock. server/index.ts asks it BEFORE it starts a
// card payment (POST /api/payments/initialize) and BEFORE it charges a saved card (POST /api/requests/:id/accept). The answer comes from the
// database (card_checkout_allowed, service_role only), so the list and the mode (setting card_checkout_mode: off | staff | on) are edited in one
// place and the Worker holds no list of its own.
//
// Every doubt is a refusal: a database error, an old database without the function, a missing or odd answer all mean "not allowed". The two
// words below are the only ones that reach a person; nothing the database or Paystack said is passed on.

export interface CardCheckoutDb {
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message?: string; code?: string } | null }>;
}

export type CardCheckoutDecision =
  | { allowed: true }
  | { allowed: false; status: 403 | 503; code: 'card_not_open' | 'card_check_unavailable'; error: string };

export const CARD_NOT_OPEN_MESSAGE = 'Card payments are not open for your account. Pay from your Tutorlage wallet instead: add money by bank transfer, then send your request from the wallet.';
export const CARD_CHECK_UNAVAILABLE_MESSAGE = 'We could not check how you may pay just now. Please try again in a minute.';

export async function cardCheckoutDecision(db: CardCheckoutDb, profileId: string | null | undefined): Promise<CardCheckoutDecision> {
  if (!profileId) return { allowed: false, status: 403, code: 'card_not_open', error: CARD_NOT_OPEN_MESSAGE };
  let answer: Awaited<ReturnType<CardCheckoutDb['rpc']>>;
  try {
    answer = await db.rpc('card_checkout_allowed', { p_profile: profileId });
  } catch {
    return { allowed: false, status: 503, code: 'card_check_unavailable', error: CARD_CHECK_UNAVAILABLE_MESSAGE };
  }
  if (answer.error) return { allowed: false, status: 503, code: 'card_check_unavailable', error: CARD_CHECK_UNAVAILABLE_MESSAGE };
  // Only an exact boolean true opens the door; false, null, "true", 1 and anything else is a refusal.
  if (answer.data === true) return { allowed: true };
  return { allowed: false, status: 403, code: 'card_not_open', error: CARD_NOT_OPEN_MESSAGE };
}
