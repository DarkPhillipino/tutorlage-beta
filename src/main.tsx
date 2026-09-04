import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {BrowserRouter, Routes, Route} from 'react-router-dom';
import App from './App.tsx';
import Login from './pages/Login.tsx';
import SignIn from './pages/SignIn.tsx';
import CreateAccount from './pages/CreateAccount.tsx';
import {AuthProvider} from './lib/AuthContext.tsx';
import {RequireAuth} from './components/RequireAuth.tsx';
// Side-effect import: initializes i18next before anything renders.
import './lib/i18n.ts';
// Ignore missing type declarations for CSS side-effect import
// @ts-ignore
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/signin/:role" element={<SignIn />} />
          <Route path="/signup/:role" element={<CreateAccount />} />
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
