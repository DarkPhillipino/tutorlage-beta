// What a request's payment_status means, in words, and how the admin counts treat it. Two new values arrived with the wallet (2 Nov 2026):
// 'wallet_paid' (a tutor accepted; the held money became the session's) and 'wallet_refunded' (that session was cancelled and refunded to
// the wallet as credit). Both come AFTER a match, so both count as sent. 'free' (free sessions) is the same.

export const PAYMENT_STATUS_LABELS: Record<string, string> = {
  unpaid: 'Not paid',
  initiated: 'Checkout started',
  card_verified: 'Card checked, or price on hold in a wallet',
  charging: 'Charging the card',
  charge_failed: 'Card charge failed',
  paid: 'Paid by card',
  refund_pending: 'Card refund started',
  refund_queued: 'Card refund queued',
  refund_needs_attention: 'Card refund needs attention',
  refunded: 'Refunded to the card',
  refund_failed: 'Card refund failed',
  failed: 'Failed',
  free: 'Free session',
  wallet_paid: 'Paid from wallet',
  wallet_refunded: 'Refunded to wallet',
};
export const paymentStatusLabel = (status: string | null | undefined): string => (status ? PAYMENT_STATUS_LABELS[status] ?? status : '—');

// A request reaches tutors once its card check (or wallet hold, or free send) succeeded; before that it is only a started checkout.
const NOT_SENT = new Set(['unpaid', 'initiated', 'failed']);
export const requestWasSent = (status: string, paymentStatus: string): boolean => status === 'accepted' || !NOT_SENT.has(paymentStatus);

// Matched = a tutor accepted. A wallet session cancelled later has its request moved to 'cancelled' / 'wallet_refunded', and it was still a match.
export const requestWasMatched = (status: string, paymentStatus: string): boolean => status === 'accepted' || paymentStatus === 'wallet_refunded';

export interface HowPaidCounts { free: number; paidFromWallet: number; refundedToWallet: number }
export function countHowPaid(requests: { payment_status: string }[]): HowPaidCounts {
  const count = (value: string) => requests.filter((r) => r.payment_status === value).length;
  return { free: count('free'), paidFromWallet: count('wallet_paid'), refundedToWallet: count('wallet_refunded') };
}
