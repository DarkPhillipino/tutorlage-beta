// Loopback test of the video-room call logic (master backlog 7bm). Three people in one page, each with a fake camera
// and microphone, wired together by an in-memory transport instead of Supabase. It runs src/lib/roomCall.ts in a
// real browser's WebRTC engine, so it checks the set-up messages, simultaneous joining ("perfect negotiation"),
// leaving, rejoining, and that a room that must hide addresses refuses to connect when there is no relay.
// It does not test the database rules (supabase/tests/7bm_video_rooms.sql) or real networks (phones, mobile data).
// Run: `npx vite --port=3002`, then open /scripts/dev/room-loopback.html and read the report on the page.
import { RoomCall } from '../../src/lib/roomCall';
import type { Signal, SignalTransport } from '../../src/lib/roomTransport';

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
}

function makePerson(id: string, transportFor: (id: string) => SignalTransport, relayOnly = false): Person {
  const person: Person = { id, call: null, remote: new Map(), gone: [] };
  person.call = new RoomCall({
    selfId: id,
    transport: transportFor(id),
    iceServers: [],
    relayOnly,
    localStream: fakeMedia(id),
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

  const failed = Object.values(results).filter((r) => r !== 'ok').length;
  say(`\nDONE: ${Object.keys(results).length - failed} of ${Object.keys(results).length} passed`);
  (window as unknown as { __done: boolean }).__done = true;
}

main().catch((error) => {
  say(`ERROR: ${error instanceof Error ? error.stack : String(error)}`);
  (window as unknown as { __done: boolean }).__done = true;
});
