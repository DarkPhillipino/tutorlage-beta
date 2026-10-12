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
}

export interface RoomPerson {
  id: string;
  name: string;
  status: MemberStatus;
  isHost: boolean;
}

export interface RoomState {
  roomId: string;
  status: MemberStatus;
  isHost: boolean;
  maxParticipants: number;
  relayOnly: boolean;
  participants: RoomPerson[];
  iceServers: IceServer[];
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

async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(apiUrl(path), {
      method,
      headers: await authHeaders(),
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

// A tutor opens a room (2 to 4 people) and gets its code.
export const createRoom = (maxParticipants = 4) => call<{ code: string }>('POST', '/api/rooms', { maxParticipants });

// Enter a room from its link's code. Everyone but the host waits in the lobby until let in.
export const joinRoom = (code: string) => call<RoomJoin>('POST', `/api/rooms/${encodeURIComponent(code)}/join`);

// Open a booked session's own room (its tutor, learner or the learner's guardian).
export const joinSessionRoom = (sessionId: string) =>
  call<RoomJoin>('POST', `/api/rooms/session/${encodeURIComponent(sessionId)}/join`);

// withIce: also ask for fresh connection settings (relay passwords). Only needed when entering the call and every
// 20 minutes after; the answer holds them only for someone who is in the call.
export const roomState = (code: string, withIce = false) =>
  call<RoomState>('GET', `/api/rooms/${encodeURIComponent(code)}/state${withIce ? '?ice=1' : ''}`);

export const admitMember = (code: string, profileId: string) =>
  call<{ ok: true }>('POST', `/api/rooms/${encodeURIComponent(code)}/admit`, { profileId });

export const removeMember = (code: string, profileId: string) =>
  call<{ ok: true }>('POST', `/api/rooms/${encodeURIComponent(code)}/remove`, { profileId });

export const leaveRoom = (code: string) => call<{ ok: true }>('POST', `/api/rooms/${encodeURIComponent(code)}/leave`);

export const endRoom = (code: string) => call<{ ok: true }>('POST', `/api/rooms/${encodeURIComponent(code)}/end`);

// The link a tutor shares.
export const roomLink = (code: string) => siteUrl(`/room/${code}`);
