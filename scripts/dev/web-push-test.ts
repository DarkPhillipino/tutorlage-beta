// Web push for a request addressed to one tutor (RUN 6, 24 Nov 2026). Run: npx --no-install tsx scripts/dev/web-push-test.ts
// No network, no browser: a fake push service and a fake database. Made-up keys only (generated here, never written anywhere).
import fs from 'node:fs';
import { generateKeyPairSync } from 'node:crypto';
import { runPushAlerts, sendEmptyPush, vapidToken, type PushClaimRow, type VapidConfig } from '../../server/webPush';
import { PUSH_COPY, fetchPushConfig, keyToBytes, pushSupport, turnOffAlerts, turnOnAlerts, type PushBrowser, type PushDb } from '../../src/lib/webPush';

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
};
const read = (p: string) => fs.readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const b64u = (b: Buffer | Uint8Array) => Buffer.from(b).toString('base64url');

const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const jwk = privateKey.export({ format: 'jwk' }) as { d: string; x: string; y: string };
const publicKey = b64u(Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]));
const cfg: VapidConfig = { privateKey: jwk.d, publicKey, subject: 'https://tutorlage.com' };
const NOW = 1_800_000_000;

async function main() {
  // --- the token ---
  const token = await vapidToken('https://fcm.example.invalid/wpush/abc', cfg, NOW);
  const [h, c, sig] = token.split('.');
  const header = JSON.parse(Buffer.from(h, 'base64url').toString());
  const claims = JSON.parse(Buffer.from(c, 'base64url').toString());
  check('T1 the token is an ES256 JWT for the push service origin, 12 hours, with our site as the contact', header.alg === 'ES256' && claims.aud === 'https://fcm.example.invalid' && claims.exp === NOW + 43200 && claims.sub === 'https://tutorlage.com');
  const pubKey = await crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y, ext: true }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  const valid = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pubKey, Buffer.from(sig, 'base64url'), new TextEncoder().encode(`${h}.${c}`));
  check('T2 the signature verifies with the PUBLIC key and is 64 raw bytes', valid && Buffer.from(sig, 'base64url').length === 64);
  let badKeyRefused = false;
  try { await vapidToken('https://x.example.invalid/a', { ...cfg, publicKey: 'AAAA' }, NOW); } catch { badKeyRefused = true; }
  check('T3 a wrong public key is refused', badKeyRefused);

  // --- one push ---
  const seen: { url: string; init: { method: string; headers: Record<string, string> } }[] = [];
  const pushService = (status: number) => async (url: string, init: { method: string; headers: Record<string, string> }) => { seen.push({ url, init }); return { status }; };
  check('S1 201 is sent, 410 and 404 are gone, 429 and 500 are failed', (await sendEmptyPush('https://p.example.invalid/1', cfg, pushService(201), NOW)) === 'sent' && (await sendEmptyPush('https://p.example.invalid/1', cfg, pushService(410), NOW)) === 'gone' && (await sendEmptyPush('https://p.example.invalid/1', cfg, pushService(404), NOW)) === 'gone' && (await sendEmptyPush('https://p.example.invalid/1', cfg, pushService(429), NOW)) === 'failed' && (await sendEmptyPush('https://p.example.invalid/1', cfg, pushService(500), NOW)) === 'failed');
  const first = seen[0];
  check('S2 the push is an EMPTY POST (no body, length 0), authorised with vapid t= and k=, held at most an hour', first.init.method === 'POST' && !('body' in first.init) && first.init.headers['Content-Length'] === '0' && /^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=/.test(first.init.headers.Authorization) && first.init.headers.TTL === '3600');
  check('S3 a network error is a failed device, not a crash', (await sendEmptyPush('https://p.example.invalid/1', cfg, async () => { throw new Error('offline'); }, NOW)) === 'failed');

  // --- the run ---
  const rows: PushClaimRow[] = [
    { notification_id: 'n1', subscription_id: 's1', endpoint: 'https://p.example.invalid/phone1' },
    { notification_id: 'n1', subscription_id: 's2', endpoint: 'https://p.example.invalid/gone' },
    { notification_id: 'n2', subscription_id: 's3', endpoint: 'https://p.example.invalid/phone2' },
  ];
  const logs: string[] = [];
  const finished: string[] = [];
  const dropped: string[] = [];
  let claims_ = 0;
  const summary = await runPushAlerts({
    config: () => cfg,
    claim: async () => (claims_++ === 0 ? rows : []),
    finish: async (id, ok, failed) => { finished.push(`${id}:${ok}/${failed}`); },
    drop: async (id) => { dropped.push(id); },
    send: async (endpoint) => (endpoint.endsWith('gone') ? 'gone' : 'sent'),
    log: (l) => logs.push(l),
  });
  check('R1 two alerts, two phones sent, one gone and dropped, each alert finished with its own counts', summary.alerts === 2 && summary.devicesSent === 2 && summary.devicesGone === 1 && dropped.join() === 's2' && finished.join() === 'n1:1/1,n2:1/0');
  check('R2 the log has counts only: no address, no key, no id', logs.length === 1 && /^push: \d+ alert\(s\), \d+ device\(s\) sent, \d+ failed \(\d+ gone\)$/.test(logs[0]));
  let claimedWhenUnset = 0;
  const unset = await runPushAlerts({ config: () => null, claim: async () => { claimedWhenUnset += 1; return rows; }, finish: async () => undefined, drop: async () => undefined, send: async () => 'sent', log: () => undefined });
  check('R3 without the keys nothing is claimed (the alerts wait)', unset.configured === false && claimedWhenUnset === 0);
  const crash = await runPushAlerts({ config: () => cfg, claim: async () => (claimedWhenUnset++ === 0 ? [rows[0]] : []), finish: async () => { throw new Error('db down'); }, drop: async () => undefined, send: async () => 'sent', log: () => undefined });
  check('R4 a failing report-back does not stop the run', crash.alerts === 1);

  // --- the browser half ---
  const calls: string[] = [];
  const db = (reply: unknown, error: { message?: string } | null = null): PushDb => ({ rpc: async (fn, args) => { calls.push(`${fn}${args ? JSON.stringify(args) : ''}`); return { data: reply, error }; } });
  check('B1 setting off or not a tutor: the card gets enabled false', (await fetchPushConfig(db({ enabled: false }))).enabled === false && (await fetchPushConfig(db(null, { message: 'x' }))).enabled === false && (await fetchPushConfig(db({ enabled: true }))).enabled === false);
  const cfgOn = await fetchPushConfig(db({ enabled: true, public_key: publicKey }));
  check('B2 setting on: enabled with the public key', cfgOn.enabled && cfgOn.publicKey === publicKey);
  check('B3 the public key decodes to 65 bytes', keyToBytes(publicKey).length === 65);
  let registered = 0;
  let asked = 0;
  const browser = (perm: 'granted' | 'denied' | 'default'): PushBrowser => ({
    requestPermission: async () => { asked += 1; return perm; },
    register: async () => { registered += 1; return { pushManager: { subscribe: async (o) => { calls.push(`subscribe:${o.userVisibleOnly}:${o.applicationServerKey.length}`); return { endpoint: 'https://p.example.invalid/mine' }; }, getSubscription: async () => ({ endpoint: 'https://p.example.invalid/mine', unsubscribe: async () => true }) } }; },
  });
  calls.length = 0;
  const okResult = await turnOnAlerts(db(null), browser('granted'), cfgOn);
  check('B4 turn on: asks permission, registers, subscribes (user-visible, 65-byte key) and saves ONLY the address', okResult === null && asked === 1 && registered === 1 && calls.join('|') === 'subscribe:true:65|push_save_subscription{"p_endpoint":"https://p.example.invalid/mine"}');
  const before = registered;
  const denied = await turnOnAlerts(db(null), browser('denied'), cfgOn);
  check('B5 permission refused: an honest line and no service worker registered', denied === PUSH_COPY.denied && registered === before);
  check('B6 setting off: nothing happens (no permission request)', (await turnOnAlerts(db(null), browser('granted'), { enabled: false, publicKey: null })) === PUSH_COPY.failed && asked === 2);
  calls.length = 0;
  check('B7 turn off removes the address', (await turnOffAlerts(db(null), browser('granted'))) === null && calls.join('|') === 'push_remove_subscription{"p_endpoint":"https://p.example.invalid/mine"}');
  const env = { hasServiceWorker: true, hasPushManager: true, hasNotification: true, isIos: false, isStandalone: false };
  check('B8 Android Chrome: ok; iPhone in Safari: add to Home Screen first; iPhone from the Home Screen icon: ok; an old browser: unsupported', pushSupport(env) === 'ok' && pushSupport({ ...env, isIos: true }) === 'ios_needs_home_screen' && pushSupport({ ...env, isIos: true, isStandalone: true }) === 'ok' && pushSupport({ ...env, hasPushManager: false }) === 'unsupported');

  // --- what is written down ---
  const sw = read('public/sw.js');
  check('W1 the one alert text, exactly, and nothing else is ever shown', sw.includes("'You have a new lesson request on Tutorlage. Open the app to answer.'") && !/event\.data|\.json\(|\.text\(\)/.test(sw));
  const card = read('src/components/TurnOnAlertsCard.tsx');
  check('W2 the card renders nothing unless the setting is on', /if \(!config\?\.enabled \|\| !settings\) return null;/.test(card) && !/serviceWorker|requestPermission/.test(card.split('const on = ')[0]));
  check('W3 the service worker is registered only inside the tap handler path (turnOnAlerts), never on page load', !/serviceWorker/.test(read('src/main.tsx')) && !/serviceWorker\.register/.test(read('src/App.tsx')) && /serviceWorker\.register/.test(read('src/lib/webPush.ts')));
  const copy = JSON.stringify(PUSH_COPY) + read('src/components/TurnOnAlertsCard.tsx') + sw;
  check('W4 none of the banned words is in anything a tutor sees', !/\bfree\b|instant|wallet|vetted|certified|background-check/i.test(copy));
  check('W5 the honest wording is there: Android Allow, iPhone Add to Home Screen, not guaranteed', /Allow/.test(PUSH_COPY.android) && /Add to Home Screen/.test(PUSH_COPY.iphoneSteps) && /not guaranteed/.test(PUSH_COPY.honest));
  const srv = read('server/index.ts') + read('server/webPush.ts');
  check('W6 no private key value or key file is in the repository files this change touches', !/vapid-private-key|BEGIN (EC )?PRIVATE KEY/.test(srv + read('public/sw.js') + read('supabase/migrations/20261125100000_web_push.sql')) && /process\.env\.VAPID_PRIVATE_KEY/.test(srv));
  const sql = read('supabase/migrations/20261125100000_web_push.sql');
  check('W7 the migration ships the switch OFF, no worker address and no payload columns', /'web_push_enabled', 'false'::jsonb/.test(sql) && /'web_push_worker_url', '""'::jsonb/.test(sql) && !/\bbody\b.*push_outbox|payload/i.test(sql.replace(/--.*$/gm, '')));

  console.log(failures ? `\n${failures} FAILED` : '\nall checks passed');
  process.exit(failures ? 1 : 0);
}
main();
