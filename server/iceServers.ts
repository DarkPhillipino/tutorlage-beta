// Connection settings ("ICE servers") handed to people in a video room (master backlog 7bm; proposal
// Drake/programmer/relay-hosting-proposal.md). Kept apart from index.ts so it can be tested with a fake fetch
// (scripts/dev/ice-servers-test.ts).
//
// Two relays are supported and may be used together:
//   - Cloudflare's relay (Realtime TURN): credentials are made by Cloudflare's API from a TURN key (a long-term
//     secret kept on the server), so nothing to rent or run. Free up to 1,000 GB a month, then US$0.05/GB.
//   - Our own relay (coturn on a rented server): coturn's shared-secret scheme, no call to anyone.
// If both are set, ours is listed first (browsers generally prefer earlier servers; to confirm in testing) and
// Cloudflare's follows as the fallback, so one failing doesn't stop the call.
import crypto from 'node:crypto';

export interface IceServer {
  urls: string[];
  username?: string;
  credential?: string;
}

export interface IceConfig {
  // Public STUN, used only when Cloudflare's relay isn't configured (Cloudflare's own STUN comes with its relay).
  // A STUN server sees callers' addresses.
  stunUrls: string[];
  // Our own relay: its addresses and the shared secret it was started with.
  coturn: { urls: string[]; secret: string } | null;
  // Cloudflare's relay: the TURN key's id and its API token.
  cloudflare: { keyId: string; apiToken: string } | null;
  // How long a credential lives. It must outlast the longest call: the relay checks it again when the call's
  // allocation is renewed, so an expired credential ends the call. Rooms last at most 4 hours.
  ttlSeconds: number;
}

type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

const list = (value: string | undefined) =>
  (value ?? '')
    .split(',')
    .map((u) => u.trim())
    .filter(Boolean);

export function iceConfigFromEnv(env: Record<string, string | undefined>): IceConfig {
  const turnUrls = list(env.TURN_URLS);
  const keyId = env.CF_TURN_KEY_ID?.trim();
  const apiToken = env.CF_TURN_API_TOKEN?.trim();
  return {
    stunUrls: list(env.STUN_URLS ?? 'stun:stun.l.google.com:19302'),
    coturn: turnUrls.length > 0 && env.TURN_SECRET ? { urls: turnUrls, secret: env.TURN_SECRET } : null,
    cloudflare: keyId && apiToken ? { keyId, apiToken } : null,
    ttlSeconds: Number(env.TURN_TTL_SECONDS) || 14_400,
  };
}

// Is any relay set up at all? (A room that hides addresses can't work without one.)
export const relayConfigured = (config: IceConfig) => Boolean(config.coturn || config.cloudflare);

// Did a relay with credentials actually come back?
export const hasRelay = (servers: IceServer[]) => servers.some((s) => Boolean(s.username && s.credential));

// Cloudflare lists port 53 alternates that browsers time out on, and its own docs say not to rely on them.
const PORT_53 = /:53(\?|$)/;

async function cloudflareServers(
  cloudflare: { keyId: string; apiToken: string },
  ttlSeconds: number,
  relayOnly: boolean,
  fetchImpl: FetchLike,
): Promise<IceServer[]> {
  try {
    const response = await fetchImpl(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(cloudflare.keyId)}/credentials/generate-ice-servers`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${cloudflare.apiToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ttl: ttlSeconds }),
      },
    );
    if (!response.ok) {
      console.error('Video rooms: Cloudflare could not make relay credentials, status', response.status);
      return [];
    }
    const body = (await response.json()) as { iceServers?: unknown };
    const entries = Array.isArray(body?.iceServers) ? body.iceServers : [];
    const servers: IceServer[] = [];
    for (const entry of entries) {
      const e = entry as { urls?: unknown; username?: unknown; credential?: unknown };
      const urls = (Array.isArray(e.urls) ? e.urls : typeof e.urls === 'string' ? [e.urls] : []).filter(
        (u): u is string => typeof u === 'string' && !PORT_53.test(u) && (!relayOnly || /^turns?:/i.test(u)),
      );
      if (urls.length === 0) continue;
      if (typeof e.username === 'string' && typeof e.credential === 'string') {
        servers.push({ urls, username: e.username, credential: e.credential });
      } else if (!relayOnly) {
        servers.push({ urls });
      }
    }
    return servers;
  } catch (error) {
    console.error('Video rooms: Cloudflare relay credentials could not be fetched', error);
    return [];
  }
}

// The settings for one admitted person. A room that hides addresses gets no STUN, only relays. Never returns
// the Cloudflare API token or our shared secret: only short-lived credentials made from them.
export async function iceServersFor(
  config: IceConfig,
  relayOnly: boolean,
  fetchImpl: FetchLike = fetch,
  nowMs: number = Date.now(),
): Promise<IceServer[]> {
  const servers: IceServer[] = [];
  if (config.coturn) {
    // coturn's shared-secret scheme: username "<expiry>:<label>", credential the base64 HMAC-SHA1 of the username.
    // The label is random, so the relay's logs never hold a profile id.
    const username = `${Math.floor(nowMs / 1000) + config.ttlSeconds}:${crypto.randomUUID()}`;
    const credential = crypto.createHmac('sha1', config.coturn.secret).update(username).digest('base64');
    servers.push({ urls: config.coturn.urls, username, credential });
  }
  if (config.cloudflare) {
    servers.push(...(await cloudflareServers(config.cloudflare, config.ttlSeconds, relayOnly, fetchImpl)));
  } else if (!relayOnly && config.stunUrls.length > 0) {
    servers.push({ urls: config.stunUrls });
  }
  return servers;
}
