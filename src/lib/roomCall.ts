// Browser-to-browser calls for a video room (master backlog 7bm; design: Drake/programmer/video-rooms-design-v2.md).
//
// Each person's browser connects straight to each other person's browser (up to 4 people, so at most 3 connections
// each). Audio and video never pass through Tutorlage's servers; WebRTC encrypts them between the browsers. What
// does travel through us is the set-up chatter (offers, answers, network candidates) over a private Supabase
// Realtime channel that the database only opens to people admitted to the room (migration 20261009200000).
// If a relay is configured (iceServers from the rooms API), calls that can't connect directly go through it.
//
// "Perfect negotiation" (the pattern from the WebRTC specification's examples) lets both sides start a connection
// at the same moment without breaking it: one side of each pair is "polite" and backs off if the offers collide.
import type { Signal, SignalTransport } from './roomTransport';
import type { IceServer } from './videoRooms';

interface Peer {
  id: string;
  pc: RTCPeerConnection;
  // Of any two people, the one with the larger id is polite (a fixed rule both sides agree on).
  polite: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  // Network candidates that arrived before the other side's description.
  queued: RTCIceCandidateInit[];
  stream: MediaStream;
}

export interface RoomCallOptions {
  selfId: string;
  // How the set-up messages travel: the room's private Realtime channel (src/lib/roomTransport.ts), or an
  // in-memory one in tests.
  transport: SignalTransport;
  iceServers: IceServer[];
  // True: use only the relay, so the other person never learns this device's address.
  relayOnly: boolean;
  // Our own camera and microphone; null to take part without sending anything.
  localStream: MediaStream | null;
  onRemoteStream: (peerId: string, stream: MediaStream) => void;
  onPeerGone: (peerId: string) => void;
  onConnectionState: (peerId: string, state: RTCPeerConnectionState) => void;
  // The set-up channel dropped and could not come back; the call may stop working for new arrivals.
  onChannelLost: () => void;
  // Someone not (yet) on the roster sent a set-up message: the page should ask the room for a fresh roster now, so a
  // person who has just been let in is not kept waiting for the next poll. Optional.
  onUnknownSender?: () => void;
}

// What a video stream is allowed to use, per person we send to (bits per second). Lower with more people,
// and lowest in low-data mode, so a room of four still works on mobile data.
const BITRATE_PAIR = 900_000;
const BITRATE_GROUP = 400_000;
const BITRATE_LOW_DATA = 150_000;

// Set-up messages from someone the room has not (yet) listed as in the call are held for a short while, in case they were
// let in a moment ago and our next roster has not caught up; anything older, or beyond these limits, is dropped.
const HELD_MAX_AGE_MS = 60_000;
const HELD_MAX_SENDERS = 8;
const HELD_MAX_PER_SENDER = 24;

interface HeldSignal {
  at: number;
  signal: Signal;
}

export class RoomCall {
  private readonly opts: RoomCallOptions;
  private readonly peers = new Map<string, Peer>();
  private iceServers: IceServer[];
  private lowData = false;
  private stopped = false;
  private opened = false;
  // Who the room currently lists as in the call (never us). null = no roster given: everyone's messages are accepted
  // (call logic on its own, in tests). Once the page gives one, only people on it may connect; see setRoster.
  private roster: Set<string> | null = null;
  private readonly held = new Map<string, HeldSignal[]>();

  constructor(opts: RoomCallOptions) {
    this.opts = opts;
    this.iceServers = opts.iceServers;
  }

  // Join the room's set-up channel and announce ourselves; the people already there start the connections.
  async start(): Promise<void> {
    await this.opts.transport.open(
      (signal) => {
        void this.handle(signal).catch((error) => console.error('Room call: handling a message failed', error));
      },
      () => {
        if (!this.stopped) this.opts.onChannelLost();
      },
    );
    this.opened = true;
    this.send({ kind: 'hello', from: this.opts.selfId });
  }

