// How the connection set-up messages of a video room travel (master backlog 7bm). src/lib/roomCall.ts only needs
// "send a message to the room" and "tell me when one arrives"; this file supplies that over a private Supabase
// Realtime channel, which the database only opens to people admitted to the room (migration 20261009200000). Kept
// apart so the call logic can be tested with an in-memory transport (scripts/dev/room-loopback.html).
import { supabase } from './supabaseClient';

export type Signal =
  | { kind: 'hello'; from: string }
  | { kind: 'description'; from: string; to: string; description: RTCSessionDescriptionInit }
  | { kind: 'candidate'; from: string; to: string; candidate: RTCIceCandidateInit }
  | { kind: 'bye'; from: string };

export interface SignalTransport {
  // Start listening; resolves once messages sent from now on will be delivered. `onLost` fires if the channel drops
  // after that.
  open(onSignal: (signal: Signal) => void, onLost: () => void): Promise<void>;
  send(signal: Signal): void;
  close(): Promise<void>;
}

// The room's private channel ("room:<uuid>"). Messages are not echoed back to the sender.
export function supabaseTransport(channelName: string): SignalTransport {
  let channel: ReturnType<typeof supabase.channel> | null = null;
  let subscribed = false;
  let closed = false;

  return {
    async open(onSignal, onLost) {
      await supabase.realtime.setAuth();
      const next = supabase.channel(channelName, { config: { private: true, broadcast: { self: false, ack: false } } });
      channel = next;
      next.on('broadcast', { event: 'signal' }, ({ payload }) => onSignal(payload as Signal));
      await new Promise<void>((resolve, reject) => {
        next.subscribe((status, error) => {
          if (status === 'SUBSCRIBED') {
            subscribed = true;
            resolve();
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            if (!subscribed) reject(error ?? new Error(`The room's connection channel could not open (${status}).`));
            else if (!closed) onLost();
          }
        });
      });
    },
    send(signal) {
      if (!channel) return;
      void channel.send({ type: 'broadcast', event: 'signal', payload: signal }).catch((error: unknown) => {
        console.error('Room call: a set-up message did not send', error);
      });
    },
    async close() {
      closed = true;
      if (!channel) return;
      const current = channel;
      channel = null;
      await supabase.removeChannel(current);
    },
  };
}
