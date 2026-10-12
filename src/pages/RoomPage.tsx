// A Tutorlage video room (master backlog 7bm; design: Drake/programmer/video-rooms-design-v2.md). Switched off by
// FEATURES.videoRooms until the CEO says so. /room lets a tutor open a room; /room/:code is the room itself:
// a lobby until the host lets you in, then a call for up to four people, browser to browser.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Check, Copy, Gauge, Loader2, Mic, MicOff, PhoneOff, ShieldCheck, Users, Video, VideoOff } from 'lucide-react';
import { useAuth } from '../lib/AuthContext';
import { RoomCall } from '../lib/roomCall';
import { supabaseTransport } from '../lib/roomTransport';
import {
  RoomError,
  admitMember,
  createRoom,
  endRoom,
  joinRoom,
  leaveRoom,
  removeMember,
  roomLink,
  roomState,
} from '../lib/videoRooms';
import type { RoomJoin, RoomPerson, RoomState } from '../lib/videoRooms';

type Phase = 'starting' | 'lobby' | 'in-call' | 'ended' | 'error';

const POLL_MS = 2500;
const ICE_REFRESH_MS = 20 * 60 * 1000;

// Camera and microphone. Falls back to audio only, then to nothing, and says why.
async function getLocalMedia(): Promise<{ stream: MediaStream | null; note: string | null }> {
  if (!navigator.mediaDevices?.getUserMedia) {
    return { stream: null, note: "This browser can't use a camera or microphone here. You can still see and hear the others." };
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
      video: { width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 24, max: 30 }, facingMode: 'user' },
    });
    return { stream, note: null };
  } catch {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      return { stream, note: "Your camera isn't available, so you're joining with sound only." };
    } catch {
      return {
        stream: null,
        note: "Tutorlage couldn't use your camera or microphone (check the browser's permission for this site). You can still see and hear the others.",
      };
    }
  }
}

function stopStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop());
}

// One person's picture. Sound starts by itself where the browser allows; otherwise a tap starts it.
const Tile: React.FC<{ stream: MediaStream | null; label: string; muted?: boolean; mirrored?: boolean; off?: boolean }> = ({
  stream,
  label,
  muted = false,
  mirrored = false,
  off = false,
}) => {
  const ref = useRef<HTMLVideoElement>(null);
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.srcObject = stream;
    if (stream) {
      el.play().then(
        () => setBlocked(false),
        () => setBlocked(true),
      );
    }
  }, [stream]);

  return (
    <div className="relative aspect-video overflow-hidden rounded-xl bg-slate-800">
      <video
        ref={ref}
        autoPlay
        playsInline
        muted={muted}
        className={`h-full w-full object-cover ${mirrored ? '-scale-x-100' : ''} ${off ? 'invisible' : ''}`}
      />
      {(off || !stream) && (
        <div className="absolute inset-0 flex items-center justify-center text-slate-400">
          <Users className="h-10 w-10" />
        </div>
      )}
      <span className="absolute bottom-2 left-2 rounded-md bg-black/60 px-2 py-0.5 text-xs font-semibold text-white">{label}</span>
      {blocked && (
        <button
          type="button"
          onClick={() => ref.current?.play().then(() => setBlocked(false), () => undefined)}
          className="absolute inset-0 flex items-center justify-center bg-black/60 text-sm font-semibold text-white"
        >
          Tap to start sound
        </button>
      )}
    </div>
  );
};

const Shell: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="min-h-screen bg-slate-900 text-white">
    <div className="mx-auto max-w-5xl px-4 py-6">{children}</div>
  </div>
);

const Message: React.FC<{ title: string; body?: string; action?: React.ReactNode }> = ({ title, body, action }) => (
  <Shell>
    <div className="mx-auto mt-16 max-w-md rounded-2xl bg-white p-8 text-center text-[#0F172A] shadow-sm">
      <h1 className="mb-2 font-serif text-2xl">{title}</h1>
      {body && <p className="mb-6 text-sm text-slate-500">{body}</p>}
      {action}
    </div>
  </Shell>
);