  // Leave the call: tell the others, close every connection and the channel.
  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    if (this.opened) this.send({ kind: 'bye', from: this.opts.selfId });
    for (const id of [...this.peers.keys()]) this.closePeer(id, false);
    await this.opts.transport.close();
  }

  // The people the room lists as in the call right now (the page passes this from every roster it fetches; we are left
  // out of it). From the first roster on, only they may connect to us: anyone else's set-up messages are held for a
  // short while and then dropped, and a connection to someone who is no longer listed (removed by the host, left, or
  // silent for 90 seconds) is closed from our side, so nothing more is sent to them. This is what makes "Remove" work
  // against a browser that ignores it: the people still in the call stop answering. Our own end of the Realtime channel
  // can still carry their messages (Supabase checks a channel's access once per connection), so we must not rely on it.
  setRoster(ids: string[]): void {
    if (this.stopped) return;
    const next = new Set(ids.filter((id) => id !== this.opts.selfId));
    this.roster = next;
    for (const id of [...this.peers.keys()]) {
      if (!next.has(id)) this.closePeer(id, true);
    }
    const now = Date.now();
    for (const [id, list] of [...this.held]) {
      this.held.delete(id);
      if (next.has(id)) {
        // Replay in the order they arrived; stop if the roster changes again while we wait.
        void (async () => {
          for (const entry of list) {
            if (this.stopped || !this.roster?.has(id)) return;
            await this.dispatch(entry.signal);
          }
        })().catch((error) => console.error('Room call: handling a held message failed', error));
      } else {
        const fresh = list.filter((entry) => now - entry.at <= HELD_MAX_AGE_MS);
        if (fresh.length > 0) this.held.set(id, fresh);
      }
    }
  }

  // Start every connection afresh: close ours, then say hello, so the people in the call set up new ones with us. For a
  // page that was away (a sleeping phone, a dropped connection) or whose place was lost and given back: by then the
  // others will have closed their end.
  announce(): void {
    if (this.stopped || !this.opened) return;
    for (const id of [...this.peers.keys()]) this.closePeer(id, true);
    this.send({ kind: 'hello', from: this.opts.selfId });
  }

  // Relay passwords expire (by default after four hours); the page asks the API for fresh settings now and then and
  // passes them here.
  updateIceServers(iceServers: IceServer[]): void {
    this.iceServers = iceServers;
    for (const peer of this.peers.values()) {
      try {
        peer.pc.setConfiguration({ iceServers, iceTransportPolicy: this.opts.relayOnly ? 'relay' : 'all' });
      } catch (error) {
        console.error('Room call: could not refresh connection settings', error);
      }
    }
  }

  // Send less video to save mobile data.
  setLowData(on: boolean): void {
    this.lowData = on;
    for (const peer of this.peers.values()) void this.applyBitrate(peer);
  }

  private send(signal: Signal): void {
    this.opts.transport.send(signal);
  }

  private async handle(signal: Signal): Promise<void> {
    if (this.stopped || signal.from === this.opts.selfId) return;
    if (this.roster && !this.roster.has(signal.from)) {
      this.hold(signal);
      return;
    }
    await this.dispatch(signal);
  }

  // A message from someone the room does not list as in the call. Maybe they were let in a moment ago and our roster is
  // behind, so keep a few of their messages briefly and ask for a fresh roster; setRoster handles or drops them. A "bye"
  // from someone we do not list changes nothing for us.
  private hold(signal: Signal): void {
    if (signal.kind === 'bye') {
      this.held.delete(signal.from);
      return;
    }
    // Set-up messages meant for someone else are none of our business.
    if ((signal.kind === 'description' || signal.kind === 'candidate') && signal.to !== this.opts.selfId) return;
    let list = this.held.get(signal.from);
    if (!list) {
      if (this.held.size >= HELD_MAX_SENDERS) return;
      list = [];
      this.held.set(signal.from, list);
    }
    // A new hello starts that person afresh: what they sent before it is out of date.
    if (signal.kind === 'hello') list.length = 0;
    if (list.length >= HELD_MAX_PER_SENDER) return;
    const first = list.length === 0;
    list.push({ at: Date.now(), signal });
    if (first) this.opts.onUnknownSender?.();
  }

  private async dispatch(signal: Signal): Promise<void> {
    if (this.stopped) return;
    switch (signal.kind) {
      case 'hello': {
        // Someone arrived (or came back): start fresh with them. The existing members make the first move.
        this.closePeer(signal.from, true);
        this.ensurePeer(signal.from);
        return;
      }
      case 'bye': {
        this.closePeer(signal.from, true);
        return;
      }
      case 'description': {
        if (signal.to !== this.opts.selfId) return;
        await this.onDescription(signal.from, signal.description);
        return;
      }
      case 'candidate': {
        if (signal.to !== this.opts.selfId) return;
        await this.onCandidate(signal.from, signal.candidate);
        return;
      }
    }
  }

  private ensurePeer(id: string): Peer {
    const existing = this.peers.get(id);
    if (existing) return existing;

    const pc = new RTCPeerConnection({
      iceServers: this.iceServers,
      iceTransportPolicy: this.opts.relayOnly ? 'relay' : 'all',
    });
    const peer: Peer = {
      id,
      pc,
      polite: this.opts.selfId > id,
      makingOffer: false,
      ignoreOffer: false,
      queued: [],
      stream: new MediaStream(),
    };
    this.peers.set(id, peer);

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) this.send({ kind: 'candidate', from: this.opts.selfId, to: id, candidate: candidate.toJSON() });
    };
    pc.ontrack = (event) => {
      const stream = event.streams[0] ?? peer.stream;
      if (!event.streams[0]) peer.stream.addTrack(event.track);
      this.opts.onRemoteStream(id, stream);
    };
    pc.onnegotiationneeded = async () => {
      try {
        peer.makingOffer = true;
        await pc.setLocalDescription();
        if (pc.localDescription) {
          this.send({ kind: 'description', from: this.opts.selfId, to: id, description: pc.localDescription.toJSON() });
        }
      } catch (error) {
        console.error('Room call: could not make an offer', error);
      } finally {
        peer.makingOffer = false;
      }
    };
    pc.onconnectionstatechange = () => {
      this.opts.onConnectionState(id, pc.connectionState);
      if (pc.connectionState === 'connected') void this.applyBitrate(peer);
      // A broken path: try other routes before giving up on this person.
      if (pc.connectionState === 'failed') pc.restartIce();
    };

    // Add what we send. With no camera or microphone we still ask to receive, so the connection sets up and we can
    // see and hear the others.
    const local = this.opts.localStream;
    const kinds = new Set<string>();
    if (local) {
      for (const track of local.getTracks()) {
        pc.addTrack(track, local);
        kinds.add(track.kind);
      }
    }
    for (const kind of ['audio', 'video'] as const) {
      if (!kinds.has(kind)) pc.addTransceiver(kind, { direction: 'recvonly' });
    }
    return peer;
  }

  private closePeer(id: string, announce: boolean): void {
    const peer = this.peers.get(id);
    if (!peer) return;
    this.peers.delete(id);
    peer.pc.onicecandidate = null;
    peer.pc.ontrack = null;
    peer.pc.onnegotiationneeded = null;
    peer.pc.onconnectionstatechange = null;
    peer.pc.close();
    if (announce) this.opts.onPeerGone(id);
    for (const other of this.peers.values()) void this.applyBitrate(other);
  }

  private async onDescription(from: string, description: RTCSessionDescriptionInit): Promise<void> {
    const peer = this.ensurePeer(from);
    const { pc } = peer;
    // Two offers at once is a collision: the polite side gives way, the other ignores the incoming offer.
    const collision = description.type === 'offer' && (peer.makingOffer || pc.signalingState !== 'stable');
    peer.ignoreOffer = !peer.polite && collision;
    if (peer.ignoreOffer) return;
    await pc.setRemoteDescription(description);
    for (const candidate of peer.queued.splice(0)) {
      try {
        await pc.addIceCandidate(candidate);
      } catch (error) {
        if (!peer.ignoreOffer) console.error('Room call: a queued candidate failed', error);
      }
    }
    if (description.type === 'offer') {
      await pc.setLocalDescription();
      if (pc.localDescription) {
        this.send({ kind: 'description', from: this.opts.selfId, to: from, description: pc.localDescription.toJSON() });
      }
    }
  }

  private async onCandidate(from: string, candidate: RTCIceCandidateInit): Promise<void> {
    const peer = this.ensurePeer(from);
    if (!peer.pc.remoteDescription) {
      peer.queued.push(candidate);
      return;
    }
    try {
      await peer.pc.addIceCandidate(candidate);
    } catch (error) {
      // Candidates for an offer we chose to ignore are expected to fail.
      if (!peer.ignoreOffer) console.error('Room call: a candidate failed', error);
    }
  }

  private async applyBitrate(peer: Peer): Promise<void> {
    const maxBitrate = this.lowData ? BITRATE_LOW_DATA : this.peers.size > 1 ? BITRATE_GROUP : BITRATE_PAIR;
    for (const sender of peer.pc.getSenders()) {
      if (sender.track?.kind !== 'video') continue;
      try {
        const parameters = sender.getParameters();
        if (!parameters.encodings || parameters.encodings.length === 0) parameters.encodings = [{}];
        parameters.encodings[0].maxBitrate = maxBitrate;
        if (this.lowData) parameters.encodings[0].scaleResolutionDownBy = 2;
        else delete parameters.encodings[0].scaleResolutionDownBy;
        await sender.setParameters(parameters);
      } catch {
        // Some browsers don't allow this until the connection is up; it is applied again when it connects.
      }
    }
  }
}
