import 'dotenv/config';
import express from 'express';

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
const PORT = Number(process.env.PORT) || 8787;

if (!PAYSTACK_SECRET_KEY) {
  throw new Error('PAYSTACK_SECRET_KEY is not set — check .env');
}

const app = express();
app.use(express.json());

interface InitializeBody {
  email: string;
  amountRands: number;
  reference: string;
  callbackUrl: string;
  currency?: string;
  metadata?: Record<string, unknown>;
}

// Starts a real Paystack transaction and hands back the hosted checkout URL
// to redirect the browser to. Amount arrives in the major currency unit
// (e.g. Rands) from the client and gets converted to the smallest unit
// (cents) here — Paystack always expects that, never the major unit.
// currency defaults to 'ZAR' — every real record is ZAR today (the pilot is
// South Africa-only) — but isn't hardcoded: a caller with a different
// currency_code (see PricesPage.tsx) can pass it through, note Paystack's
// own account may not actually support settling in every currency.
app.post('/api/payments/initialize', async (req, res) => {
  const { email, amountRands, reference, callbackUrl, currency, metadata } = req.body as Partial<InitializeBody>;

  if (!email || !amountRands || amountRands <= 0 || !reference || !callbackUrl) {
    res.status(400).json({ error: 'email, amountRands, reference, and callbackUrl are all required' });
    return;
  }

  try {
    const response = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email,
        amount: Math.round(amountRands * 100),
        currency: currency ?? 'ZAR',
        reference,
        callback_url: callbackUrl,
        metadata,
      }),
    });

    const data = await response.json();
    if (!response.ok || !data.status) {
      res.status(502).json({ error: data.message ?? 'Paystack initialize failed' });
      return;
    }

    res.json({
      authorizationUrl: data.data.authorization_url,
      accessCode: data.data.access_code,
      reference: data.data.reference,
    });
  } catch (err) {
    console.error('Paystack initialize error:', err);
    res.status(502).json({ error: 'Could not reach Paystack' });
  }
});

// Confirms what actually happened to a transaction — never trust the
// redirect back from Paystack alone (a client could forge that URL); always
// re-check the real status against Paystack's own API using the secret key.
app.get('/api/payments/verify/:reference', async (req, res) => {
  const { reference } = req.params;

  try {
    const response = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
      headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` },
    });

    const data = await response.json();
    if (!response.ok || !data.status) {
      res.status(502).json({ error: data.message ?? 'Paystack verify failed' });
      return;
    }

    res.json({
      status: data.data.status as string, // 'success' | 'failed' | 'abandoned' | ...
      amountRands: data.data.amount / 100,
      currency: data.data.currency,
      reference: data.data.reference,
    });
  } catch (err) {
    console.error('Paystack verify error:', err);
    res.status(502).json({ error: 'Could not reach Paystack' });
  }
});

app.listen(PORT, () => {
  console.log(`Payments API listening on http://localhost:${PORT}`);
});
