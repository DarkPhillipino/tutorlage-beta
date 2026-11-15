// Checks the address sent to Paystack (15 Nov 2026). Run: npx tsx scripts/dev/paystack-email-test.ts
import fs from 'node:fs';
import { PAYSTACK_FALLBACK_EMAIL, emailForPaystack, plainPaystackMessage } from '../../server/paystackEmail';

let failures = 0;
const check = (name: string, ok: boolean) => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`);
};
const dot = '.';
for (const ending of ['god', 'test', 'local', 'invalid', 'GOD', 'x', 'a1', 'abcdefghijklmnopqrstuvwxy']) {
  check(`ending "${ending}" gets the fallback`, emailForPaystack(`review.parent@tutorlage${dot}${ending}`) === PAYSTACK_FALLBACK_EMAIL);
}
for (const real of [`a@b${dot}com`, `parent@school${dot}co${dot}za`, ` Mixed.Case@Gmail${dot}COM `]) {
  check(`real address "${real.trim()}" goes through unchanged`, emailForPaystack(real) === real.trim());
}
check('empty or missing gets the fallback', emailForPaystack('') === PAYSTACK_FALLBACK_EMAIL && emailForPaystack(null) === PAYSTACK_FALLBACK_EMAIL);
check('the fallback itself is a real-looking address', emailForPaystack(PAYSTACK_FALLBACK_EMAIL) === PAYSTACK_FALLBACK_EMAIL);
check('an email error from Paystack becomes a plain sentence', !/must be a valid/.test(plainPaystackMessage('"email" must be a valid email')));
check('any other error is plain too', plainPaystackMessage(undefined).length > 10);
const server = fs.readFileSync(new URL('../../server/index.ts', import.meta.url), 'utf8');
check('both places that send an email to Paystack use the helper', /email: emailForPaystack\(user\.email\)/.test(server) && /email: emailForPaystack\(claim\.email\)/.test(server));
check('no raw account email goes to Paystack', !/^\s*email: (user|claim)\.email,/m.test(server));
console.log(failures ? `${failures} FAILED` : 'all ok');
process.exit(failures ? 1 : 0);
