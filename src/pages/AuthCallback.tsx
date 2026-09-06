import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, AlertCircle } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { takePendingOAuthRole } from '../lib/oauth';
import { convertProfileToTutor } from '../lib/queries';

// Where Google sends the browser back after OAuth (see signInWithGoogle in
// src/lib/oauth.ts). Supabase's client library exchanges the auth code for
// a session automatically on load (detectSessionInUrl, on by default) — this
// page just waits for that session to land, then fixes up the role if the
// person had picked "tutor" before starting the Google flow (see
// convertProfileToTutor in queries.ts for why that fixup is needed at all).
export default function AuthCallback() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const finish = async () => {
      // getSession() alone can race the code-exchange on first load; a
      // short-lived auth state listener catches the SIGNED_IN event if the
      // session isn't there yet on this first check.
      let { data: { session } } = await supabase.auth.getSession();

      if (!session) {
        session = await new Promise((resolve) => {
          const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
            if (event === 'SIGNED_IN' && s) {
              sub.subscription.unsubscribe();
              resolve(s);
            }
          });
          setTimeout(() => {
            sub.subscription.unsubscribe();
            resolve(null);
          }, 8000);
        });
      }

      if (cancelled) return;

      if (!session) {
        setError('Sign-in did not complete. Please try again.');
        return;
      }

      const pendingRole = takePendingOAuthRole();
      if (pendingRole === 'tutor') {
        try {
          const displayName =
            (session.user.user_metadata?.full_name as string | undefined) ?? session.user.email ?? 'Tutor';
          await convertProfileToTutor(session.user.id, displayName);
        } catch (e) {
          console.error('convertProfileToTutor failed:', e);
        }
      }

      navigate('/', { replace: true });
    };

    finish();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#FAF7F2] px-6">
      <div className="max-w-sm w-full bg-white rounded-2xl p-8 shadow-sm border border-slate-200/80 text-center">
        {error ? (
          <>
            <div className="w-12 h-12 bg-rose-100 rounded-full flex items-center justify-center text-rose-600 mx-auto mb-4">
              <AlertCircle className="w-6 h-6" />
            </div>
            <h1 className="text-base font-extrabold text-[#0F172A] mb-1">Sign-in failed</h1>
            <p className="text-xs text-slate-500 mb-5">{error}</p>
            <button
              onClick={() => navigate('/login', { replace: true })}
              className="px-5 py-2.5 bg-[#0F172A] text-white font-bold rounded-xl text-sm hover:bg-slate-800 transition-all cursor-pointer"
            >
              Back to sign in
            </button>
          </>
        ) : (
          <>
            <Loader2 className="w-8 h-8 text-slate-400 animate-spin mx-auto mb-4" />
            <h1 className="text-base font-extrabold text-[#0F172A] mb-1">Signing you in…</h1>
            <p className="text-xs text-slate-500">Just a moment.</p>
          </>
        )}
      </div>
    </div>
  );
}
