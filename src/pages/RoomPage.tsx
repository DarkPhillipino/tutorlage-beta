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
  cameraIsAllowed,
  createRoom,
  endRoom,
  joinRoom,
  leaveRoom,
  leaveRoomOnClose,
  myRooms,
  newVisitId,
  removeMember,
  roomLink,
  roomState,
  startHeartbeat,
} from '../lib/videoRooms';
import type { Heartbeat, HeartbeatStatus, MyRoom, RoomJoin, RoomPerson, RoomState } from '../lib/videoRooms';

// 'replaced': the same person opened the room in another tab or on another device, which now holds their place.
type Phase = 'starting' | 'lobby' | 'in-call' | 'ended' | 'error' | 'replaced';

const POLL_MS = 2500;
const ICE_REFRESH_MS = 20 * 60 * 1000;
// If our last answer from the room is older than this, the page was away (a sleeping phone, a dropped connection): by now
// the others may have closed their end of our connections, so we start them afresh. Normal beats come every 25 seconds.
const AWAY_MS = 60_000;

// The people the room lists as in the call right now, other than us: the only ones our call may connect to.
const othersInCall = (people: RoomPerson[], selfId: string) =>
  people.filter((p) => p.status === 'admitted' && p.id !== selfId).map((p) => p.id);

// A hiccup, not an answer from the room: no connection, a busy server (429) or a server error (5xx). While in a room the
// page keeps going through these, because the next poll or beat usually works; only the room's own refusals end a visit.
const isHiccup = (e: unknown) => e instanceof RoomError && (e.status === 0 || e.status === 429 || e.status >= 500);

// The people whose video must not be shown: anyone the room lists without a clear "camera allowed" (a learner under 18).
const withoutVideo = (people: RoomPerson[], selfId: string) =>
  people.filter((p) => p.id !== selfId && !cameraIsAllowed(p)).map((p) => p.id);

// Camera and microphone. Falls back to audio only, then to nothing, and says why. A learner under 18 (allowCamera false) is
// never asked for a camera at all: the browser's camera permission is not even requested.
async function getLocalMedia(allowCamera: boolean): Promise<{ stream: MediaStream | null; note: string | null }> {
  if (!navigator.mediaDevices?.getUserMedia) {
    return { stream: null, note: "This browser can't use a camera or microphone here. You can still see and hear the others." };
  }
  if (!allowCamera) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      return { stream, note: 'Your camera stays off on Tutorlage because you are under 18. You can speak and hear everyone, and see those who use their camera.' };
    } catch {
      return {
        stream: null,
        note: "Tutorlage couldn't use your microphone (check the browser's permission for this site). You can still see and hear the others. Your camera stays off on Tutorlage because you are under 18.",
      };
    }
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

