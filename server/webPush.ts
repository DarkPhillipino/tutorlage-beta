// WEB PUSH SENDER for a request addressed to one tutor (PM lines 68 and 77, RUN 6, 24 Nov 2026). Costs nothing per message (no SMS, no WhatsApp).
//
// The push carries NO PAYLOAD: an empty message is sent to the tutor's phone and the service worker (public/sw.js) shows the fixed words "You have a new lesson request on
// Tutorlage. Open the app to answer." So there is no encryption to get wrong and no learner, subject or family detail can ever travel through the phone maker's push service.
// What this file does: signs a VAPID token (ES256, WebCrypto: works on Cloudflare Workers), POSTs one empty message to each device address the database hands over, tells the database how
// it went and drops devices the push service says are gone (404 or 410). It logs COUNTS only (never an address, a name or a key).
// The database decides everything else (setting web_push_enabled, her switch, her quiet hours, the daily cap, once per alert): supabase/migrations/20261125100000_web_push.sql.
// Secrets (Worker secrets, set by the CEO, NEVER in a repository): VAPID_PRIVATE_KEY (the raw 32-byte private value, base64url), PUSH_JOB_SECRET (the same value as the Vault secret push_job_secret).
// Plain variables: VAPID_PUBLIC_KEY (the public key, base64url, 65 bytes) and VAPID_SUBJECT (defaults to https://tutorlage.com).

export interface PushClaimRow { notification_id: string; subscription_id: string; endpoint: string }

export interface VapidConfig { privateKey: string; publicKey: string; subject: string }

const b64u = {
  encode(bytes: Uint8Array): string {
    let s = '';
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  },
  decode(text: string): Uint8Array {
    const padded = text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4);
    const raw = atob(padded);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
    return out;
  },
};
const utf8 = (s: string) => new TextEncoder().encode(s);

// The VAPID token for one push service (aud = the origin of the device address), valid for 12 hours at most (the standard allows 24).
export async function vapidToken(endpoint: string, cfg: VapidConfig, nowSeconds: number): Promise<string> {
  const aud = new URL(endpoint).origin;
  const pub = b64u.decode(cfg.publicKey);
  if (pub.length !== 65 || pub[0] !== 4) throw new Error('The public key is not a 65-byte uncompressed P-256 key');
  const key = await crypto.subtle.importKey(
    'jwk',
    { kty: 'EC', crv: 'P-256', d: cfg.privateKey, x: b64u.encode(pub.slice(1, 33)), y: b64u.encode(pub.slice(33, 65)), ext: true },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  const header = b64u.encode(utf8(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64u.encode(utf8(JSON.stringify({ aud, exp: nowSeconds + 12 * 3600, sub: cfg.subject })));
  const signature = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, utf8(`${header}.${claims}`)));
  return `${header}.${claims}.${b64u.encode(signature)}`;
}

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string> }) => Promise<{ status: number }>;
export type DeviceResult = 'sent' | 'gone' | 'failed';

// One empty push. 201 (and any 2xx) = accepted by the push service; 404 and 410 = the device no longer exists; anything else = failed (a later alert may still work).
export async function sendEmptyPush(endpoint: string, cfg: VapidConfig, doFetch: FetchLike, nowSeconds: number): Promise<DeviceResult> {
  try {
    const jwt = await vapidToken(endpoint, cfg, nowSeconds);
    const res = await doFetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `vapid t=${jwt}, k=${cfg.publicKey}`,
        // The alert is useless an hour later (the request lives 48 hours, the bell still shows it): the push service drops it after 1 hour.
        TTL: '3600',
        Urgency: 'high',
        'Content-Length': '0',
      },
    });
    if (res.status >= 200 && res.status < 300) return 'sent';
    if (res.status === 404 || res.status === 410) return 'gone';
    return 'failed';
  } catch {
    return 'failed';
  }
}

export interface PushRunDeps {
  // Is the sender configured (private key + public key)? If not, nothing is claimed and the alerts wait.
  config: () => VapidConfig | null;
  claim: (limit: number) => Promise<PushClaimRow[]>;
  finish: (notificationId: string, ok: number, failed: number) => Promise<void>;
  drop: (subscriptionId: string) => Promise<void>;
  send: (endpoint: string, cfg: VapidConfig) => Promise<DeviceResult>;
  log: (line: string) => void;
}

export interface PushRunSummary { configured: boolean; alerts: number; devicesSent: number; devicesFailed: number; devicesGone: number }

export async function runPushAlerts(deps: PushRunDeps, opts: { rounds?: number; limit?: number } = {}): Promise<PushRunSummary> {
  const total: PushRunSummary = { configured: true, alerts: 0, devicesSent: 0, devicesFailed: 0, devicesGone: 0 };
  const cfg = deps.config();
  if (!cfg) {
    total.configured = false;
    deps.log('push: the sender is not set up (VAPID_PRIVATE_KEY, VAPID_PUBLIC_KEY); nothing claimed, the alerts wait');
    return total;
  }
  for (let round = 0; round < (opts.rounds ?? 3); round += 1) {
    const rows = await deps.claim(opts.limit ?? 20);
    if (rows.length === 0) break;
    const byAlert = new Map<string, PushClaimRow[]>();
    for (const row of rows) byAlert.set(row.notification_id, [...(byAlert.get(row.notification_id) ?? []), row]);
    for (const [notificationId, devices] of byAlert) {
      let ok = 0;
      let failed = 0;
      for (const d of devices) {
        const result = await deps.send(d.endpoint, cfg);
        if (result === 'sent') ok += 1;
        else {
          failed += 1;
          if (result === 'gone') {
            total.devicesGone += 1;
            try { await deps.drop(d.subscription_id); } catch { /* the device is dropped at the next failed send */ }
          }
        }
      }
      total.alerts += 1;
      total.devicesSent += ok;
      total.devicesFailed += failed;
      try {
        await deps.finish(notificationId, ok, failed);
      } catch {
        // the alert stays "claimed": counted against the day and never sent twice
      }
    }
  }
  deps.log(`push: ${total.alerts} alert(s), ${total.devicesSent} device(s) sent, ${total.devicesFailed} failed (${total.devicesGone} gone)`);
  return total;
}
