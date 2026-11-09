import {StrictMode, Suspense} from 'react';
import {createRoot} from 'react-dom/client';
import {BrowserRouter, Routes, Route} from 'react-router-dom';
import {RecoveryRedirect} from './lib/RecoveryRedirect.tsx';
import {FEATURES} from './lib/features.ts';
import {AuthProvider, useAuth} from './lib/AuthContext.tsx';
import {AppErrorBoundary} from './components/ErrorBoundary.tsx';
import {PageLoading} from './components/PageLoading.tsx';
import {RouteMeta} from './components/RouteMeta.tsx';
import {lazyRoute} from './lib/lazyRoute.ts';
import {loadCurrencySymbols} from './lib/currencies.ts';
import {BASE_PATH} from './lib/siteUrl.ts';
import {installGlobalErrorLogging, setErrorSender} from './lib/errorLog.ts';
import {sendClientError} from './lib/errorLogSender.ts';
import {rememberPromoCodeFromUrl} from './lib/promoCode.ts';
// Side-effect import: initializes i18next before anything renders.
import './lib/i18n.ts';
// Ignore missing type declarations for CSS side-effect import
// @ts-ignore
import './index.css';

// Error tracking (release gate OPS-ERRORS-01): crashes and uncaught errors are reported, cleaned of personal data and limited per
// page load, to the database's log_client_error. If the database does not have it yet, sending switches itself off quietly.
setErrorSender(sendClientError);
installGlobalErrorLogging();

// PROMO CODES (CEO, 5 Nov 2026): a link tutorlage.com/?code=XYZ lands on the start page, which sends a signed-out visitor to the sign-in page and drops the
// query string. The code is taken from the address first and remembered (30 days) for the sign-up form.
rememberPromoCodeFromUrl();

// Fire-and-forget: components render with the built-in ZAR fallback until
// this resolves, so it doesn't need to block first paint.
loadCurrencySymbols();

// Every page loads on demand (release gate PERF-BUNDLE-01): the first download carries the router, sign-in state and the page asked for,
// not the whole app. lazyRoute retries once and then reloads once if a page's code cannot be fetched (lost signal, or a republish).
const Landing = lazyRoute(() => import('./pages/Landing.tsx'));
const NotFound = lazyRoute(() => import('./pages/NotFound.tsx'));
const Login = lazyRoute(() => import('./pages/Login.tsx'));
const SignIn = lazyRoute(() => import('./pages/SignIn.tsx'));
const CreateAccount = lazyRoute(() => import('./pages/CreateAccount.tsx'));
const ForgotPassword = lazyRoute(() => import('./pages/ForgotPassword.tsx'));
const ResetPassword = lazyRoute(() => import('./pages/ResetPassword.tsx'));
const PaymentCallback = lazyRoute(() => import('./pages/PaymentCallback.tsx'));
const TopupReturn = lazyRoute(() => import('./pages/TopupReturn.tsx'));
const AuthCallback = lazyRoute(() => import('./pages/AuthCallback.tsx'));
const AccountClosed = lazyRoute(() => import('./pages/AccountClosed.tsx'));
const LegalPage = lazyRoute(() => import('./pages/LegalPage.tsx'));
const AboutPublic = lazyRoute(() => import('./pages/AboutPublic.tsx'));
const GuardedApp = lazyRoute(() => import('./pages/guarded.tsx').then((m) => ({default: m.GuardedApp})));
const GuardedRoom = lazyRoute(() => import('./pages/guarded.tsx').then((m) => ({default: m.GuardedRoom})));
const GuardedTutorDocuments = lazyRoute(() => import('./pages/guarded.tsx').then((m) => ({default: m.GuardedTutorDocuments})));

// The address "/": a visitor who is not signed in sees the start page; someone signed in goes straight to the app. While the sign-in
// state is still being read (and an email link's tokens are being turned into a session) it waits, so the start page never flashes.
function HomeRoute() {
  const {session, loading} = useAuth();
  if (loading) return <PageLoading />;
  return session ? <GuardedApp /> : <Landing />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter basename={BASE_PATH || '/'}>
      {/* A screen that throws shows a plain "Something went wrong" page with a way out, not a blank white one. */}
      <AppErrorBoundary homeHref={`${BASE_PATH}/`}>
      <AuthProvider>
        {/* Master 7cm: a password-reset link that landed on the wrong page is sent on to /reset-password. */}
        <RecoveryRedirect />
        <RouteMeta />
        <Suspense fallback={<PageLoading />}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/signin/:role" element={<SignIn />} />
          <Route path="/signup/:role" element={<CreateAccount />} />
          {/* Master 7cm. Both public: the reset link signs the person in with a short-lived session, and
              /reset-password must show its form before the app (RequireAuth, AccountGate) is let in. */}
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/forgot-password/:role" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/auth/callback" element={<AuthCallback />} />
          {/* Close my account: the person is signed out by the time they land here, so it is public. */}
          <Route path="/account-closed" element={<AccountClosed />} />
          {/* Legal pages are public: they must be readable before signing up (ECTA s43). */}
          <Route path="/terms" element={<LegalPage document="terms" />} />
          <Route path="/privacy" element={<LegalPage document="privacy" />} />
          <Route path="/refunds" element={<LegalPage document="refunds" />} />
          <Route path="/delivery" element={<LegalPage document="delivery" />} />
          <Route path="/about" element={<AboutPublic />} />
          {/* Public on purpose: the page only asks server/index.ts to verify the
              reference, and the server records the result. Gating it behind
              sign-in meant a student whose session had lapsed during checkout
              was bounced to /login and the payment was never recorded. */}
          <Route path="/payment/callback" element={<PaymentCallback />} />
          {/* Where the bank's page sends a payer back after Pay by bank, instant. Public so it loads even if the session is slow to come back; it shows a
              sign-in button when nobody is signed in, and it only READS the payer's own top-up (it can never credit anything). */}
          <Route path="/wallet/topup-return" element={<TopupReturn />} />
          {/* Video rooms (master 7bm), switched off with FEATURES.videoRooms until the CEO says so. */}
          {FEATURES.videoRooms && (
            <>
              <Route path="/room" element={<GuardedRoom />} />
              <Route path="/room/:code" element={<GuardedRoom />} />
            </>
          )}
          {/* The tutor's second and third sign-up pages, reopened from the Teach screen's reminder (master 7cx). */}
          {FEATURES.tutorOnboarding && <Route path="/tutor-documents" element={<GuardedTutorDocuments />} />}
          {/* The start page for visitors, the app for signed-in people (the checks the app needs are in pages/guarded.tsx). */}
          <Route path="/" element={<HomeRoute />} />
          {/* Any other address: a plain "we can't find that page" (it used to open the app, or bounce a visitor to sign-in). */}
          <Route path="*" element={<NotFound />} />
        </Routes>
        </Suspense>
      </AuthProvider>
      </AppErrorBoundary>
    </BrowserRouter>
  </StrictMode>,
);