// /room: a tutor opens a room (or goes back into one that is still open); anyone else is told to ask for a link.
const OpenRoom: React.FC = () => {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [size, setSize] = useState(4);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rooms, setRooms] = useState<MyRoom[]>([]);

  const isTutor = profile?.role === 'tutor';
  // The rooms this tutor already has open, so a lost link can be found again (a tutor may have 5 open at once).
  useEffect(() => {
    if (!isTutor) return;
    let cancelled = false;
    myRooms().then(
      (list) => {
        if (!cancelled) setRooms(list);
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [isTutor]);

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
          {rooms.length > 0 && (
            <div className="border-t border-slate-200 pt-4 text-left">
              <p className="mb-2 text-sm font-semibold">Your open rooms</p>
              <ul className="space-y-2">
                {rooms.map((room) => (
                  <li
                    key={room.code}
                    className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  >
                    <span className="text-slate-600">
                      {room.inRoom} of {room.maxParticipants} in the room · open until{' '}
                      {new Date(room.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <Link to={`/room/${room.code}`} className="font-semibold text-[#15803D]">
                      Go in
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
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
  // May our own camera be used? Only when the server says so (an adult). Until then, and for a learner under 18: no.
  const [camAllowed, setCamAllowed] = useState(false);
  const [lowData, setLowData] = useState(false);
  const [copied, setCopied] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [lostChannel, setLostChannel] = useState(false);

  const callRef = useRef<RoomCall | null>(null);
  const localRef = useRef<MediaStream | null>(null);
  const enteredRef = useRef(false);
  const startedCallRef = useRef(false);
  const lastIceRef = useRef(0);
  // This page visit's id (made when the room opens): sent with join, heartbeat and leave.
  const visitRef = useRef('');
  // Stops this visit's polling and heartbeat at once. "Leave" and "End for everyone" call it first, so a beat that is
  // already on its way cannot answer "left" and make the page join the room again while the person is walking out.
  const stopVisitRef = useRef<(() => void) | null>(null);
  // Asks for a fresh roster at once (the call uses it when someone it does not know yet sends a set-up message).
  const askRosterRef = useRef<(() => void) | null>(null);

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

  const fail = useCallback(
    (e: unknown) => {
      // Whatever ended this visit (the room was ended, we were removed, an error), the camera and microphone must not
      // keep running behind the message.
      void teardown();
      if (e instanceof RoomError && e.status === 410) {
        setPhase('ended');
        return;
      }
      setError(e instanceof Error ? e.message : 'Something went wrong with the room.');
      setPhase('error');
    },
    [teardown],
  );

  // Get camera and microphone, then join the room's set-up channel. isCancelled: the visit ended meanwhile (the page
  // was left or closed while the browser was asking for the camera), so nothing may be started or kept.
  const enterCall = useCallback(
    async (
      state: Pick<RoomJoin | RoomState, 'iceServers' | 'relayOnly' | 'cameraAllowed'> & { channelName: string },
      isCancelled: () => boolean,
      // Who the room lists as in the call (without us). [] when we have not heard yet: nobody may connect until we have.
      roster: string[],
      // Of those, whose video must not be shown.
      noVideo: string[],
    ) => {
      if (startedCallRef.current) return;
      startedCallRef.current = true;
      const allowCamera = cameraIsAllowed(state);
      setCamAllowed(allowCamera);
      const { stream, note } = await getLocalMedia(allowCamera);
      if (isCancelled()) {
        stopStream(stream);
        startedCallRef.current = false;
        return;
      }
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
        cameraAllowed: allowCamera,
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
        onUnknownSender: () => askRosterRef.current?.(),
      });
      // Before the channel opens, so that nobody the room does not list can start a connection with us.
      call.setRoster(roster, noVideo);
      callRef.current = call;
      lastIceRef.current = Date.now();
      try {
        await call.start();
        if (isCancelled()) {
          await teardown();
          return;
        }
        setPhase('in-call');
      } catch (e) {
        await teardown();
        throw e;
      }
    },
    [selfId, teardown],
  );

  // Join, wait in the lobby if need be, keep the room's list of people fresh, and keep telling the room we are still
  // here (the heartbeat): a closed tab or a crash is noticed by the silence and frees the seat. On the way out the page
  // also sends a best-effort "leave" (when the tab closes, and when the person leaves).
  useEffect(() => {
    if (!selfId) return;
    let cancelled = false;
    let timer: number | undefined;
    let heartbeat: Heartbeat | null = null;
    const visit = newVisitId();
    visitRef.current = visit;
    const isCancelled = () => cancelled;

    const stopTimers = () => {
      if (timer) window.clearTimeout(timer);
      timer = undefined;
      heartbeat?.stop();
    };
    stopVisitRef.current = () => {
      cancelled = true;
      stopTimers();
    };
    // Something ended this visit for good (the room ended, we were removed, an error): stop everything and say why.
    const finish = (e: unknown) => {
      cancelled = true;
      stopTimers();
      fail(e);
    };
    // The same person opened the room in another tab or device, which now holds their place. That visit's "leave"
    // is the one that counts, so this page sends none.
    const replaced = () => {
      cancelled = true;
      stopTimers();
      enteredRef.current = false;
      void teardown();
      setPhase('replaced');
    };

    // What the room says about our place, every ~25 seconds and whenever the page suspects something is off.
    let lastAnswerAt = Date.now();
    const onHeartbeat = async (status: HeartbeatStatus) => {
      if (cancelled) return;
      const away = Date.now() - lastAnswerAt > AWAY_MS;
      lastAnswerAt = Date.now();
      if (away && (status === 'admitted' || status === 'waiting')) {
        // We were away for a while and are still in: the others will have closed their end, so start afresh.
        callRef.current?.announce();
      }
      if (status === 'superseded') {
        replaced();
      } else if (status === 'removed') {
        finish(new RoomError('You were removed from this room.', 403));
      } else if (status === 'left') {
        // No longer in the room (our seat went to someone else while we were offline, or the room dropped us): join
        // again. That checks the room's size, so a full room says so.
        try {
          const again = await joinRoom(code, visit);
          if (cancelled) return;
          setJoin(again);
          // Our place was lost and is given back: the others closed their end while we were out, so start afresh.
          if (again.status === 'admitted') callRef.current?.announce();
        } catch (e) {
          // A hiccup: the next beat finds out we are still out and tries again.
          if (isHiccup(e)) return;
          if (!cancelled) finish(e);
        }
      }
    };

    // One poll at a time. A request to poll now (someone unknown sent a set-up message) while one is running makes the next
    // one follow at once instead of after the usual wait.
    let ticking = false;
    let tickAgain = false;
    const tick = async () => {
      if (cancelled) return;
      if (ticking) {
        tickAgain = true;
        return;
      }
      ticking = true;
      tickAgain = false;
      if (timer) window.clearTimeout(timer);
      timer = undefined;
      try {
        // Relay passwords only when entering the call and every 20 minutes after: not on every poll.
        const needIce = !startedCallRef.current || Date.now() - lastIceRef.current > ICE_REFRESH_MS;
        const state = await roomState(code, needIce);
        if (cancelled) return;
        setPeople(state.participants);
        const roster = othersInCall(state.participants, selfId);
        const noVideo = withoutVideo(state.participants, selfId);
        if (state.status === 'left') {
          // Not in the room any more. The heartbeat's answer tells whether another tab of ours took over (stop) or the
          // place was lost (join again), so it decides.
          void heartbeat?.beatNow();
        } else if (state.status === 'admitted') {
          if (!startedCallRef.current) {
            await enterCall(
              {
                iceServers: state.iceServers,
                relayOnly: state.relayOnly,
                cameraAllowed: state.cameraAllowed,
                channelName: `room:${state.roomId}`,
              },
              isCancelled,
              roster,
              noVideo,
            );
          } else if (callRef.current) {
            // Only the people the room lists may stay connected to us; anyone removed or gone is cut off from our side.
            callRef.current.setRoster(roster, noVideo);
            if (needIce && state.iceServers.length > 0) {
              // Never replace working settings with an empty answer.
              callRef.current.updateIceServers(state.iceServers);
              lastIceRef.current = Date.now();
            }
          }
        }
      } catch (e) {
        // A hiccup (no connection, a busy server, a rate limit): keep trying. Anything else ends the visit.
        if (!isHiccup(e)) {
          if (!cancelled) finish(e);
          return;
        }
      } finally {
        ticking = false;
      }
      if (!cancelled) timer = window.setTimeout(tick, tickAgain ? 0 : POLL_MS);
    };
    askRosterRef.current = () => void tick();

    // The tab is closing: the browser lets one small request out. If it never arrives the heartbeat's silence does the job.
    const onPageHide = () => {
      if (enteredRef.current) leaveRoomOnClose(code, visit);
    };
    window.addEventListener('pagehide', onPageHide);

    // The page is back on screen or the connection is back (a phone woken from sleep, a laptop lid opened): say we are
    // here now rather than waiting for the next beat, so the seat is not lost to a slow timer.
    const onVisible = () => {
      if (!document.hidden) void heartbeat?.beatNow();
    };
    const onOnline = () => void heartbeat?.beatNow();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);

    // Start on the next tick, not at once. In development React mounts the page, unmounts it and mounts it again straight
    // away; starting at once would send two joins with two different visit ids, and if the older one landed last it
    // would hold the place and this visit would be told it was replaced. The cleanup below cancels the first start.
    const startTimer = window.setTimeout(() => {
      void (async () => {
        try {
          const joined = await joinRoom(code, visit);
          if (cancelled) {
            // The page was left while the answer was on its way: give the place back at once.
            void leaveRoom(code, visit).catch(() => undefined);
            return;
          }
          enteredRef.current = true;
          setJoin(joined);
          setPhase(joined.status === 'admitted' ? 'starting' : 'lobby');
          heartbeat = startHeartbeat({
            code,
            visit,
            onStatus: (status) => void onHeartbeat(status),
            onFatal: finish,
          });
          if (joined.status === 'admitted') {
            // The roster is not known yet: the call lets nobody connect until the first poll below has given it.
            await enterCall(
              {
                iceServers: joined.iceServers,
                relayOnly: joined.relayOnly,
                cameraAllowed: joined.cameraAllowed,
                channelName: joined.channel,
              },
              isCancelled,
              [],
              [],
            );
            if (cancelled) return;
            timer = window.setTimeout(tick, 0);
            return;
          }
          timer = window.setTimeout(tick, POLL_MS);
        } catch (e) {
          if (!cancelled) finish(e);
        }
      })();
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(startTimer);
      stopTimers();
      stopVisitRef.current = null;
      askRosterRef.current = null;
      window.removeEventListener('pagehide', onPageHide);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
      const entered = enteredRef.current;
      enteredRef.current = false;
      void teardown().then(() => {
        if (entered) void leaveRoom(code, visit).catch(() => undefined);
      });
    };
  }, [code, selfId, enterCall, fail, teardown]);

  const isHost = join?.isHost ?? false;
  // A booked session's own room admits only its tutor, its learner and the learner's guardian, so there is nobody to let
  // in or remove, and the tutor cannot send the learner or guardian away or end the room: the database refuses both.
  const isSessionRoom = Boolean(join?.sessionId);
  const canManage = isHost && !isSessionRoom;
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
    stopVisitRef.current?.();
    enteredRef.current = false;
    // Sent but not waited for: a slow connection must not keep someone on this page after they pressed Leave. The page
    // stays alive while the app navigates, so the request still goes out; if it never arrives, the room notices the
    // silence (90 seconds) and frees the seat anyway.
    void leaveRoom(code, visitRef.current).catch(() => undefined);
    await teardown();
    navigate('/', { replace: true });
  };
  const endForEveryone = async () => {
    if (!window.confirm('End this room for everyone?')) return;
    stopVisitRef.current?.();
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
  if (phase === 'replaced') {
    return (
      <Message
        title="You joined this room somewhere else"
        body="You opened this room in another tab or on another device, so this one was closed. You are only in the room once."
        action={
          <div className="space-y-3">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="w-full rounded-xl bg-[#15803D] px-4 py-3 font-semibold text-white"
            >
              Join from this tab instead
            </button>
            <Link to="/" className="block text-sm font-semibold text-slate-500">Back to Tutorlage</Link>
          </div>
        }
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
        {canManage && (
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

      {canManage && waiting.length > 0 && (
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
            <Tile stream={remote[id].stream} label={nameOf(id)} off={remote[id].stream.getVideoTracks().length === 0} />
            {remote[id].state !== 'connected' && (
              <span className="absolute right-2 top-2 rounded-md bg-black/60 px-2 py-0.5 text-xs">
                {remote[id].state === 'failed' ? "Can't connect" : 'Connecting…'}
              </span>
            )}
            {canManage && (
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
          {canManage ? 'Share the link, then let people in when they appear above.' : "You're in. Waiting for the others to connect…"}
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
        {camAllowed && (
          <button
            type="button"
            onClick={toggleCam}
            disabled={!localStream?.getVideoTracks().length}
            aria-label={camOn ? 'Turn camera off' : 'Turn camera on'}
            className={`rounded-full p-3 ${camOn ? 'bg-slate-700' : 'bg-red-600'} disabled:opacity-40`}
          >
            {camOn ? <Video className="h-5 w-5" /> : <VideoOff className="h-5 w-5" />}
          </button>
        )}
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
        {canManage && (
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
