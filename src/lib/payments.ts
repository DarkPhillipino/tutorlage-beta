// Thin client for server/index.ts, which holds the Paystack secret key. The
// browser never talks to Paystack directly — every call here goes through our
// own /api proxy, so no key ever reaches the client.
//
// Backlog 7a: sending a request saves the payer's card with a R1 check
// (refunded straight away); the price is charged only when a tutor accepts,
// split so the tutor's share goes straight to them. An unmatched request is
// never charged.
import { apiUrl, authHeaders } from './api';

async function readJson(response: Response): Promise<any> {
  return response.json().catch(() => ({}));
}

// Starts the card check for the signed-in user's own new request. Neither the
// amount nor the payer's email is sent: the server takes both from the
// database and the access token.
export async function initializePayment(reference: string): Promise<{ authorizationUrl: string }> {
  const response = await fetch(apiUrl('/api/payments/initialize'), {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ reference, callbackUrl: `${window.location.origin}/payment/callback` }),
  });
  const data = await readJson(response);
  if (!response.ok) throw new Error(data.error ?? 'Could not start the card check.');
  return { authorizationUrl: data.authorizationUrl };
}

// What the server found after checking the card check with Paystack:
// 'card_verified' (the request is now visible to tutors), 'paid' (a request
// paid in full before 7a), 'failed' (with the reason when there is one), or
// 'pending' (Paystack hasn't settled it yet).
export type CardCheckStatus = 'card_verified' | 'paid' | 'failed' | 'pending';

export async function verifyPayment(reference: string): Promise<{ status: CardCheckStatus; reason?: string | null }> {
  const response = await fetch(apiUrl(`/api/payments/verify/${encodeURIComponent(reference)}`));
  const data = await readJson(response);
  if (!response.ok) throw new Error(data.error ?? 'Could not check the card.');
  return { status: data.status, reason: data.reason ?? null };
}

export interface Bank {
  code: string;
  name: string;
  supportsValidation: boolean;
}

export async function fetchBanks(): Promise<Bank[]> {
  const response = await fetch(apiUrl('/api/banks'));
  const data = await readJson(response);
  if (!response.ok) throw new Error(data.error ?? 'Could not load the list of banks.');
  return data.banks ?? [];
}

// The tutor's ID or passport number goes to the server only to be passed to
// Paystack's account check; it isn't stored anywhere.
export async function savePayoutAccount(input: {
  bankCode: string;
  accountNumber: string;
  accountHolderName: string;
  documentType: 'identityNumber' | 'passportNumber';
  documentNumber: string;
}): Promise<{ bankName: string; last4: string; validationStatus: string }> {
  const response = await fetch(apiUrl('/api/tutor/payout-account'), {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify(input),
  });
  const data = await readJson(response);
  if (!response.ok) throw new Error(data.error ?? 'Could not save your bank details.');
  return data;
}

export type AcceptResult = { status: 'booked'; sessionId: string } | { status: 'confirming'; message: string };

// A tutor accepts a request: the server charges the learner's saved card and
// books the session. Throws with the server's reason when the request is gone,
// doesn't fit this tutor, or the card couldn't be charged.
export async function acceptRequest(requestId: string): Promise<AcceptResult> {
  const response = await fetch(apiUrl(`/api/requests/${encodeURIComponent(requestId)}/accept`), {
    method: 'POST',
    headers: await authHeaders(),
  });
  const data = await readJson(response);
  if (response.status === 202) return { status: 'confirming', message: data.message };
  if (!response.ok) throw new Error(data.error ?? 'Could not accept that request.');
  return { status: 'booked', sessionId: data.sessionId };
}
