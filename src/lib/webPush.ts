// WEB PUSH on the Teach screen (PM lines 68 and 77, RUN 6, 24 Nov 2026): the browser half. Everything is injected so scripts/dev/web-push-test.ts can run it without a browser.
// The "Turn on alerts" step is HIDDEN until the database setting web_push_enabled is on AND the caller is a tutor (web_push_config answers {enabled:false} otherwise): nothing here is visible today.
// What a tutor must do: Android Chrome: tap "Turn on alerts", then "Allow". iPhone (iOS 16.4 or later): first Share, "Add to Home Screen", then open Tutorlage from that icon, then the same two taps.
// A Safari tab on an iPhone never receives alerts. Delivery is never guaranteed (the phone's maker decides; some battery savers hold alerts back). The alert text lives in public/sw.js.
export interface PushDb {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message?: string } | null }>;
}

export const PUSH_COPY = {
  title: 'Alerts for new requests',
  intro: 'Get an alert on this phone when a family sends a request to you. The alert only says: "You have a new lesson request on Tutorlage. Open the app to answer." It never names the learner or the subject.',
  android: 'On an Android phone in Chrome: tap "Turn on alerts", then "Allow".',
  iphoneSteps: 'On an iPhone you first need to add Tutorlage to your Home Screen: tap Share, then "Add to Home Screen", then open Tutorlage from that new icon (iPhone with iOS 16.4 or later). Then tap "Turn on alerts" and "Allow". A Safari tab cannot receive alerts.',
  unsupported: 'This browser cannot receive alerts. You will still see new requests in the app and under the bell.',
  honest: 'Alerts are not guaranteed: some phones hold them back to save battery. The bell and your Teach screen always show every request.',
  turnOn: 'Turn on alerts',
  turnOff: 'Turn off alerts on this phone',
  denied: 'Alerts are blocked for Tutorlage in this browser. Allow notifications for this site in the browser settings, then try again.',
  failed: 'Something went wrong turning on alerts. Please try again.',
  on: 'Alerts are on for this phone.',
  switchLabel: 'Send me alerts',
  quietLabel: 'Quiet hours (no alerts at night)',
  quietNote: 'An alert that falls in your quiet hours waits until they end. The request itself stays open as normal.',
};

export interface PushEnvironment {
  hasServiceWorker: boolean;
  hasPushManager: boolean;
  hasNotification: boolean;
  isIos: boolean;
  isStandalone: boolean;
}
export type PushSupport = 'ok' | 'ios_needs_home_screen' | 'unsupported';

export function pushSupport(env: PushEnvironment): PushSupport {
  if (env.isIos && !env.isStandalone) return 'ios_needs_home_screen';
  return env.hasServiceWorker && env.hasPushManager && env.hasNotification ? 'ok' : 'unsupported';
}

export function readPushEnvironment(w: Window = window): PushEnvironment {
  const ua = w.navigator.userAgent || '';
  const isIos = /iPad|iPhone|iPod/.test(ua) || (w.navigator.platform === 'MacIntel' && (w.navigator.maxTouchPoints ?? 0) > 1);
  const standalone = (w.navigator as Navigator & { standalone?: boolean }).standalone === true || (typeof w.matchMedia === 'function' && w.matchMedia('(display-mode: standalone)').matches);
  return {
    hasServiceWorker: 'serviceWorker' in w.navigator,
    hasPushManager: 'PushManager' in w,
    hasNotification: 'Notification' in w,
    isIos,
    isStandalone: standalone,
  };
}

export interface PushConfig { enabled: boolean; publicKey: string | null }
export async function fetchPushConfig(db: PushDb): Promise<PushConfig> {
  try {
    const { data, error } = await db.rpc('web_push_config');
    const d = data as { enabled?: boolean; public_key?: string } | null;
    if (error || !d || d.enabled !== true || typeof d.public_key !== 'string' || d.public_key === '') return { enabled: false, publicKey: null };
    return { enabled: true, publicKey: d.public_key };
  } catch {
    return { enabled: false, publicKey: null };
  }
}

export interface PushSettings { alertsOn: boolean; quietOn: boolean; quietStart: number; quietEnd: number; devices: number }
export async function fetchPushSettings(db: PushDb): Promise<PushSettings | null> {
  try {
    const { data, error } = await db.rpc('my_push_settings');
    const d = data as Record<string, unknown> | null;
    if (error || !d) return null;
    return { alertsOn: d.alerts_on !== false, quietOn: d.quiet_on !== false, quietStart: Number(d.quiet_start ?? 21), quietEnd: Number(d.quiet_end ?? 7), devices: Number(d.devices ?? 0) };
  } catch {
    return null;
  }
}

export async function savePushSettings(db: PushDb, s: Omit<PushSettings, 'devices'>): Promise<string | null> {
  try {
    const { error } = await db.rpc('set_my_push_settings', { p_alerts_on: s.alertsOn, p_quiet_on: s.quietOn, p_quiet_start: s.quietStart, p_quiet_end: s.quietEnd });
    return error ? PUSH_COPY.failed : null;
  } catch {
    return PUSH_COPY.failed;
  }
}

export function keyToBytes(base64url: string): Uint8Array {
  const padded = base64url.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob(padded);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

// The browser pieces, injected.
export interface PushBrowser {
  register(): Promise<{ pushManager: { subscribe(o: { userVisibleOnly: boolean; applicationServerKey: Uint8Array }): Promise<{ endpoint: string }>; getSubscription(): Promise<{ endpoint: string; unsubscribe(): Promise<boolean> } | null> } }>;
  requestPermission(): Promise<'granted' | 'denied' | 'default'>;
}

// Only ever called from a tap on "Turn on alerts". Returns null on success, otherwise the sentence to show.
export async function turnOnAlerts(db: PushDb, browser: PushBrowser, config: PushConfig): Promise<string | null> {
  try {
    if (!config.enabled || !config.publicKey) return PUSH_COPY.failed;
    const permission = await browser.requestPermission();
    if (permission !== 'granted') return PUSH_COPY.denied;
    const reg = await browser.register();
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyToBytes(config.publicKey) });
    const { error } = await db.rpc('push_save_subscription', { p_endpoint: sub.endpoint });
    return error ? PUSH_COPY.failed : null;
  } catch {
    return PUSH_COPY.failed;
  }
}

export async function turnOffAlerts(db: PushDb, browser: PushBrowser): Promise<string | null> {
  try {
    const reg = await browser.register();
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      const endpoint = sub.endpoint;
      await sub.unsubscribe();
      const { error } = await db.rpc('push_remove_subscription', { p_endpoint: endpoint });
      if (error) return PUSH_COPY.failed;
    }
    return null;
  } catch {
    return PUSH_COPY.failed;
  }
}

export function realBrowser(w: Window = window): PushBrowser {
  return {
    register: () => w.navigator.serviceWorker.register('/sw.js').then(() => w.navigator.serviceWorker.ready) as unknown as ReturnType<PushBrowser['register']>,
    requestPermission: () => Notification.requestPermission() as Promise<'granted' | 'denied' | 'default'>,
  };
}
