// Test of server/iceServers.ts (master backlog 7bm) with fake Cloudflare responses: no network, no keys.
// Run: npx tsx scripts/dev/ice-servers-test.ts   (exits 1 if any check fails)
import crypto from 'node:crypto';
import { hasRelay, iceConfigFromEnv, iceServersFor, relayConfigured } from '../../server/iceServers';
import type { IceConfig, IceServer } from '../../server/iceServers';

let failed = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) failed += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ' - ' + detail : ''}`);
};

const NOW = 1_800_000_000_000;
const SECRET = 'shared-secret-for-test';
const TOKEN = 'cf-api-token-for-test-do-not-leak';

// What Cloudflare returns (shape from its docs), including the port 53 alternates browsers time out on.
const cloudflareBody = {
  iceServers: [
    { urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.cloudflare.com:53'] },
    {
      urls: [
        'turn:turn.cloudflare.com:3478?transport=udp',
        'turn:turn.cloudflare.com:53?transport=udp',
        'turn:turn.cloudflare.com:80?transport=tcp',
        'turns:turn.cloudflare.com:5349?transport=tcp',
        'turns:turn.cloudflare.com:443?transport=tcp',
      ],
      username: 'cf-user',
      credential: 'cf-pass',
    },
  ],
};

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
}
const okFetch = (calls: Call[]) => async (url: string, init: { method: string; headers: Record<string, string>; body: string }) => {
  calls.push({ url, ...init });
  return { ok: true, status: 201, json: async () => cloudflareBody };
};
const failingFetch = async () => ({ ok: false, status: 403, json: async () => ({}) });
const throwingFetch = async (): Promise<never> => {
  throw new Error('network down');
};

const base: IceConfig = {
  stunUrls: ['stun:stun.l.google.com:19302'],
  coturn: null,
  cloudflare: null,
  ttlSeconds: 14_400,
};
const urlsOf = (servers: IceServer[]) => servers.flatMap((s) => s.urls);

async function main() {
  // T1: our own relay only
  {
    const config = { ...base, coturn: { urls: ['turns:turn.tutorlage.com:443?transport=tcp', 'turn:turn.tutorlage.com:3478'], secret: SECRET } };
    const open = await iceServersFor(config, false, failingFetch, NOW);
    const hidden = await iceServersFor(config, true, failingFetch, NOW);
    const turn = open[0];
    const [expiry, label] = (turn.username ?? '').split(':');
    const expected = crypto.createHmac('sha1', SECRET).update(turn.username ?? '').digest('base64');
    check('T1a own relay: username is <expiry>:<random label>, expiry = now + ttl', Number(expiry) === NOW / 1000 + 14_400 && label.length === 36, turn.username);
    check('T1b own relay: credential is the base64 HMAC-SHA1 of the username (coturn shared-secret scheme)', turn.credential === expected);
    check('T1c own relay: the label is not a profile id and differs on every call', (await iceServersFor(config, false, failingFetch, NOW))[0].username !== turn.username);
    check('T1d own relay, open room: public STUN is added after ours', open.length === 2 && open[1].urls[0].startsWith('stun:'));
    check('T1e own relay, address-hiding room: only the relay, no STUN', hidden.length === 1 && hasRelay(hidden));
  }

  // T2: Cloudflare only
  {
    const calls: Call[] = [];
    const config = { ...base, cloudflare: { keyId: 'KEY123', apiToken: TOKEN } };
    const open = await iceServersFor(config, false, okFetch(calls), NOW);
    const hidden = await iceServersFor(config, true, okFetch(calls), NOW);
    const first = calls[0];
    check(
      'T2a asks Cloudflare for credentials: POST, the key id in the URL, the token as Bearer, the ttl in the body',
      first.method === 'POST' &&
        first.url === 'https://rtc.live.cloudflare.com/v1/turn/keys/KEY123/credentials/generate-ice-servers' &&
        first.headers.Authorization === `Bearer ${TOKEN}` &&
        JSON.parse(first.body).ttl === 14_400,
    );
    check('T2b open room: Cloudflare STUN and relay both kept, port 53 dropped', urlsOf(open).every((u) => !/:53(\?|$)/.test(u)) && urlsOf(open).some((u) => u.startsWith('stun:')) && hasRelay(open));
    check('T2c open room: our default public STUN is not used when Cloudflare is', !urlsOf(open).some((u) => u.includes('google')));
    check('T2d address-hiding room: only turn: and turns: addresses, with credentials, no STUN', urlsOf(hidden).length === 4 && urlsOf(hidden).every((u) => /^turns?:/.test(u)) && hasRelay(hidden), urlsOf(hidden).join(' '));
    check('T2e the Cloudflare API token is never in what is handed to people', !JSON.stringify([open, hidden]).includes(TOKEN));
  }

  // T3: both: ours first, Cloudflare's as the fallback
  {
    const config = { ...base, coturn: { urls: ['turns:turn.tutorlage.com:443'], secret: SECRET }, cloudflare: { keyId: 'K', apiToken: TOKEN } };
    const servers = await iceServersFor(config, true, okFetch([]), NOW);
    check('T3 both relays: ours is listed first, Cloudflare second', servers.length === 2 && servers[0].urls[0].includes('tutorlage.com') && servers[1].username === 'cf-user');
  }

  // T4: Cloudflare fails
  {
    const cfOnly = { ...base, cloudflare: { keyId: 'K', apiToken: TOKEN } };
    const both = { ...cfOnly, coturn: { urls: ['turns:turn.tutorlage.com:443'], secret: SECRET } };
    const a = await iceServersFor(cfOnly, true, failingFetch, NOW);
    const b = await iceServersFor(cfOnly, true, throwingFetch, NOW);
    const c = await iceServersFor(both, true, failingFetch, NOW);
    check('T4a Cloudflare refuses (403), no other relay: no relay comes back (the route answers 503)', !hasRelay(a));
    check('T4b Cloudflare unreachable (fetch throws), no other relay: no relay and no crash', !hasRelay(b));
    check('T4c Cloudflare fails but our own relay is set: the call still gets ours', hasRelay(c) && c.length === 1);
  }

  // T5: nothing configured
  {
    const open = await iceServersFor(base, false, failingFetch, NOW);
    const hidden = await iceServersFor(base, true, failingFetch, NOW);
    check('T5a no relay, open room: public STUN only', open.length === 1 && !hasRelay(open));
    check('T5b no relay, address-hiding room: nothing (the route answers 503)', hidden.length === 0);
  }

  // T6: reading the settings
  {
    const empty = iceConfigFromEnv({});
    const full = iceConfigFromEnv({
      STUN_URLS: 'stun:a:1, stun:b:2',
      TURN_URLS: 'turns:x:443 , turn:x:3478',
      TURN_SECRET: 's',
      CF_TURN_KEY_ID: ' kid ',
      CF_TURN_API_TOKEN: ' tok ',
      TURN_TTL_SECONDS: '7200',
    });
    check('T6a nothing set: default public STUN, no relay, 4-hour credentials', empty.stunUrls.length === 1 && !relayConfigured(empty) && empty.ttlSeconds === 14_400);
    check(
      'T6b everything set: lists trimmed, both relays on, ttl read',
      full.stunUrls.join() === 'stun:a:1,stun:b:2' && full.coturn?.urls.length === 2 && full.cloudflare?.keyId === 'kid' && full.cloudflare?.apiToken === 'tok' && full.ttlSeconds === 7200 && relayConfigured(full),
    );
    check('T6c half set (a relay address without the secret, a key id without the token): not counted as configured', !relayConfigured(iceConfigFromEnv({ TURN_URLS: 'turn:x', CF_TURN_KEY_ID: 'k' })));
  }

  console.log(failed === 0 ? '\nALL OK' : `\n${failed} FAILED`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
