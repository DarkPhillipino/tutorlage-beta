import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {BrowserRouter, Routes, Route} from 'react-router-dom';
import App from './App.tsx';
import Login from './pages/Login.tsx';
import SignIn from './pages/SignIn.tsx';
import CreateAccount from './pages/CreateAccount.tsx';
import ForgotPassword from './pages/ForgotPassword.tsx';
import ResetPassword from './pages/ResetPassword.tsx';
import {RecoveryRedirect} from './lib/RecoveryRedirect.tsx';
import PaymentCallback from './pages/PaymentCallback.tsx';
import AuthCallback from './pages/AuthCallback.tsx';
import LegalPage from './pages/LegalPage.tsx';
import RoomPage from './pages/RoomPage.tsx';
import {FEATURES} from './lib/features.ts';
import {AuthProvider} from './lib/AuthContext.tsx';
import {RequireAuth} from './components/RequireAuth.tsx';
import {AccountGate} from './components/AccountGate.tsx';
import {loadCurrencySymbols} from './lib/currencies.ts';
import {BASE_PATH} from './lib/siteUrl.ts';
// Side-effect import: initializes i18next before anything renders.
import './lib/i18n.ts';
// Ignore missing type declarations for CSS side-effect import
// @ts-ignore
import './index.css';

// Fire-and-forget: components render with the built-in ZAR fallback until
// this resolves, so it doesn't need to block first paint.
loadCurrencySymbols();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter basename={BASE_PATH || '/'}>
      <AuthProvider>
        {/* Master 7cm: a password-reset link that landed on the wrong page is sent on to /reset-password. */}
        <RecoveryRedirect />
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
          {/* Legal pages are public: they must be readable before signing up (ECTA s43). */}
          <Route path="/terms" element={<LegalPage document="terms" />} />
          <Route path="/privacy" element={<LegalPage document="privacy" />} />
          <Route path="/refunds" element={<LegalPage document="refunds" />} />
          {/* Public on purpose: the page only asks server/index.ts to verify the
              reference, and the server records the result. Gating it behind
              sign-in meant a student whose session had lapsed during checkout
              was bounced to /login and the payment was never recorded. */}
          <Route path="/payment/callback" element={<PaymentCallback />} />
          {/* Video rooms (master 7bm), switched off with FEATURES.videoRooms until the CEO says so. */}
          {FEATURES.videoRooms && (
            <>
              <Route
                path="/room"
                element={
                  <RequireAuth>
                    <AccountGate>
                      <RoomPage />
                    </AccountGate>
                  </RequireAuth>
                }
              />
              <Route
                path="/room/:code"
                element={
                  <RequireAuth>
                    <AccountGate>
                      <RoomPage />
                    </AccountGate>
                  </RequireAuth>
                }
              />
            </>
          )}
          <Route
            path="/*"
            element={
              <RequireAuth>
                {/* Date of birth + Terms/Privacy acceptance before the app (7k/7l). */}
                <AccountGate>
                  <App />
                </AccountGate>
              </RequireAuth>
            }
          />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
