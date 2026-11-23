import React, { createContext, useContext, useEffect, useState } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { needsSupabaseNow, whenSupabaseReady } from './supabaseReady';
import { UserProfile } from '../types';

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  // START-PAGE CODE SPLIT (24 Nov 2026): the database library is loaded here only when the visit needs it (a saved sign-in, or an e-mail link in the address; see needsSupabaseNow).
  // A signed-out visitor on a public page is shown as signed out at once, with nothing downloaded; the moment ANY page loads the client (a sign-in or sign-up page), this provider hears it
  // (whenSupabaseReady) and starts reading the sign-in state exactly as before, so a sign-in made on those pages is still noticed.
  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;
    let cancelWait: (() => void) | null = null;
    const start = () => {
      import('./supabaseClient').then(({ supabase }) => {
        if (cancelled) return;
        supabase.auth.getSession().then(({ data }) => {
          if (cancelled) return;
          setSession(data.session);
          setLoading(false);
        });
        const { data: subscription } = supabase.auth.onAuthStateChange((_event, newSession) => {
          setSession(newSession);
        });
        unsubscribe = () => subscription.subscription.unsubscribe();
      });
    };
    if (needsSupabaseNow()) {
      start();
    } else {
      setLoading(false);
      cancelWait = whenSupabaseReady(start);
    }
    return () => {
      cancelled = true;
      cancelWait?.();
      unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    if (!session?.user) {
      setProfile(null);
      return;
    }
    let live = true;
    Promise.all([import('./queries'), import('./supabaseClient')])
      .then(async ([{ fetchProfile }, { supabase }]) => {
        const fetchedProfile = await fetchProfile(session.user.id, session.user.email ?? '');
        if (!live) return;
        if (!fetchedProfile) {
          // A valid session with no matching profiles row (e.g. the account
          // was deleted after the session was issued) previously left the
          // app stuck treating the user as signed in with nothing behind
          // it — RequireAuth only checks for a session, so it let them
          // through, and every profile-dependent screen just hung showing
          // "Loading…" forever. Treat a missing profile as an invalid
          // session instead: sign out, which flips `session` to null and
          // lets RequireAuth redirect to /login normally.
          supabase.auth.signOut();
          return;
        }
        setProfile(fetchedProfile);
      })
      .catch(() => {
        if (live) setProfile(null);
      });
    return () => {
      live = false;
    };
  }, [session?.user?.id]);

  const signOut = async () => {
    const { supabase } = await import('./supabaseClient');
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider value={{ session, user: session?.user ?? null, profile, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
