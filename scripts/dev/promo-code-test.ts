// Checks on the PROMO CODE SCREENS and helpers (CEO's decision of 5 Nov 2026: 10 percent off a parent's first 3 lessons, by code). Run: npx tsx scripts/dev/promo-code-test.ts
// Proves, with a fake database client and by reading the source: a code is recognised in any letters and trimmed; the link ?code=XYZ is taken from the
// address and remembered for 30 days (and survives a broken or blocked browser store); the sign-up box exists for parents and learners only, is pre-filled
// from the remembered code, tells a wrong code in one plain line without blocking the sign-up, and sends whatever was typed in the sign-up metadata
// (signup_code), so it survives the e-mail confirmation step; a Google sign-up claims the remembered code once; the booking screen shows
// "10% code applied: R252 (lesson 1 of 3)" before sending and asks for the discounted price; every question to the database is TOLERANT (an old database or an
// error means "no discount" and nothing about sign-up or booking changes); the word "free" is not used for lessons or sessions in any new text.
// It does NOT prove the database behaviour (supabase/tests/promo_codes_1_*.sql to promo_codes_3_*.sql (three chunks), rolled back) or the screens in a real browser (the preview does that).
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import {
  PROMO_CODE_PATTERN, PROMO_REMEMBER_DAYS, PROMO_STORAGE_KEY, PROMO_TYPED_MAX, checkPromoCode, claimRememberedPromoCode, fetchPromoQuote, forgetPromoCode,
  lessonsWord, normalisePromoCode, promoCheckMessage, promoCodeFromSearch, promoQuoteLine, promoSignupMetadata, recallPromoCode, rememberPromoCode,
  rememberPromoCodeFromUrl, type PromoClient, type PromoStore,
} from '../../src/lib/promoCode';
import { WalletPayBox } from '../../src/components/WalletPayBox';

const rootRequire = createRequire(new URL('../../package.json', import.meta.url));
const React = rootRequire('react') as typeof import('react');
const render = (rootRequire('react-dom/server') as typeof import('react-dom/server')).renderToStaticMarkup;

