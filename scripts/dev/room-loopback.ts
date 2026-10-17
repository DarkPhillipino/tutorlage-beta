// Loopback test of the video-room call logic (master backlog 7bm). Three people in one page, each with a fake camera
// and microphone, wired together by an in-memory transport instead of Supabase. It runs src/lib/roomCall.ts in a
// real browser's WebRTC engine, so it checks the set-up messages, simultaneous joining ("perfect negotiation"),
// leaving, rejoining, and that a room that must hide addresses refuses to connect when there is no relay.
// T9 onward (10 Oct) check the page's own heartbeat and leave code in src/lib/videoRooms.ts with a fake sender and a
// fake fetch: beating on a timer, skipping hiccups, stopping for good on a refusal, never two beats at once, dropping
// answers after stop, the "leave" that goes out while a tab closes, visit ids, and the session-room time window.
// T19 onward (12 Oct) mount the real room page (src/pages/RoomPage.tsx) in React's StrictMode, as the app does in
// development, against a pretend rooms API (a replacement for window.fetch), the real Supabase client object with its
// sign-in, profile lookup and Realtime channel replaced by stand-ins (so nothing is sent to any real server), and fake
// cameras. They check what the page does with each answer the heartbeat can give, one join only, the Leave button, a
// closing tab, and a woken page.
// It does not test the database rules (supabase/tests/7bm_video_rooms.sql) or real networks (phones, mobile data), and
// it cannot show that a browser really lets a "keepalive" request out while a tab closes.
// Run: `npx vite --port=3002`, then open /scripts/dev/room-loopback.html and read the report on the page.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { RequireAuth } from '../../src/components/RequireAuth';
import { AuthProvider } from '../../src/lib/AuthContext';
import { supabase } from '../../src/lib/supabaseClient';
import RoomPage from '../../src/pages/RoomPage';
import { RoomCall } from '../../src/lib/roomCall';
import type { Signal, SignalTransport } from '../../src/lib/roomTransport';
import {
  RoomError,
  leaveRoomOnClose,
  newVisitId,
  sendLeaveOnClose,
  sessionRoomWindow,
  startHeartbeat,
} from '../../src/lib/videoRooms';
import type { HeartbeatStatus } from '../../src/lib/videoRooms';

