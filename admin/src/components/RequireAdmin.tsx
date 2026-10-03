import React from 'react';
import { Navigate } from 'react-router-dom';
import { Loader2, ShieldOff } from 'lucide-react';
import { useAdminAuth } from '../lib/AuthContext';

// Two distinct failure modes, deliberately shown differently:
// 1. Not signed in at all -> silently redirect to /login, same as any
//    normal auth gate.
// 2. Signed in, but no admin_profiles row (or is_active = false) -> signed
//    in successfully as a *user*, just not an admin. Shown here as an
//    explicit "no access" screen, not a redirect, so it's clear this isn't
//    a bug — the login worked, the account just isn't an admin.
export const RequireAdmin: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { loading, session, adminProfile, signOut } = useAdminAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#FAF7F2] text-slate-400">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        <span className="text-sm font-semibold">Loading Tutorlage Admin…</span>
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/login" replace />;
  }

  if (!adminProfile || !adminProfile.isActive) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#FAF7F2] px-6">
        <div className="max-w-sm w-full bg-white rounded-2xl p-8 border border-slate-200 text-center">
          <div className="w-12 h-12 bg-rose-100 rounded-full flex items-center justify-center text-rose-600 mx-auto mb-4">
            <ShieldOff className="w-6 h-6" />
          </div>
          <h1 className="text-lg font-extrabold text-[#0F172A] mb-1">No admin access</h1>
          <p className="text-xs text-slate-500 mb-4">
            You're signed in, but this account isn't an active admin on Tutorlage.
          </p>
          <button
            onClick={signOut}
            className="text-xs font-bold text-[#15803D] hover:underline cursor-pointer"
          >
            Sign out
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};
