// Video rooms on our own WebRTC (master backlog 7bm; design: Drake/programmer/video-rooms-design-v2.md).
// The calls below talk to our own API (server/index.ts, "Video rooms"), which decides who may be in a room. The
// audio and video go between the browsers (src/lib/roomCall.ts); nothing here carries them.
import { apiUrl, authHeaders } from './api';
import { siteUrl } from './siteUrl';

export interface IceServer {
  urls: string[];
  username?: string;
  credential?: string;
}

export type MemberStatus = 'waiting' | 'admitted' | 'removed' | 'left';

// What the heartbeat answers: the person's place in the room as the database sees it. 'superseded': a newer visit by the
// same person (another tab or device) holds the place, so this page must stop.
export type HeartbeatStatus = MemberStatus | 'superseded';

export interface RoomJoin {
  roomId: string;
  code: string;
  status: 'waiting' | 'admitted';
  isHost: boolean;
  maxParticipants: number;
  relayOnly: boolean;
  sessionId: string | null;
  // The private Realtime channel that carries the connection set-up messages.
  channel: string;
  // Only filled for people who are in the call.
  iceServers: IceServer[];
  // May this person's own camera be used? Only an adult's (server/cameraRule.ts). Read with `cameraIsAllowed`, never as
  // `!== false`: anything but a clear yes means no camera, so a child is never filmed because an answer was missing.
  cameraAllowed?: boolean;
}

export interface RoomPerson {
  id: string;
  name: string;
  status: MemberStatus;
  isHost: boolean;
  // false for a learner under 18: nobody shows their video (see `cameraIsAllowed`).
  cameraAllowed?: boolean;
}

export interface RoomState {
  roomId: string;
  status: MemberStatus;
  isHost: boolean;
  maxParticipants: number;
  relayOnly: boolean;
  cameraAllowed?: boolean;
  participants: RoomPerson[];
  iceServers: IceServer[];
}

// The camera rule on the page's side: a camera is used, and a person's video shown, only when the server said yes.
export const cameraIsAllowed = (answer: { cameraAllowed?: boolean } | null | undefined): boolean => answer?.cameraAllowed === true;

// One of a tutor's own open rooms (not a session room).
export interface MyRoom {
  code: string;
  maxParticipants: number;
  relayOnly: boolean;
  createdAt: string;
  expiresAt: string;
  inRoom: number;
}

// An answer from the rooms API, with the plain-language message it sent and its HTTP status.
export class RoomError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'RoomError';
    this.status = status;
  }
}

// The sign-in headers of the last call, kept so a "leave" can still be sent in the moment a tab closes, when there is
// no time to ask Supabase for the session again.
let lastHeaders: Record<string, string> | null = null;

async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    const headers = await authHeaders();
    lastHeaders = headers;
    response = await fetch(apiUrl(path), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Sign in')) throw new RoomError(error.message, 401);
    throw new RoomError('Could not reach Tutorlage. Check your connection and try again.', 0);
  }
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const message = (payload as { error?: string } | null)?.error ?? 'Something went wrong with the room.';
    throw new RoomError(message, response.status);
  }
  return payload as T;
}

// A random id for one visit to a room page. Sent with join, heartbeat and leave so a newer tab or device of the same
// person takes the place over, and a late "leave" from an older tab changes nothing.
export function newVisitId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// A tutor opens a room (2 to 4 people) and gets its code.
export const createRoom = (maxParticipants = 4) => call<{ code: string }>('POST', '/api/rooms', { maxParticipants });

// The tutor's own open rooms, so a lost link can be found again.
export const myRooms = () => call<{ rooms: MyRoom[] }>('GET', '/api/rooms/mine').then((answer) => answer.rooms);

// Enter a room from its link's code. Everyone but the host waits in the lobby until let in. `visit`: this page's id.
export const joinRoom = (code: string, visit?: string) =>
  call<RoomJoin>('POST', `/api/rooms/${encodeURIComponent(code)}/join`, { visit });

// Find or make a booked session's own room and get its code (its tutor, learner or the learner's guardian only; from 15
// minutes before the start). The page then goes to /room/<code>, which joins it.
export const openSessionRoom = (sessionId: string) =>
  call<{ code: string }>('POST', `/api/rooms/session/${encodeURIComponent(sessionId)}/open`);

// When a booked session's room can be opened, by the same rule the database applies: from 15 minutes before the start
// until an hour after it should have ended. This only decides what to show; the server decides for real.
export function sessionRoomWindow(
  scheduledStart: string,
  durationHours: number,
  now: number = Date.now(),
): 'early' | 'open' | 'over' {
  const start = new Date(scheduledStart).getTime();
  if (Number.isNaN(start)) return 'over';
  if (now < start - 15 * 60_000) return 'early';
  if (now > start + durationHours * 3_600_000 + 3_600_000) return 'over';
  return 'open';
}

