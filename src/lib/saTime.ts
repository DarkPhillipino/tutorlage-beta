// Every time a person is shown for a session is shown in South African time and says so (CEO, 1 Nov 2026: "Session times name the zone";
// release gate row SA-LOCALE-01). South Africa has no daylight saving: it is UTC+2 all year, written SAST, so a fixed two-hour shift is exact
// and gives the same words in every browser (no locale tables). A learner or a tutor abroad sees the same SAST time as everyone else, which
// is also the zone a request is booked in (lib/requestSchedule.ts) and the zone tutors set their weekly hours in.
// No browser or Supabase code, so scripts/dev/sa-time-test.ts runs it directly.

export const SA_ZONE_LABEL = 'SAST';
const SA_OFFSET_MS = 2 * 3_600_000;
const DAY_MS = 86_400_000;

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export type TimeInput = string | number | Date | null | undefined;

interface SaParts {
  year: number;
  month: number; // 0-11
  day: number;
  weekday: number; // 0 = Sunday
  hour: number;
  minute: number;
  // The South African calendar day as a whole number (days since 1 Jan 1970), so two moments can be compared by day.
  dayNumber: number;
}

function saParts(input: TimeInput): SaParts | null {
  if (input === null || input === undefined || input === '') return null;
  const ms = input instanceof Date ? input.getTime() : new Date(input).getTime();
  if (Number.isNaN(ms)) return null;
  const sa = new Date(ms + SA_OFFSET_MS);
  return {
    year: sa.getUTCFullYear(),
    month: sa.getUTCMonth(),
    day: sa.getUTCDate(),
    weekday: sa.getUTCDay(),
    hour: sa.getUTCHours(),
    minute: sa.getUTCMinutes(),
    dayNumber: Math.floor((ms + SA_OFFSET_MS) / DAY_MS),
  };
}

const two = (n: number) => String(n).padStart(2, '0');

// "14:00" (24-hour), the time on the South African clock, no zone word. Used where the zone is named once for several times.
export function formatSaClock(input: TimeInput): string {
  const p = saParts(input);
  return p ? `${two(p.hour)}:${two(p.minute)}` : '';
}

// "14:00 SAST".
export function formatSaTime(input: TimeInput): string {
  const clock = formatSaClock(input);
  return clock ? `${clock} ${SA_ZONE_LABEL}` : '';
}

// "Sat 17 Oct"; the year is added only when it is not the current South African year ("Sat 17 Oct 2027").
export function formatSaDate(input: TimeInput, now: number = Date.now()): string {
  const p = saParts(input);
  if (!p) return '';
  const base = `${WEEKDAYS[p.weekday]} ${p.day} ${MONTHS[p.month]}`;
  const thisYear = saParts(now)?.year;
  return thisYear !== undefined && p.year !== thisYear ? `${base} ${p.year}` : base;
}

// "Sat 17 Oct, 14:00 SAST".
export function formatSaDateTime(input: TimeInput, now: number = Date.now()): string {
  const date = formatSaDate(input, now);
  return date ? `${date}, ${formatSaTime(input)}` : '';
}

// "Today, 14:00 SAST", "Tomorrow, 14:00 SAST", or "Sat 17 Oct, 14:00 SAST": the day is the South African day, not the browser's.
export function describeSaWhen(input: TimeInput, now: number = Date.now()): string {
  const p = saParts(input);
  const today = saParts(now);
  if (!p || !today) return '';
  const days = p.dayNumber - today.dayNumber;
  if (days === 0) return `Today, ${formatSaTime(input)}`;
  if (days === 1) return `Tomorrow, ${formatSaTime(input)}`;
  return formatSaDateTime(input, now);
}
