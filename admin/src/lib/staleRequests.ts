// Road to P5 item 3 (18 Nov 2026): paid requests that have waited 24 hours or more for a tutor. The database function admin_stale_requests is read-only, admin-only and names nobody
// (request id, times, whether it was sent to one tutor, how it was paid). Shown on the Phase 1 numbers page and counted by the "request waiting" alert.

export type StaleFunding = 'card' | 'wallet' | 'free';
export interface StaleRequest {
  id: string;
  createdAt: string;
  hoursWaiting: number;
  requestedStart: string | null;
  durationHours: number | null;
  sentToOneTutor: boolean;
  funding: StaleFunding;
}

const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

export function mapStaleRequests(data: unknown): StaleRequest[] {
  if (!Array.isArray(data)) return [];
  const out: StaleRequest[] = [];
  for (const raw of data as Record<string, unknown>[]) {
    if (!raw || raw.request_id == null) continue;
    const funding = raw.funding === 'wallet' || raw.funding === 'free' ? raw.funding : 'card';
    out.push({
      id: String(raw.request_id),
      createdAt: String(raw.created_at ?? ''),
      hoursWaiting: num(raw.hours_waiting) ?? 0,
      requestedStart: raw.requested_start == null ? null : String(raw.requested_start),
      durationHours: num(raw.duration_hours),
      sentToOneTutor: raw.addressed_to_one_tutor === true,
      funding,
    });
  }
  return out;
}

// "1 day 3 hours" / "26 hours": plain words for how long a request has waited.
export function waitedText(hours: number): string {
  if (hours < 48) return `${Math.round(hours)} hours`;
  const days = Math.floor(hours / 24);
  const rest = Math.round(hours - days * 24);
  return rest === 0 ? `${days} days` : `${days} days ${rest} h`;
}

// Null (the section stays hidden) when the function is not on the database yet; an error otherwise, so the page can say so.
export async function fetchStaleRequests(hours = 24): Promise<StaleRequest[] | null> {
  // loaded here, not at the top, so the mapping above can be tested without the browser-only client
  const { supabase } = await import('./supabaseClient');
  const { data, error } = await supabase.rpc('admin_stale_requests', { p_hours: hours });
  if (error) {
    const code = (error as { code?: string }).code;
    if (code === 'PGRST202' || code === '42883') return null;
    throw error;
  }
  return mapStaleRequests(data);
}
