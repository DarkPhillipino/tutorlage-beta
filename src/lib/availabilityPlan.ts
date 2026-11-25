// The tutor's weekly working hours, as pure rules (no database, no screen): tick days, one time range, one save.
// The stored data does not change: tutor_availability keeps ONE row per day and time range (day_of_week 0 = Sunday .. 6 = Saturday,
// start_time, end_time, South African clock times) and repeats every week until the tutor changes it. This file only decides which rows
// to insert and which to delete so that the stored hours are the ones the tutor picked.

export interface AvailabilityRow {
  id: string;
  dayOfWeek: number; // 0 = Sunday .. 6 = Saturday
  startTime: string; // "HH:MM" or "HH:MM:SS"
  endTime: string;
}

export interface NewAvailabilityRow {
  dayOfWeek: number;
  startTime: string; // "HH:MM"
  endTime: string;
}

// The week is shown Monday first (how a tutor thinks of it); the database numbers Sunday 0.
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;
export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const WEEKDAYS = [1, 2, 3, 4, 5];
export const WEEKENDS = [6, 0];
export const EVERY_DAY = [1, 2, 3, 4, 5, 6, 0];

export function toMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

export function fromMinutes(total: number): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// 30-minute steps. A start can be any step from 00:00 to 23:00; an end any step from 00:30 to 23:30 (the day stops at midnight).
export const START_OPTIONS: string[] = Array.from({ length: 47 }, (_, i) => fromMinutes(i * 30));
export const END_OPTIONS: string[] = Array.from({ length: 47 }, (_, i) => fromMinutes((i + 1) * 30));

// A saved time that is not on the 30-minute list (older rows) must still be pickable when the tutor changes it.
export function withValue(options: string[], value: string): string[] {
  if (options.includes(value)) return options;
  return [...options, value].sort();
}

export interface DayRange {
  start: number; // minutes since midnight
  end: number;
  ids: string[]; // the stored rows this range is made of (overlapping or touching rows show as one range)
}

