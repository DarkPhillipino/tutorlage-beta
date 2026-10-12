import { useCallback, useEffect, useState } from 'react';
import {
  EMAIL_LINK_COOLDOWN_SECONDS,
  cooldownSecondsLeft,
  cooldownStartTime,
  lastSendStartedAt,
  noteSendStarted,
} from './authHelpers';

// A count-down for "send it again" buttons. `start()` begins it; `secondsLeft` is 0 when the button may be used.
// `startedAt` is returned too so a caller can tie the wait to one address.
//
// With a `key` (for example the address a link goes to) the start time is also remembered for as long as the page
// stays open, so a screen that is closed and opened again inside the minute still shows the wait that is left.
export function useCooldown(totalSeconds: number = EMAIL_LINK_COOLDOWN_SECONDS, key: string | null = null) {
  const [startedAt, setStartedAt] = useState<number | null>(() => (key ? lastSendStartedAt(key) : null));
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (startedAt === null) return;
    const id = window.setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (cooldownSecondsLeft(startedAt, t, totalSeconds) === 0) window.clearInterval(id);
    }, 500);
    return () => window.clearInterval(id);
  }, [startedAt, totalSeconds]);

  // `waitSeconds`, when the server said how long it still wants us to wait, shortens the first count-down to that.
  const start = useCallback(
    (waitSeconds?: number | null) => {
      const t = Date.now();
      const began = cooldownStartTime(t, waitSeconds, totalSeconds);
      if (key) noteSendStarted(key, began);
      setNow(t);
      setStartedAt(began);
    },
    [key, totalSeconds],
  );

  return { secondsLeft: cooldownSecondsLeft(startedAt, now, totalSeconds), startedAt, start };
}
