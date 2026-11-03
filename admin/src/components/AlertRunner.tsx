import React, { useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAdminAuth } from '../lib/AuthContext';
import { supabase } from '../lib/supabaseClient';
import { CHECK_EVERY_MS, lapseToast, loadLink, nextLink, runAlertRound, saveLink, storageAlertStore } from '../lib/adminAlerts';
import { getDesktopBridge, wasManualSignOut } from '../lib/desktopBridge';

// How long "no sign-in" must last, online, before it counts as a lapsed sign-in: the app can start with Windows before the network is up, and then the
// stored sign-in comes back by itself within about 30 seconds of the network returning. A real lapse (refresh token refused) never comes back.
const LAPSE_GRACE_MS = 180_000;

const pageStorage = (): Storage | undefined => {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
};

// Draws nothing. In the installed Windows app (the desktop bridge exists) it runs the background alerts for the signed-in admin: a check every 2 minutes
// and one at once on start, on waking, and on unmuting; it opens the right page when a notification is clicked; and it says once if the sign-in lapsed.
// In a normal browser there is no bridge and this does nothing. The rules live in lib/adminAlerts.ts (tested by scripts/dev/admin-alerts-test.ts).
export const AlertRunner: React.FC = () => {
  const { session, adminProfile, loading } = useAdminAuth();
  const navigate = useNavigate();
  const bridge = useMemo(() => getDesktopBridge(), []);
  const store = useMemo(() => storageAlertStore(pageStorage()), []);

  // A clicked notification opens its page.
  useEffect(() => (bridge ? bridge.onNavigate((route) => navigate(route)) : undefined), [bridge, navigate]);

  // The checks.
  const adminId = adminProfile?.id;
  const role = adminProfile?.adminRole;
  const active = !!session && !!adminProfile?.isActive;
  useEffect(() => {
    if (!bridge || !active || !adminId || !role) return undefined;
    let stopped = false;
    let running = false;
    const run = async () => {
      if (stopped || running) return;
      running = true;
      try {
        await runAlertRound({
          client: supabase, adminId, role, store, now: () => Date.now(),
          show: async (toast) => { await bridge.notify(toast); },
          isMuted: () => bridge.isMuted(),
        });
      } catch {
        // never let a failed check break the app; the next round tries again
      } finally {
        running = false;
      }
    };
    void run();
    const timer = window.setInterval(() => void run(), CHECK_EVERY_MS);
    const offCheckNow = bridge.onCheckNow(() => void run());
    return () => {
      stopped = true;
      window.clearInterval(timer);
      offCheckNow();
    };
  }, [bridge, active, adminId, role, store]);

  // The sign-in: remember a working one; tell the admin once if it stops working (but never for their own sign-out).
  useEffect(() => {
    if (!bridge || loading) return undefined;
    const storage = pageStorage();
    if (session) {
      saveLink(storage, nextLink(loadLink(storage), 'session').link);
      return undefined;
    }
    if (wasManualSignOut()) {
      saveLink(storage, nextLink(loadLink(storage), 'manual_signout').link);
      return undefined;
    }
    let timer: number | undefined;
    const check = () => {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        timer = window.setTimeout(check, LAPSE_GRACE_MS);   // offline: wait for the network, then give it the grace again
        return;
      }
      const { link, announce } = nextLink(loadLink(storage), 'none');
      saveLink(storage, link);
      if (announce) void bridge.notify(lapseToast()).catch(() => undefined);
    };
    timer = window.setTimeout(check, LAPSE_GRACE_MS);
    return () => window.clearTimeout(timer);
  }, [bridge, loading, session]);

  return null;
};
