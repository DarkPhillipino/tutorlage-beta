// Pretend Ozow PAYMENTS API for the tests of server/ozowPayments.ts (scripts/dev/ozow-payments-test.ts and wallet-online-payments-worker-test.ts). No network, no real key: every "secret"
// is built from plain pieces at run time (never one literal that looks like a key).
// It is deliberately INDEPENDENT of server/ozowPayments.ts: Ozow's two hash algorithms are written out again here straight from the page (hub.ozow.com, "Hosted Checkout" on the Payments API:
// "Field concatenation order" and "Notification hash field order"), so a mistake in the server file cannot hide behind the same mistake here. It checks what Ozow checks (the ApiKey header,
// the hash, a reference not used in the last 24 hours, a limit on the amount, the two decimals, the length limits) and answers the way Ozow's pages say, including the odd part: a rejected
// request is ALSO an HTTP 200, with the reason in errorMessage and no url.
import crypto from 'node:crypto';
import { FAKE, FakeClock, join } from './fake-ozow';

export const FAKE_PAYMENTS = {
  apiKey: join('FAKE', '-api', '-key-', '0007'),
  privateKey: join('FAKE', '-private', '-key-', 'do-not-use', '-0008'),
  siteCode: FAKE.siteCode,
};
export const paymentsSecretsToHide = () => [FAKE_PAYMENTS.apiKey, FAKE_PAYMENTS.privateKey, FAKE.jobSecret];

// Ozow's "Field concatenation order" (the Hosted Checkout page), written again.
const ORDER = ['siteCode', 'countryCode', 'currencyCode', 'amount', 'transactionReference', 'bankReference', 'optional1', 'optional2', 'optional3', 'optional4', 'optional5', 'customer', 'cancelUrl', 'errorUrl', 'successUrl', 'notifyUrl', 'isTest', 'selectedBankId', 'bankAccountNumber', 'branchCode', 'bankAccountName', 'payeeDisplayName', 'expiryDateUtc', 'allowVariableAmount', 'variableAmountMin', 'variableAmountMax', 'customerIdentifier', 'customerCellphoneNumber'];
// Ozow's "Notification hash field order", written again.
const NOTIFY_ORDER = ['SiteCode', 'TransactionId', 'TransactionReference', 'Amount', 'Status', 'Optional1', 'Optional2', 'Optional3', 'Optional4', 'Optional5', 'CurrencyCode', 'IsTest', 'StatusMessage'];

export function ozowRequestHash(body: Record<string, unknown>, key: string): string {
  const s = ORDER.map((f) => body[f]).filter((v) => v !== undefined && v !== null && v !== '').map((v) => (typeof v === 'boolean' ? String(v) : String(v))).join('');
  return crypto.createHash('sha512').update((s + key).toLowerCase()).digest('hex');
}
export function ozowNotificationHash(fields: Record<string, string>, key: string): string {
  // Ozow hashes the Amount "with two decimal places".
  const amount = /^\d+(\.\d{1,2})?$/.test(fields.Amount ?? '') ? Number(fields.Amount).toFixed(2) : (fields.Amount ?? '');
  const s = NOTIFY_ORDER.map((f) => (f === 'Amount' ? amount : fields[f] ?? '')).filter((v) => v !== '').join('');
  return crypto.createHash('sha512').update((s + key).toLowerCase()).digest('hex');
}

export interface PaymentsCall {
  method: string;
  path: string;
  query: Record<string, string>;
  headers: Record<string, string>;
  body: string;
}
export interface PaymentsTxn {
  transactionId: string;
  transactionReference: string;
  siteCode: string;
  status: string;
  amount: number;
  currencyCode: string;
  subStatus?: string;
  statusMessage?: string;
  isTest: boolean;
}
interface Request {
  paymentRequestId: string;
  body: Record<string, any>;
  at: number;
}

export type CreateMode = 'ok' | 'hash' | 'cap' | 'duplicate' | '500' | 'garbled' | 'nolink' | 'badlink' | '401' | '403' | 'timeout' | 'network' | 'weird_error' | 'nobody';
export type CheckMode = 'ok' | '500' | 'garbled' | '401' | 'timeout' | 'notlist';

