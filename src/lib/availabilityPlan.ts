// The tutor's weekly working hours, as pure rules (no database, no screen): tick days, one time range, one save.
// The stored data does not change: tutor_availability keeps ONE row per day and time range (day_of_week 0 = Sunday .. 6 = Saturday,
// start_time, end_time, South African clock times) and repeats every week until the tutor changes it. This file only decides which rows
// to insert and which to delete so that overlapping or touching ranges on a day become one range and nothing is lost.

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

// What Save does. The ticked days all get the same range. On each day the new range is joined to every stored range it overlaps or
// touches (one row for the joined range; the rows it swallowed are deleted). Other rows are never touched. `replaceIds` are the rows of a
// range the tutor chose to change: they are deleted and the new range takes their place.
export function planSave(rows: AvailabilityRow[], days: number[], startTime: string, endTime: string, replaceIds: string[] = []): SavePlan {
  const start = toMinutes(startTime);
  const end = toMinutes(endTime);
  const ticked = [...new Set(days)].filter((d) => d >= 0 && d <= 6);
  if (ticked.length === 0 && replaceIds.length === 0) return { message: 'Tick at least one day.', inserts: [], deleteIds: [], changedDays: [] };
  if (end <= start) return { message: 'The end time must be after the start time.', inserts: [], deleteIds: [], changedDays: [] };
  const replacing = new Set(replaceIds);
  const kept = rows.filter((r) => !replacing.has(r.id));
  const inserts: NewAvailabilityRow[] = [];
  const deleteIds = new Set<string>(replaceIds);
  const changedDays: number[] = [];
  for (const day of ticked) {
    const ranges = rangesForDay(kept, day);
    let from = start;
    let to = end;
    const swallowed: DayRange[] = [];
    for (const r of ranges) {
      if (r.start <= to && r.end >= from) {
        swallowed.push(r);
        from = Math.min(from, r.start);
        to = Math.max(to, r.end);
      }
    }
    // The new range sits inside one stored row already: nothing to write for this day.
    const alreadyThere = swallowed.length === 1 && swallowed[0].ids.length === 1 && swallowed[0].start <= start && swallowed[0].end >= end;
    if (alreadyThere) continue;
    for (const r of swallowed) for (const id of r.ids) deleteIds.add(id);
    inserts.push({ dayOfWeek: day, startTime: fromMinutes(from), endTime: fromMinutes(to) });
    changedDays.push(day);
  }
  return { message: null, inserts, deleteIds: [...deleteIds], changedDays };
}

export function idsForDay(rows: AvailabilityRow[], day: number): string[] {
  return rows.filter((r) => r.dayOfWeek === day).map((r) => r.id);
}
