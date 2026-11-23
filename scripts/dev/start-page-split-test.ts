// Checks on the start-page code split (job T, 24 Nov 2026; branch code-split). Run: npx tsx scripts/dev/start-page-split-test.ts
// The database library (supabase-js) is no longer in the first download of a visitor with no saved sign-in. This proves the rule that decides who still gets it at once (needsSupabaseNow),
// that the listeners hear about the client whichever page loads it (supabaseReady), and, by reading the sources, that nothing the entry file imports takes the client in statically any more
// (so the build cannot quietly put it back). The browser suites (tests/browser) prove that sign-in, sign-up, the join page, the personal link and /login behave the same.
import { readFileSync } from 'node:fs';
import { markSupabaseReady, needsSupabaseNow, whenSupabaseReady } from '../../src/lib/supabaseReady';

let failed = 0;
const check = (label: string, ok: boolean) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`);
  if (!ok) failed += 1;
};
const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const code = (p: string) => read(p).replace(/\/\/.*$/gm, '');

const store = (keys: string[]): Storage => ({ length: keys.length, key: (i: number) => keys[i] ?? null }) as unknown as Storage;
const win = (o: { keys?: string[]; hash?: string; search?: string; blocked?: boolean }) => ({
  location: { hash: o.hash ?? '', search: o.search ?? '' },
  get localStorage(): Storage {
    if (o.blocked) throw new Error('blocked');
    return store(o.keys ?? []);
  },
});

check('a signed-out visitor on a public page does not need the client', needsSupabaseNow(win({})) === false);
check('a visitor arriving by a tutor code link (?code=ABC) does not need it either', needsSupabaseNow(win({ search: '?code=ABC123' })) === false);
check('an unrelated saved key does not count', needsSupabaseNow(win({ keys: ['tutorlage.promo_code', 'i18nextLng'] })) === false);
check('a saved sign-in does', needsSupabaseNow(win({ keys: ['x', 'sb-qxzhqylrrspumvguflwj-auth-token'] })) === true);
check('an e-mail link result in the fragment does (tokens, recovery, an error)', needsSupabaseNow(win({ hash: '#access_token=a&refresh_token=b&type=signup' })) && needsSupabaseNow(win({ hash: '#type=recovery' })) && needsSupabaseNow(win({ hash: '#error=access_denied&error_code=otp_expired&error_description=x' })));
check('a token in the query does', needsSupabaseNow(win({ search: '?token_hash=abc&type=magiclink' })) && needsSupabaseNow(win({ search: '?error=x' })));
check('storage that cannot be read means "load it as before"', needsSupabaseNow(win({ blocked: true })) === true);
check('no window (a test or a server) means "load it as before"', needsSupabaseNow(undefined) === true);

let heard = 0;
const cancel = whenSupabaseReady(() => { heard += 1; });
whenSupabaseReady(() => { heard += 10; });
cancel();
markSupabaseReady();
check('a listener hears the client when it is created, a cancelled one does not', heard === 10);
let late = 0;
whenSupabaseReady(() => { late += 1; });
check('a listener that asks after the client exists runs at once', late === 1);

// the sources
const main = code('src/main.tsx');
const staticClient = /^import[^;]*from ['"][^'"]*supabaseClient[^'"]*['"]/m;
const entryFiles = ['src/main.tsx', 'src/lib/AuthContext.tsx', 'src/lib/errorLogSender.ts', 'src/lib/currencies.ts', 'src/lib/recoveryLink.ts', 'src/lib/RecoveryRedirect.tsx'];
check('none of the files the entry loads imports the database client statically', entryFiles.every((f) => !staticClient.test(code(f))));
check('the sign-in state imports the client and the profile query on demand only', /import\('\.\/supabaseClient'\)/.test(code('src/lib/AuthContext.tsx')) && /import\('\.\/queries'\)/.test(code('src/lib/AuthContext.tsx')) && !/from '\.\/queries'/.test(code('src/lib/AuthContext.tsx')));
check('the sign-in state still starts reading as soon as any page creates the client', /whenSupabaseReady\(start\)/.test(code('src/lib/AuthContext.tsx')) && /markSupabaseReady\(\);/.test(code('src/lib/supabaseClient.ts')));
check('a visit with a saved sign-in or an e-mail link starts it at once (needsSupabaseNow)', /if \(needsSupabaseNow\(\)\) \{\s*start\(\);/.test(code('src/lib/AuthContext.tsx')));
check('the currency symbols wait for the client; the start-up call is not left bare', /whenSupabaseReady\(\(\) => \{\s*void loadCurrencySymbols\(\);/.test(main) && !/^loadCurrencySymbols\(\);/m.test(main));
check('the error sender and the reset-link check load the client when they need it', /import\('\.\/supabaseClient'\)/.test(code('src/lib/errorLogSender.ts')) && /import\('\.\/supabaseClient'\)/.test(code('src/lib/recoveryLink.ts')));

console.log(failed === 0 ? '\nAll start-page split checks passed.' : `\n${failed} start-page split check(s) FAILED.`);
process.exit(failed === 0 ? 0 : 1);
