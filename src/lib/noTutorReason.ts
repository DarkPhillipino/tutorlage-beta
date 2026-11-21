// P5-b (CEO, 21 Nov 2026): when a learner's choice has no tutor, say WHY, and WHEN one is open. The answer comes from the database function
// no_tutor_reason (supabase/migrations/20261121200000_no_tutor_reason.sql), which uses the same rules as the price counts and matching and
// returns time frames only (never a tutor's name, count or profile). No browser or Supabase code here, so scripts/dev/no-tutor-reason-test.ts
// runs it with a pretend database. Until the migration is applied the function is missing: the page must then behave as it did before.
import { isMissingDatabaseFunction } from './keepOrSwap';

export type NoTutorCase = 'ok' | 'no_subject' | 'fully_booked' | 'other_time';

export interface OpenWindow {
  date: string; // YYYY-MM-DD, South African time
  from: string; // HH:MM, South African time
  endDate: string; // YYYY-MM-DD
  to: string; // HH:MM, "24:00" for midnight
  place: string; // "online" today
}

export interface NoTutorReason {
  kind: NoTutorCase;
  windows: OpenWindow[];
}

export interface NoTutorSearch {
  subject: string;
  gradeLevel: string;
  start: string | null; // ISO moment
  hours: number | null;
  minSubTierId?: string | null;
}

export type NoTutorRpc = (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;

// The words (the CEO's wording, 21 Nov 2026). Case 1 is shown in red with an icon; none of the three relies on colour alone.
export const NO_TUTOR_FOR_SUBJECT = 'No tutor available for this subject.';
export const ALL_FULLY_BOOKED = "They're all fully booked at the moment.";
export const CHANGE_YOUR_TIME = 'No tutor is available at the time or date you chose. Please change your time to one of the following time frames:';
// Information, not a promise (the PM's note on P5-b): said in plain words under the time frames.
export const NOT_A_PROMISE = 'This is a guide, not a promise: a tutor may be booked by someone else before you send your request.';

const KINDS: NoTutorCase[] = ['ok', 'no_subject', 'fully_booked', 'other_time'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function isWindow(x: unknown): x is Record<string, unknown> {
  return !!x && typeof x === 'object';
}

// Reads the database's answer. Anything unexpected is "no answer" (null), so the page falls back to what it said before.
export function parseNoTutorReason(data: unknown): NoTutorReason | null {
  if (!data || typeof data !== 'object') return null;
  const raw = data as { case?: unknown; windows?: unknown };
  if (typeof raw.case !== 'string' || !KINDS.includes(raw.case as NoTutorCase)) return null;
  const windows: OpenWindow[] = [];
  for (const w of Array.isArray(raw.windows) ? raw.windows : []) {
    if (!isWindow(w)) continue;
    const { date, from, to } = w as Record<string, unknown>;
    if (typeof date !== 'string' || typeof from !== 'string' || typeof to !== 'string') continue;
    windows.push({
      date,
      from,
      to,
      endDate: typeof w.end_date === 'string' ? w.end_date : date,
      place: typeof w.place === 'string' && w.place !== '' ? w.place : 'online',
    });
  }
  return { kind: raw.case as NoTutorCase, windows: windows.slice(0, 5) };
}

// "Tue 24 Nov, 10:00 to 16:00 SAST, online"; a window that runs past midnight names the second day.
export function formatWindow(w: OpenWindow): string {
  const [y, m, d] = w.date.split('-').map(Number);
  const when = `${DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${d} ${MONTHS[m - 1]}`;
  const until = w.endDate !== w.date ? `${w.to} the next day` : w.to;
  return `${when}, ${w.from} to ${until} SAST, ${w.place}`;
}

// Asks the database. A missing function (the migration is not applied yet) or any error is null: the caller keeps its old wording.
export async function askNoTutorReason(rpc: NoTutorRpc, search: NoTutorSearch): Promise<NoTutorReason | null> {
  const args: Record<string, unknown> = {
    p_subject: search.subject,
    p_grade: search.gradeLevel,
    p_start: search.start,
    p_hours: search.hours,
  };
  if (search.minSubTierId) args.p_min_sub_tier = search.minSubTierId;
  const { data, error } = await rpc('no_tutor_reason', args);
  if (error) {
    if (isMissingDatabaseFunction(error)) return null;
    throw error;
  }
  return parseNoTutorReason(data);
}
