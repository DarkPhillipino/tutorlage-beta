// Test of how the account-email screens are wired together (master backlog 7cl, 7cm, and the Google switch). It checks
// what auth-helpers-test.ts cannot reach, because the pages need a browser:
//   1. the return addresses the emails carry, built by the app's own code under Vite's two base paths ('/' locally,
//      '/tutorlage-beta/' on GitHub Pages), so the sign-up email and "send the link again" cannot disagree;
//   2. that the pages call those same functions (a drift guard on the source text, not a render);
//   3. that every page showing the Google button is behind FEATURES.googleSignIn;
//   4. that the reset routes sit outside the sign-in gate.
// Nothing is written (no dist/, no build), no port is opened, no network. Run: npx tsx scripts/dev/auth-wiring-test.ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createServer } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const source = (file: string) => readFileSync(path.join(root, file), 'utf8');

let failed = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) failed += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ' - ' + detail : ''}`);
};

// Runs the app's own authRedirects.ts under a given Vite base path, with the browser address pretended.
async function redirectsFor(base: string, origin: string) {
  const vite = await createServer({
    root,
    base,
    configFile: false,
    appType: 'custom',
    logLevel: 'silent',
    server: { middlewareMode: true, hmr: false, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  try {
    (globalThis as { window?: unknown }).window = { location: { origin } };
    const mod = await vite.ssrLoadModule('/src/lib/authRedirects.ts');
    return {
      signup: (mod.signupConfirmationRedirect as () => string)(),
      reset: (mod.passwordResetRedirect as () => string)(),
      resetPath: mod.PASSWORD_RESET_PATH as string,
    };
  } finally {
    delete (globalThis as { window?: unknown }).window;
    await vite.close();
  }
}

async function main() {
  // ---- 1. The addresses the emails return to ------------------------------------------------------------------
  const pages = await redirectsFor('/tutorlage-beta/', 'https://darkphillipino.github.io');
  check('GitHub Pages: sign-up and "send again" return to /tutorlage-beta/login', pages.signup === 'https://darkphillipino.github.io/tutorlage-beta/login', pages.signup);
  check('GitHub Pages: the reset email returns to /tutorlage-beta/reset-password', pages.reset === 'https://darkphillipino.github.io/tutorlage-beta/reset-password', pages.reset);
  const local = await redirectsFor('/', 'http://localhost:3000');
  check('local: sign-up returns to /login', local.signup === 'http://localhost:3000/login', local.signup);
  check('local: the reset email returns to /reset-password', local.reset === 'http://localhost:3000/reset-password', local.reset);

  // ---- 2. The pages use those functions, and nothing builds its own address ---------------------------------
  const createAccount = source('src/pages/CreateAccount.tsx');
  const resend = source('src/lib/ResendConfirmation.tsx');
  const forgot = source('src/pages/ForgotPassword.tsx');
  check('sign-up sends emailRedirectTo from signupConfirmationRedirect()', /emailRedirectTo:\s*signupConfirmationRedirect\(\)/.test(createAccount));
  check('"send the link again" sends emailRedirectTo from the same function', /emailRedirectTo:\s*signupConfirmationRedirect\(\)/.test(resend));
  check('"send the link again" asks for type "signup"', /type:\s*'signup'/.test(resend));
  check('neither builds its own return address', !/siteUrl\(/.test(createAccount) && !/siteUrl\(/.test(resend));
  check('forgot password sends redirectTo from passwordResetRedirect()', /redirectTo:\s*passwordResetRedirect\(\)/.test(forgot));
  check('forgot password asks Supabase through resetPasswordForEmail', /supabase\.auth\.resetPasswordForEmail\(/.test(forgot));
  check('set-a-new-password page saves through updateUser', /supabase\.auth\.updateUser\(\{\s*password\s*\}\)/.test(source('src/pages/ResetPassword.tsx')));
  check('sign-up and the new-password page share one password rule', /validateNewPassword\(/.test(createAccount) && /validateNewPassword\(/.test(source('src/pages/ResetPassword.tsx')));

  // ---- 3. Google switch ---------------------------------------------------------------------------------------
  const googleFiles = ['src/pages/SignIn.tsx', 'src/pages/CreateAccount.tsx'];
  for (const file of googleFiles) {
    const text = source(file);
    check(`${file}: the Google button, "or" line and note sit inside FEATURES.googleSignIn`, /FEATURES\.googleSignIn\s*&&\s*\(/.test(text) && text.indexOf('FEATURES.googleSignIn') < text.indexOf('<GoogleSignInButton'));
  }
  check('the Google button itself also checks the switch', /if \(!FEATURES\.googleSignIn\) return null/.test(source('src/components/GoogleSignInButton.tsx')));
  // Any other file that renders the button (a new page, say) must carry the same check.
  const { readdirSync } = await import('node:fs');
  const walk = (dir: string): string[] =>
    readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory() ? walk(`${dir}/${entry.name}`) : [`${dir}/${entry.name}`],
    );
  const renderers = walk('src').filter((f) => /\.tsx$/.test(f) && /<GoogleSignInButton\b/.test(source(f)));
  check('every file that renders <GoogleSignInButton> is one of the two checked above', renderers.every((f) => googleFiles.includes(f)), renderers.join(', '));

  // ---- 4. Routes ----------------------------------------------------------------------------------------------
  const main = source('src/main.tsx');
  const gate = main.indexOf('path="/*"');
  for (const route of ['/forgot-password"', '/forgot-password/:role"', '/reset-password"']) {
    const at = main.indexOf(`path="${route}`);
    check(`route ${route.replace('"', '')} exists and sits before the signed-in gate`, at !== -1 && at < gate);
  }
  check('the reset email returns to the path the route is registered on', pages.resetPath === '/reset-password');

  // ---- 5. The reset-link safety net (found in a browser check on 10 Oct: a reset link that landed on /login was let
  // into the app, because the sign-in page's own "already signed in, go home" redirect won the race) --------------
  const redirect = source('src/lib/RecoveryRedirect.tsx');
  const resetPage = source('src/pages/ResetPassword.tsx');
  check('the safety net runs again on every change of page, not only the first', /\[pathname, navigate\]/.test(redirect) && !/eslint-disable/.test(redirect));
  check('the safety net goes by "a reset is pending", which survives the page-to-page moves', /!recoveryPending\(\)/.test(redirect) && /navigate\(PASSWORD_RESET_PATH/.test(redirect));
  check('a dead link ends the pending state (so the safety net can never loop)', /phase === 'expired'\)\s*clearRecoveryPending\(\)/.test(resetPage));
  check('saving, leaving, a dead link and a dead session each end the pending state (four places)', (resetPage.match(/clearRecoveryPending\(\)/g) ?? []).length >= 4);
  check('after saving, only this browser is signed out, then the person is sent to sign in', /signOut\(\{ scope: 'local' \}\)/.test(resetPage) && /onClick=\{\(\) => navigate\('\/login'/.test(resetPage));
  check('leaving the page without a new password signs out locally too, not on every device', (resetPage.match(/signOut\(\{ scope: 'local' \}\)/g) ?? []).length === 2);

  // ---- 6. Review fixes of 12 Oct: a reset address is a claim until the server stands behind it; sign-up starts the wait ----
  const link = source('src/lib/recoveryLink.ts');
  check('the address alone never sets the "reset pending" flag (no write at load time)', !/if \(landing\.isRecovery\)\s*setPending/.test(link));
  check('the flag is written only after the server accepted a link, or on supabase-js\'s own PASSWORD_RECOVERY (two places)', (link.match(/setPending\(true\)/g) ?? []).length === 2 && /verdict === 'confirmed'[\s\S]{0,80}setPending\(true\)/.test(link));
  check('the verdict comes from supabase-js\'s own result of reading the link, judged by one tested rule', /supabase\.auth\.initialize\(\)/.test(link) && /judgeRecoveryLink\(/.test(link));
  check('the "set a new password" form is opened by the verdict, not by the address', /checkRecoveryLink\(\)/.test(resetPage) && /verdict === 'confirmed'/.test(resetPage) && !/recoveryPending\(\)\s*\?/.test(resetPage));
  check('the safety net moves nobody unless the verdict is confirmed', /checkRecoveryLink\(\)/.test(redirect) && /verdict === 'confirmed'/.test(redirect));
  check('a link Supabase could not be asked about gets its own screen with a reload, not "expired"', /'unreachable'/.test(resetPage) && /window\.location\.reload\(\)/.test(resetPage) && /could-not-check/.test(resetPage));
  check('sign-up starts the "send again" wait before showing the Check your email screen', /noteSendStarted\(signupResendKey\(email\), Date\.now\(\)\);\s*setNeedsEmailConfirmation\(true\)/.test(createAccount));
  check('the button reads the wait under the same key sign-up writes', /signupResendKey\(address\)/.test(resend));
  check('the "send again" button waits as long as the server says (not a fixed minute)', /start\(rateLimitWaitSeconds\(error\)\)/.test(resend));
  check('the Check your email screen says where to go if an account was already there', /reset your password/.test(createAccount) && /forgot-password\/\$\{role\}/.test(createAccount));

  console.log(failed === 0 ? '\nall checks passed' : `\n${failed} check(s) FAILED`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
