import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {BrowserRouter, Routes, Route} from 'react-router-dom';
import App from './App.tsx';
import Login from './pages/Login.tsx';
import SignIn from './pages/SignIn.tsx';
import CreateAccount from './pages/CreateAccount.tsx';
import PaymentCallback from './pages/PaymentCallback.tsx';
import AuthCallback from './pages/AuthCallback.tsx';
import {AuthProvider} from './lib/AuthContext.tsx';
import {RequireAuth} from './components/RequireAuth.tsx';
import {loadCurrencySymbols} from './lib/currencies.ts';
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
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/signin/:role" element={<SignIn />} />
          <Route path="/signup/:role" element={<CreateAccount />} />
          <Route path="/auth/callback" element={<AuthCallback />} />
          <Route
            path="/payment/callback"
            element={
              <RequireAuth>
                <PaymentCallback />
              </RequireAuth>
            }
          />
          <Route
            path="/*"
            element={
              <RequireAuth>
                <App />
              </RequireAuth>
            }
          />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
