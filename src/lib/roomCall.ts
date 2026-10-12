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
}

// What a video stream is allowed to use, per person we send to (bits per second). Lower with more people,
// and lowest in low-data mode, so a room of four still works on mobile data.
const BITRATE_PAIR = 900_000;
const BITRATE_GROUP = 400_000;
const BITRATE_LOW_DATA = 150_000;

export class RoomCall {
  private readonly opts: RoomCallOptions;
  private readonly peers = new Map<string, Peer>();
  private iceServers: IceServer[];
  private lowData = false;
  private stopped = false;
  private opened = false;

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

  // Relay passwords expire (an hour); the page asks the API for fresh settings now and then and passes them here.
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