export class FakeOzowPayments {
  calls: PaymentsCall[] = [];
  requests = new Map<string, Request>(); // by transactionReference
  txns: PaymentsTxn[] = [];
  mode: { create: CreateMode; check: CheckMode } = { create: 'ok', check: 'ok' };
  maxAmount = Infinity; // the site's limit, like the R0.01 cap on a new account
  constructor(private clock: FakeClock, public privateKey = FAKE_PAYMENTS.privateKey, public apiKey = FAKE_PAYMENTS.apiKey) {}
  count = (method: string, pathStart: string) => this.calls.filter((c) => c.method === method && c.path.startsWith(pathStart)).length;
  requestFor = (reference: string) => this.requests.get(reference);

  // The notification Ozow would POST to notifyUrl, as the form-encoded text, signed with the key. `over` changes single fields (the Hash is then computed over the changed fields unless given).
  notification(reference: string, over: Record<string, string> = {}, o: { key?: string; skipHash?: boolean } = {}): string {
    const req = this.requests.get(reference);
    const fields: Record<string, string> = {
      SiteCode: FAKE_PAYMENTS.siteCode,
      TransactionId: crypto.randomUUID(),
      TransactionReference: reference,
      Amount: req ? String(req.body.amount) : '0.00',
      Status: 'Complete',
      Optional1: '', Optional2: '', Optional3: '', Optional4: '', Optional5: '',
      CurrencyCode: 'ZAR',
      IsTest: req?.body.isTest ? 'True' : 'False',
      StatusMessage: '',
      SubStatus: 'Unclassified',
      ...over,
    };
    const hash = over.Hash ?? ozowNotificationHash(fields, o.key ?? this.privateKey);
    const send: Record<string, string> = { ...fields };
    if (!o.skipHash) send.Hash = hash;
    // Ozow's own example shows the fields in this order, with the Hash near the end and SubStatus after it (not the hash order).
    const text = (names: string[]) => names.filter((n) => n in send).map((n) => `${n}=${encodeURIComponent(send[n])}`).join('&');
    return text(['SiteCode', 'TransactionId', 'TransactionReference', 'Amount', 'Status', 'CurrencyCode', 'IsTest', 'StatusMessage', 'Hash', 'SubStatus']);
  }

  // The payer finished (or not): Ozow now holds a transaction for the request, which GetTransactionByReference lists.
  addTransaction(reference: string, t: Partial<PaymentsTxn> & { status: string }): PaymentsTxn {
    const req = this.requests.get(reference);
    const row: PaymentsTxn = {
      transactionId: crypto.randomUUID(),
      transactionReference: reference,
      siteCode: FAKE_PAYMENTS.siteCode,
      amount: req ? Number(req.body.amount) : 0,
      currencyCode: 'ZAR',
      isTest: Boolean(req?.body.isTest),
      ...t,
    };
    this.txns.push(row);
    return row;
  }

