import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAdminAuth } from '../lib/AuthContext';
import { WatcherId, storageAlertStore, watchersForRole } from '../lib/adminAlerts';
import { DesktopStatus, getDesktopBridge } from '../lib/desktopBridge';
import { NotificationsBody } from '../components/NotificationsBody';

// Background notifications (wallet phase 5). This page loads the state; components/NotificationsBody.tsx draws it; lib/adminAlerts.ts holds the rules.
// The per-kind switches are saved on this computer for this admin (the checks read them every round); mute lives in the desktop program (the tray menu).
export const Notifications: React.FC = () => {
  const { adminProfile } = useAdminAuth();
  const bridge = useMemo(() => getDesktopBridge(), []);
  const store = useMemo(() => storageAlertStore((() => { try { return window.localStorage; } catch { return undefined; } })()), []);
  const watchers = watchersForRole(adminProfile?.adminRole);
  const [status, setStatus] = useState<DesktopStatus | null>(null);
  const [disabled, setDisabled] = useState<WatcherId[]>([]);
  const [busy, setBusy] = useState(false);
  const [testSent, setTestSent] = useState<boolean | null>(null);

  useEffect(() => {
    if (adminProfile) setDisabled(store.loadPrefs(adminProfile.id).disabled);
  }, [adminProfile, store]);

  useEffect(() => {
    if (!bridge) return undefined;
    bridge.getStatus().then(setStatus).catch(() => setStatus(null));
    return bridge.onStatusChange(setStatus);
  }, [bridge]);

  const toggleWatcher = useCallback((id: WatcherId, on: boolean) => {
    if (!adminProfile) return;
    const next = on ? disabled.filter((d) => d !== id) : [...disabled.filter((d) => d !== id), id];
    setDisabled(next);
    store.savePrefs(adminProfile.id, { disabled: next });
  }, [adminProfile, disabled, store]);

  const mute = useCallback(async (muted: boolean, hours?: number) => {
    if (!bridge) return;
    setBusy(true);
    try {
      setStatus(await bridge.setMuted(muted, hours));
    } finally {
      setBusy(false);
    }
  }, [bridge]);

  const sendTest = useCallback(async () => {
    if (!bridge) return;
    setBusy(true);
    setTestSent(null);
    try {
      setTestSent(await bridge.sendTest());
    } catch {
      setTestSent(false);
    } finally {
      setBusy(false);
    }
  }, [bridge]);

  return (
    <NotificationsBody
      inDesktopApp={!!bridge}
      status={status}
      watchers={watchers}
      disabled={disabled}
      busy={busy}
      testSent={testSent}
      onToggleWatcher={toggleWatcher}
      onMute={(muted, hours) => void mute(muted, hours)}
      onTest={() => void sendTest()}
    />
  );
};