let failed = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) failed += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && detail ? ` [${detail}]` : ''}`);
}
const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

type Answer = { data: unknown; error: { code?: string; message?: string } | null };
function fake(answer: (fn: string, args?: Record<string, unknown>) => Answer): { db: PromoClient; calls: { fn: string; args?: Record<string, unknown> }[] } {
  const calls: { fn: string; args?: Record<string, unknown> }[] = [];
  return { calls, db: { rpc: async (fn, args) => { calls.push({ fn, args }); return answer(fn, args); } } };
}
function memoryStore(): PromoStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); }, removeItem: (k) => { data.delete(k); } };
}
const brokenStore: PromoStore = {
  getItem: () => { throw new Error('blocked'); },
  setItem: () => { throw new Error('blocked'); },
  removeItem: () => { throw new Error('blocked'); },
};
const DAY = 86_400_000;

async function main() {
  // ---- what a code is -------------------------------------------------------------------------------------------------------------------------------
  check('a code is recognised in any letters and trimmed', normalisePromoCode('  faculty2026 ') === 'FACULTY2026' && normalisePromoCode('Odi-1') === 'ODI-1');
  check('not a code: too short, too long, spaces inside, other symbols, empty, not text', ['ab', 'x'.repeat(33), 'two words', 'bad!code', '', '   ', null, undefined, 42].every((v) => normalisePromoCode(v) === null));
  check('the shape is the database one: 3 to 32 letters, digits, - and _, starting with a letter or digit', PROMO_CODE_PATTERN.source === '^[A-Z0-9][A-Z0-9_-]{2,31}$');
  check('a link ?code=XYZ is read from the address, in any letters', promoCodeFromSearch('?code=odi2026') === 'ODI2026' && promoCodeFromSearch('?utm=a&code=ABC123&x=1') === 'ABC123');
  check('no code, an empty one or a bad one in the address gives nothing', promoCodeFromSearch('') === null && promoCodeFromSearch('?code=') === null && promoCodeFromSearch('?code=a b') === null && promoCodeFromSearch('?other=ABC') === null);

  // ---- remembering a code that arrived by link --------------------------------------------------------------------------------------------------------
  const store = memoryStore();
  check('the address is read once at the start: the code is remembered and returned', rememberPromoCodeFromUrl('?code=odi2026', 1000, store) === 'ODI2026' && recallPromoCode(1000, store) === 'ODI2026');
  check('an address without a code remembers nothing and does not wipe an earlier one', rememberPromoCodeFromUrl('?page=2', 2000, store) === null && recallPromoCode(2000, store) === 'ODI2026');
  check('it is remembered for 30 days and then forgotten', PROMO_REMEMBER_DAYS === 30 && recallPromoCode(1000 + 29 * DAY, store) === 'ODI2026' && recallPromoCode(1000 + 31 * DAY, store) === null && !store.data.has(PROMO_STORAGE_KEY));
  rememberPromoCode('abc123', 5, store);
  forgetPromoCode(store);
  check('forgetting removes it', recallPromoCode(5, store) === null);
  store.setItem(PROMO_STORAGE_KEY, 'not json');
  check('a damaged stored value is ignored, not a crash', recallPromoCode(0, store) === null);
  check('a blocked or missing browser store never throws and remembers nothing', (() => {
    try {
      rememberPromoCode('ABC123', 0, brokenStore);
      forgetPromoCode(brokenStore);
      return recallPromoCode(0, brokenStore) === null && rememberPromoCodeFromUrl('?code=ABC123', 0, null) === 'ABC123' && recallPromoCode(0, null) === null;
    } catch {
      return false;
    }
  })());

  // ---- the box on the sign-up form ----------------------------------------------------------------------------------------------------------------------
  const good = fake(() => ({ data: { valid: true, percent: 10, lessons: 3 }, error: null }));
  const c1 = await checkPromoCode(good.db, ' odi2026 ');
  check('a good code: asked once, in capitals, answered with the percent and the lessons', c1.state === 'valid' && good.calls.length === 1 && good.calls[0].fn === 'check_promo_code' && good.calls[0].args?.p_code === 'ODI2026');
  check('the words for a good code: "Code accepted: 10% off your first 3 lessons."', promoCheckMessage(c1)?.text === 'Code accepted: 10% off your first 3 lessons.' && promoCheckMessage(c1)?.tone === 'good');
  check('one lesson is worded in the singular', promoCheckMessage({ state: 'valid', percent: 10, lessons: 1 })?.text === 'Code accepted: 10% off your first lesson.' && lessonsWord(1) === 'lesson' && lessonsWord(3) === 'lessons');
  const bad = fake(() => ({ data: { valid: false }, error: null }));
  const c2 = await checkPromoCode(bad.db, 'NOSUCH1');
  check('a wrong code: one plain line that says the sign-up can go on', c2.state === 'invalid' && /don't recognise that code/.test(promoCheckMessage(c2)?.text ?? '') && /still create your account/.test(promoCheckMessage(c2)?.text ?? ''));
  const lim = await checkPromoCode(fake(() => ({ data: { valid: false, limited: true }, error: null })).db, 'NOSUCH1');
  check('too many tries: told to carry on and tell us the code afterwards', lim.state === 'limited' && /still create your account/.test(promoCheckMessage(lim)?.text ?? ''));
  const shape = fake(() => ({ data: null, error: null }));
  const c3 = await checkPromoCode(shape.db, 'bad code!');
  check('not the shape of a code: told so without asking the database', c3.state === 'badShape' && shape.calls.length === 0 && /still create your account/.test(promoCheckMessage(c3)?.text ?? ''));
  const none = fake(() => ({ data: null, error: null }));
  check('nothing typed: nothing asked, nothing said', (await checkPromoCode(none.db, '   ')).state === 'empty' && none.calls.length === 0 && promoCheckMessage({ state: 'empty' }) === null);
  check('an old database, an error, an odd answer or a thrown error: nothing is said and nothing blocks', (await Promise.all([
    checkPromoCode(fake(() => ({ data: null, error: { code: 'PGRST202', message: 'function not found' } })).db, 'ABC123'),
    checkPromoCode(fake(() => ({ data: 'weird', error: null })).db, 'ABC123'),
    checkPromoCode(fake(() => ({ data: { valid: true, percent: 'x', lessons: null }, error: null })).db, 'ABC123'),
    checkPromoCode({ rpc: async () => { throw new Error('offline'); } }, 'ABC123'),
  ])).every((c) => c.state === 'unavailable') && promoCheckMessage({ state: 'unavailable' }) === null);
  check('whatever was typed is sent with the sign-up, trimmed and cut to 40 letters; nothing typed sends nothing',
    promoSignupMetadata('  odi2026 ').signup_code === 'odi2026' && promoSignupMetadata('x'.repeat(300)).signup_code?.length === PROMO_TYPED_MAX && Object.keys(promoSignupMetadata('   ')).length === 0);

  // ---- a Google sign-up claims the code the link brought ----------------------------------------------------------------------------------------------------
  const cs = memoryStore();
  rememberPromoCode('ODI2026', 100, cs);
  const claimOk = fake(() => ({ data: { attached: true, percent: 10, lessons: 3 }, error: null }));
  check('claimed once with the remembered code, then forgotten', (await claimRememberedPromoCode(claimOk.db, 200, cs)) === 'attached' && claimOk.calls.length === 1 && claimOk.calls[0].fn === 'attach_my_promo_code' && claimOk.calls[0].args?.p_code === 'ODI2026' && recallPromoCode(200, cs) === null);
  check('nothing remembered: nothing asked', (await claimRememberedPromoCode(claimOk.db, 300, cs)) === 'none' && claimOk.calls.length === 1);
  rememberPromoCode('ODI2026', 100, cs);
  check('refused (an older account, a wrong code) or failing: carries on, and the code is dropped anyway', (await claimRememberedPromoCode(fake(() => ({ data: { attached: false, reason: 'too_late' }, error: null })).db, 200, cs)) === 'refused' && recallPromoCode(200, cs) === null);
  rememberPromoCode('ODI2026', 100, cs);
  check('a thrown error does not block the sign-in', (await claimRememberedPromoCode({ rpc: async () => { throw new Error('offline'); } }, 200, cs)) === 'refused');

  // ---- the booking screen's line -----------------------------------------------------------------------------------------------------------------------------
  const quoteAnswer = { applies: true, percent: 10, list_rand: 280, discount_rand: 28, pay_rand: 252, lesson_number: 1, lessons: 3 };
  const q = await fetchPromoQuote(fake(() => ({ data: quoteAnswer, error: null })).db, 280);
  check('the quote for 2C: R252, R28 off, lesson 1 of 3, asked with the whole-rand price', q?.payRand === 252 && q?.discountRand === 28 && q?.lessonNumber === 1 && q?.lessons === 3);
  check('the line before sending is "10% code applied: R252 (lesson 1 of 3)"', q !== null && promoQuoteLine(q) === '10% code applied: R252 (lesson 1 of 3)');
  const asked = fake(() => ({ data: quoteAnswer, error: null }));
  await fetchPromoQuote(asked.db, 279.6);
  check('the price is sent as whole rand (the database rounds the price the same way)', asked.calls[0].fn === 'my_promo_quote' && asked.calls[0].args?.p_list_rand === 280);
  check('no discount applies: nothing to show', (await fetchPromoQuote(fake(() => ({ data: { applies: false }, error: null })).db, 280)) === null);
  check('an old database, an error, an odd answer, no price or a thrown error: no discount is shown', (await Promise.all([
    fetchPromoQuote(fake(() => ({ data: null, error: { code: 'PGRST202' } })).db, 280),
    fetchPromoQuote(fake(() => ({ data: { applies: true, percent: 'x' }, error: null })).db, 280),
    fetchPromoQuote(fake(() => ({ data: quoteAnswer, error: null })).db, 0),
    fetchPromoQuote({ rpc: async () => { throw new Error('offline'); } }, 280),
  ])).every((v) => v === null));
  const html = render(React.createElement(WalletPayBox, { price: 252, promoLine: '10% code applied: R252 (lesson 1 of 3)', state: { status: 'ready', available: 1000, held: 0 }, onAddMoney: () => {}, onRetry: () => {} }));
  check('the booking box shows the line, then the discounted price and what is left', /data-promo-applied/.test(html) && html.includes('10% code applied: R252 (lesson 1 of 3)') && html.includes('R252') && html.includes('R748'));
  const htmlNone = render(React.createElement(WalletPayBox, { price: 280, state: { status: 'ready', available: 1000, held: 0 }, onAddMoney: () => {}, onRetry: () => {} }));
  check('with no code the box looks as it did: no promo line', !/data-promo-applied/.test(htmlNone) && htmlNone.includes('R280'));
  const htmlShort = render(React.createElement(WalletPayBox, { price: 252, promoLine: '10% code applied: R252 (lesson 1 of 3)', state: { status: 'ready', available: 200, held: 0 }, onAddMoney: () => {}, onRetry: () => {} }));
  check('a short wallet is told the shortfall of the discounted price (R52), not of the full price', /Add R52 or more/.test(htmlShort));

  // ---- the wiring, read from the source ---------------------------------------------------------------------------------------------------------------------
  const signup = code('src/pages/CreateAccount.tsx');
  check('sign-up: the optional box is there, with its label', /htmlFor="promoCode"/.test(signup) && /Code \(optional\)/.test(read('src/pages/CreateAccount.tsx')));
  check('sign-up: the box is for parents and learners only (never a tutor)', /role !== 'tutor' && \(\s*<div data-promo-code>/.test(signup) && /role === 'tutor' \? '' : recallPromoCode\(\)/.test(signup));
  check('sign-up: pre-filled from the remembered code of the link', /useState\(\(\) => \(role === 'tutor' \? '' : recallPromoCode\(\) \?\? ''\)\)/.test(signup));
  check('sign-up: the typed code goes in the sign-up metadata (so it survives the e-mail step), for parents and learners', /\.\.\.\(role !== 'tutor' \? promoSignupMetadata\(promoCode\) : \{\}\)/.test(signup) && /signup_code/.test(code('src/lib/promoCode.ts')));
  check('sign-up: a wrong code is a plain line, never an error and never blocks (no promo check inside handleSubmit)', !/setError\([^)]*promo/i.test(signup) && !/promoCheck\.state/.test(signup.slice(signup.indexOf('handleSubmit'), signup.indexOf('const RoleIcon'))));
  check('sign-up: the remembered code is dropped once the account is made', /forgetPromoCode\(\)/.test(signup));
  const main = code('src/main.tsx');
  check('start: the address is read before any page or redirect can drop the query string', /rememberPromoCodeFromUrl\(\)/.test(main) && main.indexOf('rememberPromoCodeFromUrl()') < main.indexOf('createRoot('));
  const cb = code('src/pages/AuthCallback.tsx');
  check('Google: the remembered code is claimed after the session lands, before going on', /await claimRememberedPromoCode\(promoDb\)/.test(cb) && cb.indexOf('claimRememberedPromoCode(promoDb)') < cb.indexOf("navigate('/', { replace: true })"));
  const prices = code('src/components/PricesPage.tsx');
  check('booking: the quote is asked only on the wallet path', /usePromoQuote\(walletMode, price\)/.test(prices));
  check('booking: the wallet check, the button, the shortfall and the top-up suggestion all use the discounted price',
    /payPrice = promo \? promo\.payRand : price/.test(prices) && /available >= payPrice/.test(prices) && /Pay \$\{rand0\(payPrice\)\} from your wallet/.test(prices) && /shortfall\(payPrice, wallet\.state\.available\)/.test(prices));
  check('booking: the line is shown through the wallet box', /promoLine=\{promo \? promoQuoteLine\(promo\) : null\}/.test(prices));
  check('booking: the card path is untouched (the heading names the full price only)', /getCurrencySymbol\(selectedLevel\.currencyCode\)\}\$\{formatRate\(chargedAmount \?\? 0\)\}`/.test(prices));
  const hooks = code('src/lib/promoHooks.ts');
  check('hooks: the quote and the sign-up check are bound to the app client; the sign-up check waits for typing to stop', /usePromoQuote/.test(hooks) && /usePromoCodeCheck/.test(hooks) && /setTimeout\(/.test(hooks) && /clearTimeout/.test(hooks));
  check('the database calls are the ones the migration makes: check_promo_code, attach_my_promo_code, my_promo_quote', ['check_promo_code', 'attach_my_promo_code', 'my_promo_quote'].every((f) => code('src/lib/promoCode.ts').includes(`'${f}'`) && read('supabase/migrations/20261105200100_promo_codes.sql').includes(`function public.${f}(`)));

  // ---- words: never "free" for lessons or sessions ----------------------------------------------------------------------------------------------------------
  const newText = [read('src/lib/promoCode.ts'), read('src/lib/promoHooks.ts')].join('\n');
  const stripped = newText.replace(/The word "free" is not used[^\n]*/g, '');
  check('no new text offers "free" lessons or sessions', !/\bfree\b/i.test(stripped.replace(/free_session|freeOpen/g, '')), (stripped.match(/.{20}\bfree\b.{20}/i) ?? [''])[0]);

  console.log(failed === 0 ? '\nALL OK' : `\n${failed} FAILED`);
  process.exit(failed === 0 ? 0 : 1);
}
main();