  fetch = async (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }): Promise<{ status: number; text(): Promise<string> }> => {
    const u = new URL(url);
    const call: PaymentsCall = { method: init.method, path: u.pathname, query: Object.fromEntries(u.searchParams.entries()), headers: init.headers, body: init.body ?? '' };
    this.calls.push(call);
    const reply = (status: number, body: unknown) => ({ status, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });
    const hangOrDrop = (mode: string) =>
      new Promise<never>((_, reject) => {
        if (mode === 'network') reject(new Error('connection reset'));
        else init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
    // authorisation first (Ozow's "Authorisation" errors carry a status code)
    if (init.headers.ApiKey !== this.apiKey) return reply(401, 'API key is missing or invalid.');

    if (u.pathname === '/postpaymentrequest' && init.method === 'POST') {
      const m = this.mode.create;
      if (m === 'timeout' || m === 'network') return hangOrDrop(m);
      if (m === '401') return reply(401, 'API key is missing or invalid.');
      if (m === '403') return reply(403, `Unable to authorize site code ${FAKE_PAYMENTS.siteCode}.`);
      if (m === '500') return reply(500, 'Something went wrong.');
      if (m === 'garbled') return reply(200, '<html>not json</html>');
      if (m === 'nobody') return reply(200, '');
      let b: Record<string, any>;
      try {
        b = JSON.parse(call.body);
      } catch {
        return reply(400, 'bad json');
      }
      const rejected = (errorMessage: string) => reply(200, { paymentRequestId: null, url: null, errorMessage });
      if (m === 'weird_error') return rejected('Something unexpected happened with token profile 12345');
      if (b.siteCode !== FAKE_PAYMENTS.siteCode) return reply(403, `Unable to authorize site code ${String(b.siteCode).slice(0, 20)}.`);
      if (!b.transactionReference) return rejected('Transaction reference missing');
      const earlier = this.requests.get(b.transactionReference);
      if (m === 'duplicate' || (earlier && this.clock.now() - earlier.at < 24 * 3600_000)) return rejected('Duplicate transaction reference not allowed.');
      if (!b.bankReference) return rejected('Bank reference missing');
      if (b.bankReference.length > 20 || !/^[A-Za-z0-9 -]+$/.test(b.bankReference)) return rejected('Bank reference is invalid');
      if (!/^\d+\.\d{2}$/.test(String(b.amount))) return rejected('Transaction amount is invalid');
      if (Number(b.amount) < 0.01) return rejected('Transaction amount cannot be less than 0.01');
      if (m === 'cap' || Number(b.amount) > this.maxAmount) return rejected(`Merchant has a maximum transaction amount of ${this.maxAmount}`);
      if (b.countryCode !== 'ZA') return rejected('Invalid country code');
      if (b.currencyCode !== 'ZAR') return rejected('Unsupported currency code');
      for (const f of ['cancelUrl', 'errorUrl', 'successUrl', 'notifyUrl']) if (typeof b[f] === 'string' && b[f].length > 150) return rejected(`${f} is too long`);
      if (typeof b.isTest !== 'boolean') return rejected('isTest must be true or false');
      if (m === 'hash' || b.hashCheck !== ozowRequestHash(b, this.privateKey)) return rejected('The HashCheck value has failed');
      const id = crypto.randomUUID();
      this.requests.set(b.transactionReference, { paymentRequestId: id, body: b, at: this.clock.now() });
      if (m === 'nolink') return reply(200, { paymentRequestId: id, url: null, errorMessage: null });
      if (m === 'badlink') return reply(200, { paymentRequestId: id, url: 'https://evil.example.com/pay', errorMessage: null });
      return reply(200, { paymentRequestId: id, url: `https://pay.ozow.com/${id}/Secure`, errorMessage: null });
    }

    if (u.pathname === '/GetTransactionByReference' && init.method === 'GET') {
      const m = this.mode.check;
      if (m === 'timeout') return hangOrDrop(m);
      if (m === '401') return reply(401, 'API key is missing or invalid.');
      if (m === '500') return reply(500, 'Something went wrong.');
      if (m === 'garbled') return reply(200, 'not json');
      if (m === 'notlist') return reply(200, { transactions: [] });
      const wantTest = u.searchParams.get('isTest') === 'true';
      if (u.searchParams.get('siteCode') !== FAKE_PAYMENTS.siteCode) return reply(403, 'Unable to authorize site code.');
      const ref = u.searchParams.get('transactionReference') ?? '';
      const rows = this.txns.filter((t) => t.transactionReference === ref && t.isTest === wantTest).slice(0, 10);
      return reply(
        200,
        rows.map((t) => ({
          transactionId: t.transactionId,
          merchantCode: 'MERCHANT-FAKE',
          siteCode: t.siteCode,
          transactionReference: t.transactionReference,
          currencyCode: t.currencyCode,
          amount: t.amount,
          status: t.status,
          statusMessage: t.statusMessage ?? '',
          createdDate: '2026-11-17T10:00:00',
          paymentDate: t.status === 'Complete' ? '2026-11-17T10:01:00' : '0001-01-01T00:00:00',
          subStatus: t.subStatus ?? 'Unclassified',
          bankName: 'Fake Bank',
          maskedAccountNumber: '',
          smartIndicators: '',
        })),
      );
    }
    return reply(404, 'not found');
  };
}