// One day's rows as ranges: sorted, with overlapping or touching rows joined.
export function rangesForDay(rows: AvailabilityRow[], day: number): DayRange[] {
  const own = rows
    .filter((r) => r.dayOfWeek === day)
    .map((r) => ({ start: toMinutes(r.startTime), end: toMinutes(r.endTime), id: r.id }))
    .filter((r) => r.end > r.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const out: DayRange[] = [];
  for (const r of own) {
    const last = out[out.length - 1];
    if (last && r.start <= last.end) {
      last.end = Math.max(last.end, r.end);
      last.ids.push(r.id);
    } else {
      out.push({ start: r.start, end: r.end, ids: [r.id] });
    }
  }
  return out;
}

export function formatRange(r: { start: number; end: number }): string {
  return `${fromMinutes(r.start)} to ${fromMinutes(r.end)}`;
}

// "Monday to Friday", "Saturday and Sunday", "Monday, Wednesday and Friday", "every day".
export function describeDays(days: number[]): string {
  const set = new Set(days);
  if (set.size === 7) return 'every day';
  const ordered = WEEK_ORDER.filter((d) => set.has(d));
  const runs: number[][] = [];
  for (const d of ordered) {
    const run = runs[runs.length - 1];
    if (run && WEEK_ORDER.indexOf(d as typeof WEEK_ORDER[number]) === WEEK_ORDER.indexOf(run[run.length - 1] as typeof WEEK_ORDER[number]) + 1) run.push(d);
    else runs.push([d]);
  }
  const parts = runs.map((run) => (run.length >= 3 ? `${DAY_NAMES[run[0]]} to ${DAY_NAMES[run[run.length - 1]]}` : run.map((d) => DAY_NAMES[d]).join(' and ')));
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

// message is null when the plan can go ahead, and plain words when it cannot (then there is nothing to write).
export interface SavePlan {
  message: string | null;
  inserts: NewAvailabilityRow[];
  deleteIds: string[];
  changedDays: number[];
}

// What Save does (25 Nov 2026: the tutor gets exactly what they pick; before this, Save joined the picked time to the stored one, so hours
// could only ever widen).
//  - mode 'replace' (Save, and Save change): every ticked day ends up with the picked time and nothing else.
//  - Change: `replaceIds` are the rows of the range being changed. On that range's own day the other, separate times stay; a time the new one
//    overlaps or touches is replaced by it (never joined). Every other ticked day is replaced, as in Save.
//  - mode 'add' (the separate "Add as a second time" choice): the stored times stay and the picked time is added beside them. A time that
//    overlaps or touches a stored one is refused in words.
export type SaveMode = 'replace' | 'add';

export function planSave(
  rows: AvailabilityRow[], days: number[], startTime: string, endTime: string, replaceIds: string[] = [], mode: SaveMode = 'replace',
): SavePlan {
  const start = toMinutes(startTime);
  const end = toMinutes(endTime);
  const ticked = [...new Set(days)].filter((d) => d >= 0 && d <= 6);
  const refuse = (message: string): SavePlan => ({ message, inserts: [], deleteIds: [], changedDays: [] });
  if (ticked.length === 0) return refuse('Tick at least one day.');
  if (end <= start) return refuse('The end time must be after the start time.');
  const replacing = new Set(replaceIds);
  const homeDays = new Set(rows.filter((r) => replacing.has(r.id)).map((r) => r.dayOfWeek));
  const inserts: NewAvailabilityRow[] = [];
  const deleteIds = new Set<string>(replaceIds);
  const changedDays: number[] = [];
  const meets = (r: { start: number; end: number }) => r.start <= end && r.end >= start;
  for (const day of WEEK_ORDER) {
    if (!ticked.includes(day)) {
      if (homeDays.has(day)) changedDays.push(day); // the changed range moved away from this day
      continue;
    }
    const own = rows.filter((r) => r.dayOfWeek === day);
    const kept = own.filter((r) => !replacing.has(r.id));
    let goes: AvailabilityRow[] = [];
    if (mode === 'add') {
      const clash = rangesForDay(kept, day).find(meets);
      if (clash) {
        return refuse(`${DAY_NAMES[day]} already has ${formatRange(clash)}, which overlaps or touches this time. To change those hours, press Save instead.`);
      }
    } else if (homeDays.has(day)) {
      const hit = new Set(rangesForDay(kept, day).filter(meets).flatMap((r) => r.ids));
      goes = own.filter((r) => replacing.has(r.id) || hit.has(r.id));
    } else {
      goes = own;
    }
    // A stored row that is already exactly the picked time stays as it is (no delete, no second copy).
    const same = own.find((r) => toMinutes(r.startTime) === start && toMinutes(r.endTime) === end);
    for (const r of goes) if (r !== same) deleteIds.add(r.id);
    if (same) deleteIds.delete(same.id);
    else inserts.push({ dayOfWeek: day, startTime: fromMinutes(start), endTime: fromMinutes(end) });
    if (!same || goes.some((r) => r !== same)) changedDays.push(day);
  }
  return { message: null, inserts, deleteIds: [...deleteIds], changedDays };
}

// True when the stored rows hold exactly this time on this day (as a row of its own).
export function hasExactRow(rows: AvailabilityRow[], day: number, startTime: string, endTime: string): boolean {
  return rows.some((r) => r.dayOfWeek === day && toMinutes(r.startTime) === toMinutes(startTime) && toMinutes(r.endTime) === toMinutes(endTime));
}

// The stored hours of some days in words, from the rows as they are: "Monday to Friday: 16:00 to 20:00; Saturday: 09:00 to 12:00 and 14:00 to 16:00".
export function describeHours(rows: AvailabilityRow[], days: number[]): string {
  const groups: { words: string; days: number[] }[] = [];
  for (const day of WEEK_ORDER.filter((d) => days.includes(d))) {
    const ranges = rangesForDay(rows, day);
    const words = ranges.length === 0 ? 'not available' : ranges.map(formatRange).join(' and ');
    const group = groups.find((g) => g.words === words);
    if (group) group.days.push(day);
    else groups.push({ words, days: [day] });
  }
  return groups
    .map((g) => {
      const named = describeDays(g.days);
      return `${named.charAt(0).toUpperCase()}${named.slice(1)}: ${g.words}`;
    })
    .join('; ');
}

export function idsForDay(rows: AvailabilityRow[], day: number): string[] {
  return rows.filter((r) => r.dayOfWeek === day).map((r) => r.id);
}
