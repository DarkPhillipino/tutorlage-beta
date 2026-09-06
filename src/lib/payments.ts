// Thin client for the local Express payments API (server/index.ts), which
// holds the Paystack secret key. The browser never talks to Paystack
// directly — every call here goes through our own /api/payments/* proxy
// (see vite.config.ts's server.proxy), so no key ever reaches the client.

export async function initializePayment(params: {
  email: string;
  amountRands: number;
  reference: string;
  currency?: string; // defaults to 'ZAR' server-side if omitted
  metadata?: Record<string, unknown>;
}): Promise<{ authorizationUrl: string }> {
  const response = await fetch('/api/payments/initialize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...params,
      callbackUrl: `${window.location.origin}/payment/callback`,
    }),
  });

  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? 'Could not start payment.');
  return { authorizationUrl: data.authorizationUrl };
}

export async function verifyPayment(reference: string): Promise<{ status: string; amountRands: number }> {
  const response = await fetch(`/api/payments/verify/${encodeURIComponent(reference)}`);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? 'Could not verify payment.');
  return { status: data.status, amountRands: data.amountRands };
}