// /room: a tutor opens a room; anyone else is told to ask for a link.
const OpenRoom: React.FC = () => {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [size, setSize] = useState(4);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = async () => {
    setBusy(true);
    setError(null);
    try {
      const { code } = await createRoom(size);
      navigate(`/room/${code}`, { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not open the room.');
      setBusy(false);
    }
  };

  if (profile?.role !== 'tutor') {
    return (
      <Message
        title="Open a video room"
        body="Rooms are opened by tutors. Ask your tutor for the room link, or join your booked session from your sessions list."
        action={<Link to="/" className="text-sm font-semibold text-[#15803D]">Back to Tutorlage</Link>}
      />
    );
  }
  return (
    <Message
      title="Open a video room"
      body="You'll get a link to share. People you share it with wait in a lobby until you let them in."
      action={
        <div className="space-y-4">
          <label className="block text-sm text-slate-600">
            People in the room (including you)
            <select
              value={size}
              onChange={(e) => setSize(Number(e.target.value))}
              className="ml-2 rounded-lg border border-slate-300 px-2 py-1"
            >
              {[2, 3, 4].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            type="button"
            onClick={open}
            disabled={busy}
            className="w-full rounded-xl bg-[#15803D] px-4 py-3 font-semibold text-white disabled:opacity-60"
          >
            {busy ? 'Opening…' : 'Open a room'}
          </button>
        </div>
      }
    />
  );
};

const RoomView: React.FC<{ code: string }> = ({ code }) => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const selfId = user?.id ?? '';

  const [phase, setPhase] = useState<Phase>('starting');
  const [error, setError] = useState<string | null>(null);
  const [join, setJoin] = useState<RoomJoin | null>(null);
  const [people, setPeople] = useState<RoomPerson[]>([]);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [mediaNote, setMediaNote] = useState<string | null>(null);
  const [remote, setRemote] = useState<Record<string, { stream: MediaStream; state: string }>>({});
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [lowData, setLowData] = useState(false);
  const [copied, setCopied] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [lostChannel, setLostChannel] = useState(false);

  const callRef = useRef<RoomCall | null>(null);
  const localRef = useRef<MediaStream | null>(null);
  const enteredRef = useRef(false);
  const startedCallRef = useRef(false);
  const lastIceRef = useRef(0);

  const fail = useCallback((e: unknown) => {
    if (e instanceof RoomError && e.status === 410) {
      setPhase('ended');
      return;
    }
    setError(e instanceof Error ? e.message : 'Something went wrong with the room.');
    setPhase('error');
  }, []);

  const teardown = useCallback(async () => {
    const call = callRef.current;
    callRef.current = null;
    startedCallRef.current = false;
    await call?.stop();
    stopStream(localRef.current);
    localRef.current = null;
    setLocalStream(null);
    setRemote({});
  }, []);

  // Get camera and microphone, then join the room's set-up channel.
  const enterCall = useCallback(
    async (state: Pick<RoomJoin | RoomState, 'iceServers' | 'relayOnly'> & { channelName: string }) => {
      if (startedCallRef.current) return;
      startedCallRef.current = true;
      const { stream, note } = await getLocalMedia();
      localRef.current = stream;
      setLocalStream(stream);
      setMediaNote(note);
      setMicOn(Boolean(stream?.getAudioTracks().length));
      setCamOn(Boolean(stream?.getVideoTracks().length));
      const call = new RoomCall({
        selfId,
        transport: supabaseTransport(state.channelName),
        iceServers: state.iceServers,
        relayOnly: state.relayOnly,
        localStream: stream,
        onRemoteStream: (peerId, remoteStream) =>
          setRemote((prev) => ({ ...prev, [peerId]: { stream: remoteStream, state: prev[peerId]?.state ?? 'connecting' } })),
        onPeerGone: (peerId) =>
          setRemote((prev) => {
            const { [peerId]: _gone, ...rest } = prev;
            return rest;
          }),
        onConnectionState: (peerId, connection) =>
          setRemote((prev) => (prev[peerId] ? { ...prev, [peerId]: { ...prev[peerId], state: connection } } : prev)),
        onChannelLost: () => setLostChannel(true),
      });
      callRef.current = call;
      lastIceRef.current = Date.now();
      try {
        await call.start();
        setPhase('in-call');
      } catch (e) {
        await teardown();
        throw e;
      }
    },
    [selfId, teardown],
  );

  // Join, wait in the lobby if need be, then keep the room's list of people fresh.
  useEffect(() => {
    if (!selfId) return;
    let cancelled = false;
    let timer: number | undefined;

    const tick = async () => {
      try {
        // Relay passwords only when entering the call and every 20 minutes after: not on every poll.
        const needIce = !startedCallRef.current || Date.now() - lastIceRef.current > ICE_REFRESH_MS;
        const state = await roomState(code, needIce);
        if (cancelled) return;
        setPeople(state.participants);
        if (state.status === 'left') {
          // We left (a second tab, or a dropped connection): come back in.
          const again = await joinRoom(code);
          if (cancelled) return;
          setJoin(again);
        } else if (state.status === 'admitted') {
          if (!startedCallRef.current) {
            await enterCall({ iceServers: state.iceServers, relayOnly: state.relayOnly, channelName: `room:${state.roomId}` });
          } else if (callRef.current && needIce && state.iceServers.length > 0) {
            // Never replace working settings with an empty answer.
            callRef.current.updateIceServers(state.iceServers);
            lastIceRef.current = Date.now();
          }
        }
      } catch (e) {
        // A hiccup in the connection: keep trying. Anything else ends the visit.
        if (e instanceof RoomError && e.status === 0) return;
        if (!cancelled) fail(e);
        return;
      }
      if (!cancelled) timer = window.setTimeout(tick, POLL_MS);
    };

    (async () => {
      try {
        const joined = await joinRoom(code);
        if (cancelled) return;
        enteredRef.current = true;
        setJoin(joined);
        setPhase(joined.status === 'admitted' ? 'starting' : 'lobby');
        if (joined.status === 'admitted') {
          await enterCall({ iceServers: joined.iceServers, relayOnly: joined.relayOnly, channelName: joined.channel });
          if (cancelled) return;
        }
        timer = window.setTimeout(tick, POLL_MS);
      } catch (e) {
        if (!cancelled) fail(e);
      }
    })();

    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
      const entered = enteredRef.current;
      enteredRef.current = false;
      void teardown().then(() => {
        if (entered) void leaveRoom(code).catch(() => undefined);
      });
    };
  }, [code, selfId, enterCall, fail, teardown]);

  const isHost = join?.isHost ?? false;
  const waiting = people.filter((p) => p.status === 'waiting' && p.id !== selfId);
  const inRoom = people.filter((p) => p.status === 'admitted');
  const nameOf = (id: string) => people.find((p) => p.id === id)?.name ?? 'Guest';

  const toggleMic = () => {
    const tracks = localStream?.getAudioTracks() ?? [];
    const next = !micOn;
    tracks.forEach((t) => (t.enabled = next));
    setMicOn(next);
  };
  const toggleCam = () => {
    const tracks = localStream?.getVideoTracks() ?? [];
    const next = !camOn;
    tracks.forEach((t) => (t.enabled = next));
    setCamOn(next);
  };
  const toggleLowData = () => {
    const next = !lowData;
    setLowData(next);
    callRef.current?.setLowData(next);
  };
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(roomLink(code));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt('Copy this link:', roomLink(code));
    }
  };
  const act = async (id: string, what: 'admit' | 'remove') => {
    setBusyId(id);
    try {
      if (what === 'admit') await admitMember(code, id);
      else await removeMember(code, id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work.');
    } finally {
      setBusyId(null);
    }
  };
  const leave = async () => {
    enteredRef.current = false;
    await teardown();
    await leaveRoom(code).catch(() => undefined);
    navigate('/', { replace: true });
  };
  const endForEveryone = async () => {
    if (!window.confirm('End this room for everyone?')) return;
    enteredRef.current = false;
    await endRoom(code).catch(() => undefined);
    await teardown();
    navigate('/', { replace: true });
  };

  if (phase === 'error') {
    return (
      <Message
        title="We couldn't open this room"
        body={error ?? undefined}
        action={<Link to="/" className="text-sm font-semibold text-[#15803D]">Back to Tutorlage</Link>}
      />
    );
  }
  if (phase === 'ended') {
    return (
      <Message
        title="This room has ended"
        body="The tutor ended it, or it has expired."
        action={<Link to="/" className="text-sm font-semibold text-[#15803D]">Back to Tutorlage</Link>}
      />
    );
  }
  if (phase === 'starting') {
    return (
      <Shell>
        <div className="mt-24 flex items-center justify-center text-slate-300">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          <span className="text-sm font-semibold">Opening the room…</span>
        </div>
      </Shell>
    );
  }
  if (phase === 'lobby') {
    return (
      <Message
        title="Waiting to be let in"
        body="The tutor will let you in shortly. You can leave this page open."
        action={
          <button type="button" onClick={leave} className="text-sm font-semibold text-slate-500">
            Leave
          </button>
        }
      />
    );
  }

  const remoteIds = Object.keys(remote);
  return (
    <Shell>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="font-serif text-xl">Tutorlage room</h1>
          <p className="text-xs text-slate-400">
            {inRoom.length} of {join?.maxParticipants ?? 4} in the room
          </p>
        </div>
        {isHost && (
          <button
            type="button"
            onClick={copyLink}
            className="flex items-center gap-2 rounded-lg bg-slate-700 px-3 py-2 text-sm font-semibold"
          >
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {copied ? 'Link copied' : 'Copy room link'}
          </button>
        )}
      </div>

      {mediaNote && <p className="mb-3 rounded-lg bg-amber-100 px-3 py-2 text-sm text-amber-900">{mediaNote}</p>}
      {lostChannel && (
        <p className="mb-3 rounded-lg bg-amber-100 px-3 py-2 text-sm text-amber-900">
          The room's connection dropped. People already on the call can stay; to let someone new in, reload this page.
        </p>
      )}
      {error && <p className="mb-3 rounded-lg bg-red-100 px-3 py-2 text-sm text-red-800">{error}</p>}

      {isHost && waiting.length > 0 && (
        <div className="mb-4 rounded-xl bg-slate-800 p-4">
          <p className="mb-2 text-sm font-semibold">Waiting to join</p>
          <ul className="space-y-2">
            {waiting.map((person) => (
              <li key={person.id} className="flex items-center justify-between gap-2">
                <span className="text-sm">{person.name}</span>
                <span className="flex gap-2">
                  <button
                    type="button"
                    disabled={busyId === person.id}
                    onClick={() => act(person.id, 'admit')}
                    className="rounded-lg bg-[#15803D] px-3 py-1 text-sm font-semibold disabled:opacity-60"
                  >
                    Let in
                  </button>
                  <button
                    type="button"
                    disabled={busyId === person.id}
                    onClick={() => act(person.id, 'remove')}
                    className="rounded-lg bg-slate-600 px-3 py-1 text-sm font-semibold disabled:opacity-60"
                  >
                    Not now
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className={`grid gap-3 ${remoteIds.length >= 1 ? 'sm:grid-cols-2' : ''}`}>
        {remoteIds.map((id) => (
          <div key={id} className="relative">
            <Tile stream={remote[id].stream} label={nameOf(id)} />
            {remote[id].state !== 'connected' && (
              <span className="absolute right-2 top-2 rounded-md bg-black/60 px-2 py-0.5 text-xs">
                {remote[id].state === 'failed' ? "Can't connect" : 'Connecting…'}
              </span>
            )}
            {isHost && (
              <button
                type="button"
                onClick={() => act(id, 'remove')}
                disabled={busyId === id}
                className="absolute right-2 bottom-2 rounded-md bg-black/60 px-2 py-0.5 text-xs"
              >
                Remove
              </button>
            )}
          </div>
        ))}
        <Tile stream={localStream} label="You" muted mirrored off={!camOn || !localStream?.getVideoTracks().length} />
      </div>
      {remoteIds.length === 0 && (
        <p className="mt-3 text-center text-sm text-slate-400">
          {isHost ? 'Share the link, then let people in when they appear above.' : "You're in. Waiting for the others to connect…"}
        </p>
      )}

      <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={toggleMic}
          disabled={!localStream?.getAudioTracks().length}
          aria-label={micOn ? 'Mute microphone' : 'Unmute microphone'}
          className={`rounded-full p-3 ${micOn ? 'bg-slate-700' : 'bg-red-600'} disabled:opacity-40`}
        >
          {micOn ? <Mic className="h-5 w-5" /> : <MicOff className="h-5 w-5" />}
        </button>
        <button
          type="button"
          onClick={toggleCam}
          disabled={!localStream?.getVideoTracks().length}
          aria-label={camOn ? 'Turn camera off' : 'Turn camera on'}
          className={`rounded-full p-3 ${camOn ? 'bg-slate-700' : 'bg-red-600'} disabled:opacity-40`}
        >
          {camOn ? <Video className="h-5 w-5" /> : <VideoOff className="h-5 w-5" />}
        </button>
        <button
          type="button"
          onClick={toggleLowData}
          aria-pressed={lowData}
          className={`flex items-center gap-2 rounded-full px-4 py-3 text-sm font-semibold ${lowData ? 'bg-amber-500 text-black' : 'bg-slate-700'}`}
        >
          <Gauge className="h-4 w-4" />
          {lowData ? 'Low data on' : 'Low data'}
        </button>
        <button type="button" onClick={leave} className="flex items-center gap-2 rounded-full bg-red-600 px-4 py-3 text-sm font-semibold">
          <PhoneOff className="h-4 w-4" />
          Leave
        </button>
        {isHost && (
          <button type="button" onClick={endForEveryone} className="rounded-full bg-slate-700 px-4 py-3 text-sm font-semibold">
            End for everyone
          </button>
        )}
      </div>

      <p className="mt-6 flex items-start justify-center gap-2 text-center text-xs text-slate-400">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
        {join?.relayOnly
          ? 'Audio and video are encrypted and go through Tutorlage’s relay, so the others never see your network address.'
          : 'Audio and video are encrypted and go directly between the devices in this room. The other devices can see your network (IP) address. Nothing is recorded.'}
      </p>
    </Shell>
  );
};

const RoomPage: React.FC = () => {
  const { code } = useParams();
  if (!code) return <OpenRoom />;
  return <RoomView key={code} code={code.toUpperCase()} />;
};

export default RoomPage;