// withIce: also ask for fresh connection settings (relay passwords). Only needed when entering the call and every
// 20 minutes after; the answer holds them only for someone who is in the call.
export const roomState = (code: string, withIce = false) =>
  call<RoomState>('GET', `/api/rooms/${encodeURIComponent(code)}/state${withIce ? '?ice=1' : ''}`);

export const admitMember = (code: string, profileId: string) =>
  call<{ ok: true }>('POST', `/api/rooms/${encodeURIComponent(code)}/admit`, { profileId });

export const removeMember = (code: string, profileId: string) =>
  call<{ ok: true }>('POST', `/api/rooms/${encodeURIComponent(code)}/remove`, { profileId });

export const leaveRoom = (code: string, visit?: string) =>
  call<{ ok: true }>('POST', `/api/rooms/${encodeURIComponent(code)}/leave`, { visit });

export const endRoom = (code: string) => call<{ ok: true }>('POST', `/api/rooms/${encodeURIComponent(code)}/end`);

// "I'm still here." The server stamps the database's own clock on the person's place; someone silent for 90 seconds stops
// counting toward the room's size, so a closed tab or a crash frees its seat.
export const heartbeatRoom = (code: string, visit: string) =>
  call<{ status: HeartbeatStatus }>('POST', `/api/rooms/${encodeURIComponent(code)}/heartbeat`, { visit });

// How often the open page says it is still there. The database lets 90 seconds pass before a seat stops counting, so
// three beats can go missing (a slow phone, a busy server) before anyone is dropped.
export const HEARTBEAT_MS = 25_000;

export interface HeartbeatOptions {
  code: string;
  visit: string;
  // Every answer: 'admitted', 'waiting', 'removed', 'left' or 'superseded'. What to do about each is the page's business.
  onStatus: (status: HeartbeatStatus) => void;
  // The room refused the beat for good: 410 (ended or expired) or 403 (never in it, or not allowed). The beating stops.
  onFatal: (error: RoomError) => void;
  intervalMs?: number;
  // Replaceable in tests.
  send?: (code: string, visit: string) => Promise<{ status: HeartbeatStatus }>;
}

export interface Heartbeat {
  // Beat now instead of waiting (for example when the page learns something is off). Ignored while one is in flight.
  beatNow: () => Promise<void>;
  // Stop for good; an answer that arrives afterwards is dropped.
  stop: () => void;
}

// Beats on a timer while the page is open. A hiccup (no connection, a busy server, a rate limit) is skipped and the next
// beat tries again; only a refusal from the room itself (403, 410) ends it, through onFatal.
export function startHeartbeat(opts: HeartbeatOptions): Heartbeat {
  const send = opts.send ?? heartbeatRoom;
  let stopped = false;
  let inFlight = false;

  const beatNow = async () => {
    if (stopped || inFlight) return;
    inFlight = true;
    try {
      const { status } = await send(opts.code, opts.visit);
      if (!stopped) opts.onStatus(status);
    } catch (e) {
      if (!stopped && e instanceof RoomError && (e.status === 403 || e.status === 410)) {
        stopped = true;
        window.clearInterval(timer);
        opts.onFatal(e);
      }
    } finally {
      inFlight = false;
    }
  };

  const timer = window.setInterval(() => void beatNow(), opts.intervalMs ?? HEARTBEAT_MS);
  return {
    beatNow,
    stop: () => {
      stopped = true;
      window.clearInterval(timer);
    },
  };
}

// Send "I'm leaving" so that it still goes out while the tab is closing. A normal request is cancelled when the page
// unloads; `keepalive` lets the browser finish it. It cannot be waited for, and a failure is ignored on purpose: if it
// never arrives, the room notices the silence (90 seconds) and frees the seat anyway.
export function sendLeaveOnClose(
  code: string,
  visit: string,
  headers: Record<string, string>,
  fetchImpl: typeof fetch = fetch,
): void {
  try {
    void fetchImpl(apiUrl(`/api/rooms/${encodeURIComponent(code)}/leave`), {
      method: 'POST',
      headers,
      body: JSON.stringify({ visit }),
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    // Nothing more can be done while the page is going away.
  }
}

// The page's "pagehide" handler calls this. It uses the sign-in headers of the last request (kept by `call`), and does
// nothing if there were none.
export function leaveRoomOnClose(code: string, visit: string): void {
  if (lastHeaders) sendLeaveOnClose(code, visit, lastHeaders);
}

// The link a tutor shares.
export const roomLink = (code: string) => siteUrl(`/room/${code}`);
