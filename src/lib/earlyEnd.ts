// A session that ends early (CEO, 15 Nov 2026). The database marks it (sessions.ended_early_at: the session's tutor left its video room before the
// scheduled end, after the learner or a parent was in it, and has not come back). These are the plain rules the screens follow; the database
// enforces the tutor's wait itself (complete_session), so nothing here is the only lock.
import { formatSaDate, formatSaDateTime, formatSaTime } from './saTime';

// A reload or a dropped connection is not an early end: the learner's question waits this long after the tutor left. The bell message waits 2 minutes.
export const EARLY_END_GRACE_MS = 60_000;

export interface EarlyEndFields {
  status: string | null;
  scheduledStart: string;
  durationHours: number;
  endedEarlyAt?: string | null;
  earlyEndAckAt?: string | null;
}

export const scheduledEndMs = (s: Pick<EarlyEndFields, 'scheduledStart' | 'durationHours'>): number =>
  new Date(s.scheduledStart).getTime() + s.durationHours * 3_600_000;

const earlyEndIsLive = (s: EarlyEndFields, now: number): boolean => {
  if (s.status !== 'scheduled' || !s.endedEarlyAt) return false;
  const at = new Date(s.endedEarlyAt).getTime();
  return !Number.isNaN(at) && now < scheduledEndMs(s);
};

// The learner / parent is asked "Is everything alright?" until they answer, or the scheduled end passes.
export function showEarlyEndCheckIn(s: EarlyEndFields, now: number = Date.now()): boolean {
  if (!earlyEndIsLive(s, now) || s.earlyEndAckAt) return false;
  return now - new Date(s.endedEarlyAt as string).getTime() >= EARLY_END_GRACE_MS;
}

// The tutor is told straight away, and is told until the scheduled end.
export function showTutorEarlyEnd(s: EarlyEndFields, now: number = Date.now()): boolean {
  return earlyEndIsLive(s, now);
}

// The tutor's message. Same day: "from 14:00 SAST"; another day: "from Thu 12 Nov, 14:00 SAST".
export function tutorEarlyEndMessage(s: Pick<EarlyEndFields, 'scheduledStart' | 'durationHours'>, now: number = Date.now()): string {
  const end = scheduledEndMs(s);
  const sameDay = formatSaDate(end, now) === formatSaDate(now, now);
  return `You ended the session early. You can mark it complete from ${sameDay ? formatSaTime(end) : formatSaDateTime(end)}.`;
}

export const EARLY_END_QUESTION = 'Is everything alright?';
export const EARLY_END_BODY = 'This session ended before its scheduled time.';