const out = document.getElementById('out') as HTMLPreElement;
const lines: string[] = [];
const say = (line: string) => {
  lines.push(line);
  out.textContent = lines.join('\n');
};
const results: Record<string, string> = {};
(window as unknown as { __results: Record<string, string> }).__results = results;
const record = (name: string, ok: boolean, detail = '') => {
  results[name] = ok ? 'ok' : 'FAIL';
  say(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ' - ' + detail : ''}`);
};
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(check: () => boolean, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) return true;
    await sleep(100);
  }
  return check();
}

// A room's message hub: every message goes to everyone else, in order, a moment later (like a real channel).
function makeHub() {
  const members = new Map<string, (signal: Signal) => void>();
  return (id: string): SignalTransport => ({
    async open(onSignal) {
      members.set(id, onSignal);
    },
    send(signal) {
      for (const [other, deliver] of members) {
        if (other !== id) setTimeout(() => deliver(structuredClone(signal)), 5);
      }
    },
    async close() {
      members.delete(id);
    },
  });
}

// A fake camera (a moving picture) and microphone (a tone), so no permission is needed.
function fakeMedia(label: string): MediaStream {
  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 180;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  let frame = 0;
  const draw = () => {
    frame += 1;
    ctx.fillStyle = `hsl(${(frame * 3) % 360} 70% 40%)`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#fff';
    ctx.font = '32px sans-serif';
    ctx.fillText(`${label} ${frame}`, 20, 100);
  };
  draw();
  window.setInterval(draw, 66);
  const video = canvas.captureStream(15);
  const audioContext = new AudioContext();
  const oscillator = audioContext.createOscillator();
  const destination = audioContext.createMediaStreamDestination();
  oscillator.connect(destination);
  oscillator.start();
  return new MediaStream([...video.getVideoTracks(), ...destination.stream.getAudioTracks()]);
}

interface Person {
  id: string;
  call: RoomCall | null;
  remote: Map<string, { stream: MediaStream; state: string }>;
  gone: string[];
  // How many times the call asked for a fresh roster because someone it does not list sent a set-up message.
  unknown: number;
}

function makePerson(id: string, transportFor: (id: string) => SignalTransport, relayOnly = false, cameraAllowed = true): Person {
  const person: Person = { id, call: null, remote: new Map(), gone: [], unknown: 0 };
  person.call = new RoomCall({
    selfId: id,
    transport: transportFor(id),
    iceServers: [],
    relayOnly,
    // The stream always holds a camera picture; with cameraAllowed false the call must still send none of it.
    localStream: fakeMedia(id),
    cameraAllowed,
    onRemoteStream: (peer, stream) => person.remote.set(peer, { stream, state: person.remote.get(peer)?.state ?? 'new' }),
    onPeerGone: (peer) => {
      person.remote.delete(peer);
      person.gone.push(peer);
    },
    onConnectionState: (peer, state) => {
      const known = person.remote.get(peer);
      if (known) known.state = state;
      else person.remote.set(peer, { stream: new MediaStream(), state });
    },
    onChannelLost: () => say(`(${id}: channel lost)`),
    onUnknownSender: () => {
      person.unknown += 1;
    },
  });
  return person;
}

const connectedTo = (person: Person, ...others: string[]) =>
  others.every((other) => person.remote.get(other)?.state === 'connected');

// Does a remote stream really carry decoded video? Attach it to a hidden video element and wait for a picture.
async function showsVideo(stream: MediaStream): Promise<boolean> {
  const el = document.createElement('video');
  el.muted = true;
  el.playsInline = true;
  el.srcObject = stream;
  document.body.appendChild(el);
  await el.play().catch(() => undefined);
  const ok = await waitFor(() => el.videoWidth > 0 && el.readyState >= 2, 8000);
  el.remove();
  return ok;
}

type Beat = { status: HeartbeatStatus };

// The heartbeat and leave code of src/lib/videoRooms.ts (T9 onward), with a fake sender instead of the real API.
async function heartbeatChecks() {
  say('\nHeartbeat, leave and visit-id code of src/lib/videoRooms.ts (fake sender and fake fetch)');

  // T9. Beats on its timer, reports each answer, and stops when told.
  {
    let sends = 0;
    const answers: HeartbeatStatus[] = [];
    const hb = startHeartbeat({
      code: 'ABCDEFGH',
      visit: 'v',
      intervalMs: 100,
      send: async () => {
        sends += 1;
        return { status: 'admitted' } as Beat;
      },
      onStatus: (status) => answers.push(status),
      onFatal: () => undefined,
    });
    await sleep(520);
    hb.stop();
    const atStop = sends;
    await sleep(350);
    record(
      'T9 the heartbeat beats on its timer, reports each answer, and stops when told',
      atStop >= 4 && atStop <= 6 && answers.length === atStop && sends === atStop,
      `${atStop} beats in 520 ms, ${answers.length} answers, ${sends - atStop} after stop`,
    );
  }

  // T10. A hiccup (no connection, 429, 500, any other error) is skipped; the next beat tries again; nothing is fatal.
  {
    const script: Array<() => Promise<Beat>> = [
      () => Promise.reject(new RoomError('offline', 0)),
      () => Promise.reject(new RoomError('slow down', 429)),
      () => Promise.reject(new RoomError('server error', 500)),
      () => Promise.reject(new Error('network down')),
      () => Promise.resolve({ status: 'waiting' }),
    ];
    let calls = 0;
    let fatal = 0;
    const answers: HeartbeatStatus[] = [];
    const hb = startHeartbeat({
      code: 'ABCDEFGH',
      visit: 'v',
      intervalMs: 60,
      send: async () => script[Math.min(calls++, script.length - 1)](),
      onStatus: (status) => answers.push(status),
      onFatal: () => {
        fatal += 1;
      },
    });
    await waitFor(() => answers.length >= 1, 3000);
    hb.stop();
    record(
      'T10 hiccups (offline, 429, 500, other errors) are skipped and the beating carries on',
      fatal === 0 && answers[0] === 'waiting' && calls >= 5,
      `${calls} beats, first answer ${answers[0] ?? 'none'}, fatal calls ${fatal}`,
    );
  }

  // T11. A refusal from the room itself (403: never in it / not allowed, 410: ended or expired) is final: one onFatal, no more beats.
  {
    const seen: string[] = [];
    for (const status of [403, 410]) {
      let calls = 0;
      let fatalStatus = 0;
      let fatalCalls = 0;
      startHeartbeat({
        code: 'ABCDEFGH',
        visit: 'v',
        intervalMs: 50,
        send: async () => {
          calls += 1;
          if (calls >= 3) throw new RoomError('refused', status);
          return { status: 'admitted' } as Beat;
        },
        onStatus: () => undefined,
        onFatal: (error) => {
          fatalCalls += 1;
          fatalStatus = error.status;
        },
      });
      await sleep(600);
      seen.push(`${status}: fatal ${fatalCalls}x (status ${fatalStatus}), beats ${calls}`);
      if (!(fatalCalls === 1 && fatalStatus === status && calls === 3)) seen.push('MISMATCH');
    }
    record('T11 a 403 or 410 ends the beating for good, with one onFatal', !seen.includes('MISMATCH'), seen.join('; '));
  }

  // T12. Never two beats in flight at once, even when the server is slower than the interval.
  {
    let active = 0;
    let maxActive = 0;
    let sends = 0;
    const hb = startHeartbeat({
      code: 'ABCDEFGH',
      visit: 'v',
      intervalMs: 100,
      send: async () => {
        sends += 1;
        active += 1;
        maxActive = Math.max(maxActive, active);
        await sleep(350);
        active -= 1;
        return { status: 'admitted' } as Beat;
      },
      onStatus: () => undefined,
      onFatal: () => undefined,
    });
    await sleep(1300);
    hb.stop();
    await sleep(400);
    record('T12 a slow server never gets two beats at once', maxActive === 1 && sends >= 2 && sends <= 4, `most at once ${maxActive}, ${sends} beats in 1.3 s`);
  }

  // T13. After stop(), an answer that was already on its way is dropped.
  {
    let answered = 0;
    const hb = startHeartbeat({
      code: 'ABCDEFGH',
      visit: 'v',
      intervalMs: 50,
      send: () => new Promise<Beat>((resolve) => setTimeout(() => resolve({ status: 'admitted' }), 250)),
      onStatus: () => {
        answered += 1;
      },
      onFatal: () => undefined,
    });
    await sleep(120);
    hb.stop();
    await sleep(500);
    record('T13 an answer that arrives after stop is dropped', answered === 0, `${answered} answer(s) delivered after stop`);
  }

  // T14. beatNow() beats at once, and is ignored while a beat is in flight.
  {
    let sends = 0;
    const hb = startHeartbeat({
      code: 'ABCDEFGH',
      visit: 'v',
      intervalMs: 60_000,
      send: async () => {
        sends += 1;
        await sleep(80);
        return { status: 'admitted' } as Beat;
      },
      onStatus: () => undefined,
      onFatal: () => undefined,
    });
    await hb.beatNow();
    const afterOne = sends;
    await Promise.all([hb.beatNow(), hb.beatNow(), hb.beatNow()]);
    hb.stop();
    record('T14 beatNow beats at once and ignores a second call while one is in flight', afterOne === 1 && sends === 2, `after one call ${afterOne}, after three at once ${sends} (want 1, 2)`);
  }

  // T15. The "leave" that goes out while a tab closes: a POST with keepalive, the sign-in header and the visit id;
  // a failing or throwing fetch makes no noise.
  {
    const calls: { url: string; init: RequestInit }[] = [];
    const recording = ((url: string, init: RequestInit) => {
      calls.push({ url, init });
      return Promise.resolve(new Response('{}'));
    }) as unknown as typeof fetch;
    sendLeaveOnClose('ABCDEFGH', 'visit-1', { 'Content-Type': 'application/json', Authorization: 'Bearer dummy-not-a-token' }, recording);
    const first = calls[0];
    const headers = (first?.init.headers ?? {}) as Record<string, string>;
    let body: { visit?: string } = {};
    try {
      body = JSON.parse(String(first?.init.body));
    } catch {
      body = {};
    }
    const shapeOk =
      calls.length === 1 &&
      first.url.endsWith('/api/rooms/ABCDEFGH/leave') &&
      first.init.method === 'POST' &&
      first.init.keepalive === true &&
      headers.Authorization === 'Bearer dummy-not-a-token' &&
      body.visit === 'visit-1';
    record(
      'T15 the closing-tab leave is a POST with keepalive, the sign-in header and the visit id',
      shapeOk,
      first ? `${first.init.method} ${first.url}, keepalive=${String(first.init.keepalive)}, body=${String(first.init.body)}` : 'no request',
    );

    let unhandled = 0;
    const onUnhandled = (event: PromiseRejectionEvent) => {
      unhandled += 1;
      event.preventDefault();
    };
    window.addEventListener('unhandledrejection', onUnhandled);
    let threw = false;
    try {
      sendLeaveOnClose('ABCDEFGH', 'v', {}, (() => Promise.reject(new Error('offline'))) as unknown as typeof fetch);
      sendLeaveOnClose(
        'ABCDEFGH',
        'v',
        {},
        (() => {
          throw new Error('blocked');
        }) as unknown as typeof fetch,
      );
    } catch {
      threw = true;
    }
    await sleep(200);
    window.removeEventListener('unhandledrejection', onUnhandled);
    record('T15b a failing or throwing fetch during close makes no error', !threw && unhandled === 0, `threw=${threw}, unhandled rejections=${unhandled}`);
  }

  // T16. With no earlier request there are no sign-in headers to use, so the page-hide leave does nothing.
  {
    const realFetch = window.fetch;
    let hits = 0;
    window.fetch = (() => {
      hits += 1;
      return Promise.resolve(new Response('{}'));
    }) as typeof fetch;
    leaveRoomOnClose('ABCDEFGH', 'v');
    window.fetch = realFetch;
    record('T16 the page-hide leave does nothing before any request has been made', hits === 0, `${hits} request(s) sent`);
  }

  // T17. Visit ids are UUID-shaped and different each time, also on browsers without crypto.randomUUID.
  {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
    const v4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    const a = newVisitId();
    const b = newVisitId();
    Object.defineProperty(crypto, 'randomUUID', { value: undefined, configurable: true });
    const c = newVisitId();
    const d = newVisitId();
    delete (crypto as unknown as Record<string, unknown>).randomUUID;
    record(
      'T17 visit ids are UUID-shaped and unique, with or without crypto.randomUUID',
      uuid.test(a) && uuid.test(b) && a !== b && v4.test(c) && v4.test(d) && c !== d,
      `${a} / ${c}`,
    );
  }

  // T18. The session-room time window used to show the button: from 15 minutes before the start to an hour after the end.
  {
    const start = Date.parse('2026-10-10T12:00:00Z');
    const iso = '2026-10-10T12:00:00Z';
    const min = 60_000;
    const checks: Array<[string, string, string]> = [
      ['16 min before', sessionRoomWindow(iso, 1, start - 16 * min), 'early'],
      ['15 min before', sessionRoomWindow(iso, 1, start - 15 * min), 'open'],
      ['during', sessionRoomWindow(iso, 1, start + 30 * min), 'open'],
      ['1 h after the end', sessionRoomWindow(iso, 1, start + 2 * 60 * min), 'open'],
      ['1 h 1 min after the end', sessionRoomWindow(iso, 1, start + 2 * 60 * min + min), 'over'],
      ['half-hour session, 1 h 31 min after the start', sessionRoomWindow(iso, 0.5, start + 91 * min), 'over'],
      ['not a date', sessionRoomWindow('not a date', 1, start), 'over'],
    ];
    const wrong = checks.filter(([, got, want]) => got !== want).map(([name, got, want]) => `${name}: ${got} (want ${want})`);
    record('T18 the session-room window opens 15 minutes before the start and closes an hour after the end', wrong.length === 0, wrong.join('; ') || `${checks.length} cases`);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// The room page itself (T19 onward).
// ---------------------------------------------------------------------------------------------------------------
const SELF = '33333333-3333-4333-8333-333333333333';
const ROOM_ID = '44444444-4444-4444-8444-444444444444';
const ROOM_CODE = 'ABCDEFGH';
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

interface ApiCall {
  method: string;
  path: string;
  body: { visit?: string };
  keepalive: boolean;
}
interface FakeApi {
  calls: ApiCall[];
  joinStatus: 'admitted' | 'waiting';
  stateStatus: 'admitted' | 'waiting' | 'left';
  // Answers for the next heartbeats, in order: a status, or a number to answer with that HTTP error. Then 'admitted'.
  heartbeatQueue: Array<HeartbeatStatus | number>;
  // True: "leave" is never answered (a dead connection).
  leaveNever: boolean;
  // Any request that is not to /api/rooms/ (there should be none).
  unexpected: string[];
  // What the server says about the signed-in person's camera (true = an adult). false: a learner under 18.
  cameraAllowed: boolean;
}
const allApis: FakeApi[] = [];
const newApi = (): FakeApi => {
  const api: FakeApi = {
    cameraAllowed: true,
    calls: [],
    joinStatus: 'admitted',
    stateStatus: 'admitted',
    heartbeatQueue: [],
    leaveNever: false,
    unexpected: [],
  };
  allApis.push(api);
  return api;
};
const callsTo = (api: FakeApi, suffix: string) => api.calls.filter((c) => c.path.endsWith(suffix));

function fakeFetch(api: FakeApi): typeof fetch {
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const path = new URL(raw, window.location.href).pathname;
    const method = init?.method ?? 'GET';
    if (!path.startsWith('/api/rooms/')) {
      api.unexpected.push(`${method} ${raw}`);
      return json(500, { error: 'The page test allows only /api/rooms/ requests.' });
    }
    let body: { visit?: string } = {};
    try {
      body = init?.body ? JSON.parse(String(init.body)) : {};
    } catch {
      body = {};
    }
    api.calls.push({ method, path, body, keepalive: init?.keepalive === true });
    if (path.endsWith('/join')) {
      return json(200, {
        roomId: ROOM_ID,
        code: ROOM_CODE,
        status: api.joinStatus,
        isHost: true,
        maxParticipants: 4,
        relayOnly: false,
        sessionId: null,
        channel: `room:${ROOM_ID}`,
        iceServers: [],
        cameraAllowed: api.cameraAllowed,
      });
    }
    if (path.endsWith('/heartbeat')) {
      const next = api.heartbeatQueue.shift();
      if (typeof next === 'number') return json(next, { error: `pretend ${next}` });
      return json(200, { status: next ?? 'admitted' });
    }
    if (path.endsWith('/state')) {
      return json(200, {
        roomId: ROOM_ID,
        status: api.stateStatus,
        isHost: true,
        maxParticipants: 4,
        relayOnly: false,
        cameraAllowed: api.cameraAllowed,
        participants: [{ id: SELF, name: 'Test Tutor', status: api.stateStatus, isHost: true, cameraAllowed: api.cameraAllowed }],
        iceServers: [],
      });
    }
    if (path.endsWith('/leave') && api.leaveNever) return new Promise<Response>(() => undefined);
    return json(200, { ok: true });
  }) as typeof fetch;
}

let sharedAudio: AudioContext | null = null;
// A camera picture and a microphone track that need no permission and no tone (browsers limit how many audio contexts
// one page may open, so every fake microphone uses the same one).
function pageMedia(withVideo = true): MediaStream {
  sharedAudio ??= new AudioContext();
  const destination = sharedAudio.createMediaStreamDestination();
  if (!withVideo) return new MediaStream([...destination.stream.getAudioTracks()]);
  const canvas = document.createElement('canvas');
  canvas.width = 160;
  canvas.height = 90;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  ctx.fillStyle = '#246';
  ctx.fillRect(0, 0, 160, 90);
  const video = canvas.captureStream(1);
  return new MediaStream([...video.getVideoTracks(), ...destination.stream.getAudioTracks()]);
}

// Mounts the real page at /room/<code> the way main.tsx does in development: StrictMode, router, AuthProvider.
function mountPage() {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  let pathname = '';
  const Spy: React.FC = () => {
    pathname = useLocation().pathname;
    return null;
  };
  const h = React.createElement;
  root.render(
    h(
      React.StrictMode,
      null,
      h(
        MemoryRouter,
        { initialEntries: [`/room/${ROOM_CODE.toLowerCase()}`] },
        h(
          AuthProvider,
          null,
          h(Spy),
          h(
            Routes,
            null,
            // Behind RequireAuth, as in main.tsx: the page mounts once the person is signed in, so React's development
            // mount-unmount-mount happens on the page itself (not before it knows who the person is).
            h(Route, { path: '/room/:code', element: h(RequireAuth, null, h(RoomPage)) }),
            h(Route, { path: '*', element: h('div', null, 'elsewhere') }),
          ),
        ),
      ),
    ),
  );
  return {
    text: () => host.textContent ?? '',
    has: (selector: string) => host.querySelector(selector) !== null,
    path: () => pathname,
    button: (label: string) =>
      Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.trim() === label) as HTMLButtonElement | undefined,
    unmount: () => {
      root.unmount();
      host.remove();
    },
  };
}

async function pageChecks() {
  say('\nThe room page (src/pages/RoomPage.tsx) in StrictMode, with a pretend API, sign-in, channel and camera');

  // Stand-ins on the real client object: a signed-in test person, a profile row, and a private channel that goes nowhere.
  const fakeSession = {
    access_token: 'fake.page-test.token',
    refresh_token: 'fake',
    token_type: 'bearer',
    expires_in: 3600,
    user: { id: SELF, email: 'tutor-tester@example.invalid' },
  };
  const client = supabase as unknown as {
    auth: Record<string, unknown>;
    realtime: Record<string, unknown>;
    from: unknown;
    channel: unknown;
    removeChannel: unknown;
  };
  const saved = {
    getSession: client.auth.getSession,
    onAuthStateChange: client.auth.onAuthStateChange,
    setAuth: client.realtime.setAuth,
    from: client.from,
    channel: client.channel,
    removeChannel: client.removeChannel,
    fetch: window.fetch,
    setInterval: window.setInterval,
    getUserMedia: navigator.mediaDevices.getUserMedia,
  };
  client.auth.getSession = async () => ({ data: { session: fakeSession }, error: null });
  client.auth.onAuthStateChange = (callback: (event: string, session: unknown) => void) => {
    setTimeout(() => callback('SIGNED_IN', fakeSession), 0);
    return { data: { subscription: { unsubscribe: () => undefined } } };
  };
  client.realtime.setAuth = async () => undefined;
  client.from = () => ({
    select: () => ({
      eq: () => ({
        maybeSingle: async () => ({ data: { id: SELF, full_name: 'Test Tutor', role: 'tutor', avatar_url: null }, error: null }),
      }),
    }),
  });
  client.channel = () => {
    const channel = {
      on: () => channel,
      subscribe: (callback: (status: string) => void) => {
        setTimeout(() => callback('SUBSCRIBED'), 0);
        return channel;
      },
      send: async () => 'ok',
    };
    return channel;
  };
  client.removeChannel = async () => 'ok';

  const streams: MediaStream[] = [];
  // What the page asked the browser for each time (a camera is only given when video was asked for, as a real browser does).
  const asked: Array<MediaStreamConstraints | undefined> = [];
  navigator.mediaDevices.getUserMedia = (async (constraints?: MediaStreamConstraints) => {
    asked.push(constraints);
    const stream = pageMedia(Boolean(constraints?.video));
    streams.push(stream);
    return stream;
  }) as typeof navigator.mediaDevices.getUserMedia;
  const cameraStopped = (stream?: MediaStream) =>
    Boolean(stream && stream.getTracks().length > 0 && stream.getTracks().every((t) => t.readyState === 'ended'));

  // The page beats every 25 s. Most checks make that 150 ms so they take seconds; the wake-up check keeps it at 25 s.
  let fastBeat = true;
  window.setInterval = ((handler: TimerHandler, ms?: number, ...args: unknown[]) =>
    saved.setInterval.call(window, handler, ms === 25_000 && fastBeat ? 150 : ms, ...args)) as typeof window.setInterval;

  const inCall = (page: ReturnType<typeof mountPage>) => waitFor(() => page.text().includes('Tutorlage room'), 10000);
  const visitOf = (api: FakeApi) => callsTo(api, '/join')[0]?.body.visit;

  try {
    // T19. One join only (StrictMode would send two without the page's deferred start); the page reaches the call; every
    // beat carries the join's visit id.
    {
      const api = newApi();
      window.fetch = fakeFetch(api);
      const page = mountPage();
      const reached = await inCall(page);
      await waitFor(() => callsTo(api, '/heartbeat').length >= 3, 15000);
      const joins = callsTo(api, '/join');
      const beats = callsTo(api, '/heartbeat');
      const visit = visitOf(api);
      record(
        'T19 the page joins once (also in StrictMode), reaches the call, and every beat carries its visit id',
        reached && joins.length === 1 && UUID_SHAPE.test(visit ?? '') && beats.length >= 3 && beats.every((b) => b.body.visit === visit),
        `in call=${reached}, joins=${joins.length}, beats=${beats.length}, visit ok=${UUID_SHAPE.test(visit ?? '')}, other requests=${api.unexpected.length}`,
      );

      // T20. A closing tab: one keepalive "leave" with the same visit id.
      window.dispatchEvent(new Event('pagehide'));
      await waitFor(() => callsTo(api, '/leave').length >= 1, 3000);
      await sleep(300);
      const leaves = callsTo(api, '/leave');
      record(
        'T20 a closing tab sends one leave with keepalive and the page visit id',
        leaves.length === 1 && leaves[0].keepalive === true && leaves[0].body.visit === visit,
        `leaves=${leaves.length}, keepalive=${leaves[0]?.keepalive}, same visit=${leaves[0]?.body.visit === visit}`,
      );

      // T21. Leaving the page without pressing Leave (navigating away) stops the camera and sends a leave.
      const before = callsTo(api, '/leave').length;
      const stream = streams[streams.length - 1];
      page.unmount();
      await waitFor(() => callsTo(api, '/leave').length > before, 3000);
      await sleep(300);
      const after = callsTo(api, '/leave').length;
      const beatsAtUnmount = callsTo(api, '/heartbeat').length;
      await sleep(2500);
      record(
        'T21 leaving the page stops the camera, sends a leave and stops beating',
        cameraStopped(stream) && after === before + 1 && callsTo(api, '/heartbeat').length === beatsAtUnmount,
        `camera stopped=${cameraStopped(stream)}, new leaves=${after - before}, beats after unmount=${callsTo(api, '/heartbeat').length - beatsAtUnmount}`,
      );
    }

    // T22. A page that has just been woken (back on screen, connection back) beats at once instead of waiting for its timer.
    {
      fastBeat = false;
      const api = newApi();
      window.fetch = fakeFetch(api);
      const page = mountPage();
      const reached = await inCall(page);
      await sleep(300);
      const quiet = callsTo(api, '/heartbeat').length;
      window.dispatchEvent(new Event('online'));
      const online = await waitFor(() => callsTo(api, '/heartbeat').length === quiet + 1, 4000);
      await sleep(300);
      const hiddenNow = document.hidden;
      document.dispatchEvent(new Event('visibilitychange'));
      const visible = hiddenNow ? true : await waitFor(() => callsTo(api, '/heartbeat').length === quiet + 2, 4000);
      record(
        'T22 coming back online or back on screen beats at once, not at the next 25-second tick',
        reached && quiet === 0 && online && visible,
        `beats before=${quiet}, after "online"=${online}, after becoming visible=${hiddenNow ? 'not checked: this tab is hidden' : visible}`,
      );
      page.unmount();
      fastBeat = true;
      await sleep(200);
    }

    // T23. "left": the seat went to someone else while the page was away: the page joins again (same visit id) and carries on.
    {
      const api = newApi();
      api.heartbeatQueue = ['left'];
      window.fetch = fakeFetch(api);
      const page = mountPage();
      await inCall(page);
      const rejoined = await waitFor(() => callsTo(api, '/join').length >= 2, 10000);
      await waitFor(() => callsTo(api, '/heartbeat').length >= 3, 15000);
      const joins = callsTo(api, '/join');
      const beats = callsTo(api, '/heartbeat');
      record(
        'T23 a heartbeat answer of "left" makes the page join again with the same visit id, and it stays in the call',
        rejoined && joins.length === 2 && joins[1].body.visit === joins[0].body.visit && page.text().includes('Tutorlage room') && beats.length >= 3,
        `joins=${joins.length}, same visit=${joins[1]?.body.visit === joins[0]?.body.visit}, still in call=${page.text().includes('Tutorlage room')}, beats=${beats.length}`,
      );
      page.unmount();
      await sleep(200);
    }

    // T24. "superseded": another tab holds the place: this page says so, stops beating, frees the camera, and sends no leave.
    {
      const api = newApi();
      api.heartbeatQueue = ['superseded'];
      window.fetch = fakeFetch(api);
      const page = mountPage();
      await inCall(page);
      const told = await waitFor(() => page.text().includes('You joined this room somewhere else'), 10000);
      await sleep(300);
      const beats = callsTo(api, '/heartbeat').length;
      await sleep(2500);
      const stream = streams[streams.length - 1];
      page.unmount();
      await sleep(300);
      record(
        'T24 "superseded": the page says it was replaced, stops beating, frees the camera and sends no leave',
        told && callsTo(api, '/heartbeat').length === beats && cameraStopped(stream) && callsTo(api, '/leave').length === 0,
        `told=${told}, beats after=${callsTo(api, '/heartbeat').length - beats}, camera stopped=${cameraStopped(stream)}, leaves=${callsTo(api, '/leave').length}`,
      );
    }

    // T25. "removed": the page says so, stops beating and frees the camera.
    {
      const api = newApi();
      api.heartbeatQueue = ['removed'];
      window.fetch = fakeFetch(api);
      const page = mountPage();
      await inCall(page);
      const told = await waitFor(() => page.text().includes('You were removed from this room.'), 10000);
      await sleep(300);
      const beats = callsTo(api, '/heartbeat').length;
      await sleep(2500);
      const stream = streams[streams.length - 1];
      record(
        'T25 "removed": the page says so, stops beating and frees the camera',
        told && callsTo(api, '/heartbeat').length === beats && cameraStopped(stream),
        `told=${told}, beats after=${callsTo(api, '/heartbeat').length - beats}, camera stopped=${cameraStopped(stream)}`,
      );
      page.unmount();
      await sleep(200);
    }

    // T26. A 410 on a beat (the room ended or expired): "This room has ended", beating stops, camera freed.
    {
      const api = newApi();
      api.heartbeatQueue = [410];
      window.fetch = fakeFetch(api);
      const page = mountPage();
      await inCall(page);
      const told = await waitFor(() => page.text().includes('This room has ended'), 10000);
      await sleep(300);
      const beats = callsTo(api, '/heartbeat').length;
      await sleep(2500);
      const stream = streams[streams.length - 1];
      record(
        'T26 a 410 on a beat: the page says the room has ended, stops beating and frees the camera',
        told && callsTo(api, '/heartbeat').length === beats && cameraStopped(stream),
        `told=${told}, beats after=${callsTo(api, '/heartbeat').length - beats}, camera stopped=${cameraStopped(stream)}`,
      );
      page.unmount();
      await sleep(200);
    }

    // T27. Hiccups (429, 500) on beats do not end the visit.
    {
      const api = newApi();
      api.heartbeatQueue = [429, 500, 429];
      window.fetch = fakeFetch(api);
      const page = mountPage();
      await inCall(page);
      const carried = await waitFor(() => callsTo(api, '/heartbeat').length >= 5, 15000);
      record(
        'T27 beats that fail with 429 or 500 do not end the visit',
        carried && page.text().includes('Tutorlage room'),
        `beats=${callsTo(api, '/heartbeat').length}, still in call=${page.text().includes('Tutorlage room')}`,
      );
      page.unmount();
      await sleep(200);
    }

    // T28. The Leave button works at once even if the "leave" request never gets an answer (a dead connection).
    {
      const api = newApi();
      api.leaveNever = true;
      window.fetch = fakeFetch(api);
      const page = mountPage();
      await inCall(page);
      const stream = streams[streams.length - 1];
      const leaveButton = page.button('Leave');
      leaveButton?.click();
      const gone = await waitFor(() => page.path() === '/', 5000);
      await sleep(300);
      const beats = callsTo(api, '/heartbeat').length;
      await sleep(2500);
      const leaves = callsTo(api, '/leave');
      record(
        'T28 Leave takes the person away at once even when the leave request is never answered',
        Boolean(leaveButton) && gone && leaves.length === 1 && leaves[0].body.visit === visitOf(api) && cameraStopped(stream) && callsTo(api, '/heartbeat').length === beats,
        `button found=${Boolean(leaveButton)}, left the page=${gone}, leaves=${leaves.length}, camera stopped=${cameraStopped(stream)}, beats after=${callsTo(api, '/heartbeat').length - beats}`,
      );
      page.unmount();
      await sleep(200);
    }

    // T29. The lobby: no camera until let in; beats go on while waiting; once admitted the page enters the call.
    {
      const api = newApi();
      api.joinStatus = 'waiting';
      api.stateStatus = 'waiting';
      window.fetch = fakeFetch(api);
      const streamsBefore = streams.length;
      const page = mountPage();
      const lobby = await waitFor(() => page.text().includes('Waiting to be let in'), 8000);
      await waitFor(() => callsTo(api, '/heartbeat').length >= 3, 15000);
      const beatsWaiting = callsTo(api, '/heartbeat').length;
      const noCamera = streams.length === streamsBefore;
      api.stateStatus = 'admitted';
      const entered = await inCall(page);
      record(
        'T29 in the lobby the page beats and asks for no camera; once let in it enters the call',
        lobby && beatsWaiting >= 3 && noCamera && entered && streams.length === streamsBefore + 1,
        `lobby shown=${lobby}, beats while waiting=${beatsWaiting}, camera asked for while waiting=${!noCamera}, entered=${entered}, cameras opened=${streams.length - streamsBefore}`,
      );
      page.unmount();
      await sleep(200);
    }

    // T36. A learner under 18 (the server says cameraAllowed false): the page never asks the browser for a camera, shows
    // no camera button, says why, and sends no video; an adult (T19 to T29) still gets a camera and the button.
    {
      const api = newApi();
      api.cameraAllowed = false;
      window.fetch = fakeFetch(api);
      const askedBefore = asked.length;
      const streamsBefore = streams.length;
      const page = mountPage();
      const entered = await inCall(page);
      await sleep(500);
      const mine = asked.slice(askedBefore);
      const stream = streams[streamsBefore];
      record(
        'T36 a learner under 18: no camera is asked for, no camera button, sound only, and the page says why',
        entered &&
          mine.length === 1 &&
          !mine[0]?.video &&
          Boolean(mine[0]?.audio) &&
          Boolean(stream) &&
          stream.getVideoTracks().length === 0 &&
          !page.has('[aria-label="Turn camera off"]') &&
          !page.has('[aria-label="Turn camera on"]') &&
          page.has('[aria-label="Mute microphone"]') &&
          page.text().includes('Your camera stays off on Tutorlage because you are under 18'),
        `in call=${entered}, requests for media=${mine.length}, video asked=${Boolean(mine[0]?.video)}, camera button=${page.has('[aria-label="Turn camera off"]')}, note shown=${page.text().includes('under 18')}`,
      );
      page.unmount();
      await sleep(200);
    }

    // T37. An adult, for contrast: a camera is asked for and the camera button is there.
    {
      const api = newApi();
      window.fetch = fakeFetch(api);
      const askedBefore = asked.length;
      const page = mountPage();
      const entered = await inCall(page);
      const mine = asked.slice(askedBefore);
      record(
        'T37 an adult is asked for a camera and gets the camera button',
        entered && mine.length === 1 && Boolean(mine[0]?.video) && page.has('[aria-label="Turn camera off"]'),
        `in call=${entered}, video asked=${Boolean(mine[0]?.video)}, camera button=${page.has('[aria-label="Turn camera off"]')}`,
      );
      page.unmount();
      await sleep(200);
    }

    // T38. A server that does not say (an old answer, or a failure): the safe reading is no camera.
    {
      const api = newApi();
      const plain = fakeFetch(api);
      window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const response = await plain(input, init);
        const text = await response.clone().text();
        try {
          const body = JSON.parse(text) as Record<string, unknown>;
          delete body.cameraAllowed;
          return new Response(JSON.stringify(body), { status: response.status, headers: { 'Content-Type': 'application/json' } });
        } catch {
          return response;
        }
      }) as typeof fetch;
      const askedBefore = asked.length;
      const page = mountPage();
      const entered = await inCall(page);
      const mine = asked.slice(askedBefore);
      record(
        'T38 an answer that does not say whether the camera is allowed means no camera',
        entered && mine.length === 1 && !mine[0]?.video && !page.has('[aria-label="Turn camera off"]'),
        `in call=${entered}, video asked=${Boolean(mine[0]?.video)}`,
      );
      page.unmount();
      await sleep(200);
    }

    // T30. Through fetch, the page runs asked for nothing but /api/rooms/ (anything else was refused and logged). This does
    // not cover other ways out (for example a WebSocket), which the stand-ins above are meant to make unnecessary.
    const stray = allApis.flatMap((api) => api.unexpected);
    record(
      'T30 the page runs made no fetch request except to /api/rooms/',
      stray.length === 0,
      `${allApis.length} page runs, stray requests: ${stray.length ? stray.join('; ') : 'none'}`,
    );
  } finally {
    client.auth.getSession = saved.getSession;
    client.auth.onAuthStateChange = saved.onAuthStateChange;
    client.realtime.setAuth = saved.setAuth;
    client.from = saved.from;
    client.channel = saved.channel;
    client.removeChannel = saved.removeChannel;
    window.fetch = saved.fetch;
    window.setInterval = saved.setInterval;
    navigator.mediaDevices.getUserMedia = saved.getUserMedia;
  }
}

async function main() {
  say('Loopback test of src/lib/roomCall.ts (three fake participants, in-memory set-up channel)');
  const transportFor = makeHub();

  // 1. A is alone, then B and C arrive at the very same moment (the offers collide on purpose).
  const a = makePerson('aaaa', transportFor);
  await a.call!.start();
  const b = makePerson('bbbb', transportFor);
  const c = makePerson('cccc', transportFor);
  await Promise.all([b.call!.start(), c.call!.start()]);
  const meshUp = await waitFor(
    () => connectedTo(a, 'bbbb', 'cccc') && connectedTo(b, 'aaaa', 'cccc') && connectedTo(c, 'aaaa', 'bbbb'),
    20000,
  );
  record(
    'T1 three people, two arriving at once: every pair connects',
    meshUp,
    `a:${[...a.remote].map(([k, v]) => k + '=' + v.state).join(',')} b:${[...b.remote].map(([k, v]) => k + '=' + v.state).join(',')} c:${[...c.remote].map(([k, v]) => k + '=' + v.state).join(',')}`,
  );

  // 2. Real media arrives (picture and sound tracks, and decoded frames).
  const fromB = a.remote.get('bbbb')?.stream;
  record(
    'T2 A receives one video and one audio track from B',
    Boolean(fromB && fromB.getVideoTracks().length === 1 && fromB.getAudioTracks().length === 1),
    fromB ? `${fromB.getVideoTracks().length} video, ${fromB.getAudioTracks().length} audio` : 'no stream',
  );
  record('T3 the picture from B is actually decoded and shown at A', fromB ? await showsVideo(fromB) : false);
  const fromC = a.remote.get('cccc')?.stream;
  record('T3b the picture from C is actually decoded and shown at A', fromC ? await showsVideo(fromC) : false);

  // 3. Low-data mode and group bitrate limits do not break a running call.
  a.call!.setLowData(true);
  await sleep(500);
  a.call!.setLowData(false);
  record('T4 switching low-data mode on and off leaves the calls connected', connectedTo(a, 'bbbb', 'cccc'));

  // 4. B leaves: A and C see them go, and their own connection stays.
  await b.call!.stop();
  const goneSeen = await waitFor(() => a.gone.includes('bbbb') && c.gone.includes('bbbb'), 5000);
  record('T5 when B leaves, A and C are told and drop only B', goneSeen && connectedTo(a, 'cccc') && connectedTo(c, 'aaaa'));

  // 5. B comes back as a new visit: everyone reconnects.
  const b2 = makePerson('bbbb', transportFor);
  await b2.call!.start();
  const back = await waitFor(() => connectedTo(a, 'bbbb', 'cccc') && connectedTo(b2, 'aaaa', 'cccc') && connectedTo(c, 'aaaa', 'bbbb'), 20000);
  record('T6 B rejoins and every pair connects again', back);

  // 5b. The roster (12 Oct review): "Remove" must cut someone off even from a browser that ignores it. A is told the room
  // now lists only C. A closes its end of the connection to B; B's later messages are held, not obeyed.
  a.unknown = 0;
  a.call!.setRoster(['cccc']);
  const cutOff = await waitFor(() => !a.remote.has('bbbb'), 3000);
  record(
    'T31 a roster without B: A closes its connection to B and keeps C',
    cutOff && connectedTo(a, 'cccc') && connectedTo(c, 'aaaa'),
    `a sees: ${[...a.remote].map(([k, v]) => k + '=' + v.state).join(',') || 'nobody'}`,
  );
  b2.call!.announce(); // B (who ignores the removal) says hello again and tries to set the call up afresh
  await sleep(3000);
  record(
    'T32 B\'s new hello is held, not obeyed: A makes no connection with B and asks for a fresh roster',
    !a.remote.has('bbbb') && a.unknown >= 1 && connectedTo(a, 'cccc'),
    `a sees: ${[...a.remote].map(([k, v]) => k + '=' + v.state).join(',') || 'nobody'}, roster requests at A=${a.unknown}`,
  );
  const bAndC = await waitFor(() => connectedTo(b2, 'cccc') && connectedTo(c, 'bbbb'), 20000);
  record('T32b B and C (who still list each other) connect again after B\'s hello', bAndC);
  a.call!.setRoster(['bbbb', 'cccc']); // the room lists B again: the held hello is handled
  const backIn = await waitFor(() => connectedTo(a, 'bbbb', 'cccc') && connectedTo(b2, 'aaaa'), 20000);
  record('T33 once the roster lists B again, the held hello is handled and A and B connect', backIn);

  // 5c. Someone the room never listed (a fourth person in the channel) cannot start a connection with A either.
  const d = makePerson('dddd', transportFor);
  a.unknown = 0;
  await d.call!.start();
  await sleep(3000);
  record(
    'T34 a sender the roster does not list is held: A makes no connection with D and asks for a fresh roster',
    !a.remote.has('dddd') && a.unknown >= 1,
    `a sees: ${[...a.remote].map(([k, v]) => k + '=' + v.state).join(',') || 'nobody'}, roster requests at A=${a.unknown}`,
  );
  a.call!.setRoster(['bbbb', 'cccc', 'dddd']);
  const dIn = await waitFor(() => connectedTo(a, 'dddd') && connectedTo(d, 'aaaa'), 20000);
  record('T34b once D is listed, A and D connect', dIn);
  await d.call!.stop();

  // 5d. A learner under 18 (CEO, 17 Oct 2026): their video is never shown. C is flagged "no video" at A: C's picture is taken
  // out of C's stream (their sound stays), and B, who is not flagged, still shows a picture.
  a.call!.setRoster(['bbbb', 'cccc'], ['cccc']);
  await sleep(500);
  const cAtA = a.remote.get('cccc')?.stream;
  const bAtA = a.remote.get('bbbb')?.stream;
  record(
    'T35 a person flagged "no video" (a learner under 18): A shows none of their picture but still hears them; others are unaffected',
    Boolean(cAtA && cAtA.getVideoTracks().length === 0 && cAtA.getAudioTracks().length === 1 && bAtA && bAtA.getVideoTracks().length === 1),
    `C at A: ${cAtA?.getVideoTracks().length} video, ${cAtA?.getAudioTracks().length} audio; B at A: ${bAtA?.getVideoTracks().length} video`,
  );
  // A newcomer flagged before they arrive: their video track is dropped when it arrives (nothing to remove afterwards).
  const e = makePerson('eeee', transportFor);
  a.call!.setRoster(['bbbb', 'cccc', 'eeee'], ['cccc', 'eeee']);
  await e.call!.start();
  const eIn = await waitFor(() => connectedTo(a, 'eeee') && connectedTo(e, 'aaaa'), 20000);
  const eAtA = a.remote.get('eeee')?.stream;
  record(
    'T35b a flagged newcomer: A connects, hears them, and never gets their picture',
    eIn && Boolean(eAtA && eAtA.getVideoTracks().length === 0 && eAtA.getAudioTracks().length === 1),
    `E at A: ${eAtA?.getVideoTracks().length} video, ${eAtA?.getAudioTracks().length} audio`,
  );
  await e.call!.stop();
  // The sender's own side: someone told "no camera" sends none, even though the stream they hold has a picture.
  const g = makePerson('gggg', transportFor, false, false);
  a.call!.setRoster(['bbbb', 'cccc', 'gggg']);
  await g.call!.start();
  const gIn = await waitFor(() => connectedTo(a, 'gggg') && connectedTo(g, 'aaaa'), 20000);
  const gAtA = a.remote.get('gggg')?.stream;
  const aAtG = g.remote.get('aaaa')?.stream;
  record(
    'T35c a sender told "no camera" sends no picture although its stream holds one, and still receives A\'s picture and sound',
    gIn && Boolean(gAtA && gAtA.getVideoTracks().length === 0 && gAtA.getAudioTracks().length === 1 && aAtG && aAtG.getVideoTracks().length === 1),
    `G at A: ${gAtA?.getVideoTracks().length} video, ${gAtA?.getAudioTracks().length} audio; A at G: ${aAtG?.getVideoTracks().length} video`,
  );
  await g.call!.stop();

  // 6. Everyone leaves cleanly.
  await Promise.all([a.call!.stop(), b2.call!.stop(), c.call!.stop()]);
  record('T7 everyone can leave without errors', true);

  // 7. A room that must hide addresses, with no relay available: it must NOT connect directly.
  const hub2 = makeHub();
  const p = makePerson('pppp', hub2, true);
  const q = makePerson('qqqq', hub2, true);
  await p.call!.start();
  await q.call!.start();
  await sleep(9000);
  const leaked = p.remote.get('qqqq')?.state === 'connected' || q.remote.get('pppp')?.state === 'connected';
  record(
    'T8 relay-only with no relay: the two do NOT connect directly',
    !leaked,
    `p sees q as ${p.remote.get('qqqq')?.state ?? 'nothing'}, q sees p as ${q.remote.get('pppp')?.state ?? 'nothing'}`,
  );
  await Promise.all([p.call!.stop(), q.call!.stop()]);

  await heartbeatChecks();
  await pageChecks();

  const failed = Object.values(results).filter((r) => r !== 'ok').length;
  say(`\nDONE: ${Object.keys(results).length - failed} of ${Object.keys(results).length} passed`);
  (window as unknown as { __done: boolean }).__done = true;
}

main().catch((error) => {
  say(`ERROR: ${error instanceof Error ? error.stack : String(error)}`);
  (window as unknown as { __done: boolean }).__done = true;
});
