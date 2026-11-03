// What the installed Windows app (admin/desktop) hands to the admin pages: a small bridge on `window.tutorlageDesktop`, put there by the desktop app's
// preload.cjs. In a normal browser (npm run dev, port 3100) there is NO bridge and everything here quietly does nothing; the pages must work the same.
//
// Three things cross the bridge, and only these:
//  1. SECURE STORAGE for the admin's sign-in. The sign-in session (supabase-js's tokens) used to sit in the page's own storage on disk in plain text. In the
//     installed app it is kept by the desktop program instead, encrypted with Windows (Electron safeStorage, tied to the Windows user). No password or key
//     is ever written in plain text. The session is moved over from the old storage the first time (the admin stays signed in).
//  2. NOTIFICATIONS: the page asks the desktop program to show a Windows notification (title, text, page to open) and is told when one is clicked.
//  3. MUTE: the tray menu's mute switch lives in the desktop program; the page asks before it checks, and the Notifications page can switch it.
import type { Toast } from './adminAlerts';

export interface DesktopStatus {
  muted: boolean;
  mutedUntil: number | null;     // ms since 1970 when a timed mute ends; null = until switched back on
  autostart: boolean;            // starts with Windows
  notificationsSupported: boolean;
}

export interface DesktopBridge {
  secureStorage: {
    getItem(key: string): Promise<string | null>;
    setItem(key: string, value: string): Promise<boolean>;
    removeItem(key: string): Promise<boolean>;
  };
  notify(toast: Toast): Promise<boolean>;
  isMuted(): Promise<boolean>;
  getStatus(): Promise<DesktopStatus>;
  setMuted(muted: boolean, hours?: number): Promise<DesktopStatus>;
  sendTest(): Promise<boolean>;
  onNavigate(callback: (route: string) => void): () => void;
  onCheckNow(callback: () => void): () => void;
  onStatusChange(callback: (status: DesktopStatus) => void): () => void;
}

declare global {
  interface Window {
    tutorlageDesktop?: DesktopBridge;
  }
}

export function getDesktopBridge(): DesktopBridge | null {
  try {
    return typeof window !== 'undefined' && window.tutorlageDesktop ? window.tutorlageDesktop : null;
  } catch {
    return null;
  }
}

// The same three methods supabase-js wants from `auth.storage`, backed by the desktop program's encrypted store.
//  - a copy is kept in memory, so if the encrypted store cannot be written the session still lasts until the app is quit (never written to disk in plain text);
//  - the first read moves a session found in the page's old plain storage into the encrypted store and removes the old copy.
interface PlainStorage { getItem(key: string): string | null; removeItem(key: string): void }
export function secureAuthStorage(bridge: Pick<DesktopBridge, 'secureStorage'>, legacy?: PlainStorage) {
  const memory = new Map<string, string>();
  return {
    async getItem(key: string): Promise<string | null> {
      if (memory.has(key)) return memory.get(key) ?? null;
      let value: string | null = null;
      try {
        value = await bridge.secureStorage.getItem(key);
      } catch {
        value = null;
      }
      if (value === null && legacy) {
        try {
          const old = legacy.getItem(key);
          if (old) {
            if (await bridge.secureStorage.setItem(key, old)) legacy.removeItem(key);
            value = old;
          }
        } catch {
          // the old storage is not readable: nothing to move
        }
      }
      if (value !== null) memory.set(key, value);
      return value;
    },
    async setItem(key: string, value: string): Promise<void> {
      memory.set(key, value);
      try {
        await bridge.secureStorage.setItem(key, value);
      } catch {
        // kept in memory only until the app is quit
      }
    },
    async removeItem(key: string): Promise<void> {
      memory.delete(key);
      try {
        await bridge.secureStorage.removeItem(key);
      } catch {
        // already gone, or not writable
      }
    },
  };
}

// A sign-out the admin chose (the button in the menu) must not look like a lapsed sign-in. AuthContext.signOut() leaves this mark.
let manualSignOutAt = 0;
export const noteManualSignOut = (now = Date.now()): void => { manualSignOutAt = now; };
export const wasManualSignOut = (now = Date.now()): boolean => now - manualSignOutAt < 60_000;
