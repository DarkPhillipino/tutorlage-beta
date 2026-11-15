// The address sent to Paystack as the payer's email (15 Nov 2026). Paystack checks the domain ending properly, our own EMAIL_SHAPE
// does not, so an account such as review.parent@tutorlage.god passed our check and was refused by Paystack. If the ending is not
// 2 to 24 letters, or is one of the made-up endings, Paystack gets the fallback receipt address instead; the account email is never changed.
export const PAYSTACK_FALLBACK_EMAIL = 'receipts@tutorlage.com';
const MADE_UP_ENDINGS = new Set(['god', 'test', 'local', 'invalid']);

export function emailForPaystack(email: string | null | undefined): string {
  const address = String(email ?? '').trim();
  const ending = address.slice(address.lastIndexOf('.') + 1).toLowerCase();
  const plausible = /^[^\s@]+@[^\s@]+\.[a-z]{2,24}$/i.test(address) && !MADE_UP_ENDINGS.has(ending);
  return plausible ? address : PAYSTACK_FALLBACK_EMAIL;
}

// Paystack's own wording shown to a person only when it is about the email; otherwise a plain sentence for any failure.
export function plainPaystackMessage(message: unknown): string {
  return /email/i.test(String(message ?? ''))
    ? 'We could not use your email address for the card payment. Please try again, or contact us and we will sort it out.'
    : 'The card payment could not be started. Please try again in a moment.';
}
